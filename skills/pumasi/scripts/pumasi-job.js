#!/usr/bin/env node
// 품앗이 오케스트레이터 - council-job.js를 기반으로 Codex 외주 개발용으로 가공
// 주요 변경점:
//   - config key: pumasi (council 대신)
//   - tasks 필드 사용 (members 대신)
//   - chairman 개념 없음 (Claude가 직접 검토)
//   - 기본 command: codex exec
//   - 기본 timeout: 3600초 (1시간)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const WORKER_PATH = path.join(SCRIPT_DIR, 'pumasi-job-worker.js');

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, 'pumasi.config.yaml');
const REPO_CONFIG_FILE = path.join(path.resolve(SKILL_DIR, '../..'), 'pumasi.config.yaml');

const DEFAULT_CODEX_COMMAND = 'codex exec --dangerously-bypass-approvals-and-sandbox';
const DEFAULT_TIMEOUT_SEC = 3600;

function killProcess(pid) {
  try {
    if (process.platform === 'win32') {
      process.kill(pid, 'SIGKILL');
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch { /* process already gone */ }
}

function exitWithError(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function resolveDefaultConfigFile() {
  // 1순위: CWD의 .pumasi/ (프로젝트별 config)
  const cwdConfig = path.join(process.cwd(), '.pumasi', 'pumasi.config.yaml');
  if (fs.existsSync(cwdConfig)) return cwdConfig;
  // 2순위: 플러그인 내부 config
  if (fs.existsSync(SKILL_CONFIG_FILE)) return SKILL_CONFIG_FILE;
  // 3순위: 플러그인 루트 2단계 위
  if (fs.existsSync(REPO_CONFIG_FILE)) return REPO_CONFIG_FILE;
  return SKILL_CONFIG_FILE;
}

function parsePumasiConfig(configPath) {
  const fallback = {
    pumasi: {
      tasks: [],
      defaults: { command: DEFAULT_CODEX_COMMAND },
      settings: { timeout: DEFAULT_TIMEOUT_SEC },
    },
  };

  if (!fs.existsSync(configPath)) return fallback;

  let YAML;
  try {
    YAML = require('yaml');
  } catch {
    exitWithError(
      [
        'Missing runtime dependency: yaml',
        'Install it:',
        `  cd ${SKILL_DIR} && npm install yaml`,
        'Or install globally:',
        '  npm install -g yaml',
      ].join('\n')
    );
  }

  let parsed;
  try {
    parsed = YAML.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    exitWithError(`Invalid YAML in ${configPath}: ${error && error.message ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    exitWithError(`Invalid config: expected a YAML object at root`);
  }
  if (!parsed.pumasi) {
    exitWithError(`Invalid config: missing required top-level key 'pumasi:'`);
  }

  const pumasi = parsed.pumasi;
  const merged = {
    pumasi: {
      tasks: [],
      defaults: { command: DEFAULT_CODEX_COMMAND, ...((pumasi.defaults && typeof pumasi.defaults === 'object') ? pumasi.defaults : {}) },
      settings: { timeout: DEFAULT_TIMEOUT_SEC, max_retries: 2, ...((pumasi.settings && typeof pumasi.settings === 'object') ? pumasi.settings : {}) },
      context: { reference_files: [] },
    },
  };

  // tasks 파싱
  if (Array.isArray(pumasi.tasks) && pumasi.tasks.length > 0) {
    merged.pumasi.tasks = pumasi.tasks;
  } else if (Array.isArray(pumasi.members) && pumasi.members.length > 0) {
    // 하위 호환: members 키도 허용
    merged.pumasi.tasks = pumasi.members;
  }

  // Calculate max round
  let maxRound = 1;
  for (const t of merged.pumasi.tasks) {
    const r = Number(t.round) || 1;
    if (r > maxRound) maxRound = r;
  }
  merged.pumasi.maxRound = maxRound;

  // Normalize settings: max_retries -> maxRetries
  if (merged.pumasi.settings.max_retries != null) {
    merged.pumasi.settings.maxRetries = Number(merged.pumasi.settings.max_retries);
  }

  // style 파싱 (코드 스타일 커스텀 규칙)
  if (pumasi.style && typeof pumasi.style === 'string') {
    merged.pumasi.style = pumasi.style.trim();
  } else if (Array.isArray(pumasi.style)) {
    merged.pumasi.style = pumasi.style.map((s) => `- ${s}`).join('\n');
  }

  // context 파싱
  if (pumasi.context && typeof pumasi.context === 'object') {
    if (Array.isArray(pumasi.context.reference_files)) {
      merged.pumasi.context.reference_files = pumasi.context.reference_files;
    }
    if (pumasi.context.project) merged.pumasi.context.project = pumasi.context.project;
    if (pumasi.context.description) merged.pumasi.context.description = pumasi.context.description;
  }

  return merged;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildContextString(config, workingDir) {
  const contextConfig = config.pumasi.context || {};
  const referenceFiles = contextConfig.reference_files || [];
  if (referenceFiles.length === 0) return '';

  const parts = [];
  if (contextConfig.project) {
    parts.push(`# 프로젝트: ${contextConfig.project}`);
    if (contextConfig.description) parts.push(`> ${contextConfig.description}`);
    parts.push('');
  }
  parts.push('---');
  parts.push('## 참조 컨텍스트');
  parts.push('');

  for (const relPath of referenceFiles) {
    const absPath = path.resolve(workingDir || process.cwd(), relPath);
    if (!fs.existsSync(absPath)) {
      parts.push(`<!-- 파일 없음: ${relPath} -->`);
      continue;
    }
    try {
      const content = fs.readFileSync(absPath, 'utf8');
      const fileName = path.basename(relPath, path.extname(relPath));
      parts.push(`### ${fileName}`);
      parts.push('```');
      parts.push(content.trim());
      parts.push('```');
      parts.push('');
    } catch (err) {
      parts.push(`<!-- Error reading ${relPath}: ${err.message} -->`);
    }
  }

  parts.push('---');
  parts.push('## 프로젝트 컨텍스트');
  parts.push('');
  return parts.join('\n');
}

function safeFileName(name) {
  const cleaned = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return cleaned || 'task';
}

function atomicWriteJson(filePath, payload) {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function sleepMs(ms) {
  const msNum = Number(ms);
  if (!Number.isFinite(msNum) || msNum <= 0) return;
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, Math.trunc(msNum));
}

function computeTerminalDoneCount(counts) {
  const c = counts || {};
  return (
    Number(c.done || 0) +
    Number(c.missing_cli || 0) +
    Number(c.error || 0) +
    Number(c.timed_out || 0) +
    Number(c.canceled || 0)
  );
}

function asCodexStepStatus(value) {
  const v = String(value || '');
  if (v === 'pending' || v === 'in_progress' || v === 'completed') return v;
  return 'pending';
}

function buildPumasiUiPayload(statusPayload) {
  const counts = statusPayload.counts || {};
  const done = computeTerminalDoneCount(counts);
  const total = Number(counts.total || 0);
  const isDone = String(statusPayload.overallState || '') === 'done';
  const queued = Number(counts.queued || 0);
  const running = Number(counts.running || 0);

  const tasks = Array.isArray(statusPayload.members) ? statusPayload.members : [];
  const sortedTasks = tasks
    .map((m) => ({ member: String(m.member || ''), state: String(m.state || 'unknown'), exitCode: m.exitCode != null ? m.exitCode : null }))
    .filter((m) => m.member)
    .sort((a, b) => a.member.localeCompare(b.member));

  const terminalStates = new Set(['done', 'missing_cli', 'error', 'timed_out', 'canceled']);
  const dispatchStatus = asCodexStepStatus(isDone ? 'completed' : queued > 0 ? 'in_progress' : 'completed');
  let hasInProgress = dispatchStatus === 'in_progress';

  const taskSteps = sortedTasks.map((m) => {
    const state = m.state || 'unknown';
    const isTerminal = terminalStates.has(state);
    let status;
    if (isTerminal) { status = 'completed'; }
    else if (!hasInProgress && running > 0 && state === 'running') { status = 'in_progress'; hasInProgress = true; }
    else { status = 'pending'; }
    return { label: `[품앗이] ${m.member} 구현`, status: asCodexStepStatus(status) };
  });

  const reviewStatus = asCodexStepStatus(isDone ? (hasInProgress ? 'pending' : 'in_progress') : 'pending');

  const codexPlan = [
    { step: '[품앗이] 태스크 배분', status: dispatchStatus },
    ...taskSteps.map((s) => ({ step: s.label, status: s.status })),
    { step: '[품앗이] Claude 검토 및 통합', status: reviewStatus },
  ];

  const claudeTodos = [
    { content: '[품앗이] 태스크 배분', status: dispatchStatus, activeForm: dispatchStatus === 'completed' ? '배분 완료' : 'Codex에 태스크 배분 중' },
    ...taskSteps.map((s) => ({
      content: s.label,
      status: s.status,
      activeForm: s.status === 'completed' ? '구현 완료' : 'Codex 구현 중',
    })),
    {
      content: '[품앗이] Claude 검토 및 통합',
      status: reviewStatus,
      activeForm: reviewStatus === 'in_progress' ? '검토 준비됨' : '검토 대기 중',
    },
  ];

  return {
    progress: { done, total, overallState: String(statusPayload.overallState || '') },
    codex: { update_plan: { plan: codexPlan } },
    claude: { todo_write: { todos: claudeTodos } },
  };
}

function computeStatusPayload(jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  if (!fs.existsSync(resolvedJobDir)) exitWithError(`jobDir not found: ${resolvedJobDir}`);

  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  if (!jobMeta) exitWithError(`job.json not found`);

  const membersRoot = path.join(resolvedJobDir, 'members');
  if (!fs.existsSync(membersRoot)) exitWithError(`members folder not found`);

  const members = [];
  for (const entry of fs.readdirSync(membersRoot)) {
    const statusPath = path.join(membersRoot, entry, 'status.json');
    const status = readJsonIfExists(statusPath);
    if (status) members.push({ safeName: entry, ...status });
  }

  const totals = { queued: 0, running: 0, done: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 };
  for (const m of members) {
    const state = String(m.state || 'unknown');
    if (Object.prototype.hasOwnProperty.call(totals, state)) totals[state]++;
  }

  const allDone = totals.running === 0 && totals.queued === 0;
  const overallState = allDone ? 'done' : totals.running > 0 ? 'running' : 'queued';

  return {
    jobDir: resolvedJobDir,
    id: jobMeta.id || null,
    overallState,
    counts: { total: members.length, ...totals },
    members: members
      .map((m) => ({ member: m.member, state: m.state, startedAt: m.startedAt || null, finishedAt: m.finishedAt || null, exitCode: m.exitCode != null ? m.exitCode : null, message: m.message || null }))
      .sort((a, b) => String(a.member).localeCompare(String(b.member))),
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { _: [] };
  const booleanFlags = new Set(['json', 'text', 'checklist', 'help', 'h', 'verbose']);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { out._.push(...args.slice(i + 1)); break; }
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const [key, rawValue] = a.split('=', 2);
    if (rawValue != null) { out[key.slice(2)] = rawValue; continue; }
    const normalizedKey = key.slice(2);
    if (booleanFlags.has(normalizedKey)) { out[normalizedKey] = true; continue; }
    const next = args[i + 1];
    if (next == null || next.startsWith('--')) { out[normalizedKey] = true; continue; }
    out[normalizedKey] = next;
    i++;
  }
  return out;
}

function printHelp() {
  process.stdout.write(`품앗이 (Pumasi) — Codex 병렬 외주 개발

Usage:
  pumasi-job.sh start [--config path] [--jobs-dir path] [--round N] "project context"
  pumasi-job.sh start-round --round N <jobDir>
  pumasi-job.sh status [--json|--text|--checklist] [--verbose] <jobDir>
  pumasi-job.sh wait [--cursor CURSOR] [--interval-ms N] [--timeout-ms N] <jobDir>
  pumasi-job.sh results [--json] <jobDir>
  pumasi-job.sh gates [--json] <jobDir>
  pumasi-job.sh redelegate --task <name> [--correction "text"] <jobDir>
  pumasi-job.sh autofix <jobDir>
  pumasi-job.sh stop <jobDir>
  pumasi-job.sh clean <jobDir>

Re-delegation (재위임):
  redelegate retries a specific failed task with correction context.
  autofix automatically re-delegates all tasks with failed gates or errors.

Round-based execution:
  Tasks can have a 'round' field (default: 1). Round 1 tasks run first,
  then round 2 uses round 1 results as context, etc.
  start-round spawns workers for a specific round of an existing job.

Before running: edit pumasi.config.yaml with your task list.
`);
}

function cmdStart(options, prompt) {
  const configPath = options.config || process.env.PUMASI_CONFIG || resolveDefaultConfigFile();
  const jobsDir = options['jobs-dir'] || process.env.PUMASI_JOBS_DIR || path.join(SKILL_DIR, '.jobs');

  ensureDir(jobsDir);

  const config = parsePumasiConfig(configPath);
  const timeoutSetting = Number(config.pumasi.settings.timeout || DEFAULT_TIMEOUT_SEC);
  const timeoutOverride = options.timeout != null ? Number(options.timeout) : null;
  const timeoutSec = Number.isFinite(timeoutOverride) && timeoutOverride > 0 ? timeoutOverride : timeoutSetting;

  const defaultCommand = config.pumasi.defaults.command || DEFAULT_CODEX_COMMAND;

  const rawTasks = config.pumasi.tasks || [];
  if (rawTasks.length === 0) {
    exitWithError(
      'pumasi: 태스크가 없습니다.\npumasi.config.yaml의 tasks: 섹션에 서브태스크를 추가하세요.'
    );
  }

  const tasks = rawTasks.filter((t) => t && t.name);

  const maxRound = config.pumasi.maxRound || 1;
  const requestedRound = options.round != null ? Number(options.round) : null;
  const currentRound = requestedRound || 1;

  // Filter tasks for current round
  const roundTasks = maxRound > 1
    ? tasks.filter(t => (Number(t.round) || 1) === currentRound)
    : tasks;

  if (roundTasks.length === 0) {
    exitWithError(`pumasi: 라운드 ${currentRound}에 해당하는 태스크가 없습니다.`);
  }

  const jobId = `${new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15)}-${crypto.randomBytes(3).toString('hex')}`;
  const jobDir = path.join(jobsDir, `pumasi-${jobId}`);
  const membersDir = path.join(jobDir, 'members');
  ensureDir(membersDir);

  // CWD 결정: config에서 지정하거나 현재 디렉토리 사용
  const workingDir = options.cwd || process.env.PUMASI_CWD || process.cwd();

  // 컨텍스트 + 프롬프트 합치기
  const contextString = buildContextString(config, workingDir);
  const fullPrompt = contextString ? `${contextString}${prompt}` : String(prompt);
  fs.writeFileSync(path.join(jobDir, 'prompt.txt'), fullPrompt, 'utf8');

  const jobMeta = {
    id: `pumasi-${jobId}`,
    createdAt: new Date().toISOString(),
    configPath,
    cwd: workingDir,
    maxRound,
    currentRound,
    settings: { timeoutSec: timeoutSec || null, maxRetries: Number(config.pumasi.settings.maxRetries || config.pumasi.settings.max_retries || 2) },
    style: config.pumasi.style || null,
    tasks: tasks.map((t) => ({
      name: String(t.name),
      command: String(t.command || defaultCommand),
      emoji: t.emoji ? String(t.emoji) : '🤖',
      instruction: t.instruction ? String(t.instruction).trim() : null,
      cwd: t.cwd ? String(t.cwd) : null,
      round: Number(t.round) || 1,
      gates: Array.isArray(t.gates) ? t.gates.map(g => ({
        name: String(g.name || 'unnamed'),
        command: String(g.command || ''),
      })).filter(g => g.command) : [],
    })),
  };
  atomicWriteJson(path.join(jobDir, 'job.json'), jobMeta);

  for (const task of roundTasks) {
    const name = String(task.name);
    const safeName = safeFileName(name);
    const memberDir = path.join(membersDir, safeName);
    ensureDir(memberDir);
    const command = String(task.command || defaultCommand);

    atomicWriteJson(path.join(memberDir, 'status.json'), {
      member: name, state: 'queued',
      queuedAt: new Date().toISOString(), command,
      round: currentRound,
    });

    // 태스크별 CWD: task.cwd > job.cwd > process.cwd()
    const taskCwd = task.cwd ? String(task.cwd) : workingDir;

    const workerArgs = [
      WORKER_PATH,
      '--job-dir', jobDir,
      '--member', name,
      '--safe-member', safeName,
      '--command', command,
      '--cwd', taskCwd,
    ];
    if (timeoutSec && Number.isFinite(timeoutSec) && timeoutSec > 0) {
      workerArgs.push('--timeout', String(timeoutSec));
    }

    const child = spawn(process.execPath, workerArgs, {
      detached: true,
      stdio: 'ignore',
      env: process.env,
      cwd: taskCwd,
    });
    child.unref();
  }

  // 마지막 job 저장
  const lastJobFile = path.join(jobsDir, '.last-job');
  try { fs.writeFileSync(lastJobFile, jobDir, 'utf8'); } catch { /* ignore */ }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ jobDir, ...jobMeta }, null, 2)}\n`);
  } else {
    process.stdout.write(`${jobDir}\n`);
  }
}

function cmdStatus(options, jobDir) {
  const payload = computeStatusPayload(jobDir);

  if (Boolean(options.checklist) && !options.json) {
    const done = computeTerminalDoneCount(payload.counts);
    process.stdout.write(`품앗이 진행상황 (${payload.id || jobDir})\n`);
    process.stdout.write(`완료: ${done}/${payload.counts.total} (실행 중: ${payload.counts.running}, 대기: ${payload.counts.queued})\n`);
    for (const m of payload.members) {
      const state = String(m.state || '');
      const mark = state === 'done' ? '[x]' : (state === 'running' || state === 'queued') ? '[ ]' : '[!]';
      const exitInfo = m.exitCode != null ? ` (exit ${m.exitCode})` : '';
      process.stdout.write(`${mark} ${m.member} — ${state}${exitInfo}\n`);
    }
    return;
  }

  if (Boolean(options.text) && !options.json) {
    const done = computeTerminalDoneCount(payload.counts);
    process.stdout.write(`tasks ${done}/${payload.counts.total} done; running=${payload.counts.running} queued=${payload.counts.queued}\n`);
    if (options.verbose) {
      for (const m of payload.members) {
        process.stdout.write(`- ${m.member}: ${m.state}${m.exitCode != null ? ` (exit ${m.exitCode})` : ''}\n`);
      }
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function parseWaitCursor(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parts = raw.split(':');
  const version = parts[0];
  if (version === 'v2' && parts.length === 5) {
    const bucketSize = Number(parts[1]);
    const dispatchBucket = Number(parts[2]);
    const doneBucket = Number(parts[3]);
    const isDone = parts[4] === '1';
    if (!Number.isFinite(bucketSize) || bucketSize <= 0) return null;
    if (!Number.isFinite(dispatchBucket) || dispatchBucket < 0) return null;
    if (!Number.isFinite(doneBucket) || doneBucket < 0) return null;
    return { version, bucketSize, dispatchBucket, doneBucket, isDone };
  }
  return null;
}

function formatWaitCursor(bucketSize, dispatchBucket, doneBucket, isDone) {
  return `v2:${bucketSize}:${dispatchBucket}:${doneBucket}:${isDone ? 1 : 0}`;
}

function asWaitPayload(statusPayload) {
  const members = Array.isArray(statusPayload.members) ? statusPayload.members : [];
  return {
    jobDir: statusPayload.jobDir,
    id: statusPayload.id,
    overallState: statusPayload.overallState,
    counts: statusPayload.counts,
    members: members.map((m) => ({ member: m.member, state: m.state, exitCode: m.exitCode != null ? m.exitCode : null, message: m.message || null })),
    ui: buildPumasiUiPayload(statusPayload),
  };
}

function resolveBucketSize(options, total, prevCursor) {
  const raw = options.bucket != null ? options.bucket : options['bucket-size'];
  if (raw == null || raw === true) {
    if (prevCursor && prevCursor.bucketSize) return prevCursor.bucketSize;
  } else {
    const asString = String(raw).trim().toLowerCase();
    if (asString !== 'auto') {
      const num = Number(asString);
      if (!Number.isFinite(num) || num <= 0) exitWithError(`wait: invalid --bucket: ${raw}`);
      return Math.trunc(num);
    }
  }
  const totalNum = Number(total || 0);
  if (!Number.isFinite(totalNum) || totalNum <= 0) return 1;
  return Math.max(1, Math.ceil(totalNum / 5));
}

function cmdWait(options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const cursorFilePath = path.join(resolvedJobDir, '.wait_cursor');
  const prevCursorRaw =
    options.cursor != null
      ? String(options.cursor)
      : fs.existsSync(cursorFilePath)
        ? String(fs.readFileSync(cursorFilePath, 'utf8')).trim()
        : '';
  const prevCursor = parseWaitCursor(prevCursorRaw);

  const intervalMs = Math.max(50, Math.trunc(Number(options['interval-ms'] != null ? options['interval-ms'] : 250)));
  const timeoutMs = Math.trunc(Number(options['timeout-ms'] != null ? options['timeout-ms'] : 0));

  let payload = computeStatusPayload(jobDir);
  const bucketSize = resolveBucketSize(options, payload.counts.total, prevCursor);

  const doneCount = computeTerminalDoneCount(payload.counts);
  const isDone = payload.overallState === 'done';
  const total = Number(payload.counts.total || 0);
  const queued = Number(payload.counts.queued || 0);
  const dispatchBucket = queued === 0 && total > 0 ? 1 : 0;
  const doneBucket = Math.floor(doneCount / bucketSize);
  const cursor = formatWaitCursor(bucketSize, dispatchBucket, doneBucket, isDone);

  if (!prevCursor) {
    fs.writeFileSync(cursorFilePath, cursor, 'utf8');
    process.stdout.write(`${JSON.stringify({ ...asWaitPayload(payload), cursor }, null, 2)}\n`);
    return;
  }

  const start = Date.now();
  while (cursor === prevCursorRaw) {
    if (timeoutMs > 0 && Date.now() - start >= timeoutMs) break;
    sleepMs(intervalMs);
    payload = computeStatusPayload(jobDir);
    const d = computeTerminalDoneCount(payload.counts);
    const doneFlag = payload.overallState === 'done';
    const totalCount = Number(payload.counts.total || 0);
    const queuedCount = Number(payload.counts.queued || 0);
    const dispatchB = queuedCount === 0 && totalCount > 0 ? 1 : 0;
    const doneB = Math.floor(d / bucketSize);
    const nextCursor = formatWaitCursor(bucketSize, dispatchB, doneB, doneFlag);
    if (nextCursor !== prevCursorRaw) {
      fs.writeFileSync(cursorFilePath, nextCursor, 'utf8');
      process.stdout.write(`${JSON.stringify({ ...asWaitPayload(payload), cursor: nextCursor }, null, 2)}\n`);
      return;
    }
  }

  const finalPayload = computeStatusPayload(jobDir);
  const finalDone = computeTerminalDoneCount(finalPayload.counts);
  const finalDoneFlag = finalPayload.overallState === 'done';
  const finalTotal = Number(finalPayload.counts.total || 0);
  const finalQueued = Number(finalPayload.counts.queued || 0);
  const finalDispatchBucket = finalQueued === 0 && finalTotal > 0 ? 1 : 0;
  const finalDoneBucket = Math.floor(finalDone / bucketSize);
  const finalCursor = formatWaitCursor(bucketSize, finalDispatchBucket, finalDoneBucket, finalDoneFlag);
  fs.writeFileSync(cursorFilePath, finalCursor, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...asWaitPayload(finalPayload), cursor: finalCursor }, null, 2)}\n`);
}

function cmdResults(options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  const membersRoot = path.join(resolvedJobDir, 'members');
  const members = [];

  if (fs.existsSync(membersRoot)) {
    for (const entry of fs.readdirSync(membersRoot)) {
      const statusPath = path.join(membersRoot, entry, 'status.json');
      const outputPath = path.join(membersRoot, entry, 'output.txt');
      const errorPath = path.join(membersRoot, entry, 'error.txt');
      const status = readJsonIfExists(statusPath);
      if (!status) continue;
      const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
      const stderr = fs.existsSync(errorPath) ? fs.readFileSync(errorPath, 'utf8') : '';
      const gatesPath = path.join(membersRoot, entry, 'gates.json');
      const gatesResult = readJsonIfExists(gatesPath);
      const reportPath = path.join(membersRoot, entry, 'report.json');
      const report = readJsonIfExists(reportPath);
      members.push({ safeName: entry, ...status, output, stderr, gates: gatesResult, report });
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      jobDir: resolvedJobDir,
      id: jobMeta ? jobMeta.id : null,
      prompt: fs.existsSync(path.join(resolvedJobDir, 'prompt.txt'))
        ? fs.readFileSync(path.join(resolvedJobDir, 'prompt.txt'), 'utf8')
        : null,
      members: members
        .map((m) => ({ member: m.member, state: m.state, exitCode: m.exitCode != null ? m.exitCode : null, message: m.message || null, output: m.output, stderr: m.stderr, gates: m.gates || null, report: m.report || null }))
        .sort((a, b) => String(a.member).localeCompare(String(b.member))),
    }, null, 2)}\n`);
    return;
  }

  for (const m of members.sort((a, b) => String(a.member).localeCompare(String(b.member)))) {
    process.stdout.write(`\n${'═'.repeat(60)}\n`);
    process.stdout.write(`🤖 [${m.member}] — ${m.state}${m.exitCode != null ? ` (exit ${m.exitCode})` : ''}\n`);
    process.stdout.write(`${'═'.repeat(60)}\n`);
    if (m.message) process.stdout.write(`⚠️  ${m.message}\n`);
    process.stdout.write(m.output || '(출력 없음)');
    if (!m.output && m.stderr) {
      process.stdout.write('\n[stderr]\n');
      process.stdout.write(m.stderr);
    }
    if (m.gates) {
      const gIcon = m.gates.status === 'passed' ? '✅' : '❌';
      process.stdout.write(`\n${gIcon} Gates: ${m.gates.status} (${m.gates.passedCount || 0}/${m.gates.totalCount || 0})\n`);
      for (const g of (m.gates.gates || [])) {
        process.stdout.write(`  ${g.passed ? '✓' : '✗'} ${g.name}\n`);
      }
    }
    if (m.report) {
      process.stdout.write(`\n📋 Report: ${m.report.status || 'unknown'}\n`);
      if (m.report.summary) process.stdout.write(`  ${m.report.summary}\n`);
      if (Array.isArray(m.report.files_created) && m.report.files_created.length > 0) {
        process.stdout.write(`  Files: ${m.report.files_created.join(', ')}\n`);
      }
      if (Array.isArray(m.report.signatures) && m.report.signatures.length > 0) {
        process.stdout.write(`  Signatures: ${m.report.signatures.join(', ')}\n`);
      }
    }
    process.stdout.write('\n');
  }
}

function cmdGates(options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  if (!jobMeta) exitWithError('gates: job.json not found');

  const membersRoot = path.join(resolvedJobDir, 'members');
  const results = {};

  for (const task of (jobMeta.tasks || [])) {
    const safeName = safeFileName(task.name);
    const memberDir = path.join(membersRoot, safeName);
    const gates = task.gates || [];

    if (gates.length === 0) {
      results[task.name] = { status: 'skipped', gates: [] };
      continue;
    }

    // Check if task completed successfully first
    const status = readJsonIfExists(path.join(memberDir, 'status.json'));
    if (!status || status.state !== 'done') {
      results[task.name] = {
        status: 'skipped',
        reason: `task state: ${status ? status.state : 'unknown'}`,
        gates: [],
      };
      continue;
    }

    // Determine CWD for gate execution
    const taskCwd = task.cwd || jobMeta.cwd || process.cwd();

    const gateResults = [];
    let allPassed = true;

    for (const gate of gates) {
      const startTime = Date.now();
      try {
        if (typeof gate.command !== 'string' || !gate.command.trim()) {
          throw new Error('invalid gate command: must be a non-empty string');
        }
        const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
        const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', gate.command] : ['-c', gate.command];
        const output = execFileSync(shell, shellArgs, {
          cwd: taskCwd,
          timeout: 30000,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        gateResults.push({
          name: gate.name,
          command: gate.command,
          passed: true,
          output: output.trim().slice(0, 500),
          durationMs: Date.now() - startTime,
        });
      } catch (err) {
        allPassed = false;
        gateResults.push({
          name: gate.name,
          command: gate.command,
          passed: false,
          error: err.stderr ? err.stderr.trim().slice(0, 500) : (err.message || 'unknown error'),
          exitCode: err.status != null ? err.status : null,
          durationMs: Date.now() - startTime,
        });
      }
    }

    const gatePayload = {
      status: allPassed ? 'passed' : 'failed',
      passedCount: gateResults.filter(g => g.passed).length,
      totalCount: gateResults.length,
      gates: gateResults,
    };

    // Save gates.json per task
    atomicWriteJson(path.join(memberDir, 'gates.json'), gatePayload);
    results[task.name] = gatePayload;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    for (const [taskName, result] of Object.entries(results)) {
      const icon = result.status === 'passed' ? '✅' : result.status === 'skipped' ? '⏭️' : '❌';
      process.stdout.write(`${icon} ${taskName}: ${result.status}`);
      if (result.passedCount != null) {
        process.stdout.write(` (${result.passedCount}/${result.totalCount})`);
      }
      if (result.reason) process.stdout.write(` — ${result.reason}`);
      process.stdout.write('\n');
      for (const g of (result.gates || [])) {
        const gIcon = g.passed ? '  ✓' : '  ✗';
        process.stdout.write(`${gIcon} ${g.name}`);
        if (!g.passed && g.error) process.stdout.write(` — ${g.error.split('\n')[0]}`);
        process.stdout.write('\n');
      }
    }
  }
}

function cmdStartRound(options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  if (!jobMeta) exitWithError('start-round: job.json not found');

  const roundNum = Number(options.round || options._[0]);
  if (!Number.isFinite(roundNum) || roundNum < 1) {
    exitWithError('start-round: --round N is required (N >= 1)');
  }

  const roundTasks = (jobMeta.tasks || []).filter(t => t.round === roundNum);
  if (roundTasks.length === 0) {
    exitWithError(`start-round: 라운드 ${roundNum}에 해당하는 태스크가 없습니다.`);
  }

  const membersRoot = path.join(resolvedJobDir, 'members');
  const promptPath = path.join(resolvedJobDir, 'prompt.txt');
  const basePrompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  // Collect previous round results as context
  let prevRoundContext = '';
  if (roundNum > 1) {
    const prevRoundTasks = (jobMeta.tasks || []).filter(t => t.round < roundNum);
    const contextParts = ['## 이전 라운드 결과\n'];
    for (const pt of prevRoundTasks) {
      const safeName = safeFileName(pt.name);
      const memberDir = path.join(membersRoot, safeName);
      const status = readJsonIfExists(path.join(memberDir, 'status.json'));
      const report = readJsonIfExists(path.join(memberDir, 'report.json'));
      const output = fs.existsSync(path.join(memberDir, 'output.txt'))
        ? fs.readFileSync(path.join(memberDir, 'output.txt'), 'utf8')
        : '';

      contextParts.push(`### ${pt.name} (라운드 ${pt.round})`);
      contextParts.push(`상태: ${status ? status.state : 'unknown'}`);
      if (report) {
        contextParts.push(`결과: ${report.status || 'unknown'}`);
        if (report.summary) contextParts.push(`요약: ${report.summary}`);
        if (Array.isArray(report.files_created) && report.files_created.length) {
          contextParts.push(`생성 파일: ${report.files_created.join(', ')}`);
        }
      } else if (output) {
        // Truncate output to avoid excessive context
        const truncated = output.length > 2000 ? output.slice(0, 2000) + '\n...(truncated)' : output;
        contextParts.push(`출력:\n${truncated}`);
      }
      contextParts.push('');
    }
    contextParts.push('---\n');
    prevRoundContext = contextParts.join('\n');
  }

  // Update job.json with current round
  jobMeta.currentRound = roundNum;
  atomicWriteJson(path.join(resolvedJobDir, 'job.json'), jobMeta);

  // Write round-specific prompt
  const roundPromptPath = path.join(resolvedJobDir, `prompt-round${roundNum}.txt`);
  const roundPrompt = prevRoundContext + basePrompt;
  fs.writeFileSync(roundPromptPath, roundPrompt, 'utf8');

  // Reset wait cursor so wait loop works for new round
  const cursorFile = path.join(resolvedJobDir, '.wait_cursor');
  try { fs.unlinkSync(cursorFile); } catch { /* ignore */ }

  // Spawn workers for this round
  const taskCwdFallback = jobMeta.cwd || process.cwd();
  const timeoutSec = jobMeta.settings ? jobMeta.settings.timeoutSec : DEFAULT_TIMEOUT_SEC;

  for (const task of roundTasks) {
    const name = String(task.name);
    const safeName = safeFileName(name);
    const memberDir = path.join(membersRoot, safeName);
    ensureDir(memberDir);
    const command = String(task.command || DEFAULT_CODEX_COMMAND);

    // Reset status for re-run
    atomicWriteJson(path.join(memberDir, 'status.json'), {
      member: name, state: 'queued',
      queuedAt: new Date().toISOString(), command,
      round: roundNum,
    });

    const taskCwd = task.cwd || taskCwdFallback;

    const workerArgs = [
      WORKER_PATH,
      '--job-dir', resolvedJobDir,
      '--member', name,
      '--safe-member', safeName,
      '--command', command,
      '--cwd', taskCwd,
    ];
    if (timeoutSec && Number.isFinite(timeoutSec) && timeoutSec > 0) {
      workerArgs.push('--timeout', String(timeoutSec));
    }

    const child = spawn(process.execPath, workerArgs, {
      detached: true,
      stdio: 'ignore',
      env: process.env,
      cwd: taskCwd,
    });
    child.unref();
  }

  process.stdout.write(`${resolvedJobDir}\n`);
}

function cmdRedelegate(options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  if (!jobMeta) exitWithError('redelegate: job.json not found');

  const taskName = options.task || options._[0];
  if (!taskName) exitWithError('redelegate: --task <name> is required');

  const correction = options.correction || options._[1] || '';

  const taskConfig = (jobMeta.tasks || []).find(t => t.name === taskName);
  if (!taskConfig) exitWithError(`redelegate: task "${taskName}" not found in job`);

  const safeName = safeFileName(taskName);
  const membersRoot = path.join(resolvedJobDir, 'members');
  const memberDir = path.join(membersRoot, safeName);

  if (!fs.existsSync(memberDir)) {
    exitWithError(`redelegate: member directory not found for "${taskName}"`);
  }

  // Check retry count
  const maxRetries = (jobMeta.settings && jobMeta.settings.maxRetries != null)
    ? Number(jobMeta.settings.maxRetries)
    : 2;
  const retryCountPath = path.join(memberDir, 'retry_count');
  let retryCount = 0;
  try { retryCount = Number(fs.readFileSync(retryCountPath, 'utf8').trim()) || 0; } catch { /* ignore */ }

  if (retryCount >= maxRetries) {
    process.stderr.write(`redelegate: "${taskName}" has reached max retries (${maxRetries})\n`);
    process.stdout.write(JSON.stringify({
      task: taskName,
      status: 'max_retries_reached',
      retryCount,
      maxRetries
    }, null, 2) + '\n');
    return;
  }

  // Read previous attempt's output, error, gates for context
  const prevOutput = fs.existsSync(path.join(memberDir, 'output.txt'))
    ? fs.readFileSync(path.join(memberDir, 'output.txt'), 'utf8')
    : '';
  const prevError = fs.existsSync(path.join(memberDir, 'error.txt'))
    ? fs.readFileSync(path.join(memberDir, 'error.txt'), 'utf8')
    : '';
  const prevGates = readJsonIfExists(path.join(memberDir, 'gates.json'));
  const prevReport = readJsonIfExists(path.join(memberDir, 'report.json'));
  const prevStatus = readJsonIfExists(path.join(memberDir, 'status.json'));

  // Build re-delegation context
  const redelegationParts = [
    '# 재위임 (Re-delegation)',
    '',
    '## 이전 시도 결과',
    `- 상태: ${prevStatus ? prevStatus.state : 'unknown'}`,
    `- 시도 횟수: ${retryCount + 1}/${maxRetries + 1}`,
    '',
  ];

  if (prevReport) {
    redelegationParts.push('### 이전 보고서');
    redelegationParts.push(`상태: ${prevReport.status || 'unknown'}`);
    if (prevReport.summary) redelegationParts.push(`요약: ${prevReport.summary}`);
    if (Array.isArray(prevReport.files_created)) {
      redelegationParts.push(`생성 파일: ${prevReport.files_created.join(', ')}`);
    }
    redelegationParts.push('');
  }

  if (prevGates) {
    redelegationParts.push('### 게이트 결과');
    redelegationParts.push(`전체: ${prevGates.status} (${prevGates.passedCount}/${prevGates.totalCount})`);
    for (const g of (prevGates.gates || [])) {
      const icon = g.passed ? '✓' : '✗';
      redelegationParts.push(`  ${icon} ${g.name}${g.error ? ': ' + g.error.split('\n')[0] : ''}`);
    }
    redelegationParts.push('');
  }

  if (prevOutput) {
    const truncOutput = prevOutput.length > 1500
      ? prevOutput.slice(0, 1500) + '\n...(truncated)'
      : prevOutput;
    redelegationParts.push('### 이전 출력 (참고)');
    redelegationParts.push(truncOutput);
    redelegationParts.push('');
  }

  if (correction) {
    redelegationParts.push('## 수정 지시사항');
    redelegationParts.push(correction);
    redelegationParts.push('');
  }

  redelegationParts.push('## 필수 규칙');
  redelegationParts.push('- 위 게이트 실패 항목을 반드시 해결하세요');
  redelegationParts.push('- 이전에 생성한 파일이 있다면 수정/덮어쓰기 가능합니다');
  redelegationParts.push('- 새로운 파일을 추가하지 마세요 (지시된 파일만 수정)');
  redelegationParts.push('');
  redelegationParts.push('---');
  redelegationParts.push('');

  // Write re-delegation prompt (prepend to original prompt)
  const originalPromptPath = path.join(resolvedJobDir, 'prompt.txt');
  const originalPrompt = fs.existsSync(originalPromptPath)
    ? fs.readFileSync(originalPromptPath, 'utf8')
    : '';

  const redelegationPrompt = redelegationParts.join('\n') + originalPrompt;
  const redelegationPromptPath = path.join(memberDir, 'redelegate-prompt.txt');
  fs.writeFileSync(redelegationPromptPath, redelegationPrompt, 'utf8');

  // Increment retry count
  fs.writeFileSync(retryCountPath, String(retryCount + 1), 'utf8');

  // Archive previous attempt
  const archiveDir = path.join(memberDir, `attempt-${retryCount}`);
  ensureDir(archiveDir);
  for (const f of ['output.txt', 'error.txt', 'status.json', 'gates.json', 'report.json']) {
    const src = path.join(memberDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(archiveDir, f));
    }
  }

  // Reset status
  const command = String(taskConfig.command || DEFAULT_CODEX_COMMAND);
  atomicWriteJson(path.join(memberDir, 'status.json'), {
    member: taskName, state: 'queued',
    queuedAt: new Date().toISOString(), command,
    retry: retryCount + 1,
  });

  // Delete wait cursor to reset wait loop
  const cursorFile = path.join(resolvedJobDir, '.wait_cursor');
  try { fs.unlinkSync(cursorFile); } catch { /* ignore */ }

  // Spawn worker
  const taskCwd = taskConfig.cwd || jobMeta.cwd || process.cwd();
  const timeoutSec = jobMeta.settings ? jobMeta.settings.timeoutSec : DEFAULT_TIMEOUT_SEC;

  const workerArgs = [
    WORKER_PATH,
    '--job-dir', resolvedJobDir,
    '--member', taskName,
    '--safe-member', safeName,
    '--command', command,
    '--cwd', taskCwd,
  ];
  if (timeoutSec && Number.isFinite(timeoutSec) && timeoutSec > 0) {
    workerArgs.push('--timeout', String(timeoutSec));
  }

  const child = spawn(process.execPath, workerArgs, {
    detached: true,
    stdio: 'ignore',
    env: process.env,
    cwd: taskCwd,
  });
  child.unref();

  process.stderr.write(`redelegate: "${taskName}" retry ${retryCount + 1}/${maxRetries} started\n`);
  process.stdout.write(JSON.stringify({
    task: taskName,
    status: 'redelegated',
    retry: retryCount + 1,
    maxRetries,
    jobDir: resolvedJobDir,
  }, null, 2) + '\n');
}

function cmdAutofix(options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  if (!jobMeta) exitWithError('autofix: job.json not found');

  const maxRetries = (jobMeta.settings && jobMeta.settings.maxRetries != null)
    ? Number(jobMeta.settings.maxRetries)
    : 2;

  const membersRoot = path.join(resolvedJobDir, 'members');
  const failedTasks = [];

  for (const task of (jobMeta.tasks || [])) {
    const safeName = safeFileName(task.name);
    const memberDir = path.join(membersRoot, safeName);
    const status = readJsonIfExists(path.join(memberDir, 'status.json'));
    const gates = readJsonIfExists(path.join(memberDir, 'gates.json'));

    // Check retry count
    const retryCountPath = path.join(memberDir, 'retry_count');
    let retryCount = 0;
    try { retryCount = Number(fs.readFileSync(retryCountPath, 'utf8').trim()) || 0; } catch { /* ignore */ }

    if (retryCount >= maxRetries) continue;

    // Case 1: Task errored out
    if (status && (status.state === 'error' || status.state === 'timed_out')) {
      failedTasks.push({
        name: task.name,
        reason: `task ${status.state}: ${status.message || 'unknown'}`,
        correction: `이전 시도가 ${status.state} 상태로 실패했습니다. ${status.message || ''}. 다시 시도하세요.`,
      });
      continue;
    }

    // Case 2: Gates failed
    if (gates && gates.status === 'failed') {
      const failedGates = (gates.gates || []).filter(g => !g.passed);
      const correction = failedGates.map(g =>
        `게이트 "${g.name}" 실패: ${g.error || 'unknown error'}`
      ).join('\n');
      failedTasks.push({
        name: task.name,
        reason: `gates failed (${gates.passedCount}/${gates.totalCount})`,
        correction: `다음 게이트를 통과하도록 수정하세요:\n${correction}`,
      });
    }
  }

  if (failedTasks.length === 0) {
    process.stderr.write('autofix: 수정이 필요한 태스크가 없습니다.\n');
    process.stdout.write(JSON.stringify({ status: 'no_fixes_needed', tasks: [] }, null, 2) + '\n');
    return;
  }

  process.stderr.write(`autofix: ${failedTasks.length}개 태스크 재위임 시작\n`);

  // Re-delegate each failed task
  for (const ft of failedTasks) {
    process.stderr.write(`autofix: "${ft.name}" — ${ft.reason}\n`);
    cmdRedelegate(
      { task: ft.name, correction: ft.correction, _: [] },
      resolvedJobDir
    );
  }

  process.stdout.write(JSON.stringify({
    status: 'autofix_started',
    tasks: failedTasks.map(ft => ({ name: ft.name, reason: ft.reason })),
  }, null, 2) + '\n');
}

function cmdStop(_options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const membersRoot = path.join(resolvedJobDir, 'members');
  if (!fs.existsSync(membersRoot)) exitWithError(`members 폴더 없음: ${membersRoot}`);

  let stoppedAny = false;
  for (const entry of fs.readdirSync(membersRoot)) {
    const statusPath = path.join(membersRoot, entry, 'status.json');
    const status = readJsonIfExists(statusPath);
    if (!status || status.state !== 'running' || !status.pid) continue;
    killProcess(Number(status.pid)); stoppedAny = true;
  }
  process.stdout.write(stoppedAny ? 'stop: 실행 중인 Codex에 SIGTERM 전송\n' : 'stop: 실행 중인 태스크 없음\n');
}

function cmdRunAll(options, prompt) {
  // Start round 1
  cmdStart(options, prompt);

  // Re-read the job dir from .last-job since cmdStart wrote to stdout
  const jobsDir = options['jobs-dir'] || process.env.PUMASI_JOBS_DIR || path.join(SKILL_DIR, '.jobs');
  const lastJobFile = path.join(jobsDir, '.last-job');
  const jobDir = fs.readFileSync(lastJobFile, 'utf8').trim();
  const resolvedJobDir = path.resolve(jobDir);

  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  if (!jobMeta) exitWithError('run-all: job.json not found after start');
  const maxRound = jobMeta.maxRound || 1;

  let shuttingDown = false;

  const cleanup = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { cmdStop({}, resolvedJobDir); } catch { /* ignore */ }
    try { cmdClean({}, resolvedJobDir); } catch { /* ignore */ }
    process.exit(130);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  for (let round = 1; round <= maxRound; round++) {
    if (shuttingDown) break;

    if (round > 1) {
      cmdStartRound({ round: String(round), _: [] }, resolvedJobDir);
    }

    // Wait for current round to complete
    let overallState = '';
    while (overallState !== 'done') {
      if (shuttingDown) break;
      const payload = computeStatusPayload(resolvedJobDir);
      overallState = payload.overallState;
      if (overallState !== 'done') {
        sleepMs(500);
      }
    }

    if (shuttingDown) break;

    // Run gates
    try { cmdGates({ _: [] }, resolvedJobDir); } catch { /* ignore */ }

    // Check for gate failures
    const jobMetaRefresh = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
    const membersRoot = path.join(resolvedJobDir, 'members');
    let hasGateFailure = false;
    for (const task of (jobMetaRefresh.tasks || [])) {
      const safeName = safeFileName(task.name);
      const gatesPath = path.join(membersRoot, safeName, 'gates.json');
      const gates = readJsonIfExists(gatesPath);
      if (gates && gates.status === 'failed') { hasGateFailure = true; break; }
    }

    if (hasGateFailure) {
      process.stderr.write('run-all: gate failures detected, running autofix...\n');
      try { cmdAutofix({ _: [] }, resolvedJobDir); } catch { /* ignore */ }

      // Wait for autofix tasks to complete
      overallState = '';
      while (overallState !== 'done') {
        if (shuttingDown) break;
        const payload = computeStatusPayload(resolvedJobDir);
        overallState = payload.overallState;
        if (overallState !== 'done') {
          sleepMs(500);
        }
      }

      // Re-run gates after autofix
      if (!shuttingDown) {
        try { cmdGates({ _: [] }, resolvedJobDir); } catch { /* ignore */ }
      }
    }
  }

  process.removeListener('SIGINT', cleanup);
  process.removeListener('SIGTERM', cleanup);

  if (!shuttingDown) {
    cmdResults({}, resolvedJobDir);
    cmdClean({}, resolvedJobDir);
  }
}

function cmdClean(_options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  fs.rmSync(resolvedJobDir, { recursive: true, force: true });
  process.stdout.write(`cleaned: ${resolvedJobDir}\n`);
}

function main() {
  const options = parseArgs(process.argv);
  const [command, ...rest] = options._;

  if (!command || options.help || options.h) { printHelp(); return; }

  function resolveJobDir(arg) {
    if (arg) return arg;
    const jobsDir = options['jobs-dir'] || process.env.PUMASI_JOBS_DIR || path.join(SKILL_DIR, '.jobs');
    const lastJobFile = path.join(jobsDir, '.last-job');
    if (fs.existsSync(lastJobFile)) {
      const saved = fs.readFileSync(lastJobFile, 'utf8').trim();
      if (saved) return saved;
    }
    return null;
  }

  if (command === 'run-all') {
    const prompt = rest.join(' ').trim();
    if (!prompt) exitWithError('run-all: 프로젝트 컨텍스트를 입력하세요');
    cmdRunAll(options, prompt);
    return;
  }
  if (command === 'start') {
    const prompt = rest.join(' ').trim();
    if (!prompt) exitWithError('start: 프로젝트 컨텍스트를 입력하세요');
    cmdStart(options, prompt);
    return;
  }
  if (command === 'start-round') {
    const jobDir = resolveJobDir(rest[0]);
    if (!jobDir) exitWithError('start-round: jobDir 없음');
    cmdStartRound(options, jobDir);
    return;
  }
  if (command === 'status') {
    const jobDir = resolveJobDir(rest[0]);
    if (!jobDir) exitWithError('status: jobDir 없음');
    cmdStatus(options, jobDir);
    return;
  }
  if (command === 'wait') {
    const jobDir = resolveJobDir(rest[0]);
    if (!jobDir) exitWithError('wait: jobDir 없음');
    cmdWait(options, jobDir);
    return;
  }
  if (command === 'results') {
    const jobDir = resolveJobDir(rest[0]);
    if (!jobDir) exitWithError('results: jobDir 없음');
    cmdResults(options, jobDir);
    return;
  }
  if (command === 'gates') {
    const jobDir = resolveJobDir(rest[0]);
    if (!jobDir) exitWithError('gates: jobDir 없음');
    cmdGates(options, jobDir);
    return;
  }
  if (command === 'redelegate') {
    const jobDir = resolveJobDir(rest[0]);
    if (!jobDir) exitWithError('redelegate: jobDir 없음');
    cmdRedelegate(options, jobDir);
    return;
  }
  if (command === 'autofix') {
    const jobDir = resolveJobDir(rest[0]);
    if (!jobDir) exitWithError('autofix: jobDir 없음');
    cmdAutofix(options, jobDir);
    return;
  }
  if (command === 'stop') {
    const jobDir = resolveJobDir(rest[0]);
    if (!jobDir) exitWithError('stop: jobDir 없음');
    cmdStop(options, jobDir);
    return;
  }
  if (command === 'clean') {
    const jobDir = resolveJobDir(rest[0]);
    if (!jobDir) exitWithError('clean: jobDir 없음');
    cmdClean(options, jobDir);
    return;
  }

  exitWithError(`알 수 없는 명령: ${command}`);
}

if (require.main === module) {
  main();
}

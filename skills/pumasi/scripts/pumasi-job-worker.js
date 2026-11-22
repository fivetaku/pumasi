#!/usr/bin/env node
// 품앗이 워커 - council-job-worker.js와 동일한 구조
// 각 Codex 인스턴스를 detached 프로세스로 실행하고 결과를 output.txt에 저장

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { finished } = require('node:stream/promises');

const OUTPUT_SCHEMA_PATH = path.join(__dirname, 'codex-output-schema.json');

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

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const [key, rawValue] = a.split('=', 2);
    if (rawValue != null) {
      out[key.slice(2)] = rawValue;
      continue;
    }
    const next = args[i + 1];
    if (next == null || next.startsWith('--')) {
      out[key.slice(2)] = true;
      continue;
    }
    out[key.slice(2)] = next;
    i++;
  }
  return out;
}

function splitCommand(command) {
  const tokens = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escapeNext = false;
  let tokenStarted = false;

  for (const ch of String(command || '')) {
    if (escapeNext) { current += ch; escapeNext = false; continue; }
    if (!inSingle && ch === '\\') { escapeNext = true; tokenStarted = true; continue; }
    if (!inDouble && ch === "'") { inSingle = !inSingle; tokenStarted = true; continue; }
    if (!inSingle && ch === '"') { inDouble = !inDouble; tokenStarted = true; continue; }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (tokenStarted) tokens.push(current);
      current = '';
      tokenStarted = false;
      continue;
    }
    current += ch;
    tokenStarted = true;
  }

  if (tokenStarted) tokens.push(current);
  if (inSingle || inDouble) return null;
  return tokens;
}

function atomicWriteJson(filePath, payload) {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function listOf(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return value ? [String(value)] : [];
}

// 워커 프롬프트: 목표 → 맥락 → 대상 파일 → 완료 기준(gates) → 경계 → 보고 형식.
// instruction이 없는 task는 기존처럼 basePrompt만 보낸다.
function buildWorkerPrompt({ taskConfig, style, jobCwd, basePrompt = '' }) {
  if (!taskConfig || !taskConfig.instruction) return basePrompt;
  const workDir = taskConfig.cwd || jobCwd;
  const parts = [
    `# 작업 지시서: ${taskConfig.name}`,
    '',
    '## 목표',
    '',
    taskConfig.instruction,
    '',
    '## 맥락',
    `- 작업 디렉토리: ${workDir}`,
  ];
  if (basePrompt && basePrompt.trim()) {
    parts.push('', '### 프로젝트 컨텍스트', '', basePrompt.trimEnd());
  }

  const editFiles = listOf(taskConfig.files);
  const readFiles = listOf(taskConfig.read_only);
  if (editFiles.length || readFiles.length) {
    parts.push('', '## 대상 파일');
    if (editFiles.length) parts.push('- 고칠 파일:', ...editFiles.map((f) => `  - ${f}`));
    if (readFiles.length) parts.push('- 읽기만 할 파일 (수정하지 않음):', ...readFiles.map((f) => `  - ${f}`));
  }

  const gates = (taskConfig.gates || []).filter((g) => g && g.command);
  parts.push('', '## 완료 기준 — 직접 실행해 통과시킬 것');
  if (gates.length) {
    parts.push('호스트가 작업 디렉토리에서 아래 명령을 그대로 다시 실행해 완료를 판정한다. 보고 전에 직접 실행해 모두 종료 코드 0(통과)이 되게 한다. 통과시키지 못했으면 실패한 명령과 출력 요지를 보고에 적는다.');
    for (const g of gates) parts.push(`- ${g.name}: \`${g.command}\` → 기대 결과: 종료 코드 0`);
  } else {
    parts.push('- 지정된 검사 명령이 없다. 프로젝트의 빌드/검증 명령(있다면)을 실행해 통과를 확인한다.');
  }

  parts.push(
    '',
    '## 경계',
    '- 파일은 작업 디렉토리 기준 상대 경로로 만든다 (호스트가 같은 위치에서 통합·검증한다).',
    '- 지시된 파일만 만들거나 고친다. 다른 워커가 같은 시각에 다른 파일을 작업 중일 수 있다.',
    '- 지시에 시그니처가 있으면 그대로 구현한다. 다른 서브태스크가 그 시그니처에 기대고 있다.',
    '- 지시된 라이브러리를 쓴다. 바꿔야 할 이유가 있으면 바꾸지 말고 보고에 이유를 적는다.',
    '- 버전이 지정되지 않은 패키지는 프로젝트에 이미 있는 버전·잠금 파일을 따르고, 새로 추가할 때만 현재 안정 버전을 쓴다.',
    '- 코드 스타일은 프로젝트의 기존 관례(린터·포매터 설정, 주변 코드)를 따른다.',
  );
  if (style) parts.push('', '### 프로젝트 코드 스타일', String(style));

  parts.push(
    '',
    '## 완료 보고 형식 (반드시 이 형식으로 출력)',
    '구현 완료 후 아래 형식을 반드시 출력하세요:',
    '',
    '### 생성 파일 목록',
    '(파일 경로와 각 파일의 역할을 나열)',
    '',
    '### 사용한 라이브러리',
    '(이름@버전 형태로 나열)',
    '',
    '### 주요 함수/클래스 시그니처',
    '(실제 구현한 export 함수/클래스 목록)',
    '',
    '### 빌드 확인',
    '(완료 기준 명령과 프로젝트의 빌드/검증 명령을 실행한 결과)',
    '',
    '### 주요 결정사항',
    '(구현 중 내린 판단, 지시와 다른 점이 있다면 이유)',
    '',
    '### 리스크/주의사항',
    '(다른 서브태스크와 충돌 가능성, 알려진 제한사항)',
    '',
  );
  return parts.join('\n');
}

function main() {
  const options = parseArgs(process.argv);
  const jobDir = options['job-dir'];
  const member = options.member;
  const safeMember = options['safe-member'];
  const command = options.command;
  const timeoutSec = options.timeout ? Number(options.timeout) : 0;
  const cwd = options.cwd || process.cwd();

  if (!jobDir) exitWithError('pumasi-worker: --job-dir is required. This worker should be spawned by pumasi-job.js, not called directly.');
  if (!member) exitWithError('pumasi-worker: --member is required. Specify the task name.');
  if (!safeMember) exitWithError('pumasi-worker: --safe-member is required. Specify the safe task name.');
  if (!command) exitWithError('pumasi-worker: --command is required. Specify the codex command to execute.');

  const membersRoot = path.join(jobDir, 'members');
  const memberDir = path.join(membersRoot, safeMember);
  const statusPath = path.join(memberDir, 'status.json');
  const outPath = path.join(memberDir, 'output.txt');
  const errPath = path.join(memberDir, 'error.txt');

  // 태스크별 instruction 읽기 + Codex 최적화 프롬프트 구성
  const jobJsonPath = path.join(jobDir, 'job.json');
  let jobMeta = null;
  let jobCwd = cwd;
  try {
    if (fs.existsSync(jobJsonPath)) {
      jobMeta = JSON.parse(fs.readFileSync(jobJsonPath, 'utf8'));
      if (jobMeta.cwd) jobCwd = jobMeta.cwd;
    }
  } catch { /* ignore */ }

  // Check for redelegate prompt first (per-member override), then round-specific, then default
  const redelegatePromptPath = path.join(memberDir, 'redelegate-prompt.txt');
  const currentRound = jobMeta ? (jobMeta.currentRound || 1) : 1;
  const roundPromptPath = path.join(jobDir, `prompt-round${currentRound}.txt`);
  const defaultPromptPath = path.join(jobDir, 'prompt.txt');
  const promptPath = fs.existsSync(redelegatePromptPath) ? redelegatePromptPath
    : fs.existsSync(roundPromptPath) ? roundPromptPath
    : defaultPromptPath;
  const basePrompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  const taskConfig = jobMeta ? (jobMeta.tasks || []).find((t) => t.name === member) : null;
  let prompt = buildWorkerPrompt({ taskConfig, style: jobMeta && jobMeta.style, jobCwd, basePrompt });

  // DOE E06e: Codex hangs indefinitely on empty prompt
  if (!prompt || !prompt.trim()) {
    atomicWriteJson(statusPath, {
      member, state: 'error',
      message: 'Empty prompt: both task instruction and base prompt are empty',
      finishedAt: new Date().toISOString(), command,
    });
    process.exit(1);
  }

  const tokens = splitCommand(command);
  if (!tokens || tokens.length === 0) {
    atomicWriteJson(statusPath, {
      member, state: 'error',
      message: 'Invalid command string',
      finishedAt: new Date().toISOString(), command,
    });
    process.exit(1);
  }

  const program = tokens[0];
  let args = tokens.slice(1);

  // DOE E08: Add --output-schema for structured JSON output
  // ⚠️ --output-schema/-o 는 codex 전용 플래그다. 다른 CLI(예: Antigravity `agy`)는
  // 이 플래그를 모르므로 codex일 때만 주입한다. (agy는 `agy --dangerously-skip-permissions -p`
  // 형태로 쓰며, 프롬프트가 마지막 위치 인자(-p의 값)로 정상 전달된다.)
  const reportPath = path.join(memberDir, 'report.json');
  const isCodex = /(^|\/)codex$/.test(program);
  const isClaude = /(^|[/\\])claude(?:\.exe)?$/i.test(program);
  const schemaArgs = [];
  let reportSchema;
  if (isClaude) {
    // The runner owns its transport and result schema. Preserve model/tool policy.
    const managed = new Set(['--output-format', '--json-schema']);
    args = args.filter((arg, index, values) =>
      !managed.has(arg.split('=')[0]) && !(index > 0 && managed.has(values[index - 1])));
    reportSchema = JSON.parse(fs.readFileSync(OUTPUT_SCHEMA_PATH, 'utf8'));
    schemaArgs.push('--print', '--output-format', 'json',
      '--json-schema', JSON.stringify(reportSchema), '--no-session-persistence');
    prompt = 'You are an implementation worker. The calling host owns planning, approval, '
      + 'integration and final acceptance. Execute only the assigned task; do not start '
      + 'pumasi, another planner, or delegate to other agents. Report actual results '
      + 'using the supplied schema; report partial/failed work honestly.\n\n' + prompt;
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
  }
  if (isCodex && fs.existsSync(OUTPUT_SCHEMA_PATH)) {
    schemaArgs.push('--output-schema', OUTPUT_SCHEMA_PATH);
    schemaArgs.push('-o', reportPath);
  }

  const startedAt = new Date().toISOString();
  const cancelPath = path.join(memberDir, 'cancel-request.json');
  if (fs.existsSync(cancelPath)) fs.unlinkSync(cancelPath);
  atomicWriteJson(statusPath, {
    member, state: 'running',
    startedAt,
    command, pid: null,
  });

  const outStream = fs.createWriteStream(outPath, { flags: 'w' });
  const errStream = fs.createWriteStream(errPath, { flags: 'w' });

  let child;
  try {
    const childEnv = { ...process.env };
    if (isClaude) delete childEnv.CLAUDECODE;
    child = spawn(program, [...args, ...schemaArgs, ...(isClaude ? [] : [prompt])], {
      stdio: [isClaude ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: childEnv,
      cwd: cwd,
    });
  } catch (error) {
    atomicWriteJson(statusPath, {
      member, state: 'error',
      message: error && error.message ? error.message : 'Failed to spawn command',
      finishedAt: new Date().toISOString(), command,
    });
    process.exit(1);
  }

  atomicWriteJson(statusPath, {
    member, state: 'running',
    startedAt: new Date().toISOString(),
    command, pid: child.pid,
  });

  if (child.stdout) child.stdout.pipe(outStream);
  if (child.stderr) child.stderr.pipe(errStream);
  if (isClaude && child.stdin) {
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') errStream.write(`stdin: ${error.message}\n`);
    });
    child.stdin.end(prompt);
  }

  let timeoutHandle = null;
  let timeoutTriggered = false;
  if (Number.isFinite(timeoutSec) && timeoutSec > 0) {
    timeoutHandle = setTimeout(() => {
      timeoutTriggered = true;
      killProcess(child.pid);
    }, timeoutSec * 1000);
    timeoutHandle.unref();
  }

  let spawnError = null;
  child.on('error', (error) => {
    spawnError = error;
  });

  child.on('close', async (code, signal) => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const timedOut = Boolean(timeoutTriggered);
    let canceled = !timedOut && (signal === 'SIGTERM' || signal === 'SIGKILL'
      || fs.existsSync(cancelPath));
    let state = timedOut ? 'timed_out' : canceled ? 'canceled'
      : spawnError?.code === 'ENOENT' ? 'missing_cli' : code === 0 ? 'done' : 'error';
    let message = timedOut ? `Timed out after ${timeoutSec}s`
      : canceled ? 'Canceled' : spawnError?.message || null;
    let permissionDenials;
    try {
      if (!outStream.writableEnded) outStream.end();
      if (!errStream.writableEnded) errStream.end();
      await Promise.all([finished(outStream), finished(errStream)]);
      if (!timedOut && fs.existsSync(cancelPath)) {
        canceled = true;
        state = 'canceled';
        message = 'Canceled';
      }
      if (isClaude && state === 'done') {
        const envelope = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        if (envelope.type !== 'result' || envelope.is_error || envelope.subtype !== 'success') {
          throw new Error(`Claude result failed: ${envelope.subtype || 'invalid envelope'}`
            + (Array.isArray(envelope.errors) ? `: ${envelope.errors.join('; ')}` : ''));
        }
        const report = envelope.structured_output;
        const valid = report && typeof report === 'object' && !Array.isArray(report)
          && reportSchema.required.every(key => Object.hasOwn(report, key))
          && Object.entries(report).every(([key, value]) => {
            const field = reportSchema.properties[key];
            if (!field) return false;
            if (field.type === 'array') return Array.isArray(value) && value.every(item => typeof item === 'string');
            return typeof value === 'string' && (!field.enum || field.enum.includes(value));
          });
        if (!valid) throw new Error('Claude structured_output is missing or does not match the report schema');
        atomicWriteJson(reportPath, report);
        permissionDenials = envelope.permission_denials;
        if (report.status !== 'success') {
          state = 'error';
          message = `Claude report: ${report.status}`;
        }
      }
    } catch (error) {
      if (!timedOut && !canceled && state !== 'missing_cli') state = 'error';
      message = message || `Worker output error: ${error.message}`;
    }
    atomicWriteJson(statusPath, {
      member,
      state, message,
      startedAt,
      finishedAt: new Date().toISOString(),
      command,
      exitCode: typeof code === 'number' ? code : null,
      signal: signal || null,
      pid: child.pid,
      ...(permissionDenials ? { permissionDenials } : {}),
    });
    process.exitCode = state === 'done' ? 0 : 1;
  });
}

if (require.main === module) {
  main();
}

module.exports = { buildWorkerPrompt };

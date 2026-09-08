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

  let taskInstruction = '';
  if (jobMeta) {
      const taskConfig = (jobMeta.tasks || []).find((t) => t.name === member);
      if (taskConfig && taskConfig.instruction) {
        // Codex 최적화: 명시적이고 구조화된 프롬프트
        const parts = [
          `# 작업 지시서: ${taskConfig.name}`,
          '',
          '## 작업 환경',
          `- 작업 디렉토리: ${taskConfig.cwd || jobCwd}`,
          `- 이 디렉토리에서 파일을 생성/수정하세요`,
          '',
          '## 구현 요구사항',
          '',
          taskConfig.instruction,
          '',
          '---',
          '',
          '## 필수 규칙',
          '- 모든 파일은 위 작업 디렉토리 기준 상대 경로로 생성',
          '- 지시된 파일만 생성 (추가 파일 생성 금지)',
          '- 함수/클래스 시그니처는 지시사항 그대로 구현',
          '- 지시된 라이브러리/패키지를 반드시 사용 (다른 라이브러리로 대체 금지)',
          '- 구현 완료 후 아래 "완료 보고 형식"에 맞춰 반드시 보고',
          '',
          '## 코드 스타일 (반드시 준수)',
          '- **정확성 최우선**: 간결하게 작성하되 모든 엣지케이스의 동작이 반드시 올바라야 한다. 간결화로 인해 엣지케이스 처리가 달라지면 간결화를 포기하고 정확한 코드를 작성한다.',
          '- **엣지케이스 명시 규칙**:',
          '  - 문자열 절삭: 음수/0은 빈 문자열 반환. maxLength가 말줄임표(...) 길이 이하이면(<=3) 말줄임표 없이 원본을 잘라 반환. `const safe = Math.max(0, maxLength); if (safe <= 3) return text.slice(0, safe)`',
          '  - 날짜 포맷: 명시된 포맷 옵션이 있으면 반드시 Intl.DateTimeFormat에 전달한다 (toLocaleDateString 기본값에 의존하지 않는다)',
          '  - 범위 역전(min > max): 내부에서 swap하여 정상 처리한다 (무시하거나 원본 반환 금지)',
          '- **TypeScript 타입 신뢰**: 파라미터에 타입이 있으면 런타임 typeof 체크 금지 (이미 타입시스템이 보장)',
          '- **관용적 패턴 사용**: `Math.min(Math.max(val, min), max)` 같은 관용구가 있으면 if/else보다 우선 사용',
          '- **불필요한 중간변수 금지**: `const isValid = pattern.test(x); if (!isValid)` → `if (!pattern.test(x))`',
          '- **정규식은 함수 내부 인라인**: 모듈 상단 상수로 꺼내지 않음 (단일 사용처)',
          '- **return 형식**: 객체 리터럴은 인라인 반환 (`return { valid: false, error: "..." }`)',
        ];

        // config에서 커스텀 스타일 규칙 주입
        if (jobMeta.style) {
          parts.push('');
          parts.push('## 프로젝트 코드 스타일 (추가 규칙)');
          parts.push(jobMeta.style);
        }

        parts.push(...[
          '',
          '## 기술스택 규칙',
          '- 패키지 버전은 지시사항에 명시된 버전을 우선 사용',
          '- 버전이 명시되지 않은 경우 최신 안정 버전(latest stable) 사용',
          '- 참고 기준 (2025-2026):',
          '  - React 19+, Next.js 15+, Vite 6+',
          '  - TypeScript 5.8+, Node.js 22+',
          '  - Tailwind CSS 4+, Express 5+ 또는 Hono',
          '  - Bun 또는 pnpm 권장 (npm도 허용)',
          '- 구버전 사용 금지: React 18, Vite 5, Tailwind 3, Express 4 등은 사용하지 않는다',
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
          '(TypeScript 컴파일 에러가 없는지 확인한 결과)',
          '',
          '### 주요 결정사항',
          '(구현 중 내린 판단, 지시와 다른 점이 있다면 이유)',
          '',
          '### 리스크/주의사항',
          '(다른 서브태스크와 충돌 가능성, 알려진 제한사항)',
          '',
          '---',
          '',
        ]);
        if (basePrompt) {
          parts.push('## 프로젝트 컨텍스트');
          parts.push('');
        }
        taskInstruction = parts.join('\n');
      }
  }

  let prompt = taskInstruction + basePrompt;

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

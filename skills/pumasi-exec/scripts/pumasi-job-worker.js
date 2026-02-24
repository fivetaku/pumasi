#!/usr/bin/env node
// 품앗이 워커 - council-job-worker.js와 동일한 구조
// 각 Codex 인스턴스를 detached 프로세스로 실행하고 결과를 output.txt에 저장

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

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

  for (const ch of String(command || '')) {
    if (escapeNext) { current += ch; escapeNext = false; continue; }
    if (!inSingle && ch === '\\') { escapeNext = true; continue; }
    if (!inDouble && ch === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && ch === '"') { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  if (current) tokens.push(current);
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

  if (!jobDir) exitWithError('worker: missing --job-dir');
  if (!member) exitWithError('worker: missing --member');
  if (!safeMember) exitWithError('worker: missing --safe-member');
  if (!command) exitWithError('worker: missing --command');

  const membersRoot = path.join(jobDir, 'members');
  const memberDir = path.join(membersRoot, safeMember);
  const statusPath = path.join(memberDir, 'status.json');
  const outPath = path.join(memberDir, 'output.txt');
  const errPath = path.join(memberDir, 'error.txt');

  const promptPath = path.join(jobDir, 'prompt.txt');
  const basePrompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  // 태스크별 instruction 읽기 + Codex 최적화 프롬프트 구성
  const jobJsonPath = path.join(jobDir, 'job.json');
  let taskInstruction = '';
  let jobCwd = cwd;
  if (fs.existsSync(jobJsonPath)) {
    try {
      const jobMeta = JSON.parse(fs.readFileSync(jobJsonPath, 'utf8'));
      if (jobMeta.cwd) jobCwd = jobMeta.cwd;
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
        ];
        if (basePrompt) {
          parts.push('## 프로젝트 컨텍스트');
          parts.push('');
        }
        taskInstruction = parts.join('\n');
      }
    } catch {
      // ignore
    }
  }

  const prompt = taskInstruction + basePrompt;

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
  const args = tokens.slice(1);

  atomicWriteJson(statusPath, {
    member, state: 'running',
    startedAt: new Date().toISOString(),
    command, pid: null,
  });

  const outStream = fs.createWriteStream(outPath, { flags: 'w' });
  const errStream = fs.createWriteStream(errPath, { flags: 'w' });

  let child;
  try {
    child = spawn(program, [...args, prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
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

  let timeoutHandle = null;
  let timeoutTriggered = false;
  if (Number.isFinite(timeoutSec) && timeoutSec > 0) {
    timeoutHandle = setTimeout(() => {
      timeoutTriggered = true;
      try { process.kill(child.pid, 'SIGTERM'); } catch { /* ignore */ }
    }, timeoutSec * 1000);
    timeoutHandle.unref();
  }

  const finalize = (payload) => {
    try { outStream.end(); errStream.end(); } catch { /* ignore */ }
    atomicWriteJson(statusPath, payload);
  };

  child.on('error', (error) => {
    const isMissing = error && error.code === 'ENOENT';
    finalize({
      member,
      state: isMissing ? 'missing_cli' : 'error',
      message: error && error.message ? error.message : 'Process error',
      finishedAt: new Date().toISOString(),
      command, exitCode: null, pid: child.pid,
    });
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const timedOut = Boolean(timeoutTriggered) && signal === 'SIGTERM';
    const canceled = !timedOut && signal === 'SIGTERM';
    finalize({
      member,
      state: timedOut ? 'timed_out' : canceled ? 'canceled' : code === 0 ? 'done' : 'error',
      message: timedOut ? `Timed out after ${timeoutSec}s` : canceled ? 'Canceled' : null,
      finishedAt: new Date().toISOString(),
      command,
      exitCode: typeof code === 'number' ? code : null,
      signal: signal || null,
      pid: child.pid,
    });
    process.exit(code === 0 ? 0 : 1);
  });
}

if (require.main === module) {
  main();
}

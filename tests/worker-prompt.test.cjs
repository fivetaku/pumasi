const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const workerPath = path.join(__dirname, '../skills/pumasi/scripts/pumasi-job-worker.js');
const { buildWorkerPrompt } = require(workerPath);

const task = {
  name: 'auth-service',
  instruction: 'Implement login(email, password) in src/auth.ts.',
  files: ['src/auth.ts'],
  read_only: ['src/types.ts'],
  gates: [
    { name: 'typecheck', command: 'npx tsc --noEmit' },
    { name: 'unit tests', command: 'npm test' },
  ],
};

test('worker prompt includes every gate command as the done-check, in the documented order', () => {
  const prompt = buildWorkerPrompt({ taskConfig: task, style: null, jobCwd: '/work/app', basePrompt: 'project overview\n' });
  assert.match(prompt, /`npx tsc --noEmit` → 기대 결과: 종료 코드 0/);
  assert.match(prompt, /`npm test` → 기대 결과: 종료 코드 0/);
  const order = ['## 목표', '## 맥락', 'project overview', '## 대상 파일', '## 완료 기준 — 직접 실행해 통과시킬 것', '## 경계', '## 완료 보고 형식'];
  const positions = order.map((heading) => prompt.indexOf(heading));
  assert.ok(positions.every((p) => p >= 0), `missing section: ${order[positions.indexOf(-1)]}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(prompt, /고칠 파일:\n {2}- src\/auth\.ts/);
  assert.match(prompt, /읽기만 할 파일[^\n]*\n {2}- src\/types\.ts/);
});

test('worker prompt drops benchmark-specific style rules and the version-stamped stack block', () => {
  const prompt = buildWorkerPrompt({ taskConfig: task, style: 'Use ESM.', jobCwd: '/w', basePrompt: '' });
  for (const stale of ['Intl.DateTimeFormat', 'safe <= 3', 'React 19', '2025-2026', 'TypeScript 컴파일']) {
    assert.ok(!prompt.includes(stale), `stale rule still present: ${stale}`);
  }
  assert.match(prompt, /### 프로젝트 코드 스타일\nUse ESM\./);
  assert.match(prompt, /### 빌드 확인/);
});

test('task without instruction still sends only the base prompt', () => {
  assert.equal(buildWorkerPrompt({ taskConfig: { name: 'x' }, jobCwd: '/w', basePrompt: 'raw' }), 'raw');
  assert.equal(buildWorkerPrompt({ taskConfig: null, jobCwd: '/w', basePrompt: 'raw' }), 'raw');
});

test('spawned worker passes the gate commands to the CLI', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pumasi-prompt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'members/auth-service'), { recursive: true });
  const fake = path.join(root, 'fakecli');
  const capture = path.join(root, 'captured.txt');
  fs.writeFileSync(fake, `#!${process.execPath}\nrequire('fs').writeFileSync(process.env.CAPTURE, process.argv[process.argv.length - 1]);\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'job.json'), JSON.stringify({ cwd: root, tasks: [task] }));
  fs.writeFileSync(path.join(root, 'prompt.txt'), 'fixture context\n');
  const run = spawnSync(process.execPath, [workerPath, '--job-dir', root, '--member', 'auth-service',
    '--safe-member', 'auth-service', '--command', fake, '--cwd', root],
  { env: { ...process.env, CAPTURE: capture }, encoding: 'utf8', timeout: 15000 });
  assert.equal(run.status, 0, run.stderr);
  const prompt = fs.readFileSync(capture, 'utf8');
  assert.ok(prompt.includes('npx tsc --noEmit') && prompt.includes('npm test'));
  assert.ok(prompt.indexOf('fixture context') < prompt.indexOf('## 완료 기준'));
});

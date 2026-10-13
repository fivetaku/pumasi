const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const script = path.join(__dirname, '../skills/pumasi/scripts/pumasi-job.js');

// start-gates.test.cjs 와 같은 방식: 워커 spawn만 가짜로 바꾸고 job.json·프롬프트를 확인한다.
function runJob(root, argv) {
  const moduleRecord = { exports: {} };
  const actualRequire = createRequire(script);
  const spawned = [];
  const requireFixture = (name) => {
    if (name === 'yaml') return { parse: JSON.parse };
    if (name === 'child_process') return {
      ...actualRequire(name),
      spawn: (_bin, args) => { spawned.push(args[args.indexOf('--member') + 1]); return { pid: 12345, unref() {} }; },
    };
    return actualRequire(name);
  };
  requireFixture.main = moduleRecord;
  let output = '';
  let exitCode = null;
  let stderr = '';
  try {
    vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
      require: requireFixture, module: moduleRecord,
      __dirname: path.dirname(script), __filename: script, Buffer, console,
      process: {
        argv: [process.execPath, script, ...argv],
        env: { ...process.env, HOME: root }, execPath: process.execPath,
        platform: process.platform, cwd: () => root,
        stdout: { write: text => { output += text; } },
        stderr: { write: text => { stderr += text; } },
        exit: code => { exitCode = code; throw new Error('__exit__'); },
      },
    }, { filename: script, timeout: 10000 });
  } catch (e) {
    if (e.message !== '__exit__') throw e;
  }
  return { output, spawned, exitCode, stderr };
}

function writeConfig(root, tasks) {
  const config = path.join(root, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ pumasi: { tasks } }));
  return config;
}

test('candidates: N expands into N parallel tasks with distinct names, commands and instructions', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pumasi-cand-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = writeConfig(root, [
    { name: 'naming', candidates: 3, candidate_commands: ['worker-a', 'worker-b'], command: 'worker-default', instruction: '이름 후보 10개' },
    { name: 'plain', command: 'worker-x', instruction: '그대로' },
  ]);
  const r = runJob(root, ['start', '--config', config, '--jobs-dir', path.join(root, 'jobs'), '--json', 'ctx']);
  const job = JSON.parse(fs.readFileSync(path.join(JSON.parse(r.output).jobDir, 'job.json'), 'utf8'));
  const names = job.tasks.map(x => x.name);
  assert.deepEqual(names, ['naming~c1', 'naming~c2', 'naming~c3', 'plain']);
  assert.deepEqual(job.tasks.slice(0, 3).map(x => x.command), ['worker-a', 'worker-b', 'worker-default']);
  assert.deepEqual(job.tasks.slice(0, 3).map(x => x.candidate_of), ['naming', 'naming', 'naming']);
  assert.equal(job.tasks[3].candidate_of, undefined);
  assert.match(job.tasks[1].instruction, /후보 2\/3/);
  assert.match(job.tasks[1].instruction, /-c2/);
  assert.equal(r.spawned.length, 4, 'all candidates run in parallel in the same round');
});

test('candidates above the cap are rejected before any worker starts', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pumasi-cand-cap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = writeConfig(root, [{ name: 'too-many', candidates: 5, command: 'w', instruction: 'x' }]);
  const r = runJob(root, ['start', '--config', config, '--jobs-dir', path.join(root, 'jobs'), '--json', 'ctx']);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /최대 3개/);
  assert.equal(r.spawned.length, 0);
});

test('staged rounds: start runs round 1 only; start-round --note puts the host decision into the next round prompt', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pumasi-round-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = writeConfig(root, [
    { name: 'research', round: 1, command: 'w1', instruction: '조사' },
    { name: 'build', round: 2, command: 'w2', instruction: '구현' },
  ]);
  const first = runJob(root, ['start', '--config', config, '--jobs-dir', path.join(root, 'jobs'), '--json', 'ctx']);
  const jobDir = JSON.parse(first.output).jobDir;
  assert.deepEqual(first.spawned, ['research']);

  const second = runJob(root, ['start-round', '--round', '2', '--note', '하이픈 구분 010-1234-5678 채택', jobDir]);
  assert.deepEqual(second.spawned, ['build']);
  const prompt = fs.readFileSync(path.join(jobDir, 'prompt-round2.txt'), 'utf8');
  assert.match(prompt, /## 이전 라운드 결과/);
  assert.match(prompt, /## 호스트 결정[^\n]*\n하이픈 구분 010-1234-5678 채택/);
  const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
  assert.equal(job.roundNotes['2'], '하이픈 구분 010-1234-5678 채택');
  assert.equal(job.currentRound, 2);
});

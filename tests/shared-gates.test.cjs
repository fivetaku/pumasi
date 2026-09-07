const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '../skills/pumasi/scripts/pumasi-job.js');

function fixture(t, shared = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pumasi-gates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace with spaces');
  const job = path.join(root, 'job');
  const counter = path.join(root, 'calls.txt');
  const checker = path.join(root, 'check.cjs');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'value.txt'), 'good');
  fs.writeFileSync(counter, '');
  fs.writeFileSync(checker, `
const fs = require('node:fs');
fs.appendFileSync(process.argv[2], 'x');
if (fs.readFileSync('value.txt', 'utf8') !== 'good') process.exit(9);
console.log('fixture check passed');
`);
  const command = [process.execPath, checker, counter].map(JSON.stringify).join(' ');
  const tasks = ['a', 'b', 'c'].map(name => ({
    name, gates: [{ name: `check-${name}`, command, shared_readonly: shared }],
  }));
  for (const task of tasks) {
    const member = path.join(job, 'members', task.name);
    fs.mkdirSync(member, { recursive: true });
    fs.writeFileSync(path.join(member, 'status.json'), JSON.stringify({ state: 'done', member: task.name }));
  }
  function run() {
    fs.writeFileSync(path.join(job, 'job.json'), JSON.stringify({ id: 'fixture', cwd: workspace, tasks }));
    const result = spawnSync(process.execPath, [script, 'gates', '--json', job], {
      env: { ...process.env, HOME: root }, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  return { root, workspace, job, tasks, run, calls: () => fs.readFileSync(counter, 'utf8').length };
}

test('explicit shared read-only success executes once and keeps per-task attribution', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(f.calls(), 1);
  for (const name of ['a', 'b', 'c']) {
    assert.equal(result[name].status, 'passed');
    assert.equal(result[name].gates[0].name, `check-${name}`);
  }
  assert.equal(result.b.gates[0].sharedFrom, 'a');
  assert.equal(result.b.gates[0].durationMs, 0);
  t.diagnostic('identical successful project checks: 3 task attributions, 1 actual execution');
});

test('unmarked gates retain their independent executions', (t) => {
  const f = fixture(t, false);
  f.run();
  assert.equal(f.calls(), 3);
});

test('failures are not reused', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.workspace, 'value.txt'), 'broken');
  const result = f.run();
  assert.equal(f.calls(), 3);
  for (const name of ['a', 'b', 'c']) {
    assert.equal(result[name].status, 'failed');
    assert.equal(result[name].gates[0].exitCode, 9);
  }
});

test('a later invocation rechecks changed source', (t) => {
  const f = fixture(t);
  f.run();
  fs.writeFileSync(path.join(f.workspace, 'value.txt'), 'broken');
  const second = f.run();
  assert.equal(f.calls(), 4);
  assert.equal(second.a.status, 'failed');
});

test('active workers disable sharing', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.job, 'members/c/status.json'), JSON.stringify({ state: 'running', member: 'c' }));
  const result = f.run();
  assert.equal(f.calls(), 2);
  assert.equal(result.c.status, 'skipped');
});

test('different working directories do not share results', (t) => {
  const f = fixture(t);
  const other = path.join(f.root, 'other');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'value.txt'), 'broken');
  f.tasks[2].cwd = other;
  const result = f.run();
  assert.equal(f.calls(), 2);
  assert.equal(result.a.status, 'passed');
  assert.equal(result.c.status, 'failed');
});

test('an unmarked intervening gate invalidates shared results', (t) => {
  const f = fixture(t);
  const mutator = path.join(f.root, 'mutate.cjs');
  fs.writeFileSync(mutator, "require('node:fs').writeFileSync('value.txt', 'broken');");
  f.tasks[0].gates.push({ name: 'mutation', command: [process.execPath, mutator].map(JSON.stringify).join(' ') });
  const result = f.run();
  assert.equal(f.calls(), 3);
  assert.equal(result.b.status, 'failed');
  assert.equal(result.c.status, 'failed');
});

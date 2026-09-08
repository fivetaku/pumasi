const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '../skills/pumasi/scripts/pumasi-job.js');

test('compact results retain reports and recoverable artifacts without duplicating raw context', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pumasi-results-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const member = path.join(root, 'members/worker');
  fs.mkdirSync(member, { recursive: true });
  const prompt = 'reference context\n'.repeat(5000);
  const output = 'raw worker output\n'.repeat(10000);
  const stderr = 'fixture warning\n';
  const report = { status: 'success', summary: 'done', files_created: ['src/a.js'], risks: ['fixture risk'] };
  const gates = { status: 'passed', passedCount: 1, totalCount: 1, gates: [{ name: 'test', passed: true }] };
  fs.writeFileSync(path.join(root, 'job.json'), JSON.stringify({ id: 'fixture' }));
  fs.writeFileSync(path.join(root, 'prompt.txt'), prompt);
  fs.writeFileSync(path.join(member, 'status.json'), JSON.stringify({ member: 'worker', state: 'done', exitCode: 0 }));
  fs.writeFileSync(path.join(member, 'output.txt'), output);
  fs.writeFileSync(path.join(member, 'error.txt'), stderr);
  fs.writeFileSync(path.join(member, 'report.json'), JSON.stringify(report));
  fs.writeFileSync(path.join(member, 'gates.json'), JSON.stringify(gates));
  const env = { ...process.env, HOME: root, PUMASI_JOBS_DIR: path.join(root, 'empty-jobs') };
  const fullRun = spawnSync(process.execPath, [script, 'results', '--json', root], { env, encoding: 'utf8', timeout: 30000 });
  const compactRun = spawnSync(process.execPath, [script, 'results', '--compact', root], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(fullRun.status, 0, fullRun.stderr);
  assert.equal(compactRun.status, 0, compactRun.stderr);
  const full = JSON.parse(fullRun.stdout);
  const compact = JSON.parse(compactRun.stdout);
  assert.equal(full.prompt, prompt);
  assert.equal(full.members[0].output, output);
  assert.equal(full.members[0].stderr, stderr);
  assert.equal(compact.prompt, undefined);
  assert.equal(compact.members[0].output, undefined);
  assert.equal(compact.members[0].stderr, undefined);
  assert.deepEqual(compact.members[0].report, report);
  assert.deepEqual(compact.members[0].gates, gates);
  assert.equal(compact.members[0].state, 'done');
  assert.equal(compact.members[0].exitCode, 0);
  assert.equal(fs.readFileSync(compact.promptPath, 'utf8'), prompt);
  assert.equal(fs.readFileSync(compact.members[0].artifacts.output, 'utf8'), output);
  assert.equal(fs.readFileSync(compact.members[0].artifacts.stderr, 'utf8'), stderr);
  assert.ok(Buffer.byteLength(compactRun.stdout) < Buffer.byteLength(fullRun.stdout));
  t.diagnostic(`result bytes: full=${Buffer.byteLength(fullRun.stdout)}, compact=${Buffer.byteLength(compactRun.stdout)}`);
});

test('compact results retain failures even when structured report is absent', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pumasi-results-failed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const member = path.join(root, 'members/worker');
  fs.mkdirSync(member, { recursive: true });
  fs.writeFileSync(path.join(root, 'job.json'), JSON.stringify({ id: 'failed-fixture' }));
  fs.writeFileSync(path.join(member, 'status.json'), JSON.stringify({
    member: 'worker', state: 'error', exitCode: 7, message: 'fixture failure',
  }));
  fs.writeFileSync(path.join(member, 'error.txt'), 'complete failure detail');
  const run = spawnSync(process.execPath, [script, 'results', '--compact', root], {
    env: { ...process.env, HOME: root, PUMASI_JOBS_DIR: path.join(root, 'empty-jobs') }, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout).members[0];
  assert.equal(result.state, 'error');
  assert.equal(result.exitCode, 7);
  assert.equal(result.message, 'fixture failure');
  assert.equal(result.report, null);
  assert.equal(result.artifacts.output, null);
  assert.equal(fs.readFileSync(result.artifacts.stderr, 'utf8'), 'complete failure detail');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

const worker = path.join(__dirname, '../skills/pumasi/scripts/pumasi-job-worker.js');
const report = {
  files_created: ['answer.txt'], files_modified: [], status: 'success', summary: 'fixture work',
  signatures: [], dependencies_used: [], risks: '',
};

function fixture(t, envelope, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pumasi-claude-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const member = path.join(root, 'members/task');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(member, { recursive: true });
  fs.mkdirSync(bin);
  const program = path.join(bin, 'claude');
  fs.writeFileSync(program, `#!${process.execPath}
const fs = require('node:fs');
const input = fs.readFileSync(0, 'utf8');
fs.writeFileSync(process.env.CAPTURE, JSON.stringify({
  args: process.argv.slice(2), input, nested: process.env.CLAUDECODE || null,
}));
process.stdout.write(fs.readFileSync(process.env.ENVELOPE_PATH, 'utf8'));
process.exitCode = Number(process.env.FIXTURE_EXIT || 0);
if (process.env.FIXTURE_HANG === '1') setInterval(() => {}, 1000);
`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'job.json'), JSON.stringify({ tasks: [], host: 'omo' }));
  fs.writeFileSync(path.join(root, 'prompt.txt'), 'fixture request\n'.repeat(10000));
  fs.writeFileSync(path.join(member, 'report.json'), JSON.stringify({ ...report, summary: 'stale' }));
  fs.writeFileSync(path.join(member, 'cancel-request.json'), JSON.stringify({ pid: -1 }));
  const captured = path.join(root, 'captured.json');
  const envelopePath = path.join(root, 'envelope.json');
  fs.writeFileSync(envelopePath, typeof envelope === 'string' ? envelope : JSON.stringify(envelope));
  const run = spawnSync(process.execPath, [
    worker, '--job-dir', root, '--member', 'task', '--safe-member', 'task',
    '--command', `"${program}" --model fixture-model --setting-sources ""`, '--cwd', root,
    '--timeout', options.hang ? '1' : '10',
  ], {
    env: {
      ...process.env, HOME: root, CLAUDECODE: 'parent-context',
      CAPTURE: captured, ENVELOPE_PATH: envelopePath,
      FIXTURE_EXIT: String(options.exit || 0),
      FIXTURE_HANG: options.hang ? '1' : '0',
    },
    encoding: 'utf8', timeout: 15000,
  });
  return {
    run, root, member,
    invocation: JSON.parse(fs.readFileSync(captured, 'utf8')),
    status: JSON.parse(fs.readFileSync(path.join(member, 'status.json'), 'utf8')),
  };
}

test('Claude worker receives stdin and returns the existing report contract before completion', (t) => {
  const f = fixture(t, { type: 'result', subtype: 'success', is_error: false, structured_output: report });
  assert.equal(f.run.status, 0, f.run.stderr);
  assert.equal(f.status.state, 'done');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.member, 'report.json'), 'utf8')), report);
  assert.equal(f.invocation.nested, null);
  assert.ok(f.invocation.input.endsWith('fixture request\n'.repeat(10000)));
  assert.ok(f.invocation.args.includes('--print'));
  assert.equal(f.invocation.args[f.invocation.args.indexOf('--output-format') + 1], 'json');
  const schema = JSON.parse(f.invocation.args[f.invocation.args.indexOf('--json-schema') + 1]);
  assert.ok(schema.required.includes('files_created'));
  assert.ok(f.invocation.args.includes('fixture-model'));
  assert.equal(f.invocation.args[f.invocation.args.indexOf('--setting-sources') + 1], '');
  assert.ok(f.invocation.args.includes('--no-session-persistence'));
  assert.ok(!f.invocation.args.includes('--output-schema'));
  assert.ok(!f.invocation.args.includes('-o'));
  assert.ok(!f.invocation.args.some(arg => arg.includes('fixture request')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.member, 'output.txt'), 'utf8')).type, 'result');
});

for (const [label, envelope] of [
  ['API error', { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['limit reached'] }],
  ['missing structured result', { type: 'result', subtype: 'success', is_error: false, result: 'no report' }],
  ['wrong schema', { type: 'result', subtype: 'success', is_error: false, structured_output: { status: 'success' } }],
  ['invalid JSON', 'not-json'],
]) {
  test(`${label} cannot retain stale success even if CLI exits zero`, (t) => {
    const f = fixture(t, envelope);
    assert.notEqual(f.run.status, 0);
    assert.equal(f.status.state, 'error');
    assert.ok(f.status.message);
    assert.equal(fs.existsSync(path.join(f.member, 'report.json')), false);
  });
}

for (const status of ['partial', 'failed']) {
  test(`structured ${status} result stays visible but is not completed`, (t) => {
    const f = fixture(t, { type: 'result', subtype: 'success', is_error: false, structured_output: { ...report, status } });
    assert.notEqual(f.run.status, 0);
    assert.equal(f.status.state, 'error');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.member, 'report.json'), 'utf8')).status, status);
  });
}

test('a nonzero Claude process exit cannot produce a completed task', (t) => {
  const f = fixture(t, { type: 'result', subtype: 'success', is_error: false, structured_output: report }, { exit: 7 });
  assert.notEqual(f.run.status, 0);
  assert.equal(f.status.state, 'error');
  assert.equal(f.status.exitCode, 7);
  assert.equal(fs.existsSync(path.join(f.member, 'report.json')), false);
});

test('a timed-out Claude cannot publish its already-written success envelope', (t) => {
  const f = fixture(t, { type: 'result', subtype: 'success', is_error: false, structured_output: report }, { hang: true });
  assert.notEqual(f.run.status, 0);
  assert.equal(f.status.state, 'timed_out');
  assert.equal(fs.existsSync(path.join(f.member, 'report.json')), false);
  assert.throws(() => process.kill(f.status.pid, 0));
});

test('large structured output is completely drained before done is published', (t) => {
  const large = { ...report, summary: 'large-report-'.repeat(100000) };
  const f = fixture(t, { type: 'result', subtype: 'success', is_error: false, structured_output: large });
  assert.equal(f.run.status, 0, f.run.stderr);
  assert.equal(f.status.state, 'done');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.member, 'report.json'), 'utf8')).summary, large.summary);
});

for (const graceful of [false, true]) {
test(`host stop cancels Claude without publishing a prepared success result (graceful=${graceful})`, { timeout: 15000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pumasi-claude-stop-'));
  const member = path.join(root, 'members/task');
  fs.mkdirSync(member, { recursive: true });
  const program = path.join(root, 'claude');
  const statusPath = path.join(member, 'status.json');
  const readyPath = path.join(root, 'ready');
  fs.writeFileSync(program, `#!${process.execPath}
const fs=require('node:fs');
fs.readFileSync(0,'utf8');
process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:${JSON.stringify(report)}}));
if (${graceful}) process.on('SIGTERM',()=>process.exit(0));
fs.writeFileSync(process.env.READY_PATH,'ready');
setInterval(()=>{},1000);
`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'job.json'), JSON.stringify({ host: 'omo', tasks: [] }));
  fs.writeFileSync(path.join(root, 'prompt.txt'), 'fixture work');
  let watcher;
  let deadline;
  const ready = new Promise((resolve, reject) => {
    watcher = fs.watch(root, (_event, filename) => {
      if (filename === 'ready' && fs.existsSync(readyPath)) resolve();
    });
    deadline = setTimeout(() => reject(new Error('worker readiness timeout')), 5000);
  });
  const child = spawn(process.execPath, [
    worker, '--job-dir', root, '--member', 'task', '--safe-member', 'task',
    '--command', program, '--cwd', root, '--timeout', '10',
  ], { env: { ...process.env, HOME: root, READY_PATH: readyPath }, stdio: 'ignore' });
  const completion = once(child, 'close');
  t.after(() => {
    clearTimeout(deadline);
    watcher.close();
    if (child.exitCode === null && child.signalCode === null) {
      if (fs.existsSync(statusPath)) {
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        if (status.pid) { try { process.kill(status.pid, 'SIGKILL'); } catch {} }
      }
      child.kill('SIGKILL');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  await ready;
  clearTimeout(deadline);
  const stopped = spawnSync(process.execPath, [
    path.join(__dirname, '../skills/pumasi/scripts/pumasi-job.js'), 'stop', root,
  ], { encoding: 'utf8', timeout: 5000 });
  assert.equal(stopped.status, 0, stopped.stderr);
  const [exit] = await completion;
  assert.notEqual(exit, 0);
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).state, 'canceled');
  assert.equal(fs.existsSync(path.join(member, 'report.json')), false);
});
}

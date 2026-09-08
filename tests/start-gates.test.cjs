const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const script = path.join(__dirname, '../skills/pumasi/scripts/pumasi-job.js');

test('start carries shared gate declaration from parsed config into persisted job', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pumasi-start-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ pumasi: { tasks: [{
    name: 'a', command: 'fixture-worker',
    gates: [
      { name: 'common', command: 'fixture-check', shared_readonly: true },
      { name: 'ordinary', command: 'fixture-check' },
    ],
  }] } }));
  const moduleRecord = { exports: {} };
  const actualRequire = createRequire(script);
  let workers = 0;
  const requireFixture = (name) => {
    // JSON is a YAML subset; parser behavior is not the seam under test.
    if (name === 'yaml') return { parse: JSON.parse };
    if (name === 'child_process') return {
      ...actualRequire(name),
      spawn: () => { workers++; return { pid: 12345, unref() {} }; },
    };
    return actualRequire(name);
  };
  requireFixture.main = moduleRecord;
  let output = '';
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
    require: requireFixture, module: moduleRecord,
    __dirname: path.dirname(script), __filename: script, Buffer, console,
    process: {
      argv: [process.execPath, script, 'start', '--config', config,
        '--jobs-dir', path.join(root, 'jobs'), '--json', 'fixture context'],
      env: { ...process.env, HOME: root }, execPath: process.execPath,
      platform: process.platform, cwd: () => root,
      stdout: { write: text => { output += text; } },
      stderr: { write: text => { throw new Error(text); } },
      exit: code => { throw new Error(`unexpected exit ${code}`); },
    },
  }, { filename: script, timeout: 10000 });
  assert.equal(workers, 1);
  const result = JSON.parse(output);
  const persisted = JSON.parse(fs.readFileSync(path.join(result.jobDir, 'job.json'), 'utf8'));
  assert.equal(persisted.tasks[0].gates[0].shared_readonly, true);
  assert.equal(persisted.tasks[0].gates[1].shared_readonly, undefined);
  assert.equal(persisted.tasks[0].gates[0].command, 'fixture-check');
});

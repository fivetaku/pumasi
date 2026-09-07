const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const script = path.join(__dirname, '../skills/pumasi/scripts/pumasi-job.js');

function start(t, { host, envHost, configHost, defaultCommand, taskCommand, laterRound, implicitJobs } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pumasi-host-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ pumasi: {
    ...(configHost ? { host: configHost } : {}),
    defaults: defaultCommand ? { command: defaultCommand } : {},
    tasks: [{ name: 'task', ...(taskCommand ? { command: taskCommand } : {}) },
      ...(laterRound ? [{ name: 'later', round: 2 }] : [])],
  } }));
  const moduleRecord = { exports: {} };
  const requireReal = createRequire(script);
  const launched = [];
  const requireFixture = (name) => {
    if (name === 'yaml') return { parse: JSON.parse };
    if (name === 'child_process') return { ...requireReal(name), spawn: (_program, args) => {
      launched.push(args);
      return { unref() {} };
    } };
    return requireReal(name);
  };
  requireFixture.main = moduleRecord;
  let output = '';
  let errors = '';
  const context = {
    require: requireFixture, module: moduleRecord, __dirname: path.dirname(script),
    Buffer, console,
    process: {
      argv: [process.execPath, script, 'start', '--config', config, '--json',
        ...(host ? ['--host', host] : []), 'fixture request'],
      env: { ...process.env, HOME: root, PUMASI_HOST: envHost || '',
        PUMASI_JOBS_DIR: implicitJobs ? '' : path.join(root, 'jobs') },
      execPath: process.execPath, platform: process.platform, cwd: () => root,
      stdout: { write: text => { output += text; } },
      stderr: { write: text => { errors += text; } },
      exit: code => { throw new Error(`exit ${code}: ${errors}`); },
    },
  };
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), context, { filename: script, timeout: 10000 });
  return { result: JSON.parse(output), root, context, launched, invoke: args => {
    output = '';
    context.process.argv = [process.execPath, script, ...args];
    context.main();
    return JSON.parse(output);
  }, config };
}

for (const host of ['omo', 'codex', 'other']) {
  test(`${host} remains host and defaults to a Claude worker`, (t) => {
    const { result, root } = start(t, { host });
    assert.equal(result.host, host);
    assert.match(result.tasks[0].command, /^claude --print/);
    assert.ok(result.jobDir.startsWith(root));
    assert.equal(result.cwd, root);
  });
}
test('legacy unspecified and Claude Code hosts retain the Codex default', (t) => {
  for (const host of [undefined, 'claude-code']) {
    const { result } = start(t, { host });
    assert.equal(result.host, 'claude-code');
    assert.match(result.tasks[0].command, /^codex exec/);
  }
});
test('explicit task command wins over config default and host selection', (t) => {
  assert.equal(start(t, { host: 'omo', defaultCommand: 'grok -p', taskCommand: 'custom -p' }).result.tasks[0].command, 'custom -p');
});
test('explicit default command wins over host default', (t) => {
  assert.equal(start(t, { host: 'omo', defaultCommand: 'codex exec --model custom' }).result.tasks[0].command, 'codex exec --model custom');
});
test('host selection precedence is CLI then environment then config', (t) => {
  assert.equal(start(t, { host: 'omo', envHost: 'codex', configHost: 'other' }).result.host, 'omo');
  assert.equal(start(t, { envHost: 'codex', configHost: 'other' }).result.host, 'codex');
  assert.equal(start(t, { configHost: 'other' }).result.host, 'other');
});
test('unknown host fails instead of guessing a worker', (t) => {
  assert.throws(() => start(t, { host: 'typo-host' }));
});
test('OMO jobs default to the host project rather than the plugin directory', (t) => {
  const { result, root } = start(t, { host: 'omo', implicitJobs: true });
  assert.equal(path.dirname(result.jobDir), path.join(root, '.pumasi/jobs'));
});
test('later rounds and retries retain worker selection after host environment changes', (t) => {
  const { result, context, launched } = start(t, { host: 'omo', laterRound: true });
  context.process.env.PUMASI_HOST = 'claude-code';
  context.cmdStartRound({ round: '2', _: [] }, result.jobDir);
  context.cmdRedelegate({ task: 'task', correction: 'fixture retry', _: [] }, result.jobDir);
  assert.equal(launched.length, 3);
  for (const args of launched) {
    assert.match(args[args.indexOf('--command') + 1], /^claude --print/);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.jobDir, 'job.json'), 'utf8')).host, 'omo');
});
test('config-only host selection also resolves implicit lifecycle lookup', (t) => {
  const f = start(t, { configHost: 'omo', implicitJobs: true });
  const result = f.invoke(['status', '--config', f.config, '--json']);
  assert.equal(result.jobDir, f.result.jobDir);
  assert.equal(result.members[0].member, 'task');
});

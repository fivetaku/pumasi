# Host-controlled workers

Pumasi's controller is the session that calls it. Workers implement bounded
tasks and return evidence; they do not take over planning or start another team.

| Host | `--host` | Default worker |
| --- | --- | --- |
| Claude Code | `claude-code` | Codex |
| OMO | `omo` | Claude Code |
| Codex | `codex` | Claude Code |
| Other agent or automation | `other` | Claude Code |

Host selection is explicit: `--host` > `PUMASI_HOST` > `pumasi.host` in config >
legacy `claude-code`. Terminal names, provider names, inherited environment
markers, and the model serving the host do not identify the host reliably.

Task `command` overrides `defaults.command`, which overrides the host default.
An existing explicit Codex command continues to select Codex, including in OMO.
Omit it to use the host-dependent default. The resolved host and commands are
saved in `job.json` and retained for subsequent rounds and retries.

## Use from OMO without a Claude plugin installation

The CLI requires Node.js, the repository's existing `yaml` dependency, and an
installed, authenticated worker CLI. It does not require Claude's plugin loader,
`CLAUDE_PLUGIN_ROOT`, or `AskUserQuestion` on the host. Read
`skills/pumasi/SKILL.md` in the host and use its own file/command/question tools.
Do not run Claude-specific `setup/setup.sh` from another host.

Set `PUMASI` to the checkout's absolute plugin directory and `PROJECT` to the
target project. Author the task list in the project's
`.pumasi/pumasi.config.yaml`, not in the installed plugin:

```yaml
pumasi:
  host: omo
  tasks:
    - name: format-duration
      instruction: |
        Implement formatDuration(seconds) in src/format-duration.js.
        Return an M:SS string for a nonnegative integer number of seconds.
        Add focused tests; change only that implementation and its test.
      gates:
        - name: duration-tests
          command: node --test tests/format-duration.test.js
```

Start asynchronously and retain the returned job directory:

```bash
node "$PUMASI/skills/pumasi/scripts/pumasi-job.js" start \
  --host omo --config "$PROJECT/.pumasi/pumasi.config.yaml" \
  --cwd "$PROJECT" --json "Implement the approved duration-format task."
```

Non-Claude hosts default to `$PROJECT/.pumasi/jobs/`. `--jobs-dir` or
`PUMASI_JOBS_DIR` can override that. Use the returned `jobDir` as `JOB_DIR`:

```bash
node "$PUMASI/skills/pumasi/scripts/pumasi-job.js" wait "$JOB_DIR"
node "$PUMASI/skills/pumasi/scripts/pumasi-job.js" status --json "$JOB_DIR"
node "$PUMASI/skills/pumasi/scripts/pumasi-job.js" gates --json "$JOB_DIR"
node "$PUMASI/skills/pumasi/scripts/pumasi-job.js" results --compact "$JOB_DIR"
```

`wait` returns progress snapshots as well as completion. The host must await a
terminal state using its background execution/event mechanism. `overallState:
done` means all workers are terminal, not that every task succeeded. Inspect
individual states, `report.status`, and gates. `gates` results must also be
inspected; its process exit alone is not an all-checks-passed guarantee.

Keep artifacts until the host finishes verification. Do not use one-shot
automatic cleanup when the host still needs the results. Question/approval
tools belong to the host; Claude workers run noninteractively.

## Claude worker contract

Default command: `claude --print --permission-mode acceptEdits`.

The worker adds `--output-format json`, the existing structured report schema,
and `--no-session-persistence`. These transport flags are runner-owned.
The potentially large task prompt is sent through stdin. Explicit model,
effort, tool and permission options remain in the configured command.

Example of a deliberately narrower worker:

```yaml
pumasi:
  host: omo
  defaults:
    command: 'claude --print --permission-mode acceptEdits --tools "Read,Edit,Write"'
```

`acceptEdits` is not unrestricted shell approval. A task requiring other tools
may be denied; select an appropriate explicit permission/tool policy for the
task and inspect permission denials. The host's own bypass settings are not
automatically translated into Claude's bypass mode. No new auth key or
subscription relay is configured by Pumasi.

Claude uses its existing local authentication and environment. The worker
removes only the inherited `CLAUDECODE` nesting marker for this explicit child
invocation; it does not use that marker to infer host identity.

The raw envelope remains in `output.txt`. Valid `structured_output` becomes the
same `report.json` used for Codex: files, status, summary, signatures,
dependencies, and risks. Partial/failed reports remain visible but the task is
not marked done. API error envelopes, malformed/missing reports, triggered
timeouts, and nonzero exits never become successful completion. Host `stop`
records cancellation intent before signaling a running CLI; if observed before
finalization, a graceful zero-exit response is still canceled. Terminal status
is published only after stdout/stderr are drained and report normalization ends.

CLI flags and envelopes were probed with Claude Code 2.1.259. Older versions
without print JSON/schema support need upgrading or an explicitly supported
worker; there is no silent text-success fallback.

## Limits

- Direct Node invocation is available to other hosts; this does not make the
  Claude marketplace command package a native plugin for every host.
- A task's cwd and prompt scope are not an OS sandbox. Claude's actual tool
  permission policy still applies.
- Existing stop/timeout behavior signals the recorded CLI PID. It does not
  claim full descendant-tree isolation or queued-start cancellation.
- Native Windows command quoting and process-tree behavior are not verified by
  the macOS tests. Node availability alone is not a Windows parity guarantee.
- Image generation remains its existing separate workflow.

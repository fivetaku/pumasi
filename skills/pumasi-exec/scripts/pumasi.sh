#!/bin/bash
#
# 품앗이 (Pumasi) - Codex 병렬 외주 개발
#
# Subcommands:
#   pumasi.sh start [options] "project context"   # returns JOB_DIR immediately
#   pumasi.sh status [--json|--text|--checklist] JOB_DIR
#   pumasi.sh wait [--cursor CURSOR] [--timeout-ms N] JOB_DIR
#   pumasi.sh results [--json] JOB_DIR
#   pumasi.sh stop JOB_DIR
#   pumasi.sh clean JOB_DIR
#
# One-shot:
#   pumasi.sh "project context"
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOB_SCRIPT="$SCRIPT_DIR/pumasi-job.sh"

usage() {
  cat <<EOF
품앗이 (Pumasi) — Codex 병렬 외주 개발

Usage:
  $(basename "$0") start [options] "project context"
  $(basename "$0") status [--json|--text|--checklist] <jobDir>
  $(basename "$0") wait [--cursor CURSOR] [--timeout-ms N] <jobDir>
  $(basename "$0") results [--json] <jobDir>
  $(basename "$0") stop <jobDir>
  $(basename "$0") clean <jobDir>

One-shot:
  $(basename "$0") "project context"

Before running: edit pumasi.config.yaml with your task list.
EOF
}

if [ $# -eq 0 ]; then
  usage
  exit 1
fi

case "$1" in
  -h|--help|help)
    usage
    exit 0
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required." >&2
  echo "macOS (Homebrew): brew install node" >&2
  exit 127
fi

case "$1" in
  start|status|wait|results|stop|clean)
    exec "$JOB_SCRIPT" "$@"
    ;;
esac

in_host_agent_context() {
  if [ -n "${CODEX_CACHE_FILE:-}" ]; then
    return 0
  fi
  case "$SCRIPT_DIR" in
    */.codex/skills/*|*/.claude/skills/*)
      if [ ! -t 1 ] && [ ! -t 2 ]; then
        return 0
      fi
      ;;
  esac
  return 1
}

JOB_DIR="$("$JOB_SCRIPT" start "$@")"

if in_host_agent_context; then
  exec "$JOB_SCRIPT" wait "$JOB_DIR"
fi

echo "pumasi: started ${JOB_DIR}" >&2

cleanup_on_signal() {
  if [ -n "${JOB_DIR:-}" ] && [ -d "$JOB_DIR" ]; then
    "$JOB_SCRIPT" stop "$JOB_DIR" >/dev/null 2>&1 || true
    "$JOB_SCRIPT" clean "$JOB_DIR" >/dev/null 2>&1 || true
  fi
  exit 130
}

trap cleanup_on_signal INT TERM

while true; do
  WAIT_JSON="$("$JOB_SCRIPT" wait "$JOB_DIR")"
  OVERALL="$(printf '%s' "$WAIT_JSON" | node -e '
const fs=require("fs");
const d=JSON.parse(fs.readFileSync(0,"utf8"));
process.stdout.write(String(d.overallState||""));
')"

  "$JOB_SCRIPT" status --text "$JOB_DIR" >&2

  if [ "$OVERALL" = "done" ]; then
    break
  fi
done

trap - INT TERM

"$JOB_SCRIPT" results "$JOB_DIR"
"$JOB_SCRIPT" clean "$JOB_DIR" >/dev/null

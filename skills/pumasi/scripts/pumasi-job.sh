#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required." >&2
  exit 127
fi

exec node "$SCRIPT_DIR/pumasi-job.js" "$@"

#!/bin/bash
# Human permission-flow entry point. Only the owner grants permissions.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
if [[ $# -eq 0 ]]; then set -- status; fi
exec node "$repo/scripts/yonder-permissions.mjs" "$@"

#!/bin/bash
# Owner entry point. No request/guide/watch is run by the agent.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
if [[ $# -eq 0 ]]; then set -- status; fi
exec node "$repo/scripts/yonder-permissions.mjs" "$@"

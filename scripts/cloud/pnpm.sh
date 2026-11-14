#!/usr/bin/env bash
set -euo pipefail
MILKUP_REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$MILKUP_REPO_ROOT"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export COREPACK_HOME="${COREPACK_HOME:-/workspace/.cache/corepack}"
# Corepack reads packageManager from this v2 checkout (currently pnpm 11.7.0).
exec corepack pnpm "$@"

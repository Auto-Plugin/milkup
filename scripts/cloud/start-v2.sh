#!/usr/bin/env bash
set -euo pipefail
MILKUP_REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$MILKUP_REPO_ROOT"
export CARGO_HOME="${CARGO_HOME:-/workspace/.cache/milkup-v2/cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-/workspace/.cache/milkup-v2/rustup}"
export RUSTUP_TOOLCHAIN=1.99.0
export PATH="$CARGO_HOME/bin:$PATH"
case "${1:-frontend}" in
  frontend) exec bash scripts/cloud/pnpm.sh --filter @milkup/desktop dev ;;
  native)
    command -v cargo >/dev/null || { echo 'Run setup-v2.sh native first.' >&2; exit 2; }
    pkg-config --exists webkit2gtk-4.1 || { echo 'Missing WebKitGTK 4.1 development libraries.' >&2; exit 2; }
    # Tauri invokes `pnpm dev` in apps/desktop; propagate the same pinned pnpm to children.
    export PATH="$MILKUP_REPO_ROOT/scripts/cloud/bin:$PATH"
    exec bash scripts/cloud/pnpm.sh --filter @milkup/desktop tauri dev --no-watch
    ;;
  *) echo 'Usage: start-v2.sh [frontend|native]' >&2; exit 1 ;;
esac

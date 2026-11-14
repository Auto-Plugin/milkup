#!/usr/bin/env bash
# Repository-local draft for Linux cloud setup. Does not publish an environment or product.
set -euo pipefail
MILKUP_REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$MILKUP_REPO_ROOT"
if [[ ! -f apps/desktop/src-tauri/Cargo.toml || ! -f pnpm-workspace.yaml ]]; then
  echo 'Expected the existing milkup v2 checkout. No branch will be created or switched.' >&2
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22+ required")'
export CI=true
export CARGO_HOME="${CARGO_HOME:-/workspace/.cache/milkup-v2/cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-/workspace/.cache/milkup-v2/rustup}"
export PATH="$MILKUP_REPO_ROOT/scripts/cloud/bin:$CARGO_HOME/bin:$PATH"
MILKUP_RUST_VERSION=1.99.0

case "${1:-frontend}" in
  frontend) ;;
  native)
    if ! command -v rustup >/dev/null; then
      MILKUP_RUST_INSTALLER="$(mktemp)"
      trap 'rm -f "$MILKUP_RUST_INSTALLER"' EXIT
      curl --proto '=https' --tlsv1.2 --fail --location https://sh.rustup.rs -o "$MILKUP_RUST_INSTALLER"
      sh "$MILKUP_RUST_INSTALLER" -y --no-modify-path --profile minimal --default-toolchain "$MILKUP_RUST_VERSION"
    elif ! rustup run "$MILKUP_RUST_VERSION" rustc --version >/dev/null 2>&1; then
      rustup toolchain install "$MILKUP_RUST_VERSION" --profile minimal
    fi
    export RUSTUP_TOOLCHAIN="$MILKUP_RUST_VERSION"
    if ! pkg-config --exists gtk+-3.0 webkit2gtk-4.1 javascriptcoregtk-4.1 libsoup-3.0; then
      echo 'Missing Tauri Linux system libraries. Run the documented Debian packages step in an administrator-controlled environment image.' >&2
      exit 2
    fi
    cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --no-deps --format-version 1 >/dev/null
    ;;
  *) echo 'Usage: setup-v2.sh [frontend|native]' >&2; exit 1 ;;
esac
bash scripts/cloud/pnpm.sh --version
bash scripts/cloud/pnpm.sh install --frozen-lockfile
bash scripts/cloud/pnpm.sh build
bash scripts/cloud/pnpm.sh typecheck

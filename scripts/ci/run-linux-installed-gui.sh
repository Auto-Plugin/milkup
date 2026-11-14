#!/usr/bin/env bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "$(id -u)" != 0
test -z "${WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS:-}"
export MILKUP_NATIVE_PROFILE_ROOT="$RUNNER_TEMP/milkup-native-profile-$GITHUB_RUN_ID"
mkdir -m 700 "$MILKUP_NATIVE_PROFILE_ROOT"
export XDG_DATA_HOME="$MILKUP_NATIVE_PROFILE_ROOT/data"
export XDG_CONFIG_HOME="$MILKUP_NATIVE_PROFILE_ROOT/config"
export XDG_CACHE_HOME="$MILKUP_NATIVE_PROFILE_ROOT/cache"
export XDG_STATE_HOME="$MILKUP_NATIVE_PROFILE_ROOT/state"
export XDG_RUNTIME_DIR="$MILKUP_NATIVE_PROFILE_ROOT/runtime"
mkdir -m 700 "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$XDG_RUNTIME_DIR"
export TAURI_APP_PATH=/usr/bin/milkup-desktop
export TAURI_DRIVER_URL=http://127.0.0.1:4444
export MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1
export MILKUP_NATIVE_CLOSE_HELPER="$RUNNER_TEMP/milkup-window-close"
export MILKUP_NATIVE_EXPECTED_BINARY_SHA256
MILKUP_NATIVE_EXPECTED_BINARY_SHA256=$(sha256sum "$TAURI_APP_PATH" | cut -d' ' -f1)
export MILKUP_NATIVE_EVIDENCE_DIR="$RUNNER_TEMP/linux-native-evidence/gui"
mkdir -p "$MILKUP_NATIVE_EVIDENCE_DIR"
# This wrapper owns only this driver; the UI harness separately verifies normal application close.
trap 'if test -n "${driver_pid:-}"; then kill "$driver_pid" 2>/dev/null || true; wait "$driver_pid" 2>/dev/null || true; fi' EXIT
tauri-driver --native-driver /usr/bin/WebKitWebDriver > "$MILKUP_NATIVE_EVIDENCE_DIR/driver.log" 2>&1 &
driver_pid=$!
for attempt in $(seq 1 50); do
  if curl --fail --silent "$TAURI_DRIVER_URL/status" > /dev/null; then break; fi
  sleep 0.1
done
node scripts/ci/linux-installed-gui.mjs

#!/usr/bin/env bash
set -euo pipefail
source /workspace/milkup-p7-quality-evidence/milestone02/outline/runtime/run-env.sh "$@"
[[ ! -e "$XDG_RUNTIME_DIR" && ! -e "$MILKUP_NATIVE_PROFILE_ROOT" && ! -e "$MILKUP_NATIVE_APP_LOG" && ! -e "$MILKUP_NATIVE_EVIDENCE_DIR" ]]
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$(dirname "$MILKUP_NATIVE_APP_LOG")"
mkdir -m 0700 "$XDG_RUNTIME_DIR"
exec /workspace/milkup-export-print-evidence/milestone01/native/namespace.sh dbus-run-session -- /workspace/.cargo/bin/tauri-driver --port 4477 --native-port 4478 --native-driver /workspace/.cloud/milkup-v2/sysroot/usr/bin/WebKitWebDriver > "$MILKUP_NATIVE_APP_LOG" 2>&1

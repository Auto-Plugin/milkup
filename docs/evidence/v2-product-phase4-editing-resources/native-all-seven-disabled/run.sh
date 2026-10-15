#!/bin/bash
set -euo pipefail
source /workspace/.cloud/milkup-v2/env.sh
cd /workspace/milkup
export DISPLAY=:111
export MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1
export MILKUP_P1_BINARY_CONFIRMED=1
export TAURI_APP_PATH=/workspace/milkup-editing-resources-phase4-evidence/candidate-02-deb/usr/bin/milkup-desktop
export TAURI_DRIVER_URL=http://127.0.0.1:4592
export MILKUP_NATIVE_EVIDENCE_DIR=/workspace/milkup-editing-resources-phase4-evidence/native/all-seven-disabled
export XDG_CONFIG_HOME=$MILKUP_NATIVE_EVIDENCE_DIR/profile/config
export XDG_CACHE_HOME=$MILKUP_NATIVE_EVIDENCE_DIR/profile/cache
export XDG_DATA_HOME=$MILKUP_NATIVE_EVIDENCE_DIR/profile/data
export MILKUP_RECOVERY_PROFILE=$XDG_DATA_HOME/app.milkup.desktop/recovery-v1
export MILKUP_EXPECT_PLUGIN_IDS=milkup.formatting,milkup.images,milkup.outline,milkup.preferences,milkup.shortcuts,milkup.updates,milkup.workspace
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME"
Xvfb :111 -screen 0 1600x1100x24 -nolisten tcp > "$MILKUP_NATIVE_EVIDENCE_DIR/xvfb.log" 2>&1 &
acceptance_xvfb_pid=$!
acceptance_driver_pid=
cleanup() {
  if [ -n "$acceptance_driver_pid" ]; then kill -TERM -- -"$acceptance_driver_pid" 2>/dev/null || true; fi
  kill -TERM "$acceptance_xvfb_pid" 2>/dev/null || true
}
trap cleanup EXIT
for attempt in $(seq 1 40); do
  if xdpyinfo >/dev/null 2>&1; then break; fi
  sleep 0.1
done
setsid proot -b /workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1:/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1 dbus-run-session -- tauri-driver --port 4592 --native-port 4593 --native-driver /workspace/.cloud/milkup-v2/sysroot/usr/bin/WebKitWebDriver > "$MILKUP_NATIVE_EVIDENCE_DIR/driver.log" 2>&1 &
acceptance_driver_pid=$!
for attempt in $(seq 1 40); do
  if curl -s http://127.0.0.1:4592/status >/dev/null; then break; fi
  sleep 0.1
done
node tests/native/tauri-all-plugins-disabled.mjs > "$MILKUP_NATIVE_EVIDENCE_DIR/run.log" 2>&1

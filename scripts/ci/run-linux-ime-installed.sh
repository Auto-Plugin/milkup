#!/usr/bin/env bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "$(id -u)" != 0
test -z "${WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS:-}"
test "${GDK_SCALE:-}" = 1 || test "${GDK_SCALE:-}" = 2
export MILKUP_NATIVE_PROFILE_ROOT="$RUNNER_TEMP/milkup-ime-profile-$GITHUB_RUN_ID-$GDK_SCALE"
mkdir -m 700 "$MILKUP_NATIVE_PROFILE_ROOT"
export XDG_DATA_HOME="$MILKUP_NATIVE_PROFILE_ROOT/data"
export XDG_CONFIG_HOME="$MILKUP_NATIVE_PROFILE_ROOT/config"
export XDG_CACHE_HOME="$MILKUP_NATIVE_PROFILE_ROOT/cache"
export XDG_STATE_HOME="$MILKUP_NATIVE_PROFILE_ROOT/state"
export XDG_RUNTIME_DIR="$MILKUP_NATIVE_PROFILE_ROOT/runtime"
mkdir -m 700 "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$XDG_RUNTIME_DIR"
export GTK_IM_MODULE=ibus
export XMODIFIERS=@im=ibus
# D-Bus was started by the outer isolated session before these owned XDG paths
# existed. Its activated dconf service must use the same temporary profile.
dbus-update-activation-environment XDG_DATA_HOME XDG_CONFIG_HOME XDG_CACHE_HOME XDG_STATE_HOME XDG_RUNTIME_DIR GTK_IM_MODULE XMODIFIERS DISPLAY
export TAURI_APP_PATH=/usr/bin/milkup-desktop
export TAURI_DRIVER_URL=http://127.0.0.1:4444
export MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1
export MILKUP_NATIVE_CLOSE_HELPER="$RUNNER_TEMP/milkup-window-close"
export MILKUP_NATIVE_EVIDENCE_DIR="$RUNNER_TEMP/linux-native-evidence/ime-scale-$GDK_SCALE"
mkdir -p "$MILKUP_NATIVE_EVIDENCE_DIR"
trap 'for child in ${driver_pid:-} ${ibus_pid:-}; do kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; done' EXIT
ibus-daemon --xim > "$MILKUP_NATIVE_EVIDENCE_DIR/ibus.log" 2>&1 &
ibus_pid=$!
for attempt in $(seq 1 100); do
  kill -0 "$ibus_pid"
  if /usr/bin/python3 -c "import gi,sys;gi.require_version('IBus','1.0');from gi.repository import IBus;IBus.init();sys.exit(0 if IBus.Bus.new().is_connected() else 1)"; then break; fi
  sleep 0.1
done
ibus list-engine > "$MILKUP_NATIVE_EVIDENCE_DIR/engines.txt"
gsettings set org.freedesktop.ibus.general preload-engines "['libpinyin','xkb:us::eng']"
gsettings set org.freedesktop.ibus.general use-global-engine true
# Keep the test display's US physical keymap. IBus 1.5.34-rc2's CLI returns
# failure for an engine with layout=default after successfully selecting it
# when it tries to run setxkbmap with no arguments (tools/main.vala).
gsettings set org.freedesktop.ibus.general use-system-keyboard-layout true
test "$(gsettings get org.freedesktop.ibus.general use-system-keyboard-layout)" = true
gsettings list-recursively org.freedesktop.ibus.general > "$MILKUP_NATIVE_EVIDENCE_DIR/ibus-settings.txt"
selected=0
for attempt in $(seq 1 50); do
  if ibus engine libpinyin >> "$MILKUP_NATIVE_EVIDENCE_DIR/engine-selection.log" 2>&1; then selected=1; break; fi
  printf 'attempt=%s failed; actual=' "$attempt" >> "$MILKUP_NATIVE_EVIDENCE_DIR/engine-selection.log"
  ibus engine >> "$MILKUP_NATIVE_EVIDENCE_DIR/engine-selection.log" 2>&1 || true
  sleep 0.1
done
test "$selected" = 1
ibus engine > "$MILKUP_NATIVE_EVIDENCE_DIR/initial-engine.txt"
test "$(cat "$MILKUP_NATIVE_EVIDENCE_DIR/initial-engine.txt")" = libpinyin
gsettings list-recursively org.freedesktop.ibus.general > "$MILKUP_NATIVE_EVIDENCE_DIR/ibus-settings.txt"
xdpyinfo > "$MILKUP_NATIVE_EVIDENCE_DIR/x-display.txt"
tauri-driver --native-driver /usr/bin/WebKitWebDriver > "$MILKUP_NATIVE_EVIDENCE_DIR/driver.log" 2>&1 &
driver_pid=$!
for attempt in $(seq 1 50); do
  if curl --fail --silent "$TAURI_DRIVER_URL/status" > /dev/null; then break; fi
  sleep 0.1
done
node scripts/ci/linux-ime-installed.mjs

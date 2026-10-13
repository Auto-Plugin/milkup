set -eu
ibus-daemon --xim --panel=disable --config=/workspace/.cache/milkup-ime-phase11/usr/libexec/ibus-memconf --emoji-extension=disable > /tmp/milkup-v2-phase12/ime/daemon.log 2>&1 &
daemon=$!
trap 'kill "$daemon" 2>/dev/null || true' EXIT
for attempt in {1..30}; do if ibus list-engine > /tmp/milkup-v2-phase12/ime/engines.log 2>/dev/null; then break; fi; sleep 0.1; done
timeout 12 ibus engine libpinyin
ibus engine
ps -eo pid,ppid,stat,comm | rg 'ibus|dbus'

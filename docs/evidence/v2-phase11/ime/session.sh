set -eu
ibus-daemon --xim --panel=/usr/libexec/ibus-ui-gtk3 --config=/usr/libexec/ibus-memconf --emoji-extension=disable > /tmp/milkup-v2-phase11/ime/daemon.log 2>&1 &
ibus version
ready=0
for attempt in {1..50}; do
  if ibus list-engine > /tmp/milkup-v2-phase11/ime/engines.log 2>/dev/null; then ready=1; break; fi
  sleep 0.1
done
[ "$ready" = 1 ]
/usr/libexec/ibus-engine-libpinyin --ibus --verbose > /tmp/milkup-v2-phase11/ime/engine.log 2>&1 &
sleep 1
ibus engine libpinyin
exec tauri-driver --port 4444 --native-port 9515 --native-driver /workspace/.cloud/milkup-v2/sysroot/usr/bin/WebKitWebDriver

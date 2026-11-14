set -eux
export IBUS_ADDRESS=unix:path=/tmp/milkup-v2-phase12/ime/ibus-third.sock
ibus-daemon --address="$IBUS_ADDRESS" --single --verbose > /tmp/milkup-v2-phase12/ime/daemon-third.log 2>&1 &
daemon=$!
config=0
trap 'kill "$daemon" 2>/dev/null || true; if [ "$config" != 0 ]; then kill "$config" 2>/dev/null || true; fi; wait || true' EXIT
for attempt in {1..30}; do if ibus list-engine > /tmp/milkup-v2-phase12/ime/engines-third.log 2>/dev/null; then break; fi; sleep 0.1; done
/workspace/.cache/milkup-ime-phase11/usr/libexec/ibus-memconf > /tmp/milkup-v2-phase12/ime/config-third.log 2>&1 &
config=$!
sleep 0.3
timeout 12 ibus engine libpinyin
ibus engine

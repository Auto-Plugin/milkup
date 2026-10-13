set -eux
export IBUS_ADDRESS=unix:path=/tmp/milkup-v2-phase12/ime/ibus.sock
ibus-daemon --address="$IBUS_ADDRESS" --single --panel=disable --config=disable --emoji-extension=disable --verbose > /tmp/milkup-v2-phase12/ime/daemon-second.log 2>&1 &
daemon=$!
trap 'kill "$daemon" 2>/dev/null || true; wait "$daemon" || true' EXIT
for attempt in {1..30}; do if ibus list-engine > /tmp/milkup-v2-phase12/ime/engines-second.log 2>/dev/null; then break; fi; if ! kill -0 "$daemon"; then wait "$daemon"; exit 1; fi; sleep 0.1; done
timeout 12 ibus engine libpinyin
ibus engine

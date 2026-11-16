#!/usr/bin/env bash
# Manual future same-package gate only. Does not install/build/dispatch or change the system.
set -euo pipefail
set -C
: "${MILKUP_FINAL_MANIFEST:?}" "${MILKUP_FINAL_RECIPE:?}" "${MILKUP_FINAL_STAGING_RECEIPT:?}"
: "${MILKUP_FINAL_PACKAGE:?}" "${MILKUP_FINAL_APPLICATION:?}" "${MILKUP_FINAL_DRIVER:?}"
: "${MILKUP_NATIVE_EVIDENCE_DIR:?}" "${MILKUP_NATIVE_EXTRACTED_APP:?}"
: "${MILKUP_NATIVE_PROFILE_ROOT:?}" "${MILKUP_NATIVE_CLOSE_HELPER:?}" "${DISPLAY:?}"
test "$(id -u)" != 0
test "${MILKUP_NATIVE_EXCLUSIVE_DISPLAY:-}" = 1
# Each real test validates isolated profile paths and installed binary again.
test -d "$MILKUP_NATIVE_EVIDENCE_DIR"
receipt="$MILKUP_NATIVE_EVIDENCE_DIR/final-prefix-installed-gate.json"
timeout --signal=TERM --kill-after=5s 90s python3 research/pdf-delivery-20261116/install_gate.py installed \
  --manifest "$MILKUP_FINAL_MANIFEST" --recipe "$MILKUP_FINAL_RECIPE" \
  --receipt "$MILKUP_FINAL_STAGING_RECEIPT" --package "$MILKUP_FINAL_PACKAGE" \
  --application "$MILKUP_FINAL_APPLICATION" --driver "$MILKUP_FINAL_DRIVER" --output "$receipt"
export TAURI_APP_PATH="$MILKUP_FINAL_APPLICATION"
export MILKUP_NATIVE_PACKAGE_MANIFEST="$MILKUP_FINAL_MANIFEST"
export MILKUP_NATIVE_EXPECTED_BINARY_SHA256
MILKUP_NATIVE_EXPECTED_BINARY_SHA256=$(python3 - "$MILKUP_FINAL_MANIFEST" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); rows=[r for r in m['files'] if r['role']=='application']
assert len(rows)==1
print(rows[0]['sha256'])
PY
)
# Reuse the exclusive runner's loopback driver port. Never attach to an old service.
export TAURI_DRIVER_URL=http://127.0.0.1:4444
if curl --silent --max-time 2 "$TAURI_DRIVER_URL/status" >/dev/null; then
  printf '%s\n' 'Refusing pre-existing driver at the reserved test endpoint' >&2
  exit 1
fi
for command in tauri-driver xdotool xwininfo xprop node timeout; do command -v "$command" >/dev/null; done
trap 'if test -n "${driver_pid:-}"; then kill "$driver_pid" 2>/dev/null || true; wait "$driver_pid" 2>/dev/null || true; fi' EXIT
timeout --signal=TERM --kill-after=5s 600s tauri-driver --native-driver "$MILKUP_FINAL_DRIVER" > "$MILKUP_NATIVE_EVIDENCE_DIR/final-prefix-driver.log" 2>&1 &
driver_pid=$!
ready=0
for attempt in $(seq 1 50); do
  if curl --fail --silent --max-time 1 "$TAURI_DRIVER_URL/status" >/dev/null; then ready=1; break; fi
  kill -0 "$driver_pid"
  sleep 0.1
done
test "$ready" = 1
# Product identity is fixed to v2 integration 546796b0 by install_gate.py.
# No research runtime environment, logging feature or probe switch is required.
timeout --signal=TERM --kill-after=5s 240s node tests/native/tauri-external-reload.mjs
timeout --signal=TERM --kill-after=5s 180s node scripts/ci/linux-installed-bracket-caret.mjs
printf '%s\n' '{"issue":94,"status":"not-applicable-no-supported-language-switch","nativePassed":false,"sourceSha":"546796b005390642ee5cc655440b4b350a730717","note":"External reload is tested separately; no language UI was invented."}' > "$MILKUP_NATIVE_EVIDENCE_DIR/issue-94-boundary.json"
# These two native scenarios do not imply PDF, mappings/sandbox, IME, installation recovery or release acceptance.

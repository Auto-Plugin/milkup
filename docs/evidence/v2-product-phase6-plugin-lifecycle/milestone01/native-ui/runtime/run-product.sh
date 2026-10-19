#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 ]] || exit 2
run=$1
runtime=/workspace/milkup-plugin-lifecycle-evidence/milestone01/native-ui/runtime
binary=/workspace/milkup-plugin-lifecycle-evidence/milestone01/production-accepted/milkup-desktop
hash=$(python3 -c 'import json; print(json.load(open("/workspace/milkup-plugin-lifecycle-evidence/milestone01/production-accepted/proof.json"))["binarySha256"])')
args=("$run" html "$binary" "$hash" /workspace/milkup-export-print-evidence/milestone01/plugin/action-id-fix-external/dist/milkup.export-print-1.0.0.milkup-plugin 08cd8532ecd209f4794f88de1880e06c16c586ae2997e326450687e1be2181b9)
export MILKUP_P6_CASE="$2" MILKUP_P6_FORMAT="$3" MILKUP_P6_BINARY_CONFIRMED=1
export MILKUP_P6_EXTRA_PACKAGES_JSON="$(cat /workspace/milkup-plugin-lifecycle-evidence/milestone01/native-preflight02/extra-packages.json)"
python3 "$runtime/driver-control.py" start "${args[@]}"
trap 'python3 "$runtime/driver-control.py" stop "$run"' EXIT
source "$runtime/run-env.sh" "${args[@]}"
export MILKUP_P6_NATIVE_LOG="$MILKUP_NATIVE_APP_LOG"
cd /workspace/milkup
python3 "$runtime/run-harness.py"

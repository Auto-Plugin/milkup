#!/usr/bin/env bash
set -euo pipefail
run=$1
stage=$2
runtime=/workspace/milkup-export-print-evidence/milestone01/native-ui/runtime
args=("$run" "$stage" "${MILKUP_P5_FROZEN_BINARY:-/workspace/milkup-export-print-evidence/milestone01/production/milkup-desktop}" "${MILKUP_P5_FROZEN_SHA256:-222b2a321616f744fcf950d4754053951f4981857fb8fda386400de893051fa5}" /workspace/milkup-export-print-evidence/milestone01/plugin/action-id-fix-external/dist/milkup.export-print-1.0.0.milkup-plugin 08cd8532ecd209f4794f88de1880e06c16c586ae2997e326450687e1be2181b9)
python3 "$runtime/driver-control.py" start "${args[@]}"
trap 'python3 "$runtime/driver-control.py" stop "$run"' EXIT
source "$runtime/run-env.sh" "${args[@]}"
cd /workspace/milkup
python3 tests/native/p5-output-run-case.py "$stage"

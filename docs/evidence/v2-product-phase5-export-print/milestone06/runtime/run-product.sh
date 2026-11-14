#!/usr/bin/env bash
set -euo pipefail
[[ $# == 6 ]] || exit 2
run=$1
runtime=/workspace/milkup-export-print-evidence/milestone01/native-ui/runtime
args=("$run" html /workspace/milkup-export-print-evidence/milestone06/production-queue/milkup-desktop 6e6c004030fe06146b58d9e40cbd22c7c7d3315c306ceb741f3f58e119ed9d2a /workspace/milkup-export-print-evidence/milestone01/plugin/action-id-fix-external/dist/milkup.export-print-1.0.0.milkup-plugin 08cd8532ecd209f4794f88de1880e06c16c586ae2997e326450687e1be2181b9)
export MILKUP_P5M6_CASE="$2" MILKUP_P5M6_FORMAT="$3" MILKUP_P5M6_DIAGRAM_ARCHIVE="$4" MILKUP_P5M6_DIAGRAM_ARCHIVE_SHA256="$5" MILKUP_P5M6_DIAGRAM_VERSION="$6"
python3 "$runtime/driver-control.py" start "${args[@]}"
trap 'python3 "$runtime/driver-control.py" stop "$run"' EXIT
source "$runtime/run-env.sh" "${args[@]}"
export MILKUP_P5M6_NATIVE_LOG="$MILKUP_NATIVE_APP_LOG"
cd /workspace/milkup
python3 /workspace/milkup-export-print-evidence/milestone06/runtime/run-diagrams.py

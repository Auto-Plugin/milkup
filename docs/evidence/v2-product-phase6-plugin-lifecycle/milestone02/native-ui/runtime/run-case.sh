#!/usr/bin/env bash
set -euo pipefail
[[ $# == 4 ]] || exit 2
run=$1
kind=$2
case_name=$3
production=$4
runtime=/workspace/milkup-plugin-lifecycle-evidence/milestone02/native-ui/runtime
binary=/workspace/milkup-plugin-lifecycle-evidence/milestone02/$production/milkup-desktop
hash=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["binarySha256"])' "/workspace/milkup-plugin-lifecycle-evidence/milestone02/$production/proof.json")
archive=/workspace/milkup-plugin-lifecycle-evidence/milestone02/management-extension/external/dist/milkup.management-1.0.0.milkup-plugin
archive_hash=$(sha256sum "$archive" | cut -d ' ' -f 1)
args=("$run" html "$binary" "$hash" "$archive" "$archive_hash")
python3 "$runtime/driver-control.py" start "${args[@]}"
trap 'python3 "$runtime/driver-control.py" stop "$run"' EXIT
source "$runtime/run-env.sh" "${args[@]}"
export MILKUP_P6_BINARY_CONFIRMED=1 MILKUP_P6_CATALOG_CASE="$case_name"
export MILKUP_P6_MANAGEMENT_ARCHIVE="$archive" MILKUP_P6_MANAGEMENT_EXPECTED_SHA256="$archive_hash"
export MILKUP_P6_CASE="$case_name" MILKUP_P6_FORMAT=html MILKUP_P6_NATIVE_LOG="$MILKUP_NATIVE_APP_LOG"
export MILKUP_P6_EXTRA_PACKAGES_JSON="$(cat /workspace/milkup-plugin-lifecycle-evidence/milestone01/native-preflight02/extra-packages.json)"
if [[ "$kind" == legacy && "$case_name" == cold-* ]]; then
  export MILKUP_P5_ARCHIVE=/workspace/milkup-export-print-evidence/milestone01/plugin/action-id-fix-external/dist/milkup.export-print-1.0.0.milkup-plugin
  export MILKUP_P5_ARCHIVE_SHA256=08cd8532ecd209f4794f88de1880e06c16c586ae2997e326450687e1be2181b9
fi
cd /workspace/milkup
python3 "$runtime/run-case.py" "$kind"

#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 && "$1" == p7-candidate-* ]]
run="$1"
source /workspace/milkup-p7-quality-evidence/milestone01/native-ui/candidate-runtime/run-env.sh "$run" "$2" "$3"
export MILKUP_PLUGIN_ARCHIVE=/workspace/milkup-p7-quality-evidence/milestone01/outline/external-1.3.2/milkup.outline-1.3.2.milkup-plugin
export MILKUP_PLUGIN_ARCHIVE_SHA256=c4f1bc3b3333fc8ae8919487cd2c20e59b622af98c97ce26e14ff9fdaf3b0f0f
export MILKUP_P7_OUTLINE_VERSION=1.3.2 MILKUP_P7_OUTLINE_CASE=ordinary MILKUP_P7_OUTLINE_PHASE=smoke
export MILKUP_P7_OUTLINE_INDEX_SAMPLES=1 MILKUP_P7_OUTLINE_SAMPLES=1 MILKUP_P7_BINARY_CONFIRMED=1
cd /workspace/milkup
exec node tests/native/tauri-p7-outline-performance.mjs

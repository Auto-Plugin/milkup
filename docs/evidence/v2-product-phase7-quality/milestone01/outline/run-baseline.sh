#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 && "$2" =~ ^(ordinary|large|dense)$ && "$3" =~ ^(performance|keyboard|scroll|lifecycle)$ ]]
run="$1"
source /workspace/milkup-p7-quality-evidence/milestone01/native-ui/runtime/run-env.sh "$run"
export MILKUP_PLUGIN_ARCHIVE=/workspace/milkup-plugin-lifecycle-evidence/milestone01/outline-external/milkup.outline-1.3.1.milkup-plugin
export MILKUP_PLUGIN_ARCHIVE_SHA256=7eea6ffb5bba53155b3c256c6e35d95b04a93199ebbbd04636ee9c7ec5f6f712
export MILKUP_P7_OUTLINE_VERSION=1.3.1 MILKUP_P7_OUTLINE_CASE="$2" MILKUP_P7_OUTLINE_PHASE="$3"
export MILKUP_P7_OUTLINE_INDEX_SAMPLES=3 MILKUP_P7_OUTLINE_SAMPLES=20 MILKUP_P7_BINARY_CONFIRMED=1
cd /workspace/milkup
exec node tests/native/tauri-p7-outline-performance.mjs

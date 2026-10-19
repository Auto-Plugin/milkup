#!/usr/bin/env bash
set -euo pipefail
# RUN CASE PHASE EXACT_ELF_SHA. Driver startup remains separately ownership-checked.
[[ $# == 4 && "$1" =~ ^p7-candidate-m02-outline04-[a-z0-9-]+$ && "$2" =~ ^(large|dense)$ && "$3" =~ ^(performance|keyboard|lifecycle)$ && "$4" =~ ^[a-f0-9]{64}$ ]]
source /workspace/milkup-p7-quality-evidence/milestone02/outline/runtime04/run-env.sh "$1" /workspace/milkup-p7-quality-evidence/milestone02/candidate-production-04/milkup-desktop "$4"
export MILKUP_PLUGIN_ARCHIVE=/workspace/milkup-p7-quality-evidence/milestone02/outline/external-1.3.3/milkup.outline-1.3.3.milkup-plugin
export MILKUP_PLUGIN_ARCHIVE_SHA256=80a9ce947c4abf2998eb72c36c327d5d826f0d30fa22dad61f903ff4713ca5c6
export MILKUP_P7_OUTLINE_VERSION=1.3.3 MILKUP_P7_OUTLINE_CASE="$2" MILKUP_P7_OUTLINE_PHASE="$3"
export MILKUP_P7_OUTLINE_INDEX_SAMPLES=3 MILKUP_P7_OUTLINE_SAMPLES=20 MILKUP_P7_BINARY_CONFIRMED=1
export MILKUP_P7_EXISTING_FIXTURE="/workspace/milkup-p7-quality-evidence/milestone02/outline/runs/p7-candidate-m02-outline-$2-01/outline.md"
if [[ "$3" == lifecycle ]]; then
  original_fixture="$MILKUP_P7_EXISTING_FIXTURE"
  export MILKUP_P7_EXISTING_FIXTURE="/tmp/$MILKUP_NATIVE_RUN-source.md"
  [[ ! -e "$MILKUP_P7_EXISTING_FIXTURE" ]]
  cp -- "$original_fixture" "$MILKUP_P7_EXISTING_FIXTURE"
fi
cd /workspace/milkup
exec node /workspace/milkup-p7-quality-evidence/milestone02/outline/candidate04-inputs/tests/native/tauri-p7-outline-performance.mjs

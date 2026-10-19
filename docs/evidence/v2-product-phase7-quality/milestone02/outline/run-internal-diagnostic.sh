#!/usr/bin/env bash
set -euo pipefail
[[ $# == 2 && "$1" =~ ^p7-candidate-m02-outline-[a-z0-9-]+$ && "$2" =~ ^(large|dense)$ ]]
source /workspace/milkup-p7-quality-evidence/milestone02/outline/runtime/run-env.sh "$1" /workspace/milkup-p7-quality-evidence/milestone01/candidate-production-03/milkup-desktop 341d12999d07ba0b7116d463ebacde4bb52ead97279a33ad588ab599d2ddb7a2
export MILKUP_PLUGIN_ARCHIVE=/workspace/milkup-p7-quality-evidence/milestone02/review/outline-internal-diagnostic/build-01/dist/milkup.outline-1.3.2-p7diag.1.milkup-plugin
export MILKUP_PLUGIN_ARCHIVE_SHA256=504153854d2be3bf85d4e3a6f63ba70f098a2be6f11ce01fbdec3427e0183dfb
export MILKUP_P7_OUTLINE_VERSION=1.3.2-p7diag.1 MILKUP_P7_OUTLINE_CASE="$2" MILKUP_P7_OUTLINE_PHASE=internal
export MILKUP_P7_OUTLINE_INDEX_SAMPLES=1 MILKUP_P7_OUTLINE_SAMPLES=3 MILKUP_P7_BINARY_CONFIRMED=1
export MILKUP_P7_DIAGNOSTIC_SOURCE="/workspace/milkup-p7-quality-evidence/milestone02/outline/runs/p7-candidate-m02-outline-$2-01/outline.md"
cd /workspace/milkup
exec node /workspace/milkup-p7-quality-evidence/milestone02/outline/diagnostic-inputs/tests/native/tauri-p7-outline-internal-diagnostic.mjs

#!/bin/bash
set -euo pipefail
case "${1:-}" in smoke|corpus) ;; *) exit 64 ;; esac
export DISPLAY=:154
export MILKUP_DIRECT_CORPUS_RUN=1
MILKUP_DIRECT_CORPUS_OUTER_PID_NS="$(readlink /proc/self/ns/pid)"
export MILKUP_DIRECT_CORPUS_OUTER_PID_NS
exec /workspace/mermaid-rebuild-evidence/run-native-mounted.sh node \
  /workspace/mermaid-rebuild-evidence/c4-label-clearance/native-after/run-corpus.mjs "$1"

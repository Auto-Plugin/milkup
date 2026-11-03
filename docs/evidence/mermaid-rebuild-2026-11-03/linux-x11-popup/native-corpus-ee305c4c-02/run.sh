#!/bin/bash
set -euo pipefail
case "${1:-}" in smoke|corpus) ;; *) exit 64 ;; esac
export DISPLAY=:143
export MILKUP_DIRECT_CORPUS_RUN=1
MILKUP_DIRECT_CORPUS_OUTER_PID_NS="$(readlink /proc/self/ns/pid)"
export MILKUP_DIRECT_CORPUS_OUTER_PID_NS
exec /workspace/mermaid-rebuild-evidence/run-native-mounted.sh node \
  /workspace/mermaid-rebuild-evidence/linux-x11-popup/native-corpus-ee305c4c-02/run-corpus.mjs "$1"

#!/usr/bin/env bash
set -euo pipefail
source /workspace/.cloud/milkup-v2/env.sh
unset CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER PROOT_NO_SECCOMP DISPLAY WAYLAND_DISPLAY
exec /workspace/milkup-export-print-evidence/milestone01/native/namespace.sh python3 /workspace/milkup-export-print-evidence/milestone05/chromium-controlled/run.py

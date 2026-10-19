#!/usr/bin/env bash
set -euo pipefail
source /workspace/.cloud/milkup-v2/env.sh
unset CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER PROOT_NO_SECCOMP
export GDK_PIXBUF_MODULE_FILE=/workspace/milkup-markdown-extensions-phase4-evidence/native/environment/loaders-sysroot.cache
export GDK_PIXBUF_MODULEDIR=/workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders
export XDG_CONFIG_HOME=/workspace/milkup-export-print-evidence/milestone01/native/heading-block-final/profile/config
export XDG_CACHE_HOME=/workspace/milkup-export-print-evidence/milestone01/native/heading-block-final/profile/cache
export XDG_DATA_HOME=/workspace/milkup-export-print-evidence/milestone01/native/heading-block-final/profile/data
export XDG_RUNTIME_DIR=/tmp/milkup-p5-heading-final
export MILKUP_CSS_VARIANTS="$1"
exec /workspace/milkup-export-print-evidence/milestone01/native/namespace.sh dbus-run-session -- python3 /workspace/milkup-export-print-evidence/milestone01/native/heading-block-final/with-display.py

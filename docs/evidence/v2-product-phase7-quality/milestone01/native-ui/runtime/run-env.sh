# Source with UNIQUE_RUN; immutable baseline and independent display/ports.
[[ $# == 1 && "$1" =~ ^p7-[a-z0-9-]+$ ]] || return 1
[[ -z "${LD_PRELOAD:-}" && -z "${WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS:-}" ]] || return 1
export MILKUP_NATIVE_RUN="$1"
export TAURI_APP_PATH=/workspace/milkup-p7-quality-evidence/milestone01/baseline-production/milkup-desktop
export MILKUP_NATIVE_EXPECTED_BINARY_SHA256=f15c476a4f6e7b5f254e325692d57e9bfaa798580441dd3554f6c4fe1e9d802e
[[ "$(sha256sum "$TAURI_APP_PATH" | cut -d ' ' -f 1)" == "$MILKUP_NATIVE_EXPECTED_BINARY_SHA256" ]] || return 1
source /workspace/.cloud/milkup-v2/env.sh
unset CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER PROOT_NO_SECCOMP
export DISPLAY=:127 GDK_BACKEND=x11
export GDK_PIXBUF_MODULE_FILE=/workspace/milkup-markdown-extensions-phase4-evidence/native/environment/loaders-sysroot.cache
export GDK_PIXBUF_MODULEDIR=/workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders
export MILKUP_NATIVE_PROFILE_ROOT=/tmp/milkup-p7-profiles/$MILKUP_NATIVE_RUN
export XDG_CONFIG_HOME=$MILKUP_NATIVE_PROFILE_ROOT/config XDG_CACHE_HOME=$MILKUP_NATIVE_PROFILE_ROOT/cache XDG_DATA_HOME=$MILKUP_NATIVE_PROFILE_ROOT/data
export XDG_RUNTIME_DIR=/tmp/milkup-runtime-$MILKUP_NATIVE_RUN
export MILKUP_NATIVE_EVIDENCE_DIR=/workspace/milkup-p7-quality-evidence/milestone01/native-ui/runs/$MILKUP_NATIVE_RUN
export MILKUP_NATIVE_APP_LOG=/workspace/milkup-p7-quality-evidence/milestone01/native-ui/logs/$MILKUP_NATIVE_RUN-driver.log
export TAURI_DRIVER_URL=http://127.0.0.1:4477 MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1 MILKUP_DOM_DIAGNOSTICS=1

# Source with UNIQUE_RUN FROZEN_CANDIDATE_BINARY EXPECTED_SHA256; baseline script unchanged.
[[ $# == 3 && "$1" =~ ^p7-candidate-[a-z0-9-]+$ && "$3" =~ ^[a-f0-9]{64}$ ]] || return 1
[[ -z "${LD_PRELOAD:-}" && -z "${WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS:-}" ]] || return 1
export MILKUP_NATIVE_RUN="$1"
export TAURI_APP_PATH="$(realpath "$2")"
case "$TAURI_APP_PATH" in /workspace/milkup-p7-quality-evidence/milestone01/candidate-*/milkup-desktop) ;; *) return 1 ;; esac
export MILKUP_NATIVE_EXPECTED_BINARY_SHA256="$3"
python3 - "$TAURI_APP_PATH" "$3" <<'CHECK'
import json,sys,pathlib
p=pathlib.Path(sys.argv[1]);proof=json.loads(p.with_name('proof.json').read_text())
assert proof['exitCode']==0 and not proof['inputDrift'] and proof['baselineUnchanged']
assert proof['artifact']['path']==str(p) and proof['artifact']['sha256']==sys.argv[2]
CHECK
[[ $? == 0 ]] || return 1
[[ "$(sha256sum "$TAURI_APP_PATH" | cut -d ' ' -f 1)" == "$MILKUP_NATIVE_EXPECTED_BINARY_SHA256" ]] || return 1
source /workspace/.cloud/milkup-v2/env.sh
unset CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER PROOT_NO_SECCOMP
export DISPLAY=:127 GDK_BACKEND=x11
export GDK_PIXBUF_MODULE_FILE=/workspace/milkup-markdown-extensions-phase4-evidence/native/environment/loaders-sysroot.cache
export GDK_PIXBUF_MODULEDIR=/workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders
export MILKUP_NATIVE_PROFILE_ROOT=/tmp/milkup-p7-m02-profiles/$MILKUP_NATIVE_RUN
export XDG_CONFIG_HOME=$MILKUP_NATIVE_PROFILE_ROOT/config XDG_CACHE_HOME=$MILKUP_NATIVE_PROFILE_ROOT/cache XDG_DATA_HOME=$MILKUP_NATIVE_PROFILE_ROOT/data
export XDG_RUNTIME_DIR=/tmp/milkup-runtime-$MILKUP_NATIVE_RUN
export MILKUP_NATIVE_EVIDENCE_DIR=/workspace/milkup-p7-quality-evidence/milestone02/outline/runs/$MILKUP_NATIVE_RUN
export MILKUP_NATIVE_APP_LOG=/workspace/milkup-p7-quality-evidence/milestone02/outline/logs/$MILKUP_NATIVE_RUN-driver.log
export TAURI_DRIVER_URL=http://127.0.0.1:4477 MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1 MILKUP_DOM_DIAGNOSTICS=1

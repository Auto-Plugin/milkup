# Source with RUN STAGE FROZEN_BINARY BINARY_SHA256 ARCHIVE ARCHIVE_SHA256.
# Preparation only; does not launch or create anything.
if [[ $# != 6 || ! "$1" =~ ^p6-[a-z0-9-]+$ || ! "$4" =~ ^[a-f0-9]{64}$ || ! "$6" =~ ^[a-f0-9]{64}$ ]]; then
  echo 'Expected unique p6 run, stage, frozen binary/hash, independent archive/hash' >&2; return 1
fi
case "$2" in html|pdf|cancel|selection|disable|print-cancel|print-file|overwrite|large|pdf-render-cancel) ;; *) return 1 ;; esac
export MILKUP_NATIVE_RUN="$1" MILKUP_P5_STAGE="$2"
export TAURI_APP_PATH="$(realpath "$3")" MILKUP_NATIVE_EXPECTED_BINARY_SHA256="$4"
case "$TAURI_APP_PATH" in
  /workspace/milkup-plugin-lifecycle-evidence/*/target/*) return 1 ;;
  /workspace/milkup-plugin-lifecycle-evidence/*) ;;
  *) echo 'Use an immutable P6 evidence binary' >&2; return 1 ;;
esac
[[ "$(sha256sum "$TAURI_APP_PATH" | cut -d ' ' -f 1)" == "$MILKUP_NATIVE_EXPECTED_BINARY_SHA256" ]] || return 1
export MILKUP_P5_ARCHIVE="$(realpath "$5")" MILKUP_P5_ARCHIVE_SHA256="$6"
[[ "$(sha256sum "$MILKUP_P5_ARCHIVE" | cut -d ' ' -f 1)" == "$MILKUP_P5_ARCHIVE_SHA256" ]] || return 1
if [[ -n "${LD_PRELOAD:-}" || -n "${WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS:-}" || -n "${MILKUP_GTK_THREAD_TRACE:-}" ]]; then
  echo 'Unexpected interposition or sandbox-changing environment' >&2; return 1
fi
source /workspace/.cloud/milkup-v2/env.sh
unset CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER PROOT_NO_SECCOMP
export DISPLAY=:126
export GDK_PIXBUF_MODULE_FILE=/workspace/milkup-markdown-extensions-phase4-evidence/native/environment/loaders-sysroot.cache
export GDK_PIXBUF_MODULEDIR=/workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders
export MILKUP_NATIVE_PROFILE_ROOT=/tmp/milkup-p6-profiles/$MILKUP_NATIVE_RUN
export XDG_CONFIG_HOME=$MILKUP_NATIVE_PROFILE_ROOT/config
export XDG_CACHE_HOME=$MILKUP_NATIVE_PROFILE_ROOT/cache
export XDG_DATA_HOME=$MILKUP_NATIVE_PROFILE_ROOT/data
export MILKUP_NATIVE_EVIDENCE_DIR=/workspace/milkup-plugin-lifecycle-evidence/milestone02/native-ui/runs/$MILKUP_NATIVE_RUN
export MILKUP_NATIVE_APP_LOG=/workspace/milkup-plugin-lifecycle-evidence/milestone02/native-ui/logs/$MILKUP_NATIVE_RUN-driver.log
export TAURI_DRIVER_URL=http://127.0.0.1:4636
export MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1 MILKUP_P5_BINARY_CONFIRMED=1 MILKUP_DOM_DIAGNOSTICS=1
export XDG_RUNTIME_DIR=/tmp/milkup-runtime-$MILKUP_NATIVE_RUN

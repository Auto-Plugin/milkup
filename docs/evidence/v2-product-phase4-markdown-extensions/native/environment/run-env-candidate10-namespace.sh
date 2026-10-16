source /workspace/.cloud/milkup-v2/env.sh
export DISPLAY=:118
export GDK_PIXBUF_MODULE_FILE=/workspace/milkup-markdown-extensions-phase4-evidence/native/environment/loaders-sysroot.cache
export GDK_PIXBUF_MODULEDIR=/workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders
unset PROOT_NO_SECCOMP
export XDG_CONFIG_HOME=/workspace/milkup-markdown-extensions-phase4-evidence/native/profile-${MILKUP_RUN}/config
export XDG_CACHE_HOME=/workspace/milkup-markdown-extensions-phase4-evidence/native/profile-${MILKUP_RUN}/cache
export XDG_DATA_HOME=/workspace/milkup-markdown-extensions-phase4-evidence/native/profile-${MILKUP_RUN}/data
export TAURI_APP_PATH=/workspace/milkup-markdown-extensions-phase4-evidence/native/install-candidate10/usr/bin/milkup-desktop
export TAURI_DRIVER_URL=http://127.0.0.1:4618
export MILKUP_RECOVERY_PROFILE=$XDG_DATA_HOME/app.milkup.desktop/recovery-v1
export MILKUP_NATIVE_EVIDENCE_DIR=/workspace/milkup-markdown-extensions-phase4-evidence/native/run-${MILKUP_RUN}
export MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1
export MILKUP_MARKDOWN_BINARY_CONFIRMED=1
export MILKUP_MARKDOWN_ARCHIVES_JSON='{"milkup.math":"/workspace/milkup-markdown-extensions-phase4-evidence/math/external-crlf-final/dist/milkup.math-1.0.0.milkup-plugin","milkup.diagrams":"/workspace/milkup-markdown-extensions-phase4-evidence/diagrams/external/dist/milkup.diagrams-1.0.0.milkup-plugin","milkup.footnotes":"/workspace/milkup-markdown-extensions-phase4-evidence/footnotes/external-revision-final/dist/milkup.footnotes-1.0.0.milkup-plugin"}'
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$MILKUP_NATIVE_EVIDENCE_DIR"

export MILKUP_MARKDOWN_BINARY_SHA256=12fe5aa449d3e650b2c89da593330d52fc3b72851397014bb6529bf211526995

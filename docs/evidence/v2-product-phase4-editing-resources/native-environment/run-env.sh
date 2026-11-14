source /workspace/.cloud/milkup-v2/env.sh
export DISPLAY=:109
export GDK_PIXBUF_MODULE_FILE=/workspace/milkup-editing-resources-phase4-evidence/native/environment/loaders.cache
export GDK_PIXBUF_MODULEDIR=/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders
export XDG_CONFIG_HOME=/workspace/milkup-editing-resources-phase4-evidence/native/profile-${MILKUP_PROFILE:-${MILKUP_RUN}}/config
export XDG_CACHE_HOME=/workspace/milkup-editing-resources-phase4-evidence/native/profile-${MILKUP_PROFILE:-${MILKUP_RUN}}/cache
export XDG_DATA_HOME=/workspace/milkup-editing-resources-phase4-evidence/native/profile-${MILKUP_PROFILE:-${MILKUP_RUN}}/data
export MILKUP_P4_BINARY_CONFIRMED=1
export TAURI_APP_PATH=/workspace/milkup-editing-resources-phase4-evidence/native/install-candidate02/usr/bin/milkup-desktop
export TAURI_DRIVER_URL=http://127.0.0.1:4588
export MILKUP_RECOVERY_PROFILE=$XDG_DATA_HOME/app.milkup.desktop/recovery-v1
export MILKUP_NATIVE_EVIDENCE_DIR=/workspace/milkup-editing-resources-phase4-evidence/native/run-${MILKUP_RUN}
export MILKUP_P4_DEB_PATH=/workspace/milkup-editing-resources-phase4-evidence/native/candidate02.deb
export MILKUP_P4_RELEASE_SHA=0267d7bd206c443c1d5ad42e21713e68aae1b5ba0da0c5a29dba101f20fc0c35
export MILKUP_P4_PACKAGING_NOTE='Actual DEB independently extracted; Tauri packaging patches package-type marker UNK to DEB, so extracted binary hash is authoritative and matches independent root extraction.'
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$MILKUP_NATIVE_EVIDENCE_DIR"
export MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1

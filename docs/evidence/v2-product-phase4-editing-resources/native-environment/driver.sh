export MILKUP_RUN="$1"
source /workspace/milkup-editing-resources-phase4-evidence/native/environment/run-env.sh
export DISPLAY="$2"
proot -b /workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1:/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1 dbus-run-session -- /workspace/.cargo/bin/tauri-driver --port "$3" --native-port "$4" --native-driver /workspace/.cloud/milkup-v2/sysroot/usr/bin/WebKitWebDriver > "/workspace/milkup-editing-resources-phase4-evidence/native/driver-${MILKUP_RUN}.log" 2>&1

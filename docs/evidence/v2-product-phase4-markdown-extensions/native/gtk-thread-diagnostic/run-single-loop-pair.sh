#!/usr/bin/env bash
set -u
source /workspace/.cloud/milkup-v2/env.sh
export DISPLAY=:118
export PROOT_NO_SECCOMP=1
export GDK_PIXBUF_MODULE_FILE=/workspace/milkup-markdown-extensions-phase4-evidence/native/environment/loaders-sysroot.cache
export GDK_PIXBUF_MODULEDIR=/workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders
unset LD_PRELOAD MILKUP_GTK_THREAD_TRACE MILKUP_GTK_TRACE_APP
experiment=/workspace/milkup-markdown-extensions-phase4-evidence/native/gtk-thread-diagnostic/single-loop-pair01
mkdir "$experiment"
for mode in proot-on proot-off; do
  run="$experiment/$mode"
  mkdir -p "$run/maps" "$run/config" "$run/cache" "$run/data"
  export XDG_CONFIG_HOME="$run/config" XDG_CACHE_HOME="$run/cache" XDG_DATA_HOME="$run/data"
  command=(/workspace/milkup-markdown-extensions-phase4-evidence/native/gtk-thread-diagnostic/single-loop-chooser /workspace/milkup-markdown-extensions-phase4-evidence/math/external-crlf-final/dist/milkup.math-1.0.0.milkup-plugin "$run/maps")
  if [[ "$mode" == proot-on ]]; then
    timeout 25s proot -b /workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1:/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1 dbus-run-session -- "${command[@]}" > "$run/stdout.log" 2> "$run/stderr.log"
  else
    timeout 25s dbus-run-session -- "${command[@]}" > "$run/stdout.log" 2> "$run/stderr.log"
  fi
  probe_status=$?
  printf '%s\n' "$probe_status" > "$run/exit-code.txt"
  printf '%s exit=%s\n' "$mode" "$probe_status"
done

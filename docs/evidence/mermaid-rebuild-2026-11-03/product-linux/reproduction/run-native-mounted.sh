#!/bin/bash
set -euo pipefail
source /workspace/mermaid-rebuild-evidence/dependency-env.sh
: "${DISPLAY:?isolated test DISPLAY required}"
exec bwrap --unshare-user --unshare-pid --die-with-parent \
  --ro-bind / / --dev-bind /dev /dev --proc /proc \
  --bind /tmp /tmp --bind /workspace /workspace \
  --ro-bind /tmp/milkup-mermaid-runtime-overlay/usr /usr \
  --ro-bind /usr /usr/host \
  --ro-bind /usr/share /usr/share \
  --ro-bind /workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1 /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1 \
  --ro-bind /workspace/.cloud/milkup-v2/sysroot/usr/bin/xdg-dbus-proxy /usr/bin/xdg-dbus-proxy \
  dbus-run-session -- "$@"

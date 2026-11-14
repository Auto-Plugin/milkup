#!/bin/bash
source /workspace/.cloud/milkup-v2/env.sh
export DISPLAY=:99 GTK_IM_MODULE=ibus XMODIFIERS=@im=ibus
export LD_LIBRARY_PATH=/workspace/.cache/milkup-ime-phase11/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
export PATH=/workspace/.cache/milkup-ime-phase11/usr/bin:$PATH
export IBUS_COMPONENT_PATH=/tmp/milkup-v2-phase12/ime/components
export GSETTINGS_SCHEMA_DIR=/tmp/milkup-v2-phase11/ime/schemas
export GSETTINGS_BACKEND=memory
export XDG_CONFIG_HOME=/tmp/milkup-v2-phase12/ime/config XDG_CACHE_HOME=/tmp/milkup-v2-phase12/ime/cache XDG_DATA_HOME=/tmp/milkup-v2-phase12/ime/data
export XDG_DATA_DIRS=/workspace/.cache/milkup-ime-phase11/usr/share:/workspace/.cloud/milkup-v2/sysroot/usr/share:/usr/share
export GTK_IM_MODULE_FILE=/tmp/milkup-v2-phase11/ime/immodules.cache
exec dbus-run-session -- bash /tmp/milkup-v2-phase12/ime/session.sh

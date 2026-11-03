#!/bin/bash
# Recovery record assembled from the two Python commands actually executed in
# this task. This file itself was not the original execution entry point and has
# NOT been run. It preserves the original /tmp path and original command bodies.
# Step 1 created the overlay with symlinks to a read-only /usr/host bind.
# Step 2 corrected the nested WebKit sandbox's missing loader/shared libraries
# by copying the already-installed sysroot files into the temporary overlay.
# No original /usr file was changed. This is specific to the selected test
# environment and its pre-existing sysroot, not a general runtime installer.

# Executed step 1:
python3 - <<'PY'
from pathlib import Path
import json
root=Path('/tmp/milkup-mermaid-runtime-overlay')
root.mkdir(mode=0o700,exist_ok=True)
usr=root/'usr'
usr.mkdir(exist_ok=True)
for p in Path('/usr').iterdir():
    if p.name in ['bin','lib','host']: continue
    q=usr/p.name
    if not q.exists() and not q.is_symlink(): q.symlink_to('/usr/host/'+p.name,target_is_directory=p.is_dir())
(usr/'host').mkdir(exist_ok=True)
for sub in ['bin','lib','lib/x86_64-linux-gnu']:
    d=usr/sub
    d.mkdir(exist_ok=True)
    for p in (Path('/usr')/sub).iterdir():
        if (sub=='lib' and p.name=='x86_64-linux-gnu') or (sub=='bin' and p.name=='xdg-dbus-proxy') or (sub=='lib/x86_64-linux-gnu' and p.name=='webkit2gtk-4.1'): continue
        q=d/p.name
        if not q.exists() and not q.is_symlink(): q.symlink_to('/usr/host/'+sub+'/'+p.name,target_is_directory=p.is_dir())
(usr/'bin/xdg-dbus-proxy').touch()
(usr/'lib/x86_64-linux-gnu/webkit2gtk-4.1').mkdir(exist_ok=True)
Path('/workspace/mermaid-rebuild-evidence/runtime-overlay.json').write_text(json.dumps({'path':str(root),'purpose':'temporary namespace path mapping only; system files unchanged; WebKit sandbox remains enabled'},indent=2)+'\n')
PY

# Executed step 2, after the first nested WebKit launch could not resolve its
# dbus-proxy ELF loader through the /usr/host symlink targets:
python3 - <<'PY'
from pathlib import Path
import shutil
u=Path('/tmp/milkup-mermaid-runtime-overlay/usr')
src=Path('/workspace/.cloud/milkup-v2/sysroot/usr/lib/x86_64-linux-gnu')
for p in src.iterdir():
    if not p.is_file(): continue
    q=u/'lib/x86_64-linux-gnu'/p.name
    if q.is_symlink() or q.exists(): q.unlink()
    shutil.copy2(p,q)
for name in ['lib64','share']:
    q=u/name
    if q.is_symlink(): q.unlink()
    q.mkdir(exist_ok=True)
shutil.copy2(src/'ld-linux-x86-64.so.2',u/'lib64/ld-linux-x86-64.so.2')
PY

# The runner was then amended to bind the real /usr/share to /usr/share in the
# temporary namespace. See the retained run-native-mounted.sh for the executed
# bwrap argument list. That runner also maps the existing sysroot WebKit helper
# directory and xdg-dbus-proxy to their expected native paths. Execution required
# the tool-approved wrapper exception so WebKit could create its own sandbox;
# no WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS override was used.

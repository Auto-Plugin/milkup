#!/bin/sh
# Only runs inside the reviewed pinned, read-only, network-disabled container.
set -eu
umask 022
mkdir -p /out/cache /out/trace
cp -a /emsdk/upstream/emscripten/cache/. /out/cache/
python3 - <<'PY'
import hashlib,json,pathlib,subprocess
root=pathlib.Path('/emsdk/upstream')
versions={n:subprocess.check_output(cmd,text=True,stderr=subprocess.STDOUT,timeout=30) for n,cmd in {
 'emcc':['emcc','--version'], 'clang':[str(root/'bin/clang'),'--version'],
 'wasmOpt':[str(root/'bin/wasm-opt'),'--version'], 'node':['node','--version']}.items()}
if '6.0.0' not in versions['emcc'].splitlines()[0]:raise ValueError('compiler version mismatch')
files={}
for rel in ['emscripten/emcc.py','emscripten/src/lib/libcore.js','emscripten/src/lib/libtime.js','bin/clang','bin/wasm-opt']:
 p=(root/rel).resolve()
 with p.open('rb') as f:files[rel]=hashlib.file_digest(f,'sha256').hexdigest()
pathlib.Path('/out/compiler-identity.json').write_text(json.dumps({'versions':versions,'files':files},sort_keys=True)+'\n')
PY
cd /src/generator
sh ./compile.sh

import os, json, subprocess, hashlib
from pathlib import Path
root=Path('/workspace/milkup-plugin-lifecycle-evidence/milestone01/native-preflight02')
packages=[{'id':'milkup.outline','version':'1.3.1','path':'/workspace/milkup-plugin-lifecycle-evidence/milestone01/outline-external/milkup.outline-1.3.1.milkup-plugin','sha256':'7eea6ffb5bba53155b3c256c6e35d95b04a93199ebbbd04636ee9c7ec5f6f712'}, {'id':'milkup.footnotes','version':'1.0.1','path':'/workspace/milkup-plugin-lifecycle-evidence/milestone01/footnotes-external/artifacts/milkup.footnotes-1.0.1.milkup-plugin','sha256':'cf495f6bdf22dc6b24143a06fc34fdce8d2b2ecab90b8296b85fb49773b692a2'}]
(root/'extra-packages.json').write_text(json.dumps(packages,indent=2)+'\n')
base=dict(os.environ,TAURI_APP_PATH='/workspace/milkup-export-print-evidence/milestone06/production-queue/milkup-desktop',MILKUP_NATIVE_EXPECTED_BINARY_SHA256='6e6c004030fe06146b58d9e40cbd22c7c7d3315c306ceb741f3f58e119ed9d2a',MILKUP_P6_EXTRA_PACKAGES_JSON=json.dumps(packages))
results=[]
for stage in ['outline','reject','cold-output','cold-edit','manager-matrix','all-off','all-off-windowed']:
    env=dict(base,MILKUP_P6_CASE=stage,MILKUP_NATIVE_EVIDENCE_DIR=str(root/stage))
    p=subprocess.run(['node','tests/native/tauri-p6-lifecycle.mjs','--preflight'],cwd='/workspace/milkup',env=env,capture_output=True,text=True)
    (root/(stage+'.log')).write_text(p.stdout+p.stderr)
    results.append({'stage':stage,'exitCode':p.returncode})
    assert p.returncode==0,p.stderr
script=Path('/workspace/milkup/tests/native/tauri-p6-lifecycle.mjs').read_bytes()
(root/'result.json').write_text(json.dumps({'preparedOnly':True,'nativeUI':'NOT RUN','binaryScope':'Historical P5 frozen binary validates paths/hash only; not P6 product acceptance','harnessSHA256':hashlib.sha256(script).hexdigest(),'cases':results},indent=2)+'\n')
print((root/'result.json').read_text())

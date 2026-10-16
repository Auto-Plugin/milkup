from pathlib import Path
import shutil, subprocess, json, hashlib
root=Path('/workspace/milkup')
out=Path('/workspace/milkup-markdown-extensions-phase4-evidence')
native=out/'native'
proofbuild=json.loads((out/'candidate11-final-production-build.json').read_text())
assert proofbuild['exitCode']==0 and proofbuild['sourceChanges']==[] and not proofbuild['manifestChanged']
deb=native/'candidate11.deb'
install=native/'install-candidate11'
proofpath=native/'candidate11-provenance.json'
assert not any(p.exists() for p in (deb,install,proofpath)), 'Do not overwrite evidence'
shutil.copy2(root/'apps/desktop/src-tauri/target/release/bundle/deb/milkup_2.0.0-beta.1_amd64.deb',deb)
subprocess.run(['dpkg-deb','-x',str(deb),str(install)],check=True)
def item(p):
 return {'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
proof={'deb':item(deb),'extractedBinary':item(install/'usr/bin/milkup-desktop'),'releaseBinary':item(root/'apps/desktop/src-tauri/target/release/milkup-desktop'),'buildProof':item(out/'candidate11-final-production-build.json'),'manifest':item(out/'candidate11-final-source-manifest.json'),'note':'Local Linux production DEB independently extracted. Tauri patches bundle-type metadata; extracted binary SHA is authoritative. No upload.'}
proofpath.write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof,indent=2))

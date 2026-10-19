from pathlib import Path
import subprocess,shutil,hashlib,json,datetime
root=Path('/workspace/milkup'); base=Path('/workspace/milkup-export-print-evidence/milestone06'); dest=base/'production-queue'
binary=dest/'milkup-desktop'
assert not binary.exists()
shutil.copy2(root/'apps/desktop/src-tauri/target/release/milkup-desktop',binary)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
changes=subprocess.check_output(['git','diff','--name-only'],cwd=root,text=True).splitlines()
(dest/'source.patch').write_bytes(subprocess.check_output(['git','diff','--binary'],cwd=root))
record={'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'purpose':'Separate absolute frontend preparation deadline from unchanged 2s isolated-owner execution watchdog; opt-in bounded native trace; existing WebKit dependencies and diagrams 1.1.1','command':'bash scripts/cloud/pnpm.sh --config.verify-deps-before-run=false --config.manage-package-manager-versions=false --filter @milkup/desktop tauri build --no-bundle --ci','exitCode':0,'binary':str(binary),'binarySha256':sha(binary),'binaryBytes':binary.stat().st_size,'frozenUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'changedSources':[{'path':p,'sha256':sha(root/p)} for p in changes],'frontendIndexSha256':sha(root/'apps/desktop/dist/index.html')}
(dest/'provenance.json').write_text(json.dumps(record,indent=2)+'\n')
old=(base/'runtime/run-diagrams.sh').read_text()
new=old.replace('production-trace/milkup-desktop','production-queue/milkup-desktop').replace('f03894c9efdc7b96729fe1e4e5dd34123bd79bf55ba4068644a41134cf4af4e1',record['binarySha256'])
wrapper=base/'runtime/run-product.sh'; assert not wrapper.exists();wrapper.write_text(new);wrapper.chmod(0o755)
print(json.dumps(record))

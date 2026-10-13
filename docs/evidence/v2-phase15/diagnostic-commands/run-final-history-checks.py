import subprocess,os,json,datetime,pathlib
root=pathlib.Path('/tmp/milkup-v2-phase15')
checks=[('js-final',['pnpm','-r','--workspace-concurrency=1','test']),('supplemental-final',['pnpm','exec','vitest','run','plugins/outline/src/plugin.test.ts','tests/helpers/native-startup.test.ts']),('typecheck-final',['pnpm','typecheck']),('build-final',['pnpm','build']),('rust-final',['cargo','test','--manifest-path','apps/desktop/src-tauri/Cargo.toml','--lib']),('rust-fmt-final',['cargo','fmt','--manifest-path','apps/desktop/src-tauri/Cargo.toml','--check']),('browser-final',['pnpm','test:e2e','--workers=1']),('release-final',['pnpm','--filter','@milkup/desktop','tauri','build','--no-bundle'])]
results=[]
os.environ.pop('CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER',None)
os.environ['MILKUP_BROWSER_EXECUTABLE']='/usr/bin/chromium'
for name,cmd in checks:
 at=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (root/(name+'-history.log')).open('w') as log:r=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT)
 results.append({'name':name,'command':cmd,'started':at,'exitCode':r.returncode})
 (root/'checks-final-history.json').write_text(json.dumps(results,indent=2)+'\n')
 print(name,r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)

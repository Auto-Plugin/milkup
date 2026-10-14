import pathlib,subprocess,json,datetime,os
root=pathlib.Path('/workspace/.milkup-v2-phase21');results=[]
commands=[('js',['pnpm','-r','--workspace-concurrency=1','test']),('supplemental',['pnpm','exec','vitest','run','plugins/outline/src/plugin.test.ts','tests/helpers/native-startup.test.ts']),('rust',['cargo','test','--manifest-path','apps/desktop/src-tauri/Cargo.toml','--lib']),('typecheck',['pnpm','typecheck']),('rust-format',['cargo','fmt','--manifest-path','apps/desktop/src-tauri/Cargo.toml','--check']),('workspace-build',['pnpm','build']),('chromium',['pnpm','test:e2e','--workers=1'])]
env={**os.environ,'MILKUP_BROWSER_EXECUTABLE':'/usr/bin/chromium'}
env.pop('CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER',None)
for name,cmd in commands:
 started=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with open(root/(name+'.log'),'w') as f:r=subprocess.run(cmd,env=env,stdout=f,stderr=subprocess.STDOUT)
 results.append({'name':name,'command':cmd,'started':started,'exitCode':r.returncode})
 (root/'checks.json').write_text(json.dumps(results,indent=2))
 print(name,r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)

import subprocess,os,json,datetime,pathlib
root=pathlib.Path('/tmp/milkup-v2-phase16');results=[]
env=dict(os.environ,MILKUP_BROWSER_EXECUTABLE='/usr/bin/chromium');env.pop('CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER',None)
checks=[('js',['pnpm','-r','--workspace-concurrency=1','test']),('supplemental',['pnpm','exec','vitest','run','plugins/outline/src/plugin.test.ts','tests/helpers/native-startup.test.ts']),('typecheck',['pnpm','typecheck']),('build',['pnpm','build']),('rust',['cargo','test','--manifest-path','apps/desktop/src-tauri/Cargo.toml','--lib']),('rust-fmt',['cargo','fmt','--manifest-path','apps/desktop/src-tauri/Cargo.toml','--check']),('browser',['pnpm','test:e2e','--workers=1'])]
for name,command in checks:
 started=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with open(root/(name+'-final.log'),'w') as log:r=subprocess.run(command,env=env,stdout=log,stderr=subprocess.STDOUT)
 results.append(dict(name=name,command=command,started=started,exitCode=r.returncode));(root/'checks.json').write_text(json.dumps(results,indent=2)+'\n');print(name,r.returncode,flush=True)
 if r.returncode:break

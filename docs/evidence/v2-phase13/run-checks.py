import subprocess,os,json,time
from pathlib import Path
root=Path('/tmp/milkup-v2-phase13');rows=[]
env=dict(os.environ);env.pop('CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER',None)
commands=[('workspace-tests',['pnpm','-r','--workspace-concurrency=1','test','--maxWorkers=1','--no-file-parallelism']),('outline',['pnpm','test:outline']),('harness',['pnpm','test:native:harness']),('typecheck',['pnpm','typecheck']),('build',['pnpm','build']),('rust-tests',['cargo','test','--locked','--manifest-path','apps/desktop/src-tauri/Cargo.toml']),('rust-format',['cargo','fmt','--manifest-path','apps/desktop/src-tauri/Cargo.toml','--check'])]
for name,cmd in commands:
 start=time.strftime('%FT%TZ',time.gmtime());print('START',name,start,flush=True)
 with (root/(name+'.log')).open('w') as out:
  out.write('COMMAND '+json.dumps(cmd)+'\nCARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER unset\n');out.flush()
  p=subprocess.run(cmd,env=env,stdout=out,stderr=subprocess.STDOUT)
  out.write('\nACTUAL_EXIT_CODE '+str(p.returncode)+'\n')
 rows.append({'name':name,'command':cmd,'started':start,'exitCode':p.returncode});(root/'checks.json').write_text(json.dumps(rows,indent=2)+'\n');print('EXIT',name,p.returncode,flush=True)
 if p.returncode:raise SystemExit(p.returncode)

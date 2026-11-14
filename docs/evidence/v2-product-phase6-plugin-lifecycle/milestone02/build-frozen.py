import datetime,hashlib,json,subprocess,shutil,sys
from pathlib import Path
root=Path('/workspace/milkup');out=Path('/workspace/milkup-plugin-lifecycle-evidence/milestone02')/sys.argv[1];out.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
paths=sorted(set(subprocess.check_output(['git','ls-files'],cwd=root,text=True).splitlines()+subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=root,text=True).splitlines()))
paths=[p for p in paths if (p.startswith(('apps/','packages/','plugins/','release/')) or p in ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml']) and (root/p).is_file()]
proof={'baseline':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'inputs':[{'path':p,'sha256':sha(root/p)} for p in paths]}
cmd='source /workspace/.cloud/milkup-v2/env.sh\nexport NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false\nbash scripts/cloud/pnpm.sh --config.verify-deps-before-run=false --config.manage-package-manager-versions=false --filter @milkup/desktop tauri build --no-bundle --ci'
proof['command']=cmd;(out/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
with (out/'build.log').open('w') as log:r=subprocess.run(['bash','-c',cmd],cwd=root,stdout=log,stderr=subprocess.STDOUT)
proof.update(exitCode=r.returncode,endedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),postBuildInputDrift=[p['path'] for p in proof['inputs'] if sha(root/p['path'])!=p['sha256']])
if r.returncode==0:
 shutil.copy2(root/'apps/desktop/src-tauri/target/release/milkup-desktop',out/'milkup-desktop');proof['binarySha256']=sha(out/'milkup-desktop')
proof['acceptance']='frozen production inputs' if not proof['postBuildInputDrift'] else 'input drift: rebuild required'
(out/'proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({k:v for k,v in proof.items() if k!='inputs'}));sys.exit(r.returncode or bool(proof['postBuildInputDrift']))

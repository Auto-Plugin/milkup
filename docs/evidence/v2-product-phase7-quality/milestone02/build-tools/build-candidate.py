"""Run only after the root agent freezes sources; no bundle/install/download operation."""
from pathlib import Path
import datetime,hashlib,json,os,re,shutil,subprocess,sys
repo=Path('/workspace/milkup');evidence=Path('/workspace/milkup-p7-quality-evidence/milestone02')
previous=Path('/workspace/milkup-p7-quality-evidence/milestone01')
assert len(sys.argv)==3,'candidate-<id> expected-head'
name,expected=sys.argv[1:]
assert re.fullmatch(r'candidate-[a-z0-9-]+',name) and re.fullmatch(r'[a-f0-9]{40}',expected)
head=lambda:subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
assert head()==expected
out=evidence/name;out.mkdir(exist_ok=False)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def snapshot():
    # Include new/untracked source and ignored embedded plugin archives, not merely git ls-files.
    paths=set()
    for base in ['apps/desktop','packages','plugins','scripts']:
        for parent,dirs,files in os.walk(repo/base):
            dirs[:]=[d for d in dirs if d not in {'node_modules','target','dist','.git','__pycache__','.turbo'} and not (Path(parent)==repo/'apps/desktop/src-tauri' and d=='gen')]
            for leaf in files:
                p=Path(parent)/leaf
                if p.is_file():paths.add(p)
    for name in ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','.npmrc']:
        p=repo/name
        if p.is_file():paths.add(p)
    return {str(p.relative_to(repo)):{'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(paths)}
inputs=snapshot();assert 'apps/desktop/src/desktop-focus.ts' in inputs
baseline=previous/'baseline-production/milkup-desktop';baseline_sha=sha(baseline)
protected={str(p):sha(p) for p in sorted(previous.glob('*/milkup-desktop')) if p.is_file()}
assert len(protected)>=4, 'Expected preserved M01 baseline and candidates 01/02/03'
archives=[];seen=set()
for path in sorted((repo/'apps/desktop/src/bundled-plugins').glob('*.milkup-plugin')):
    package=json.loads(path.read_text());manifest=package['manifest'];identity=manifest['id'];version=manifest['version']
    assert package['format']=='milkup-plugin' and package['version']==1
    assert isinstance(identity,str) and identity not in seen, 'Duplicate bundled plugin identity/version'
    assert isinstance(version,str) and path.name==f'{identity}-{version}.milkup-plugin', 'Bundle filename disagrees with manifest'
    seen.add(identity);archives.append({'path':str(path.relative_to(repo)),'pluginId':identity,'version':version,'sha256':sha(path),'bytes':path.stat().st_size})
expected_ids={'milkup.diagrams','milkup.footnotes','milkup.formatting','milkup.images','milkup.management','milkup.math','milkup.outline','milkup.preferences','milkup.shortcuts','milkup.updates','milkup.workspace'}
assert seen==expected_ids and len(archives)==11, 'Expected one version for each of the 11 bundled identities'
disk_before={p:dict(zip(['total','used','free'],shutil.disk_usage(p))) for p in ['/workspace','/tmp']}

command=['bash','-c','source /workspace/.cloud/milkup-v2/env.sh; export COREPACK_ENABLE_NETWORK=0 NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false; exec bash scripts/cloud/pnpm.sh --config.verify-deps-before-run=false --config.manage-package-manager-versions=false --filter @milkup/desktop tauri build --no-bundle --ci']
proof={'sourceHead':expected,'startedUtc':now(),'inputs':inputs,'command':command,'gitStatusBefore':subprocess.check_output(['git','status','--short'],cwd=repo,text=True),'baselineSha256':baseline_sha,'protectedM01Artifacts':protected,'bundledArchives':archives,'diskBefore':disk_before,'snapshotPolicy':'Filesystem inputs include untracked/new source and ignored embedded archives. Actual count is recorded; not a fixed expected count.'}
(out/'proof-before.json').write_text(json.dumps(proof,indent=2)+'\n')
with (out/'build.log').open('x') as log: result=subprocess.run(command,cwd=repo,stdout=log,stderr=subprocess.STDOUT)
(out/'build-exit.txt').write_text(str(result.returncode)+'\n')
after=snapshot();proof.update(completedUtc=now(),exitCode=result.returncode,headAfter=head(),inputDrift=[{'path':p,'before':inputs.get(p),'after':after.get(p)} for p in sorted(set(inputs)|set(after)) if inputs.get(p)!=after.get(p)],baselineUnchanged=sha(baseline)==baseline_sha,protectedM01ArtifactsUnchanged=all(Path(p).is_file() and sha(Path(p))==digest for p,digest in protected.items()),diskAfter={p:dict(zip(['total','used','free'],shutil.disk_usage(p))) for p in ['/workspace','/tmp']})
if result.returncode==0 and not proof['inputDrift'] and proof['headAfter']==expected and proof['baselineUnchanged'] and proof['protectedM01ArtifactsUnchanged']:
    source=repo/'apps/desktop/src-tauri/target/release/milkup-desktop';target=out/'milkup-desktop';shutil.copy2(source,target);assert sha(source)==sha(target)
    proof['artifact']={'path':str(target),'sha256':sha(target),'bytes':target.stat().st_size}
proof['frontendAssets']={str(p.relative_to(repo)):sha(p) for p in sorted((repo/'apps/desktop/dist').rglob('*')) if p.is_file()}
(out/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps({k:proof[k] for k in ['sourceHead','exitCode','inputDrift','baselineUnchanged','protectedM01ArtifactsUnchanged','artifact'] if k in proof},indent=2))
sys.exit(0 if 'artifact' in proof else 1)

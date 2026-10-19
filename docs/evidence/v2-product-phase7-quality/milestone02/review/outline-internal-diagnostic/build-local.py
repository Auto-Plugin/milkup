#!/usr/bin/env python3
"""Run only after Root CPU GO. Reuse external dependencies; no install/network."""
from pathlib import Path
import json,hashlib,shutil,subprocess,datetime,tarfile,sys
base=Path(__file__).resolve().parent
out=base/'build-01'
if out.exists(): raise SystemExit('Preserve build-01; choose a new script output for a rerun')
external=Path('/tmp/milkup-p7-outline-external')
tar=external/'vendor/plugin-sdk-0.3.7.tgz'
expected='58973ba8b0db0dd062be5612d4c3058e339205275ebee45f2b31395e5ec965b0'
if hashlib.sha256(tar.read_bytes()).hexdigest()!=expected: raise SystemExit('SDK tar mismatch')
checks=[]
with tarfile.open(tar) as archive:
    for member in archive.getmembers():
        if not member.isfile(): continue
        relative=Path(member.name).relative_to('package')
        installed=external/'node_modules/@milkup/plugin-sdk'/relative
        data=archive.extractfile(member).read()
        if data!=installed.read_bytes(): raise SystemExit('Installed public SDK mismatch: '+str(relative))
        checks.append({'path':str(relative),'sha256':hashlib.sha256(data).hexdigest()})
shutil.copytree(base/'prepared',out)
(out/'node_modules').symlink_to(external/'node_modules',target_is_directory=True)
p=out/'package.json'; package=json.loads(p.read_text())
package['devDependencies']={'@milkup/plugin-sdk':'0.3.7','typescript':'5.9.3','esbuild':'0.25.12'}
p.write_text(json.dumps(package,indent=2)+'\n')
commands=[('typecheck-01',['node',str(external/'node_modules/typescript/bin/tsc'),'--noEmit','-p','tsconfig.json']),('build-01',['node','scripts/build.mjs'])]
records=[]
for name,cmd in commands:
    start=datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (base/(name+'.log')).open('w') as log: result=subprocess.run(cmd,cwd=out,stdout=log,stderr=subprocess.STDOUT)
    record={'command':cmd,'cwd':str(out),'startedUtc':start,'finishedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':result.returncode}
    (base/(name+'.json')).write_text(json.dumps(record,indent=2)+'\n'); records.append(record)
    if result.returncode: print(json.dumps(record,indent=2)); sys.exit(result.returncode)
manifest=json.loads((out/'plugin.json').read_text())
artifact=out/'dist'/f"{manifest['id']}-{manifest['version']}.milkup-plugin"
meta=json.loads((out/'dist/build-meta.json').read_text())
inputs=[]
for name in meta['inputs']:
    path=(out/name).resolve()
    public=path.is_relative_to((external/'node_modules/@milkup/plugin-sdk').resolve())
    local=path.is_relative_to(out/'src')
    if not(local or public): raise SystemExit('Non-public build input: '+str(path))
    inputs.append({'path':name,'realPath':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
imports=sum(len(x.get('imports',[])) for x in meta['outputs'].values())
if imports: raise SystemExit('Residual runtime import')
proof={'status':'TYPECHECK_AND_BUILD_PASS_NOT_NATIVE_VALIDATED','version':manifest['version'],'sdkVersion':'0.3.7','sdkTarSha256':expected,'installedSdkFilesMatchTar':checks,'noInstallOrNetwork':True,'externalDependencies':str(external/'node_modules'),'commands':records,'runtimeImports':imports,'buildInputs':inputs,'artifact':{'path':str(artifact),'bytes':artifact.stat().st_size,'sha256':hashlib.sha256(artifact.read_bytes()).hexdigest()},'manifestSha256':hashlib.sha256((out/'plugin.json').read_bytes()).hexdigest(),'entrySha256':hashlib.sha256((out/'dist/plugin.js').read_bytes()).hexdigest()}
(base/'build-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps({'status':proof['status'],'artifact':proof['artifact'],'manifestSha256':proof['manifestSha256']},indent=2))

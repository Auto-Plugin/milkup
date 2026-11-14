from pathlib import Path
import json,shutil,tempfile,zipfile,hashlib,subprocess
root=Path(tempfile.mkdtemp(prefix='milkup-download-v2-synthetic-')); out=root/'payload'
shutil.copytree('/tmp/manual-delivery-helper-contract-hfqlmzc1/coherent-synthetic-input',out)
manifest=json.loads((out/'manifest.json').read_text());sha='0'*40
manifest.update(commit=sha,baseline='40e53428e64a4effef2378ea6cbcab8f3be3b11a',guiImeAccepted=False,payloadImageMatchesCheckedBinary=False,payloadImageMatchesExpectedNsisImage=True)
record={'productVersion':'2.0.0-beta.2','signature':'NotSigned','sha256':'b'*64}
manifest['application']=record;manifest['extractedApplication']=record;manifest['compiledApplication']={**record,'sha256':'a'*64}
manifest['installer'].update(productVersion='2.0.0-beta.2',signature='NotSigned')
manifest['sourceChecks']={'phases':[{'status':'passed','name':f'synthetic-{i}'} for i in range(15)],'rust':{'status':'passed','syntheticOnly':True}}
manifest['nsisImageVerification']={'status':'passed','transform':'tauri-cli-2.11.4-unique-UNK-to-NSS','changedBytes':3,'markerOffset':17,'compiledSha256':'a'*64,'expectedNsisSha256':'b'*64,'files':[{'exactMatch':True,'sha256':'b'*64}]}
results=[]
for case in ['coherent-synthetic','wrong-transform-proof','tampered-installer']:
    current=json.loads(json.dumps(manifest))
    if case=='wrong-transform-proof':current['nsisImageVerification']['compiledSha256']='c'*64
    (out/'manifest.json').write_text(json.dumps(current)+'\n')
    files=sorted(p for p in out.rglob('*') if p.is_file() and p.name!='SHA256SUMS.txt')
    (out/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(out).as_posix()+'\n' for p in files))
    if case=='tampered-installer':(out/'synthetic.exe').write_bytes(b'tampered inert fixture')
    archive=root/f'{case}.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for p in out.rglob('*'):
            if p.is_file():z.write(p,p.relative_to(out).as_posix())
    data=archive.read_bytes();meta={'digest':'sha256:'+hashlib.sha256(data).hexdigest(),'size_in_bytes':len(data),'expired':False,'workflow_run':{'head_sha':sha},'id':'synthetic-not-uploaded','expires_at':'synthetic'}
    metadata=root/f'{case}.json';metadata.write_text(json.dumps(meta))
    result=subprocess.run(['python3','/tmp/milkup-manual-beta2-evidence/verify-download-v2.py',str(metadata),str(archive),str(root/f'extracted-{case}'),'/tmp/milkup-windows-manual-candidate'],capture_output=True,text=True)
    (root/f'{case}.log').write_text(result.stdout+result.stderr)
    expected=0 if case=='coherent-synthetic' else 1
    assert (result.returncode==0)==(expected==0),case
    results.append({'case':case,'exitCode':result.returncode,'expectedResultConfirmed':True})
report={'syntheticOnly':True,'root':str(root),'cases':results}
Path('/tmp/milkup-manual-beta2-evidence/download-v2-contracts.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))

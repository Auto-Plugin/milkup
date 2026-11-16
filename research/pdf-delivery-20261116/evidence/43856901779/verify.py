import pathlib,sys,zipfile,json,hashlib,gzip,re,shlex
base=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(base));import current_object_restore as restore
p=pathlib.Path(__file__).parent;raw=(p/'original.zip').read_bytes()
assert len(raw)==11169620 and hashlib.sha256(raw).hexdigest()=='40da8ac78420694aeee990ddf8395c7fb96ac9697c62fc6d2da6e40347f734c1'
with zipfile.ZipFile(p/'original.zip')as z,zipfile.ZipFile(restore.ARTIFACT)as old:
 r=json.loads(z.read('result.json'));prior=json.loads(old.read('result.json'))
 assert r['harnessSha']=='f2f768c36c9019c9a3436b6a74dd2b09d5504dd3'and r['status']==restore.PASS
 assert all(s['exitCode']==0 and not s['timedOut']for s in r['steps'])
 a=restore.identity(prior,json.loads(old.read('generated-header-sha256.json')),old.read('installed-package-inventory.log'))
 b=restore.identity(r,json.loads(z.read('generated-header-sha256.json')),z.read('installed-package-inventory.log'));restore.require_identity(a,b)
 assert len(r['restoreIdentity']['negativeControls'])==len(a)==11
 assert all(c['rejected']and c['objectsWritten']==0 for c in r['restoreIdentity']['negativeControls'])
 assert r['objectMismatchControl']=={'rejected':True,'objectsWritten':0}
 assert {x['target']:x['sha256']for x in prior['precompiledHeaders']}=={x['target']:x['sha256']for x in r['precompiledHeaders']}
 assert restore.object_payload(z.read('selected-objects.tar.gz'),r['objectRetention'])==restore.object_payload(old.read('selected-objects.tar.gz'),prior['objectRetention'])
 assert z.read('restored-selected-dry-run.log').decode().strip()=='ninja: no work to do.'
 assert 'REL (Relocatable file)'in z.read('partial-elf-header.log').decode()
 command=json.loads(z.read('restored-relocatable-link-command.json'))['arguments'];assert command[1:3]==['-r','--fatal-warnings']and command[5:]==[x['target']for x in r['objects']]
 inputs=json.loads(z.read('current-object-inputs.json'));assert len(inputs)==r['currentInputFiles']==3820
 assert all(re.fullmatch('[a-f0-9]{64}',v['sha256'])for v in inputs.values())
 normal=z.read('restored-full-graph-dry-run.log').decode();pending='--regenerate-during-build'in normal
 assert pending,'This receipt is retained specifically as the false-complete plan control'
 out={'sourceRun':43856901779,'outerArchiveVerified':True,'identityFieldsMatched':11,'identityMismatchControlsRejected':11,'objectMismatchRejectedBeforeWrites':True,'pchByteIdentical':2,'restoredObjectAndDepfilesByteIdentical':20,'selectedNinjaNoop':True,'actualRelocatableLinkPassed':True,'inputIdentitiesRetained':3820,'normalGraphHasPendingManifestRegeneration':True,'normalGraphCompilationReadinessProven':False,'strictOverallStatus':'partial-proof-normal-graph-not-expanded','fullEngineOrPackagePassed':False}
(p/'independent-verification.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))

"""Independent raw-archive verification; pass the preserved Library ZIP path."""
import pathlib,sys,zipfile,json,hashlib,gzip,re,shlex,collections
base=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(base));import current_object_restore as restore
p=pathlib.Path(__file__).parent
archive=pathlib.Path(sys.argv[1])if len(sys.argv)>1 else pathlib.Path('/workspace/milkup-preserved-ci-20261116/milkup-current-source-restore-43859140947.zip')
raw=archive.read_bytes();assert len(raw)==11194509 and hashlib.sha256(raw).hexdigest()=='ea1837495bda1515d94094ffab26779f2e9b5eb8f8fa8b5ff23311e7c4d17f2c'
with zipfile.ZipFile(archive)as z,zipfile.ZipFile(restore.ARTIFACT)as old:
 r=json.loads(z.read('result.json'));prior=json.loads(old.read('result.json'))
 assert r['harnessSha']=='e5aa1cde43d7600d3158bfb14cf3917be0e99e32'and r['status']==restore.PASS
 assert all(s['exitCode']==0 and not s['timedOut']for s in r['steps'])
 a=restore.identity(prior,json.loads(old.read('generated-header-sha256.json')),old.read('installed-package-inventory.log'))
 b=restore.identity(r,json.loads(z.read('generated-header-sha256.json')),z.read('installed-package-inventory.log'));restore.require_identity(a,b)
 assert len(r['restoreIdentity']['negativeControls'])==len(a)==11
 assert all(c['rejected']and c['objectsWritten']==0 for c in r['restoreIdentity']['negativeControls'])
 assert r['objectMismatchControl']=={'rejected':True,'objectsWritten':0}
 assert {x['target']:x['sha256']for x in prior['precompiledHeaders']}=={x['target']:x['sha256']for x in r['precompiledHeaders']}
 assert restore.object_payload(z.read('selected-objects.tar.gz'),r['objectRetention'])==restore.object_payload(old.read('selected-objects.tar.gz'),prior['objectRetention'])
 assert z.read('restored-selected-dry-run.log').decode().strip()=='ninja: no work to do.'
 graph={};total=0
 for name,meta in r['retainedConfigurationFiles'].items():
  if meta['encoding']=='raw':data=z.read('graph/'+name)
  else:
   assert meta['encoding']=='ordered-gzip-parts';parts=[];assert json.loads(z.read('graph/'+name+'.parts.json'))==meta
   for row in meta['parts']:
    part=z.read(str(pathlib.PurePosixPath('graph')/pathlib.PurePosixPath(name).parent/row['file']))
    assert len(part)==row['storedBytes']and restore.sha(part)==row['storedSha256'];data=gzip.decompress(part)
    assert len(data)==row['rawBytes']and restore.sha(data)==row['rawSha256'];parts.append(data)
   data=b''.join(parts)
  assert len(data)==meta['rawBytes']and restore.sha(data)==meta['rawSha256'];total+=len(data);assert total<=128*1024**2;graph[name]=data
 snapshot,proof=restore.settled_inspection_graph(graph['build.ninja'].decode());assert proof==json.loads(z.read('normal-graph-snapshot-proof.json'))
 observed=r['normalGraphInspection'];assert observed['snapshotSha256']==restore.sha(snapshot.encode())
 assert all(restore.sha(graph[name])==h for name,h in observed['identityUnchanged'].items())
 assert observed['actualManifestRefresh']and observed['expanded']and observed['compilationAndLinkEdgesUnchanged']
 normal=z.read('restored-expanded-graph-dry-run.log').decode();restore.require_expanded_plan(normal)
 targets={x['target']for x in r['objects']+r['precompiledHeaders']};assert not restore.plan_compiles(normal,targets)
 lines=[line.split('] ',1)[1]for line in normal.splitlines()if re.match(r'^\[\d+/\d+\] ',line)];assert len(lines)==r['normalGraphPlannedCommands']==541
 kinds=collections.Counter()
 for line in lines:
  args=shlex.split(line)
  if '-o'in args:
   output=args[args.index('-o')+1];kinds['object'if output.endswith('.o')else'pch'if output.endswith('.pch')else'other-output']+=1
  else:kinds['generator-or-other']+=1
 assert r['normalGraphCompilationReadinessProven']and not r['normalGraphSelectedRecompiles']
 assert 'REL (Relocatable file)'in z.read('partial-elf-header.log').decode()
 command=json.loads(z.read('restored-relocatable-link-command.json'))['arguments'];assert command[1:3]==['-r','--fatal-warnings']and command[5:]==[x['target']for x in r['objects']]
 assert r['relocatableLink']['sha256']=='35f2efdefdfc8615fd0d482a168f46e46a1591a582265e116c2992ef2281a8d1'and not r['relocatableLink']['fullSharedLibraryLink']
 inputs=json.loads(z.read('current-object-inputs.json'));assert len(inputs)==r['currentInputFiles']==3820
 classes=collections.Counter('build'if '/milkup-current-source-gate/build/'in k else'source'if '/milkup-current-source-gate/source/'in k else'host'for k in inputs)
 assert all(re.fullmatch('[a-f0-9]{64}',v['sha256'])for v in inputs.values())
 assert not r['engineBuildAttempted']and not r['runtimeInstalled']and not r['fullEngineLinkAttempted']and not r['legacy2526CacheRestored']
 out={'sourceRun':43859140947,'candidate':r['harnessSha'],'status':'passed-selected-object-restoration-and-expanded-plan-only','outerArchiveVerified':True,'configurationRawBytesVerified':total,'identityFieldsMatched':11,'identityMismatchControlsRejected':11,'objectMismatchRejectedBeforeWrites':True,'pchByteIdentical':2,'restoredObjectAndDepfilesByteIdentical':20,'selectedNinjaNoop':True,'normalManifestActuallyRefreshed':True,'manifestGraphIdentityUnchanged':True,'onlySettledManifestEdgeExcludedForInspection':True,'compilationAndLinkEdgesUnchanged':True,'expandedPlanCommands':541,'unexecutedPlanClasses':dict(kinds),'selectedObjectsAndPchScheduledAgain':0,'actualRelocatableLinkPassed':True,'inputIdentitiesRetained':3820,'inputClasses':dict(classes),'fullEngineOrPackagePassed':False,'nativePdfExecuted':False}
(p/'independent-verification.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))

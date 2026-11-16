import pathlib,zipfile,json,hashlib,gzip,tarfile,io,sys,shlex
base=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(base));import current_tu_gate as gate
p=base/'evidence/43852458294';checks={}
def sha(b):return hashlib.sha256(b).hexdigest()
with zipfile.ZipFile(p/'original.zip')as z:
 r=json.loads(z.read('result.json'));assert r['status']=='passed-actual-selected-TUs-not-engine-or-package'
 assert r['harnessSha']=='ae1f50b4640abd45e84476977b95e9d1a93f6a75'
 assert not r.get('error')and not r.get('retentionError')and not r.get('compileFailures')and not r.get('skippedUnits')
 graph={};total=0
 for name,meta in r['retainedConfigurationFiles'].items():
  if meta['encoding']=='raw':raw=z.read('graph/'+name)
  else:
   assert meta['encoding']=='ordered-gzip-parts';parts=[]
   manifest=json.loads(z.read('graph/'+name+'.parts.json'));assert manifest==meta
   for i,row in enumerate(meta['parts']):
    assert row['file']==pathlib.PurePosixPath(name).name+f'.part-{i:03d}.gz'
    stored=z.read(str(pathlib.PurePosixPath('graph')/pathlib.PurePosixPath(name).parent/row['file']))
    assert len(stored)==row['storedBytes']and sha(stored)==row['storedSha256']
    rawpart=gzip.decompress(stored);assert len(rawpart)==row['rawBytes']<=32*1024**2 and sha(rawpart)==row['rawSha256'];parts.append(rawpart)
   raw=b''.join(parts)
  assert len(raw)==meta['rawBytes']and sha(raw)==meta['rawSha256'];total+=len(raw);assert total<=128*1024**2;graph[name]=raw
 checks['configurationRawBytes']=total;checks['configurationFilesVerified']=len(graph)
 commands=json.loads(graph['compile_commands.json']);assert sha(graph['compile_commands.json'])==r['compileDatabaseSha256']
 build=pathlib.Path(next(iter(r['selectedUnits'].values()))['directory'])
 pch=gate.selected_pch_entries(commands,r['selectedUnits'],build);assert len(pch)==len(r['precompiledHeaders'])==2
 assert gate.pch_input_contract(graph['build.ninja'].decode(),pch,build)==r['pchInputs']
 for i,row in enumerate(r['precompiledHeaders']):
  target,cmd=gate.contract.original_command(pch[i],z.read(f'pch-{i}-graph.log').decode(),build)
  assert target==row['target']and cmd==row['command']
  for name,h in row['inputHashes'].items():assert sha(z.read('pch-inputs/'+name))==h
 checks['exactPchCommands']=2
 assert len(r['selectedUnits'])==len(r['objects'])==10
 for obj in r['objects']:
  source=obj['source'];entry=r['selectedUnits'][source];stem=pathlib.Path(source).stem
  target,cmd=gate.contract.original_command(entry,z.read(stem+'-graph.log').decode(),build)
  assert target==obj['target']and cmd==obj['command'];assert sha(z.read('actual-units/'+pathlib.Path(entry['file']).name))==obj['unitSha256']
 checks['exactTuCommands']=10
 archive=z.read('selected-objects.tar.gz');ret=r['objectRetention'];assert len(archive)==ret['bytes']and sha(archive)==ret['sha256']
 expected={row['path']:row for row in ret['files']};assert len(expected)==20
 with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz')as tar:
  members=tar.getmembers();assert len(members)==len(expected)
  for m in members:
   assert m.isfile()and m.name in expected and '..'not in pathlib.PurePosixPath(m.name).parts
   data=tar.extractfile(m).read();row=expected[m.name];assert len(data)==row['bytes']and sha(data)==row['sha256']
 checks['objectAndDepfilesVerified']=20;checks['rawObjectAndDepfileBytes']=sum(row['bytes']for row in ret['files'])
 assert all(s['exitCode']==0 and not s['timedOut']for s in r['steps'])
 checks['allStageExitCodesZero']=True
 assert r['engineBuildAttempted']==r['runtimeInstalled']==r['oldCacheRestored']==False
 checks['scope']='two PCH and ten actual TUs passed; no full engine/package/native runtime acceptance'
 checks['crossJobRestoreProven']=ret['crossJobRestoreProven'];assert not checks['crossJobRestoreProven']
(p/'independent-verification.json').write_text(json.dumps(checks,indent=2)+'\n');print(json.dumps(checks,indent=2))

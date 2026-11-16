import sys,json,hashlib,collections,importlib.util
from pathlib import Path
from zipfile import ZipFile
import fitz
repo=Path(__file__).resolve().parents[4];base=Path(__file__).resolve().parent
sys.path[:0]=[str(repo/'research/pdf-pagination-mechanism-20261116'),str(repo/'research/pdf-pagination-mechanism-20261116/support')]
from process_capture import bind_records
spec=importlib.util.spec_from_file_location('combined_contract',repo/'research/pdf-combined-20261116/contract.py');cc=importlib.util.module_from_spec(spec);spec.loader.exec_module(cc)
sha=lambda b:hashlib.sha256(b).hexdigest()
with ZipFile(base/'build-original.zip') as build,ZipFile(base/'native-original.zip') as z:
 manifestBytes=build.read('pagination-continuation.json');manifest=json.loads(manifestBytes)
 native=json.loads(z.read('native-diagnostic.json'));combined=json.loads(z.read('combined-fidelity/combined-result.json'))
 assert native['runtimeManifestSha256']==sha(manifestBytes)
 assert native['status']=='targeted-combined-passed-not-product-acceptance' and native['productAcceptancePassed'] is False
 cc.original_fidelity(native);assert cc.complete(combined['runs'],combined['contracts'])
 assert manifest['systemLibrariesBefore']==manifest['systemLibrariesAfter']
 assert manifest['combinedPatchSha256']==sha((repo/'research/pdf-combined-20261116/combined.patch').read_bytes())
 expected={manifest['prefix']+'/'+r['path']:r for r in manifest['runtimeFiles']}
 cases=[];mapping=None
 files=[n for n in z.namelist()if n.endswith('/native-result.json') and not n.startswith('reference/')];assert len(files)==15
 expectedFolders={'observed-'+r['case']for r in native['results']}|{'root-control-'+r['case']for r in native['rootMarginControls']}|{'combined-fidelity/'+r['case']for r in combined['runs']}
 assert {f.rsplit('/',1)[0]for f in files}==expectedFolders
 for f in sorted(files):
  folder=f.rsplit('/',1)[0];n=json.loads(z.read(f));c=json.loads(z.read(folder+'/process-capture.json'));log=z.read(folder+'/native.log')
  assert n['status']=='pdf-received' and n['guardianExit']==0 and n['privateRemoved'] is True
  assert n['guardianIdentity']['pidfdHeld'] and n['guardianIdentity']['uid']==1001
  assert c['status']=='kernel-sender-bound' and c['threadsStopped'] is True
  sender=bind_records(log,c['records'],c['processes']);assert sender==c['webProcessPidfdId']
  web=c['processes'][sender];assert web in n['processes'];assert web['noNewPrivs']==1 and web['seccomp']==2 and web['capEff']==0
  assert web['image']in expected and web['imageFile']['bytes']==expected[web['image']]['bytes']
  assert sum(p['image']=='/usr/bin/bwrap'for p in web['lineage'])==2
  assert web['lineage'][-1]['pid']==n['guardianIdentity']['pid'] and web['lineage'][-1]['birth']==n['guardianIdentity']['birth']
  assert len(web['libraries'])==2 and set(web['libraries'])==set(web['mappedFiles'])
  for p in n['processes']:
   assert p['libraries']==web['libraries'] and p['mappedFiles']==web['mappedFiles']
  for p,m in web['mappedFiles'].items():assert p in expected and m['bytes']==expected[p]['bytes']
  if mapping is None:mapping=web['mappedFiles']
  else:assert mapping==web['mappedFiles'],'Runtime family changed between cases'
  windows=[w for p in n['processes']for w in p['windows']]
  assert windows and all('Width: 1024' in w['geometry'] and 'Height: 768' in w['geometry'] for w in windows)
  pdfs=[p for p in z.namelist()if p.startswith(folder+'/') and p.count('/')==folder.count('/')+1 and p.endswith('.pdf')];assert len(pdfs)==1
  data=z.read(pdfs[0]);assert sha(data)==n['pdfSha256']
  with fitz.open(stream=data,filetype='pdf') as pdf:boundary=cc.pages(log.decode(),len(pdf))
  errors=collections.Counter(e['phase'] for e in c['errors']);assert not any(k!='window'for k in errors)
  assert all(e['error'].startswith('CalledProcessError(1,') and 'xdotool' in e['error']for e in c['errors'])
  row={'case':folder,'pages':boundary['pages'],'boundRecords':len(c['records']),'pdfSha256':sha(data),'inputSha256':n['inputSha256'],'webProcess':{'pid':web['pid'],'birth':web['birth'],'pidfdId':sender,'uid':web['uid'],'noNewPrivs':1,'seccomp':2,'capEff':0},'defaultSandboxAndLibraryFamily':True,'pageEnvelope':boundary,'ownedWindow1024x768':True,'guardianExit':0,'privateRemoved':True,'transientWindowSearchMisses':len(c['errors'])}
  cases.append(row)
 before=manifest['cacheStatsBefore'];after=manifest['cacheStatsAfter']
 result={'status':'passed-15-retained-identity-and-contracts-not-product-acceptance','run':43836771926,'testedSha':native['harnessSha'],'combinedPatchSha256':manifest['combinedPatchSha256'],'packageSha256':native['packageSha256'],'binarySha256':native['binarySha256'],'guardSha256':native['guardSha256'],'engineSeconds':manifest['compileSeconds'],'newHits':sum(after[k]-before[k]for k in ['direct_cache_hit','preprocessed_cache_hit']),'newMisses':after['cache_miss']-before['cache_miss'],'nativeSeconds':native['seconds'],'systemLibrariesUnchanged':True,'runtimeFiles':manifest['runtimeFiles'],'cases':cases,'scope':'Read-only retained bytes/record binding/page envelopes and same-run original/combined contracts; runtime hashes and ownership checked natively before recording, not remapped locally','limits':['Research-only private prefix and fixture-scoped dedup','No normal product delivery or security-update acceptance','Complex text negative extraction unchanged, not full fidelity','No manual clipboard/clicks/internal targets/physical printing']}
 (base/'retained-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'status':result['status'],'cases':len(cases),'newHits':result['newHits'],'newMisses':result['newMisses'],'boundRecords':sum(r['boundRecords']for r in cases),'windowMisses':sum(r['transientWindowSearchMisses']for r in cases)}))
 for r in cases:print(r['case'],r['pages'],r['boundRecords'],r['transientWindowSearchMisses'])

import pathlib,json,hashlib,shutil,xml.etree.ElementTree as ET,sys
r=pathlib.Path('research/pdf-pagination-mechanism-20261116');sys.path.insert(0,str(r.resolve()));import contract
p=pathlib.Path('/workspace/milkup-pagination-followup-43808221193');n=p/'nativeNew';b=p/'buildNew';o=r/'evidence/43808221193';o.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for src,dest in [('nativeNew.zip','native-original.zip'),('buildNew.zip','build-original.zip')]:shutil.copyfile(p/src,o/dest)
source=pathlib.Path('/tmp/milkup-webkit-header-preflight/source/Source/WebCore');locks=json.loads((r/'source-lock.json').read_text())
for rel,h in locks.items():assert sha(source/rel)==h,(rel,'source mismatch')
summary={'run':43808221193,'testedSha':'db2218fb230ba8504cc0b507de28bd484499dc0c','status':'identity-and-diagnostic-passed-product-failure-retained','productAcceptancePassed':False,'artifacts':[], 'cases':[], 'sourceLockVerified':locks}
for name,aid in [('native-original.zip',14199118814),('build-original.zip',14199811355)]:summary['artifacts'].append({'id':aid,'file':name,'bytes':(o/name).stat().st_size,'sha256':sha(o/name)})
def words(f):
 root=ET.parse(f).getroot();pages=root.findall('.//{*}page');return pages,[(i,''.join(w.itertext()),*[float(w.get(a)) for a in ['xMin','yMin','xMax','yMax']]) for i,p in enumerate(pages,1) for w in p.findall('.//{*}word')]
x=json.loads((n/'native-diagnostic.json').read_text())
for row in x['results']:
 case=row['case'];d=n/('observed-'+case);c=json.loads((d/'process-capture.json').read_text());lines=[l for l in (d/'native.log').read_text().splitlines() if l.startswith(contract.PREFIX)]
 assert len(lines)==len(c['records'])==row['records'];assert c['threadsStopped'];assert c['status']=='kernel-sender-bound'
 wp=[v for v in c['processes'].values() if v['image'].endswith('/WebKitWebProcess')];assert len(wp)==1;w=wp[0]
 assert (w['noNewPrivs'],w['seccomp'],w['capEff'])==(1,2,0)
 for l,v in zip(lines,c['records']):
  assert v['pid']==w['pid'] and v['pidfdId']==w['pidfdId'] and v['uid']==w['uid'];assert hashlib.sha256((l+'\n').encode()).hexdigest()==v['sha256']
 a,aw=words(d/'a4-portrait-bbox.xhtml');q,qw=words(n/'reference'/case/'a4-portrait-bbox.xhtml');assert len(a)==len(q);assert len(aw)==len(qw)
 assert [(v[0],v[1]) for v in aw]==[(v[0],v[1]) for v in qw]
 delta=max(abs(a-b) for v,z in zip(aw,qw) for a,b in zip(v[2:],z[2:]));assert delta<=0.5
 parsed=contract.parse((d/'native.log').read_text(),len(a));assert contract.observations(parsed)=={**row['observations'],'finalVisibleBoxPages':{int(k):v for k,v in row['observations']['finalVisibleBoxPages'].items()}}
 assert row['native']['guardianExit']==0 and row['native']['privateRemoved']
 summary['cases'].append({'case':case,'webProcess':{k:w[k] for k in ['pid','birth','pidfdId','uid','noNewPrivs','seccomp','capEff','namespacePids']},'lineage':w['lineage'],'records':len(lines),'pages':len(a),'words':len(aw),'maxCoordinateDeltaPt':delta,'exactOrderedWordsAndCoordinatesEqual':aw==qw,'windowProbeTransientErrors':len(c['errors']),'collectorErrorsOutsideWindow':[v for v in c['errors'] if v['phase']!='window'],'normalExit':True,'privateRemoved':True,'observations':row['observations'],'retainedProductErrors':row['originalErrorsRetained'],'retainedHeaderErrors':row['originalHeaderErrorsRetained'],'pdfSha256':row['pdfSha256']})
co=json.loads((b/'pagination-continuation.json').read_text());summary['cache']={'incomingRun':43794564331,'compileSeconds':co['compileSeconds'],'completedObjects':co['uniqueCompletedObjects'],'newMisses':co['cacheStatsAfter']['cache_miss']-co['cacheStatsBefore']['cache_miss'],'newHits':sum(co['cacheStatsAfter'][k]-co['cacheStatsBefore'][k] for k in ['direct_cache_hit','preprocessed_cache_hit']),'savedObjectArtifact':14199955883,'runtimeFiles':co['runtimeFiles']}
for k in ['packageSha256','binarySha256','guardSha256']:summary[k]=x[k]
(o/'offline-recheck.json').write_text(json.dumps(summary,indent=2)+'\n')
shutil.copyfile(n/'native-diagnostic.json',o/'native-diagnostic.json')
for f in ['pagination-cache-roundtrip.json','segment-cache-save.json','pagination-continuation.json']:shutil.copyfile(b/f,o/f)
print(json.dumps({'cases':[{k:v for k,v in x.items() if k in ['case','records','pages','words','maxCoordinateDeltaPt','exactOrderedWordsAndCoordinatesEqual','collectorErrorsOutsideWindow']} for x in summary['cases']],'cache':{k:v for k,v in summary['cache'].items() if k!='runtimeFiles'}},indent=2))

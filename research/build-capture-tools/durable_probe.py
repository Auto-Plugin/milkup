"""Receipt-only durability/configure probe; no engine build or audit upload."""
import argparse,gzip,hashlib,json,os,pathlib,shutil,sys,time
P=pathlib.Path
HERE=P(__file__).resolve().parent; RESEARCH=HERE.parent/'pdf-delivery-20261116'
PINS={'current_tu_gate.py':'9beec6c789c7761e4510a89bbbeb0599745f0a94a8ffef3a3e1f20336b252e36','qa-final-path-profile.json':'25fcfe9425a73ba0f864a80c3994f3dd0b49285c98d49530e3ccc766fe204223','normal-path-2.54.2.patch':'855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5'}
COLLECTOR='15418267490da131ea9fb7524a7a78dc36b106141c6a9d47ff015805b615d931'
COLLECTOR_FILES={'README.md': '136895093e9c4721c1a889d7c52a8beb2393989ffe7944cc6100ce876bf9cbd8', 'build_provenance_plan.py': '6c8d7bdfc357d019eacac83787fd77e291e4e591c0e805c248c153f85f3aff7d', 'capture_support.py': 'de988d3ea7c1686211b9a43ea45965f036d3af7a3ea2712b64fa4b20981fb57c', 'link_map_probe.py': 'df1e1850a67032ae7386a39c06416990dd884c0d4455b051d79ce9a58d7687a4', 'test_build_provenance_plan.py': '4b1506c902b19a272971f3d23d85ab0852e842d1adc6459cc71eae6f2cca58ff', 'test_capture_support.py': '3bcb2d1e35f625314d28eb67c841f64cdc65596c0e153f9fe9445fb78d1edc09'}
CHUNK=8*1024**2; MAX_RAW=256*1024**2; MAX_PUBLIC=4096
PHASES={'checkout','contracts','product-check','retention','sdk','configure','headers','complete','interrupted'}
STATUSES={'incomplete','failed','passed-scaffold-only','passed-configure-only'}
CODES={'none','contracts-failed','product-mismatch','retention-failed','sdk-configure-failed','interrupted-or-missing-status'}
def require(x,m):
 if not x:raise ValueError(m)
def sha(p):
 with P(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def write(p,d):
 p=P(p);p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(d,sort_keys=True)+'\n');tmp.replace(p)
def validate(d):
 allowed={'schema','status','phase','errorCode','mode','fullEngineBuilt','completeSbom','configured','packageBound','mapCompared','privateEvidenceDurable','recipeSha256','gateSha256','collectorPatchSha256','graphSha256','compilerTargets','fixtureRawBytes','fixtureParts'}
 require(type(d)is dict and set(d)<=allowed and {'schema','status','phase','fullEngineBuilt','completeSbom'}<=set(d),'Closed public schema')
 require(d['schema']==1 and d['status']in STATUSES and d['phase']in PHASES,'Public enums')
 require(d['fullEngineBuilt']is False and d['completeSbom']is False,'No release claim')
 for k,v in d.items():
  if k.endswith('Sha256'):require(type(v)is str and len(v)==64 and all(c in '0123456789abcdef'for c in v),'Digest only')
  elif k in ['fixtureParts','compilerTargets','fixtureRawBytes']:require(type(v)is int and 0<=v<=({'fixtureParts':32,'compilerTargets':20000,'fixtureRawBytes':MAX_RAW}[k]),'Bounded counts')
  elif k in ['configured','packageBound','mapCompared','privateEvidenceDurable']:require(type(v)is bool and (k=='configured' or v is False),'Conservative flags')
 if 'mode'in d:require(d['mode']in ['smoke','configure'],'Mode')
 if 'errorCode'in d:require(d['errorCode']in CODES,'Fixed error code')
 if d['status'].startswith('passed-'):
  configured=d['status']=='passed-configure-only';require(d.get('configured')is configured and d.get('mode')==('configure'if configured else'smoke') and d['phase']=='complete' and d.get('errorCode')=='none','Consistent completed probe')
  require(d.get('fixtureRawBytes')==96*1024**2 and d.get('fixtureParts')==12 and d.get('recipeSha256')==PINS['qa-final-path-profile.json'] and d.get('gateSha256')==PINS['current_tu_gate.py'] and d.get('collectorPatchSha256')==COLLECTOR,'Completed pinned fixture')
  require(all(d.get(k)is False for k in ['privateEvidenceDurable','packageBound','mapCompared']),'No elevated completion claims')
  require((configured and d.get('compilerTargets')==2833 and 'graphSha256'in d)or(not configured and 'graphSha256'not in d and 'compilerTargets'not in d),'Configure evidence scope')
 require(len(json.dumps(d).encode())<=MAX_PUBLIC,'Compact receipt budget');return d

def publish(private,public):
 # Never copy private fields wholesale, errors, filenames, logs, manifests or paths.
 state=P(private)/'state.json';d={'schema':1,'status':'incomplete','phase':'interrupted','errorCode':'interrupted-or-missing-status','fullEngineBuilt':False,'completeSbom':False}
 if state.is_file() and not state.is_symlink() and state.stat().st_size<=MAX_PUBLIC:
  try:candidate=json.loads(state.read_text());validate(candidate);d=candidate
  except (ValueError,TypeError,KeyError):pass
 validate(d);out=P(public);out.mkdir(parents=True,exist_ok=True)
 require(not out.is_symlink() and all(p.name=='status.json' and not p.is_symlink() for p in out.iterdir()),'Public destination allowlist')
 write(out/'status.json',d);return d

def check_public(path):
 p=P(path);require(p.name=='status.json' and p.is_file() and not p.is_symlink() and p.stat().st_nlink==1 and p.stat().st_size<=MAX_PUBLIC,'Exact compact regular receipt');return validate(json.loads(p.read_text()))

def retain_private(source,out):
 # New private codec, NOT a relaxation of the pinned legacy64MiB reader.
 source=P(source);out=P(out);require(source.is_file() and not source.is_symlink() and source.stat().st_nlink==1,'Private regular input');size=source.stat().st_size;require(0<size<=MAX_RAW,'Private raw budget');out.mkdir(exist_ok=False)
 whole=hashlib.sha256();parts=[]
 with source.open('rb') as src:
  while b:=src.read(CHUNK):
   whole.update(b);name=f'{len(parts):03d}.gz';p=out/name
   with p.open('xb') as f:
    with gzip.GzipFile(fileobj=f,mode='wb',mtime=0,filename='') as z:z.write(b)
   require(p.stat().st_size<=CHUNK+65536,'Stored part budget');parts.append({'name':name,'rawBytes':len(b),'rawSha256':hashlib.sha256(b).hexdigest(),'storedBytes':p.stat().st_size,'storedSha256':sha(p)})
 require(sum(r['rawBytes']for r in parts)==size and source.stat().st_size==size and sha(source)==whole.hexdigest(),'Stable private input');m={'schema':1,'rawBytes':size,'rawSha256':whole.hexdigest(),'parts':parts};write(out/'manifest.json',m);return m

def verify_private(out):
 out=P(out);m=json.loads((out/'manifest.json').read_text());require(m['schema']==1 and 0<m['rawBytes']<=MAX_RAW and 0<len(m['parts'])<=32,'Private manifest bounds');whole=hashlib.sha256();total=0
 for i,r in enumerate(m['parts']):
  require(r['name']==f'{i:03d}.gz' and 0<r['rawBytes']<=CHUNK,'Ordered bounded part');p=out/r['name'];require(not p.is_symlink() and p.stat().st_size==r['storedBytes']<=CHUNK+65536 and sha(p)==r['storedSha256'],'Stored identity')
  with gzip.open(p,'rb') as f:b=f.read(CHUNK+1);require(len(b)==r['rawBytes'] and not f.read(1),'Bounded decompression')
  require(hashlib.sha256(b).hexdigest()==r['rawSha256'],'Raw identity');whole.update(b);total+=len(b)
 require(total==m['rawBytes'] and whole.hexdigest()==m['rawSha256'],'Whole identity');return m

def product_check():
 for n,h in COLLECTOR_FILES.items():require(sha(HERE/n)==h,'Exact recovered collector-only tools')
 for n,h in PINS.items():require(sha(RESEARCH/n)==h,'Pinned unmodified product gate')
 profile=json.loads((RESEARCH/'qa-final-path-profile.json').read_text());require(profile['version']=='2.54.2' and profile['sourceArchiveSha256']=='a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065','Exact official source')
 for k,v in {'PORT':'GTK','USE_GTK4':'OFF','DEVELOPER_MODE':'OFF','ENABLE_BUBBLEWRAP_SANDBOX':'ON'}.items():require(profile['cmake'][k]==v,'Same product options')
 return profile

def run(mode,private,tests_code):
 private=P(private);private.mkdir(parents=True,exist_ok=True);d={'schema':1,'status':'incomplete','phase':'contracts','errorCode':'interrupted-or-missing-status','mode':mode,'fullEngineBuilt':False,'completeSbom':False,'configured':False,'packageBound':False,'mapCompared':False,'privateEvidenceDurable':False}
 def state(phase):d['phase']=phase;write(private/'state.json',d)
 state('contracts')
 try:
  require(tests_code==0,'Contracts failed');state('product-check');product_check();d.update(recipeSha256=PINS['qa-final-path-profile.json'],gateSha256=PINS['current_tu_gate.py'],collectorPatchSha256=COLLECTOR)
  state('retention');fixture=private/'synthetic.bin'
  with fixture.open('xb') as f:
   block=bytes(range(256))*4096
   for _ in range(96):f.write(block)
  m=retain_private(fixture,private/'synthetic-parts');verify_private(private/'synthetic-parts');d.update(fixtureRawBytes=m['rawBytes'],fixtureParts=len(m['parts']))
  if mode=='configure':
   require(os.environ.get('GITHUB_ACTIONS')=='true' and os.getuid()!=0,'Real ordinary GitHub runner required; never emulate locally');sys.path.insert(0,str(RESEARCH));import current_tu_gate as gate
   class Probe(gate.Gate):
    def run(self,name,*a,**kw):
     phase='configure' if 'configure'in name or 'compiler'in name else 'headers' if 'header'in name or 'manifest'in name else 'sdk';state(phase);return super().run(name,*a,**kw)
    def before_compilation(self):
     db=json.loads((self.build/'compile_commands.json').read_text());require(len(db)==2833,'Review changed target set before engine build')
     state('retention');retain_private(self.build/'build.ninja',private/'private-graph-parts');verify_private(private/'private-graph-parts');d.update(configured=True,compilerTargets=len(db),graphSha256=sha(self.build/'build.ninja'));return False
   g=Probe(private/'actual-source-gate',time.time());g.execute();require(d['configured'],'Configure hook not reached')
  d.update(status='passed-configure-only'if mode=='configure'else'passed-scaffold-only',phase='complete',errorCode='none')
 except Exception:
  errors={'contracts':'contracts-failed','product-check':'product-mismatch','retention':'retention-failed'};d.update(status='failed',errorCode=errors.get(d['phase'],'sdk-configure-failed'));write(private/'state.json',validate(d));return 1
 write(private/'state.json',validate(d));return 0

def main():
 a=argparse.ArgumentParser();a.add_argument('action',choices=['run','publish','validate','check']);a.add_argument('--mode',choices=['smoke','configure'],default='smoke');a.add_argument('--private',type=P);a.add_argument('--public',type=P);a.add_argument('--tests-code',type=int,default=0);a.add_argument('--receipt',type=P);x=a.parse_args()
 if x.action=='run':return run(x.mode,x.private,x.tests_code)
 if x.action=='publish':publish(x.private,x.public);return 0
 d=check_public(x.receipt)
 if x.action=='validate':return 0
 require(d['status']in ['passed-scaffold-only','passed-configure-only'],'Probe incomplete or failed; no durable pass');return 0
if __name__=='__main__':raise SystemExit(main())

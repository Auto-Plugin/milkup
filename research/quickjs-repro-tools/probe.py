"""Research-only QuickJS reconstruction; only a closed compact receipt is public."""
import argparse,hashlib,json,os,pathlib,re,shutil,signal,subprocess,tarfile,time,urllib.request
P=pathlib.Path
HERE=P(__file__).resolve().parent
LOCK_SHA='163a0bec205eab097a56da96d7ad88681dc17813addeee0668a6a483028151eb'
MAX_PUBLIC=4096
PHASES={'checkout','tests','inputs','image','build1','build2','compare','complete','interrupted'}
STATUSES={'incomplete','failed','matched-reference','reproducible-different'}
CODES={'none','interrupted','contracts','inputs','image','build','abi','nonreproducible','cleanup'}
class AbiError(RuntimeError):pass
class ProbeInterrupted(RuntimeError):pass
FLAGS=['historicalCompilerProved','licenseClosureComplete','nativePdfTested','packageBound','publicationReady']
def require(ok,message):
 if not ok:raise ValueError(message)
def sha(p):
 with P(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def digest(b):return hashlib.sha256(b).hexdigest()
def write(p,obj):
 p=P(p);p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(obj,sort_keys=True)+'\n');tmp.replace(p)
def lock():
 require(sha(HERE/'inputs.lock.json')==LOCK_SHA,'reviewed lock changed')
 return json.loads((HERE/'inputs.lock.json').read_text())
def initial():return {'schema':1,'status':'incomplete','phase':'checkout','errorCode':'interrupted','runs':[],'abiDisposition':'not-run',**dict.fromkeys(FLAGS,False)}
def ishash(x):return type(x)is str and re.fullmatch('[0-9a-f]{64}',x)is not None
def validate(d):
 base={'schema','status','phase','errorCode','runs','abiDisposition',*FLAGS}
 optional={'lockSha256','imageManifestSha256','imageConfigSha256','sourceCount','repeatIdentical','baselineJsEqual','baselineWasmEqual','elapsedMs','workflowCommit'}
 require(type(d)is dict and base<=set(d)<=base|optional,'closed schema')
 require(type(d['schema'])is int and d['schema']==1 and d['status']in STATUSES and d['phase']in PHASES and d['errorCode']in CODES,'fixed enums')
 require(d['abiDisposition']in {'not-run','failed','passed'},'ABI disposition')
 require(all(d[k]is False for k in FLAGS),'no elevated claims')
 require(type(d['runs'])is list and len(d['runs'])<=2,'two bounded runs')
 for r in d['runs']:
  require(type(r)is dict and set(r)=={'jsSha256','wasmSha256','compilerIdentitySha256','traceSha256','elapsedMs','abi'},'closed run')
  require(all(ishash(r[k])for k in r if k.endswith('Sha256')),'digest fields only')
  require(type(r['elapsedMs'])is int and 0<=r['elapsedMs']<=700000 and r['abi']=='passed','bounded run')
 for k in optional & set(d):
  if k.endswith('Sha256'):require(ishash(d[k]),'digest')
  elif k in {'repeatIdentical','baselineJsEqual','baselineWasmEqual'}:require(type(d[k])is bool,'boolean')
  elif k=='sourceCount':require(type(d[k])is int and d[k]==18,'declared sources')
  elif k=='elapsedMs':require(type(d[k])is int and 0<=d[k]<=1800000,'bounded duration')
  elif k=='workflowCommit':require(type(d[k])is str and re.fullmatch('[0-9a-f]{40}',d[k])is not None,'commit only')
 if d['status']in {'matched-reference','reproducible-different'}:
  l=lock();require(set(d)==base|optional and d['phase']=='complete' and d['errorCode']=='none' and len(d['runs'])==2,'complete research evidence');require(d['abiDisposition']=='passed','completed ABI')
  require(d['lockSha256']==LOCK_SHA and d['imageManifestSha256']==l['imageManifest'][7:] and d['imageConfigSha256']==l['imageConfig'][7:],'fixed identities')
  a,b=d['runs'];require(all(a[k]==b[k] for k in ['jsSha256','wasmSha256','compilerIdentitySha256']) and d['repeatIdentical']is True,'repeat identity')
  require(d['baselineJsEqual']==(a['jsSha256']==l['referenceJs']['sha256']) and d['baselineWasmEqual']==(a['wasmSha256']==l['referenceWasm']['sha256']),'derived baseline comparison')
  require((d['status']=='matched-reference')==(d['baselineJsEqual']and d['baselineWasmEqual']),'consistent outcome')
 require(len(json.dumps(d).encode())<=MAX_PUBLIC,'receipt budget');return d

def regular(p,limit):
 p=P(p);require(p.is_file() and not p.is_symlink() and p.stat().st_nlink==1 and p.stat().st_size<=limit,'bounded regular file');return p

def publish(private,public):
 d=initial();d['phase']='interrupted'
 try:d=validate(json.loads(regular(P(private)/'state.json',MAX_PUBLIC).read_text()))
 except (OSError,ValueError,TypeError,KeyError):pass
 out=P(public);out.mkdir(parents=True,exist_ok=True)
 require(not out.is_symlink() and all(p.name=='status.json' and not p.is_symlink() and p.is_file() and p.stat().st_nlink==1 for p in out.iterdir()),'public directory allowlist')
 write(out/'status.json',validate(d));return d

def check(path,success=False):
 d=validate(json.loads(regular(path,MAX_PUBLIC).read_text()))
 if success:require(d['status']in {'matched-reference','reproducible-different'},'trial incomplete or failed')
 return d

def get(url,limit,headers=None):
 require(url.startswith('https://'),'HTTPS only')
 with urllib.request.urlopen(urllib.request.Request(url,headers=headers or {}),timeout=45) as r:b=r.read(limit+1)
 require(len(b)<=limit,'download budget');return b

def fetch(item,path):
 b=get(item['url'],item['size']);require(len(b)==item['size'] and digest(b)==item['sha256'],'pinned download mismatch');P(path).write_bytes(b)

def unpack(archive,dest):
 dest=P(dest);dest.mkdir()
 with tarfile.open(archive) as t:
  total=0
  for m in t.getmembers():
   parts=P(m.name).parts
   require(not m.name.startswith('/') and '..' not in parts and len(parts)>=1,'archive path')
   if m.isdir():continue
   require(m.isfile() and len(parts)>1 and 0<=m.size<=4*1024**2,'archive type/size')
   total+=m.size;require(total<=16*1024**2,'archive expansion budget')
   out=dest.joinpath(*parts[1:]);out.parent.mkdir(parents=True,exist_ok=True)
   with out.open('xb') as f:f.write(t.extractfile(m).read())

def prepare(private,downloads):
 l=lock();root=P(private);full=root/'full';full.mkdir()
 for name in ['generator','quickjs']:
  archive=P(downloads)/(name+'.tar.gz');require(sha(archive)==l[name]['sha256'] and archive.stat().st_size==l[name]['size'],'pinned archive');unpack(archive,full/name)
 patch=full/'generator/0001-Extra-stuff-for-use-with-PDF.js.patch'
 with (root/'patch.log').open('wb')as log:subprocess.run(['patch','--batch','--fuzz=0','-p1','-i',str(patch.resolve())],cwd=full/'quickjs',stdout=log,stderr=subprocess.STDOUT,check=True,timeout=30)
 src=root/'src';src.mkdir()
 require(len(l['sources'])==18,'exact declared source count')
 for rel,h in l['sources'].items():
  require(sha(full/rel)==h,'source hash');out=src/rel;out.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(full/rel,out)
 script=full/'generator/compile.sh';require(sha(script)==l['compileSha256'],'compile script hash');shutil.copyfile(script,src/'generator/compile.sh')
 require({str(p.relative_to(src))for p in src.rglob('*')if p.is_file()}==set(l['sources'])|{'generator/compile.sh'},'exact compiler input files')
 # Verify quoted source includes resolve inside the declared set, not elsewhere.
 for rel in l['sources']:
  for inc in re.findall(r'^\s*#\s*include\s*"([^\"]+)"',(src/rel).read_text(),re.M):
   found=[p for p in [(src/rel).parent/inc,src/'quickjs'/inc,src/'generator/src'/inc]if p.is_file()]
   require(bool(found)and all(p.resolve().is_relative_to(src.resolve())for p in found),'declared include closure')
 return src

def metadata(private):
 l=lock();token=json.loads(get('https://auth.docker.io/token?service=registry.docker.io&scope=repository:emscripten/emsdk:pull',16384))['token']
 headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.manifest.v1+json'}
 b=get('https://registry-1.docker.io/v2/emscripten/emsdk/manifests/'+l['imageManifest'],65536,headers)
 require('sha256:'+digest(b)==l['imageManifest'],'OCI manifest digest');m=json.loads(b)
 require(m['config']['digest']==l['imageConfig'],'OCI config pin');P(private,'oci-manifest.json').write_bytes(b)
 b=get('https://registry-1.docker.io/v2/emscripten/emsdk/blobs/'+l['imageConfig'],65536,headers)
 require('sha256:'+digest(b)==l['imageConfig'],'OCI config digest');c=json.loads(b)
 require(c['architecture']=='amd64' and c['os']=='linux','OCI platform');P(private,'oci-config.json').write_bytes(b)
 # Anonymous short-lived registry token is never stored or emitted.

def inspect_image(d):
 l=lock();require(type(d)is list and len(d)==1,'one image');i=d[0]
 require(i['Id']==l['imageConfig']and i['Architecture']=='amd64'and i['Os']=='linux','actual image identity')
 require('emscripten/emsdk@'+l['imageManifest']in i['RepoDigests'],'actual image manifest')

def scope():
 run=os.environ.get('GITHUB_RUN_ID');attempt=os.environ.get('GITHUB_RUN_ATTEMPT')
 if run is None and attempt is None:return 'local-'+str(os.getpid())
 require(type(run)is str and type(attempt)is str and re.fullmatch('[0-9]{1,20}',run) and re.fullmatch('[0-9]{1,6}',attempt),'run ownership scope')
 return run+'-'+attempt

def interrupt(signum,frame):raise ProbeInterrupted('research trial interrupted')

def cleanup_owned():
 # Filter only this workflow run/attempt's label; never prune global resources.
 label='io.milkup.quickjs-research='+scope()
 b=subprocess.check_output(['docker','ps','--all','--quiet','--filter','label='+label],timeout=30,text=True)
 ids=b.split();require(all(re.fullmatch('[0-9a-f]{12,64}',i)for i in ids),'owned container IDs')
 if ids:subprocess.run(['docker','rm','-f',*ids],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=30)
 left=subprocess.check_output(['docker','ps','--all','--quiet','--filter','label='+label],timeout=30,text=True)
 require(not left.strip(),'owned containers remain')

def remove_named(name):
 old={sig:signal.signal(sig,signal.SIG_IGN)for sig in [signal.SIGTERM,signal.SIGINT]}
 try:
  subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30,check=False)
  left=subprocess.check_output(['docker','ps','--all','--quiet','--filter','name=^/'+name+'$'],timeout=30,text=True)
  require(not left.strip(),'named container remains')
 finally:
  for sig,handler in old.items():signal.signal(sig,handler)

def docker_args(src,out,n):
 l=lock();return ['docker','run','--rm','--name',n,'--label','io.milkup.quickjs-research='+scope(),'--pull=never','--platform=linux/amd64','--network=none','--cpus=1','--memory=2g','--pids-limit=256','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user',f'{os.getuid()}:{os.getgid()}','--tmpfs','/tmp:rw,nosuid,nodev,size=512m','-v',f'{P(src).resolve()}:/src:ro','-v',f'{P(out).resolve()}:/out:rw','-v',f'{HERE}:/driver:ro',*[x for pair in [('HOME','/tmp'),('EM_CACHE','/out/cache'),('EMCC_TEMP_DIR','/out/trace'),('EMCC_DEBUG','1'),('EMCC_CORES','1'),('BINARYEN_CORES','1'),('SOURCE_DATE_EPOCH','1780838050'),('LC_ALL','C'),('TZ','UTC'),('INPUT','/src/generator/src'),('QUICKJS','/src/quickjs'),('OUTPUT','/out')]for x in ['-e',pair[0]+'='+pair[1]]], 'emscripten/emsdk@'+l['imageManifest'],'sh','/driver/container-build.sh']

def trace_hash(out):
 files=sorted((out/'trace').rglob('*'));items={};total=0
 for p in files:
  if p.is_dir():continue
  regular(p,256*1024**2);total+=p.stat().st_size;require(total<=1024**3 and len(items)<4096,'trace budget');items[str(p.relative_to(out))]=sha(p)
 require(items,'trace evidence missing');write(out/'trace-hashes.json',items);return digest(json.dumps(items,sort_keys=True).encode())

def build(src,out,index):
 out=P(out);out.mkdir();start=time.monotonic();name=f'milkup-qjs-{scope()}-{index}';args=docker_args(src,out,name)
 # First run retains a link map; equality with unmodified-flag run two tests neutrality.
 if index==1:args[-3:-3]=['-e','EMCC_CFLAGS=-Wl,-Map=/out/link.map -Wl,--trace']
 with (out/'docker-args.json').open('w')as f:json.dump(args,f)
 try:
  with (out/'build.log').open('wb')as log:subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=600)
 finally:remove_named(name)
 for n,limit in [('quickjs-eval.js',1024**2),('quickjs-eval.wasm',16*1024**2),('compiler-identity.json',16384)]:regular(out/n,limit)
 identity=json.loads((out/'compiler-identity.json').read_text());require('6.0.0'in identity['versions']['emcc'].splitlines()[0]and len(identity['files'])==5,'compiler identity')
 if index==1:regular(out/'link.map',64*1024**2)
 shutil.copyfile(out/'quickjs-eval.js',out/'quickjs-eval.mjs')
 try:
  with (out/'abi.json').open('wb')as log:subprocess.run(['node','--max-old-space-size=128',str(HERE/'abi-smoke.mjs'),str(out/'quickjs-eval.mjs'),str(out/'quickjs-eval.wasm')],stdout=log,stderr=subprocess.STDOUT,check=True,timeout=10)
 except (subprocess.SubprocessError,OSError) as exc:raise AbiError('candidate ABI failed') from exc
 abi=json.loads((out/'abi.json').read_text());require(abi['standaloneAbiPassed']is True and abi['nativePdfTested']is False,'ABI proof')
 return {'jsSha256':sha(out/'quickjs-eval.js'),'wasmSha256':sha(out/'quickjs-eval.wasm'),'compilerIdentitySha256':sha(out/'compiler-identity.json'),'traceSha256':trace_hash(out),'elapsedMs':int((time.monotonic()-start)*1000),'abi':'passed'}

def run(private,tests_code):
 root=P(private).resolve();root.mkdir(parents=True,exist_ok=True);start=time.monotonic();d=initial();l=lock();code='contracts'
 def state(phase):d['phase']=phase;write(root/'state.json',validate(d))
 try:
  state('tests');require(tests_code==0,'contracts failed');d['workflowCommit']=os.environ['GITHUB_SHA'];d['lockSha256']=LOCK_SHA
  code='inputs';state('inputs');downloads=root/'downloads';downloads.mkdir()
  for name in ['generator','quickjs']:fetch(l[name],downloads/(name+'.tar.gz'))
  for key,name in [('referenceJs','reference.mjs'),('referenceWasm','reference.wasm')]:fetch(l[key],downloads/name)
  with (root/'reference-abi.json').open('wb')as log:subprocess.run(['node','--max-old-space-size=128',str(HERE/'abi-smoke.mjs'),str(downloads/'reference.mjs'),str(downloads/'reference.wasm')],stdout=log,stderr=subprocess.STDOUT,check=True,timeout=10)
  src=prepare(root,downloads);d['sourceCount']=18
  code='image';state('image');metadata(root);image='emscripten/emsdk@'+l['imageManifest']
  with (root/'pull.log').open('wb')as log:subprocess.run(['docker','pull','--platform=linux/amd64',image],stdout=log,stderr=subprocess.STDOUT,check=True,timeout=300)
  b=subprocess.check_output(['docker','image','inspect',image],timeout=30);inspect_image(json.loads(b));(root/'image-inspect.json').write_bytes(b)
  d.update(imageManifestSha256=l['imageManifest'][7:],imageConfigSha256=l['imageConfig'][7:])
  for index in [1,2]:
   code='build';state('build'+str(index));d['runs'].append(build(src,root/('run'+str(index)),index))
  d['abiDisposition']='passed';code='nonreproducible';state('compare');a,b=d['runs'];require(all(a[k]==b[k]for k in ['jsSha256','wasmSha256','compilerIdentitySha256']),'repeat mismatch')
  require((root/'run1/quickjs-eval.js').read_bytes()==(root/'run2/quickjs-eval.js').read_bytes()and(root/'run1/quickjs-eval.wasm').read_bytes()==(root/'run2/quickjs-eval.wasm').read_bytes(),'raw equality')
  d.update(repeatIdentical=True,baselineJsEqual=a['jsSha256']==l['referenceJs']['sha256'],baselineWasmEqual=a['wasmSha256']==l['referenceWasm']['sha256'],elapsedMs=int((time.monotonic()-start)*1000),errorCode='none')
  d['status']='matched-reference'if d['baselineJsEqual']and d['baselineWasmEqual']else'reproducible-different';state('complete');return 0
 except Exception as exc:
  if isinstance(exc,AbiError):code='abi';d['abiDisposition']='failed'
  if isinstance(exc,ProbeInterrupted):code='interrupted';d['phase']='interrupted'
  d.update(status='failed',errorCode=code,elapsedMs=min(1800000,int((time.monotonic()-start)*1000)));write(root/'state.json',validate(d));raise

def main():
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['run','publish','check','cleanup']);p.add_argument('--private');p.add_argument('--public');p.add_argument('--receipt');p.add_argument('--tests-code',type=int,default=1);a=p.parse_args()
 if a.mode=='run':
  signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt);return run(a.private,a.tests_code)
 if a.mode=='cleanup':
  try:cleanup_owned()
  except Exception:
   d=initial();d.update(status='failed',phase='interrupted',errorCode='cleanup');write(P(a.private)/'state.json',d);raise
 if a.mode=='publish':publish(a.private,a.public)
 if a.mode=='check':check(a.receipt,success=True)
 return 0
if __name__=='__main__':raise SystemExit(main())

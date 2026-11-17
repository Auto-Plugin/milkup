"""Actual configure/source admission only. Never calls Ninja all or uploads evidence."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,sys,tarfile,time,uuid
import durable_probe as d
P=pathlib.Path; HERE=P(__file__).resolve().parent; REPO=HERE.parents[1]
SOURCE='a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065'
ALIAS='Source/ThirdParty/skia/src/ports/fontations/Cargo.toml'
LINK='../../../bazel/external/fontations/Cargo.toml'
META=['build.ninja','CMakeFiles/rules.ninja','CMakeCache.txt','compile_commands.json','cmakeconfig.h']
DEPENDENCIES={'current_tu_gate.py':'9beec6c789c7761e4510a89bbbeb0599745f0a94a8ffef3a3e1f20336b252e36','current_source_archive.py':'c4ea19ae64a62590191655eff36e05b2acea7cf06df5db57bf92b15990c43d6c','package_boundary.py':'7d52086f668cc110532ba3cfe5186eec05beeb08865ea0c44d7fb79135ee2b07','normal-path-2.54.2.json':'38f8508b1b0db69e004ec1f9799221648d9370ae27a5f6cd31cde1f4acca2b8a','pch-audit/source-lock.json':'a55bb59c6755e9724d2045b96b2cbbdc0f259db6902ae3a9127e034f24425e71'}
def pins():
 d.product_check()
 for n,h in DEPENDENCIES.items():d.require(d.sha(d.RESEARCH/n)==h,'Pinned gate dependencies')
 d.require(d.sha(REPO/'scripts/ci/webkit-pagination-object-preflight.py')=='61a3e9034bd909f0cacc8e6b87870888cec9632a37236d6f5a4daaf40163911d','Pinned header generator contract')
def canonical(x):return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def relative(n):
 p=pathlib.PurePosixPath(n);d.require(str(p)==n and n not in ('','.') and not p.is_absolute() and '..'not in p.parts,'Canonical source member');return n

def expected_source(archive,lock):
 files={};aliases={};start=time.monotonic()
 with tarfile.open(archive,'r:xz')as t:
  for m in t:
   d.require(time.monotonic()-start<600,'Source archive time cap')
   if m.isdir() and m.name=='webkitgtk-2.54.2':continue
   d.require(m.name.startswith('webkitgtk-2.54.2/'),'Archive prefix')
   if m.isdir():continue
   name=relative(m.name.removeprefix('webkitgtk-2.54.2/'))
   if m.issym():
    d.require(name==ALIAS and m.linkname==LINK and name not in aliases,'Exact single archive-declared alias');aliases[name]=m.linkname;continue
   d.require(m.isfile(),'Only regular archive members');h=hashlib.file_digest(t.extractfile(m),'sha256').hexdigest()
   if name in lock['inputs']:d.require(h==lock['inputs'][name],'Patched preimage')
   h=lock['outputs'].get(name,h)
   d.require(name not in files or files[name]==h,'Consistent duplicate archive entry');files[name]=h
 for name in lock['newFiles']:files[relative(name)]=lock['outputs'][name]
 d.require(aliases=={ALIAS:LINK},'Expected official alias evidence')
 return files,aliases

def verify_source(root,files,aliases):
 seen=set();seen_aliases=set();start=time.monotonic();root=root.resolve()
 for p in root.rglob('*'):
  d.require(time.monotonic()-start<600,'Actual source time cap');n=str(p.relative_to(root))
  if p.is_symlink():
   d.require(n in aliases and os.readlink(p)==aliases[n] and not p.exists(),'Exact declared dangling alias; never traverse');seen_aliases.add(n);continue
  if p.is_dir():continue
  d.require(p.is_file() and n in files and d.sha(p)==files[n],'Exact regular source bytes');seen.add(n)
 d.require(seen==set(files) and seen_aliases==set(aliases),'Complete regular source and alias coverage')

def seal(g,private):
 pins();d.require(d.sha(g.root/'source.tar.xz')==SOURCE,'Pinned official archive')
 lock=json.loads((d.RESEARCH/'normal-path-2.54.2.json').read_text());files,aliases=expected_source(g.root/'source.tar.xz',lock);verify_source(g.source,files,aliases)
 db=json.loads((g.build/'compile_commands.json').read_text());d.require(len(db)==2833,'Changed compile set requires review')
 missing=[]
 for row in db:
  p=P(row['file']);d.require(p.is_absolute() and not p.is_symlink(),'Canonical primary TU')
  d.require(p.is_relative_to(g.source)or p.is_relative_to(g.build),'Primary TU root')
  if p.is_relative_to(g.source):d.require(p.is_file() and str(p.relative_to(g.source))in files,'Declared actual source TU')
  elif not p.is_file():missing.append(str(p))
 # Inventory limitations explicitly; this is not a Ninja semantic closure parser.
 for name in ['python3','perl','ruby','pkg-config','dpkg-buildflags','ld','ar']:
  tool=P(shutil.which(name)or'');d.require(tool.is_file(),'Required actual generator/linker tool');g.report['tools'][name]={'path':str(tool),'resolved':str(tool.resolve()),'sha256':d.sha(tool.resolve())}
 graph=(g.build/'build.ninja').read_text();edges=[x for x in graph.splitlines()if x.startswith('build ')]
 exceptional=[x for x in edges if '$'in x.split(': ',1)[0]or any(y.startswith('/')for y in x[6:].split(': ',1)[0].split())]
 manifest={'schema':1,'buildId':str(uuid.uuid4()),'harnessSha':os.environ['GITHUB_SHA'],'sourceRoot':str(g.source),'buildRoot':str(g.build),'archive':str(g.root/'source.tar.xz'),'archiveSha256':SOURCE,'patchSha256':d.PINS['normal-path-2.54.2.patch'],'sourceFiles':files,'aliases':aliases,'aliasTextSha256':hashlib.sha256(LINK.encode()).hexdigest(),'configuration':g.report['configuration'],'configureOptions':g.report['configureOptions'],'tools':g.report['tools'],'metadata':{n:d.sha(g.build/n)for n in META},'compilerTargets':len(db),'generatedFiles':{str(p.relative_to(g.build)):d.sha(p)for p in g.build.rglob('*')if p.is_file()and not p.is_symlink()and p.suffix in ('.h','.hpp','.cpp','.cxx','.sh','.py','.json')},'unresolvedGraphEdges':exceptional,'missingGeneratedCompileInputs':missing,'resources':g.report.get('resources',[]),'dependencyInventorySha256':d.sha(g.out/'installed-package-inventory.log'),'fullBuildAdmitted':False,'remaining':['expanded ordered graph and generator producer/input closure','actual depfile/rsp closure after normal build','actual WebKit map replay and byte equality','archive-member/live-section interpretation','package notice SBOM native gates']}
 d.write(private/'admission.json',manifest);return manifest

def compact(status='incomplete',phase='setup',code='missing-status',**kw):
 return {'schema':1,'status':status,'phase':phase,'errorCode':code,'configured':False,'sourceSealed':False,'independentVerifierPassed':False,'fullBuildAdmitted':False,'fullEngineBuilt':False,'completeSbom':False,'mapCompared':False,'privateEvidenceDurable':False,**kw}
def validate(x):
 base=compact();extra={'admissionSha256','compilerTargets','sourceFiles','unresolvedGraphEdges','generatedFiles','missingGeneratedCompileInputs'}
 d.require(type(x)is dict and set(base)<=set(x) and set(x)<=set(base)|extra,'Closed outcome')
 d.require(x['schema']==1 and x['status']in ['incomplete','failed','passed-configure-admission-only'] and x['phase']in ['setup','contracts','configure','source-seal','verify','complete'] and x['errorCode']in ['none','missing-status','contracts-failed','configure-admission-failed','verification-failed'],'Fixed outcome enums')
 for k in ['fullBuildAdmitted','fullEngineBuilt','completeSbom','mapCompared','privateEvidenceDurable']:d.require(x[k]is False,'No full-build or release claims')
 for k in ['configured','sourceSealed','independentVerifierPassed']:d.require(type(x[k])is bool,'Boolean facts')
 for k in extra-{'admissionSha256'}:
  if k in x:d.require(type(x[k])is int and 0<=x[k]<=1000000,'Bounded count')
 if 'admissionSha256'in x:d.require(type(x['admissionSha256'])is str and len(x['admissionSha256'])==64 and set(x['admissionSha256'])<=set('0123456789abcdef'),'Digest')
 if x['status']=='passed-configure-admission-only':d.require(all(x[k]for k in ['configured','sourceSealed','independentVerifierPassed'])and x['compilerTargets']==2833 and x['phase']=='complete'and x['errorCode']=='none'and extra<=set(x),'Consistent admission-only pass')
 d.require(len(json.dumps(x).encode())<4096,'Small outcome');return x

def run(private,tests_code):
 private=P(private);private.mkdir(exist_ok=True);state=compact(phase='contracts');d.write(private/'status.json',state)
 try:
  d.require(tests_code==0,'Contract tests failed');pins();d.require(os.getuid()!=0 and os.environ.get('GITHUB_ACTIONS')=='true','Real ordinary hosted user')
  d.require(os.environ.get('GITHUB_REF')=='refs/heads/dot/provenance-configure-20261117','Exact isolated branch')
  d.require(shutil.disk_usage(private).free>=12*1024**3,'12 GiB measured configure start headroom; unchanged gate retains 8 GiB reserve')
  sys.path.insert(0,str(d.RESEARCH));import current_tu_gate as gate
  class Probe(gate.Gate):
   def before_compilation(self):
    state.update(phase='source-seal',configured=True);d.write(private/'status.json',state)
    m=seal(self,private);state.update(sourceSealed=True,admissionSha256=d.sha(private/'admission.json'),compilerTargets=m['compilerTargets'],sourceFiles=len(m['sourceFiles']),generatedFiles=len(m['generatedFiles']),unresolvedGraphEdges=len(m['unresolvedGraphEdges']),missingGeneratedCompileInputs=len(m['missingGeneratedCompileInputs']));d.write(private/'status.json',state);return False
  state['phase']='configure';d.write(private/'status.json',state);Probe(private/'actual-source-gate',time.time()).execute();d.require(state['sourceSealed'],'Admission hook reached')
  # Separate consumer process reopens private evidence; no upload or fake CI context.
  state['phase']='verify';d.write(private/'status.json',state)
  with (private/'verifier.log').open('x')as log:r=subprocess.run([sys.executable,str(HERE/'hosted_verify.py'),str(private/'admission.json'),state['admissionSha256']],stdout=log,stderr=subprocess.STDOUT,timeout=660)
  d.require(r.returncode==0,'Independent verifier failed');state.update(status='passed-configure-admission-only',phase='complete',errorCode='none',independentVerifierPassed=True)
 except Exception:
  state.update(status='failed',errorCode='contracts-failed'if state['phase']=='contracts'else'verification-failed'if state['phase']=='verify'else'configure-admission-failed');d.write(private/'status.json',validate(state));raise
 d.write(private/'status.json',validate(state))
def publish(private):
 try:
  p=private/'status.json';d.require(p.is_file() and not p.is_symlink() and p.stat().st_size<4096,'Bounded regular outcome');x=json.loads(p.read_text());validate(x)
 except (OSError,ValueError,TypeError,KeyError):x=compact()
 print(json.dumps(x,sort_keys=True));return x
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('action',choices=['run','publish']);p.add_argument('private',type=P);p.add_argument('--tests-code',type=int,default=0);a=p.parse_args()
 if a.action=='run':run(a.private,a.tests_code)
 else:publish(a.private)

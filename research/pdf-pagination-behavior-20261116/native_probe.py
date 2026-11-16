#!/usr/bin/env python3
"""Exact packaged output helper + original guard + private observation WebKit.
Diagnostic completion preserves the original PDF failures; never product acceptance.
"""
import argparse,hashlib,json,os,pathlib,re,subprocess,sys,tempfile,time
HERE=pathlib.Path(__file__).resolve().parent
BASE=HERE.parent/'pdf-pagination-mechanism-20261116'
sys.path.insert(0,str(BASE))
sys.path.insert(0,str(BASE/'support'))
import calibrate,pagination_audit
import contract,fixtures
import paper_render

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def verify_assets(package,reference,out):
 out.mkdir(parents=True,exist_ok=True)
 calibrate.unpack(package,'b22943b501b9bfb0202dfb2507b7e7c5fe5aeda7c8fea8b2f0d0534182d5c89a',9812731,out/'package')
 calibrate.unpack(reference,'e52114caa8503b12b792efed4af7ddb0aa3cd0b601a1497c953edf1a396d82b3',8569296,out/'reference')
 deb,=list((out/'package').rglob('*.deb'));assert sha(deb)==calibrate.PACKAGE_SHA
 receipt=json.loads((HERE/'fixtures/source-receipt.json').read_text())
 for case,row in receipt.items():
  original=out/'reference'/case
  assert sha(original/'input.html')==row['originalHtmlSha256']
  assert sha(original/'a4-portrait.pdf')==row['pdfSha256']
  assert (original/'input.html').read_bytes()==(HERE/'fixtures'/(case+'.html')).read_bytes()
  expected=json.loads((original/'expectations.json').read_text())
  assert sha(original/'complex-pagination.md')==expected['sourceSha256']
 (out/'assets.json').write_text(json.dumps({'package':str(deb),'sha256':sha(deb),'referenceRun':43693522845,'originalCases':receipt},indent=2)+'\n')
 return deb

def runtime_verifier(prefix,manifest):
 assert manifest['status']=='private-behavior-runtime-built-not-accepted'
 assert manifest['behaviorPatchSha256']==sha(HERE/'candidate.patch')
 assert pathlib.Path(manifest['prefix']).resolve()==prefix.resolve()
 expected={str((prefix/r['path']).resolve()):r for r in manifest['runtimeFiles']}
 checked={}
 def verify(paths):
  assert len(paths)==2 and any('libwebkit2gtk-4.1.so.'in p for p in paths)and any('libjavascriptcoregtk-4.1.so.'in p for p in paths),'Both exact private libraries required'
  for name in paths:
   p=pathlib.Path(name)
   assert p.resolve().is_relative_to(prefix.resolve()) and str(p.resolve())in expected,'Library outside exact research prefix'
   st=p.stat();identity=(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)
   assert st.st_uid==os.getuid() and not (st.st_mode & 0o022),'Runtime owner/write permissions'
   if str(p)not in checked:
    row=expected[str(p.resolve())];assert st.st_size==row['bytes'] and sha(p)==row['sha256'],'Runtime bytes changed'
    checked[str(p)]=identity
   else:assert checked[str(p)]==identity,'Runtime file changed after first validation'
 return verify,expected


def validate_native(native,dest,verify,expected,prefix):
 capture=json.loads((dest/'process-capture.json').read_text())
 assert capture['status']=='kernel-sender-bound'
 for process in native['processes']:
  verify(process['libraries'])
  for name,identity in process['mappedFiles'].items():
   st=pathlib.Path(name).stat()
   assert identity=={'device':st.st_dev,'inode':st.st_ino,'bytes':st.st_size,'mtimeNs':st.st_mtime_ns,'ctimeNs':st.st_ctime_ns},'Mapped file changed after capture'
 web=[p for p in native['processes']if 'WebKitWebProcess'in p['image']]
 assert web,'Actual WebProcess required'
 assert any(p['pidfdId']==capture['webProcessPidfdId']for p in web),'Log sender must be the mapped WebProcess'
 for process in web:
  image=pathlib.Path(process['image']).resolve();assert str(image)in expected and image.is_relative_to(prefix.resolve())
  assert sha(image)==expected[str(image)]['sha256']
  st=image.stat();assert process['imageFile']=={'device':st.st_dev,'inode':st.st_ino,'bytes':st.st_size,'mtimeNs':st.st_mtime_ns,'ctimeNs':st.st_ctime_ns}
  assert process['noNewPrivs']==1 and process['seccomp']==2,'Actual sandbox status required'


def run(out,prefix,manifest_path):
 assert os.getuid()!=0 and not os.environ.get('WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS')
 assert not os.environ.get('LD_LIBRARY_PATH')and not os.environ.get('LD_PRELOAD')
 report={'status':'running','scope':'Research behavior candidate on exact installed helper; targeted pagination, not release acceptance','harnessSha':os.environ.get('GITHUB_SHA'),'results':[],'productAcceptancePassed':False}
 def persist():(out/'native-diagnostic.json').write_text(json.dumps(report,indent=2)+'\n')
 started=time.monotonic()
 try:
  assets=json.loads((out/'assets.json').read_text());deb=pathlib.Path(assets['package'])
  assert sha(deb)==calibrate.PACKAGE_SHA
  binary=pathlib.Path('/usr/bin/milkup-desktop');assert sha(binary)==calibrate.BINARY_SHA
  guard=calibrate.extract_guard(binary.read_bytes());assert calibrate.sha(guard)==calibrate.GUARD_SHA
  manifest=json.loads(manifest_path.read_text());assert manifest['harnessSha']==os.environ['GITHUB_SHA']
  if os.environ.get('PAGINATION_TAIL')=='true':assert manifest['tailObservation']['patchSha256']==sha(HERE/'tail-observation.patch')
  if os.environ.get('PAGINATION_ROOT_MARGIN')=='true':assert manifest['rootMarginPatchSha256']==sha(HERE/'root-margin.patch')
  verify,expected=runtime_verifier(prefix,manifest);calibrate.verify_private_libraries=verify
  original_proc=calibrate.proc
  def observed_proc(pid):
   row=original_proc(pid)
   if 'WebKitWebProcess'in row['image']:
    status=(pathlib.Path('/proc')/str(pid)/'status').read_text()
    row['noNewPrivs']=int(re.search(r'^NoNewPrivs:\s+(\d+)$',status,re.M)[1]);row['seccomp']=int(re.search(r'^Seccomp:\s+(\d+)$',status,re.M)[1])
   return row
  # prove_chain captures the same identity and birth; default reader is explicitly
  # rebound so the extra status fields reach retained WebProcess evidence.
  calibrate.proc=observed_proc;calibrate.prove_chain.__defaults__=(observed_proc,)
  report.update(packageSha256=calibrate.PACKAGE_SHA,binarySha256=calibrate.BINARY_SHA,guardSha256=calibrate.GUARD_SHA,installedBinary=str(binary),runtimeManifestSha256=sha(manifest_path));persist()
  labelled=out/'labelled';fixtures.generate(labelled)
  from behavior_contract import CASES, adapted_html, assess_pdf, batch_passed
  env=os.environ.copy();env['LD_LIBRARY_PATH']=str(prefix/'lib/x86_64-linux-gnu');env['MILKUP_PAGINATION_PROBE']='1'
  if os.environ.get('PAGINATION_TAIL')=='true':env['MILKUP_PAGINATION_TAIL']='1'
  with tempfile.TemporaryDirectory(prefix='mkpagination-runtime-',dir='/tmp')as runtime:
   env['XDG_RUNTIME_DIR']=runtime
   for key in ['CONFIG','CACHE','DATA','STATE']:
    path=out/('xdg-'+key.lower());path.mkdir(mode=0o700);env['XDG_'+key+'_HOME']=str(path)
   for case,source_case,paper in CASES:
    assert time.monotonic()-started<480,'Native batch budget'
    dest=out/('observed-'+case);reference=out/'reference'/source_case
    native=paper_render.render(binary,guard,adapted_html((labelled/(source_case+'.html')).read_text(),paper),dest,env,paper)
    validate_native(native,dest,verify,expected,prefix)
    for name in ['complex-pagination.md','expectations.json']:(dest/name).write_bytes((reference/name).read_bytes())
    expectation=json.loads((dest/'expectations.json').read_text());expectation['papers']=[paper]
    (dest/'expectations.json').write_text(json.dumps(expectation,indent=2)+'\n')
    pagination_audit.audit(dest)
    current=json.loads((dest/'pagination-audit.json').read_text())
    parsed=contract.parse((dest/'native.log').read_text(),len(current['papers'][0]['pages']))
    tail=None
    if os.environ.get('PAGINATION_TAIL')=='true':
     import tail_contract
     tail=tail_contract.parse((dest/'native.log').read_text(),parsed)
     (dest/'tail-layout.json').write_text(json.dumps(tail,indent=2)+'\n')
    assessment=assess_pdf(current,dest/(paper['name']+'.pdf'))
    # Known text/URI gaps remain explicit. They cannot be replaced by this target gate.
    import fitz
    pdf=fitz.open(dest/(paper['name']+'.pdf'))
    uri=[link.get('uri') for page in pdf for link in page.get_links() if link.get('uri')]
    row={'case':case,'sourceCase':source_case,'paper':paper,'native':native,**assessment,'tail':tail,
         'records':len(parsed['rows']),'observations':contract.observations(parsed),
         'pdfSha256':sha(dest/(paper['name']+'.pdf')),'mappingDiagnostics':current['papers'][0]['mappingDiagnostics'],
         'uriTargets':uri,'expectedDiagnosticUri':'https://example.invalid/pagination',
         'uriDiagnosticPassed':'https://example.invalid/pagination' in uri,
         'productAcceptancePassed':False}
    report['results'].append(row);persist()
   if os.environ.get('PAGINATION_ROOT_MARGIN')=='true':
    import root_margin_controls
    def save_controls(rows):report['rootMarginControls']=rows;persist()
    root_margin_controls.run(out,labelled,binary,guard,env,lambda n,d:validate_native(n,d,verify,expected,prefix),save_controls)
  controls=report.get('rootMarginControls',[])
  controls_ok=os.environ.get('PAGINATION_ROOT_MARGIN')!='true' or (len(controls)==2 and all(r['passed']for r in controls))
  report['status']='targeted-pagination-passed-not-product-acceptance' if batch_passed(report['results'],CASES) and controls_ok else 'failed-original-pagination-contract'
 except Exception as error:report.update(status='failed',error=repr(error))
 finally:report['seconds']=round(time.monotonic()-started,3);persist()
 print(json.dumps({k:v for k,v in report.items()if k not in ['results','rootMarginControls']},indent=2))
 return report['status']=='targeted-pagination-passed-not-product-acceptance'

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['assets','run']);p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--package',type=pathlib.Path);p.add_argument('--reference',type=pathlib.Path);p.add_argument('--prefix',type=pathlib.Path);p.add_argument('--manifest',type=pathlib.Path);a=p.parse_args()
 if a.mode=='assets':raise AssertionError('Use original exact asset verifier')
 else:raise SystemExit(0 if run(a.output,a.prefix,a.manifest)else 1)

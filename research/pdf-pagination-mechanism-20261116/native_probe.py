#!/usr/bin/env python3
"""Exact packaged output helper + original guard + private observation WebKit.
Diagnostic completion preserves the original PDF failures; never product acceptance.
"""
import argparse,hashlib,json,os,pathlib,re,subprocess,sys,tempfile,time
HERE=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'support'))
import calibrate,pagination_audit
import contract,fixtures

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
 assert manifest['status']=='private-observation-runtime-built-not-accepted'
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

def compare_diagnostic_pdf(case,current,reference,parsed):
 paper=current['papers'][0];prior=reference['papers'][0]
 errors=calibrate.compare_reference(paper['pages'],prior['pages'])
 assert not errors,('Original PDF coordinates changed',errors)
 assert current['errors']==reference['errors'],'Original content/orphan/clipping failures changed'
 expected_errors=['a4-portrait: T: orphan heading']if case=='baseline-baseline'else[]
 assert current['errors']==expected_errors,'Original failure/control not reproduced'
 def page_for(label):
  pages=[i for i,p in enumerate(paper['pages'],1)for w in p['words']if w['text']==label]
  assert len(pages)==1,('Independent PDF label',label,pages)
  return pages[0]
 observed=contract.observations(parsed)
 for role,label in [(1,'TABLESECTION'),(4,'TABLELEFT'),(5,'TABLERIGHT'),(6,'TAA')]:
  assert observed['finalVisibleBoxPages'][role]==[page_for(label)],('Final layout/PDF page mismatch',label)
 return observed

def run(out,prefix,manifest_path):
 assert os.getuid()!=0 and not os.environ.get('WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS')
 assert not os.environ.get('LD_LIBRARY_PATH')and not os.environ.get('LD_PRELOAD')
 report={'status':'running','scope':'Original installed helper and guard with isolated observation-only WebKit; diagnostic only','harnessSha':os.environ.get('GITHUB_SHA'),'results':[],'productAcceptancePassed':False}
 def persist():(out/'native-diagnostic.json').write_text(json.dumps(report,indent=2)+'\n')
 started=time.monotonic()
 try:
  assets=json.loads((out/'assets.json').read_text());deb=pathlib.Path(assets['package'])
  assert sha(deb)==calibrate.PACKAGE_SHA
  binary=pathlib.Path('/usr/bin/milkup-desktop');assert sha(binary)==calibrate.BINARY_SHA
  guard=calibrate.extract_guard(binary.read_bytes());assert calibrate.sha(guard)==calibrate.GUARD_SHA
  manifest=json.loads(manifest_path.read_text());assert manifest['harnessSha']==os.environ['GITHUB_SHA']
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
  env=os.environ.copy();env['LD_LIBRARY_PATH']=str(prefix/'lib/x86_64-linux-gnu');env['MILKUP_PAGINATION_PROBE']='1'
  with tempfile.TemporaryDirectory(prefix='mkpagination-runtime-',dir='/tmp')as runtime:
   env['XDG_RUNTIME_DIR']=runtime
   for key in ['CONFIG','CACHE','DATA','STATE']:
    path=out/('xdg-'+key.lower());path.mkdir(mode=0o700);env['XDG_'+key+'_HOME']=str(path)
   for case in ['baseline-baseline','baseline-short-edge','baseline-long-room','baseline-short-room']:
    assert time.monotonic()-started<480,'Native batch budget'
    dest=out/('observed-'+case);reference=out/'reference'/case
    native=calibrate.render(binary,guard,(labelled/(case+'.html')).read_text(),dest,env)
    web=[p for p in native['processes']if 'WebKitWebProcess'in p['image']]
    assert web,'Actual WebProcess required'
    for process in web:
     image=pathlib.Path(process['image']).resolve();assert str(image)in expected and image.is_relative_to(prefix.resolve())
     assert sha(image)==expected[str(image)]['sha256']
     assert process['noNewPrivs']==1 and process['seccomp']==2,'Actual sandbox status required'
    for name in ['complex-pagination.md','expectations.json']:(dest/name).write_bytes((reference/name).read_bytes())
    pagination_audit.audit(dest)
    current=json.loads((dest/'pagination-audit.json').read_text());prior=json.loads((reference/'pagination-audit.json').read_text())
    parsed=contract.parse((dest/'native.log').read_text(),len(current['papers'][0]['pages']))
    observed=compare_diagnostic_pdf(case,current,prior,parsed)
    header=calibrate.header_contract(current['papers'][0],dest/'a4-portrait.pdf')
    previous=json.loads((out/'reference/calibration-result.json').read_text())
    previous=next(r for r in previous['results']if r['name']==case)
    assert header['errors']==previous['headers']['errors'],'Original header semantics changed'
    row={'case':case,'native':native,'originalErrorsRetained':current['errors'],'originalHeaderErrorsRetained':header['errors'],'records':len(parsed['rows']),'observations':observed,'pdfSha256':sha(dest/'a4-portrait.pdf'),'coordinateComparison':'Original ordered text boxes, original 0.5 PDF-point threshold','wordCount':sum(len(p['words'])for p in current['papers'][0]['pages'])}
    if case=='baseline-baseline':assert row['wordCount']==693,'Original 693-word baseline'
    report['results'].append(row);persist()
  report['status']='diagnostic-complete-original-product-failure-retained'
 except Exception as error:report.update(status='failed',error=repr(error))
 finally:report['seconds']=round(time.monotonic()-started,3);persist()
 print(json.dumps({k:v for k,v in report.items()if k!='results'},indent=2))
 return report['status']=='diagnostic-complete-original-product-failure-retained'

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['assets','run']);p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--package',type=pathlib.Path);p.add_argument('--reference',type=pathlib.Path);p.add_argument('--prefix',type=pathlib.Path);p.add_argument('--manifest',type=pathlib.Path);a=p.parse_args()
 if a.mode=='assets':verify_assets(a.package,a.reference,a.output)
 else:raise SystemExit(0 if run(a.output,a.prefix,a.manifest)else 1)

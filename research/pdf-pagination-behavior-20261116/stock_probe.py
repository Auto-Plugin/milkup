#!/usr/bin/env python3
"""One no-build stock control: exact installed helper/guard and real paper settings.
Independent cases retain their failures; no result is PDF release acceptance.
"""
import argparse,hashlib,json,os,pathlib,sys,tempfile,time
HERE=pathlib.Path(__file__).resolve().parent
BASE=HERE.parent/'pdf-pagination-mechanism-20261116'
sys.path[:0]=[str(BASE),str(BASE/'support')]
import calibrate,pagination_audit,fixtures
from behavior_contract import PAPERS,adapted_html
import stock_render

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def exact_coordinates(current,reference):
 assert len(current)==len(reference),'Stock A4 reference page count'
 count=0
 for a,b in zip(current,reference):
  assert a['width']==b['width'] and a['height']==b['height'],'Stock A4 reference dimensions'
  assert a['words']==b['words'],'Stock A4 exact text/order/four coordinates changed'
  count+=len(a['words'])
 assert count==693,('Stock A4 original word count',count)
 return {'pages':len(current),'words':count,'coordinateDifference':0}

def inspect_tail(path):
 import fitz
 with fitz.open(path) as pdf:
  pages=[]
  for n,page in enumerate(pdf):
   row={'page':n+1,'box':list(page.rect),'words':len(page.get_text('words')),'images':len(page.get_images()),'drawings':len(page.get_drawings())}
   if n==len(pdf)-1 or not row['words']:
    streams=[pdf.xref_stream(x) for x in page.get_contents()]
    assert sum(map(len,streams))<2*1024*1024,'Bounded page content streams'
    row['streams']=[s.decode('latin1')for s in streams]
    row['drawingRects']=[{'rect':list(d['rect']),'fill':d['fill'],'type':d['type']}for d in page.get_drawings()]
    pix=page.get_pixmap(matrix=fitz.Matrix(1,1),colorspace=fitz.csRGB,alpha=False)
    samples=pix.samples
    row['nonWhitePixels']=sum(any(v<245 for v in samples[i:i+3])for i in range(0,len(samples),3))
   pages.append(row)
  return pages

def run(out):
 assert os.getuid()!=0 and not os.environ.get('WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS')
 assert not any(os.environ.get(k)for k in ['LD_LIBRARY_PATH','LD_PRELOAD','MILKUP_PAGINATION_PROBE'])
 started=time.monotonic();report={'status':'running','harnessSha':os.environ.get('GITHUB_SHA'),'results':[],
  'scope':'Stock controls only; exact packaged native output; no private runtime or engine rebuild',
  'productAcceptancePassed':False,'diagnosticComplete':False}
 def persist():(out/'stock-controls.json').write_text(json.dumps(report,indent=2)+'\n')
 checked={}
 def verify_file(name):
  p=pathlib.Path(name);real=p.resolve(strict=True);assert real.is_relative_to('/usr/lib'),'Stock runtime outside /usr/lib'
  st=real.stat();assert st.st_uid==0 and not st.st_mode&0o022,'Official runtime ownership/write permissions'
  identity={'device':st.st_dev,'inode':st.st_ino,'bytes':st.st_size,'mtimeNs':st.st_mtime_ns,'ctimeNs':st.st_ctime_ns}
  if str(real)not in checked:checked[str(real)]={'identity':identity,'sha256':sha(real)}
  else:assert checked[str(real)]['identity']==identity,'Stock runtime changed'
  return identity
 try:
  assets=json.loads((out/'assets.json').read_text());assert sha(pathlib.Path(assets['package']))==calibrate.PACKAGE_SHA
  binary=pathlib.Path('/usr/bin/milkup-desktop');assert sha(binary)==calibrate.BINARY_SHA
  guard=calibrate.extract_guard(binary.read_bytes());assert calibrate.sha(guard)==calibrate.GUARD_SHA
  report.update(packageSha256=calibrate.PACKAGE_SHA,binarySha256=calibrate.BINARY_SHA,guardSha256=calibrate.GUARD_SHA);persist()
  labelled=out/'labelled';fixtures.generate(labelled)
  source='baseline-baseline';reference=out/'reference'/source
  original=json.loads((reference/'pagination-audit.json').read_text())['papers'][0]['pages']
  with tempfile.TemporaryDirectory(prefix='mk-stock-paper-',dir='/tmp')as runtime:
   env=os.environ.copy();env['XDG_RUNTIME_DIR']=runtime
   for key in ['CONFIG','CACHE','DATA','STATE']:
    path=out/('xdg-'+key.lower());path.mkdir(mode=0o700);env['XDG_'+key+'_HOME']=str(path)
   for paper in [PAPERS[0],PAPERS[2],PAPERS[3]]:
    assert time.monotonic()-started<400,'Stock batch budget'
    row={'case':paper['name'],'paper':paper,'status':'running','paginationPassed':False};report['results'].append(row);persist()
    dest=out/('stock-'+paper['name']);safe=False
    try:
     native=stock_render.render(binary,guard,adapted_html((labelled/(source+'.html')).read_text(),paper),dest,env,paper)
     capture=json.loads((dest/'process-capture.json').read_text())
     assert capture['status']=='live-stock-webprocess-bound' and not capture['records']
     for process in native['processes']:
      for name,identity in process['mappedFiles'].items():assert verify_file(name)==identity
     web=[p for p in native['processes']if pathlib.Path(p['image']).name=='WebKitWebProcess'];assert len(web)==1
     assert web[0]['pidfdId']==capture['webProcessPidfdId']
     assert verify_file(web[0]['image'])==web[0]['imageFile']
     assert native['guardianExit']==0 and native['privateRemoved']
     safe=True;row.update(native=native,processIdentityPassed=True)
     for name in ['complex-pagination.md','expectations.json']:(dest/name).write_bytes((reference/name).read_bytes())
     expected=json.loads((dest/'expectations.json').read_text());expected['papers']=[paper]
     (dest/'expectations.json').write_text(json.dumps(expected,indent=2)+'\n')
     pagination_audit.audit(dest);current=json.loads((dest/'pagination-audit.json').read_text())
     pdf=dest/(paper['name']+'.pdf');headers=calibrate.header_contract(current['papers'][0],pdf)
     row.update(headers=headers,contentErrors=current['errors'],pdfSha256=sha(pdf),pages=inspect_tail(pdf),mappingDiagnostics=current['papers'][0]['mappingDiagnostics'])
     if paper['name']=='a4-portrait':row['originalA4Calibration']=exact_coordinates(current['papers'][0]['pages'],original)
     row['paginationPassed']=not current['errors'] and not headers['errors']
     row['status']='passed' if row['paginationPassed'] else 'product-contract-failed'
    except Exception as error:
     row.update(status='diagnostic-failed',error=repr(error))
     # A failed identity/cleanup is not silently bypassed to run another process.
     if not safe:raise
    finally:report['runtimeFiles']=checked;persist()
    if paper['name']=='a4-portrait' and 'originalA4Calibration'not in row:raise AssertionError('Stock A4 calibration failed; further paper comparison withheld')
  report['diagnosticComplete']=len(report['results'])==3 and all(r['status']in ['passed','product-contract-failed']for r in report['results'])
  report['status']='passed-target-only' if all(r['paginationPassed']for r in report['results'])else 'failed-original-pagination-contract'
 except Exception as error:report.update(status='diagnostic-failed',error=repr(error))
 finally:report['seconds']=round(time.monotonic()-started,3);persist()
 print(json.dumps({k:v for k,v in report.items()if k not in ['results','runtimeFiles']},indent=2))
 return report['status']=='passed-target-only'
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();raise SystemExit(0 if run(a.output)else 1)

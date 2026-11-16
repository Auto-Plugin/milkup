#!/usr/bin/env python3
"""Apply after the exact base cache is restored; compile changed real TUs only."""
import hashlib,importlib.util,json,os,pathlib,subprocess,sys,time
HERE=pathlib.Path(__file__).resolve().parent;REPO=HERE.parents[1]
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'milkup-webkit-research';e=root/'evidence';source=root/'source';build=root/'build'
sys.path.insert(0,str(HERE));import prepare
report={'status':'running','harnessSha':os.environ['GITHUB_SHA'],'scope':'Behavior candidate actual TUs only, no runtime/PDF acceptance'}
def persist():(e/'pagination-behavior-preflight.json').write_text(json.dumps(report,indent=2)+'\n')
try:
 assert os.getuid()!=0 and os.environ.get('PAGINATION_BEHAVIOR')=='true'
 assert os.environ.get('PAGINATION_RESTORE_RUN')=='43808221193','Only the exact successful observation-object bundle is approved'
 transfer=json.loads((e/'pagination-cache-roundtrip.json').read_text());assert transfer['status']=='passed'
 assert transfer['incomingRun']=='43808221193'
 # Verify behavior patch against pristine source in a bounded temporary overlay;
 # the real source already carries the exact observation patch.
 import tempfile,shutil
 with tempfile.TemporaryDirectory(prefix='behavior-source-',dir=root) as tmp:
  overlay=pathlib.Path(tmp)
  for rel in json.loads((HERE/'source-lock.json').read_text()):
   p=overlay/'Source/WebCore'/rel;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/'Source/WebCore'/rel,p)
  # Restore only files that were modified by the observation-only patch.
  observation=(e/'pagination-observation.patch').read_text()
  for rel,h in json.loads((HERE/'source-lock.json').read_text()).items():
   original=subprocess.run(['git','apply','--reverse','--include=Source/WebCore/'+rel,str(e/'pagination-observation.patch')],cwd=overlay,capture_output=True,text=True)
   assert original.returncode==0,original.stderr
  generated=overlay/'candidate.patch';receipt=prepare.build(overlay,generated)
  assert generated.read_bytes()==(HERE/'candidate.patch').read_bytes()
 report['patchSha256']=receipt['patchSha256'];report['baseCacheIdentity']=transfer['identity'];persist()
 subprocess.run(['git','apply','--check',str(HERE/'candidate.patch')],cwd=source,check=True,timeout=20)
 subprocess.run(['git','apply',str(HERE/'candidate.patch')],cwd=source,check=True,timeout=20)
 spec=importlib.util.spec_from_file_location('actual_tu',REPO/'scripts/ci/webkit-pagination-object-preflight.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 m.SOURCES=['Source/WebCore/rendering/RenderBlockFlow.cpp','Source/WebCore/rendering/RenderTable.cpp','Source/WebCore/rendering/RenderTableSection.cpp']
 gate=m.run(source,build,e/'pagination-behavior-object-gate')
 assert gate['status']=='passed',gate
 report.update(status='passed',gate=gate,modifiedSourceHashes={rel:hashlib.sha256((source/'Source/WebCore'/rel).read_bytes()).hexdigest() for rel in receipt['modified']})
except Exception as error:report.update(status='failed',error=repr(error))
finally:persist()
raise SystemExit(0 if report['status']=='passed'else 1)

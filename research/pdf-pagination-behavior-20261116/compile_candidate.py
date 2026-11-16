#!/usr/bin/env python3
"""Apply after the exact base cache is restored; compile changed real TUs only."""
import hashlib,importlib.util,json,os,pathlib,subprocess,sys,time
HERE=pathlib.Path(__file__).resolve().parent;REPO=HERE.parents[1]
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'milkup-webkit-research';e=root/'evidence';source=root/'source';build=root/'build'
sys.path.insert(0,str(HERE));import prepare,candidate_gate
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
 m.SOURCES=candidate_gate.sources(tail=os.environ.get('PAGINATION_TAIL')=='true',combined=os.environ.get('PAGINATION_COMBINED')=='true')
 tail_sources={}
 if os.environ.get('PAGINATION_TAIL')=='true':
  import prepare_tail
  tail=prepare_tail.build(source,e/'pagination-tail.patch',write=True)
  assert tail['patchSha256']==hashlib.sha256((HERE/'tail-observation.patch').read_bytes()).hexdigest()
  report['tailObservation']=tail;tail_sources=tail['sources'];persist()
 if os.environ.get('PAGINATION_ROOT_MARGIN')=='true':
  assert os.environ.get('PAGINATION_TAIL')=='true'
  import prepare_root_margin
  correction=prepare_root_margin.build(source,e/'pagination-root-margin.patch',write=True)
  assert correction['patchSha256']==hashlib.sha256((HERE/'root-margin.patch').read_bytes()).hexdigest()
  report['rootMarginCorrection']=correction;tail_sources.update(correction['sources']);persist()
 combined=os.environ.get('PAGINATION_COMBINED')=='true'
 if combined:
  assert os.environ.get('PAGINATION_ROOT_MARGIN')=='true'
  combined_dir=HERE.parent/'pdf-combined-20261116'
  spec=importlib.util.spec_from_file_location('combined_prepare',combined_dir/'prepare.py');composer=importlib.util.module_from_spec(spec);spec.loader.exec_module(composer)
  receipt_combined=composer.build(source,e/'pagination-combined.patch',write=True)
  assert receipt_combined['patchSha256']==hashlib.sha256((combined_dir/'combined.patch').read_bytes()).hexdigest()
  report['combined']=receipt_combined
  tail_sources.update({rel.removeprefix('Source/WebCore/'):h for rel,h in receipt_combined['outputs'].items()})
  persist()
 gate=m.run(source,build,e/'pagination-behavior-object-gate',max_objects=13 if combined else 4)
 assert gate['status']=='passed',gate
 if combined:
  cache=composer.module('combined_cache',combined_dir/'cache_gate.py')
  report['combinedCache']=cache.run(m,source,build,e/'combined-graphics-cache',gate)
 report.update(status='passed',gate=gate,modifiedSourceHashes={rel:hashlib.sha256((source/'Source/WebCore'/rel).read_bytes()).hexdigest() for rel in set(receipt['modified'])|set(tail_sources)})
 report['continuationGate']=candidate_gate.validate(report,tail=os.environ.get('PAGINATION_TAIL')=='true',combined=combined)
except Exception as error:report.update(status='failed',error=repr(error))
finally:persist()
raise SystemExit(0 if report['status']=='passed'else 1)

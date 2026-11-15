"""Inherit only the accepted TU baseline for one bounded, research-only delta."""
import argparse,json,pathlib,os
BASE='835fece0c1ebeb02d50de8f0fc23a7a4b1f3b862'
FILES={'.github/workflows/linux-webkit-build-research.yml','scripts/ci/build-webkit-private.py','scripts/ci/run-webkit-link-probe.py','scripts/ci/webkit-paint-inheritance.py','scripts/ci/webkit-paint-inheritance-test.py'}
FILES.update('research/linux-pdf-links-20261114/'+n for n in ['unique-per-call.inc','paint-probe-header.inc','prepare_paint_probe.py','paint_contract.py','test_paint_contract.py','result-43661203007.md','geometry-comparison-43661203007.json','paint-probe-plan-20261115.md'])
DIGIT_FILES={'scripts/ci/webkit-digit-object-preflight.py'}
DIGIT_FILES.update('research/linux-pdf-unicode-20261114/'+n for n in ['prepare_digit_probe.py','independent-digit-text.inc','digit-trace.inc','test_digit_probe.py','digit_pdf_contract.py','test_digit_contract.py','digit-plan-20261115.md','digit-local-result-20261115.json'])
DIGIT_FILES.update('research/linux-pdf-links-20261114/'+n for n in ['result-43668937059.md','paint-offline-43668937059.json'])
def verify(compare,run,report,gate,sha,digits=False):
 allowed=FILES|DIGIT_FILES if digits else FILES
 assert run['id']==43660565818 and run['head_sha']==BASE and run['status']=='completed'and run['conclusion']=='success'and run['event']=='workflow_dispatch'
 assert run['path']=='.github/workflows/linux-webkit-build-research.yml'
 assert report['harnessSha']==BASE and report['status']=='preflight-passed-not-engine-built'and report['fullEngineBuildAttempted']is False
 assert report['preflight']['geometryActualObjects']=='passed'and gate['status']=='passed'and gate['sourceRestored']is True
 assert compare['base_commit']['sha']==BASE and compare['status']=='ahead'
 assert 0<len(compare['commits'])==compare['total_commits']<=20 and compare['commits'][-1]['sha']==sha
 files=compare['files'];assert 0<len(files)<len(allowed)+1
 for f in files:
  assert f['filename']in allowed and f['status']in ['modified','added'],'Non-diagnostic source delta'
  assert 'previous_filename'not in f
 return {'status':'passed','inheritedRun':43660565818,'inheritedSha':BASE,'candidateSha':sha,'changedFiles':[f['filename']for f in files],'requiresNewDigitTUGate':digits,'scope':'Only original geometry TU gate inherited; digit delta requires a new exact FontCascade TU gate before bounded continuation; no application inputs changed' if digits else 'Original TU gate inherited, new research paint instrumentation compiled once by bounded native continuation; no application inputs changed'}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('root',type=pathlib.Path);p.add_argument('sha');a=p.parse_args();r=a.root
 result=verify(json.loads((r/'paint-compare.json').read_text()),json.loads((r/'prior-preflight-run.json').read_text()),json.loads((r/'prior-preflight/build-result.json').read_text()),json.loads((r/'prior-preflight/geometry-object-gate/result.json').read_text()),a.sha,os.environ.get('MILKUP_WEBKIT_DIGITS')=='true')
 (r/'paint-inherited-gate.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

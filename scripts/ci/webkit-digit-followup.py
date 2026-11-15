#!/usr/bin/env python3
"""Reuse exact successful sub-gates, never relabel a failed native run as passed."""
import argparse, json, pathlib
BASE='7b589d0d1d3127bd11bf8c20dae3d0a7bb3f9f2d'
RUN=43670757867
FILES={'.github/workflows/linux-webkit-build-research.yml','scripts/ci/build-webkit-private.py','scripts/ci/run-webkit-link-probe.py','scripts/ci/webkit-digit-followup.py','scripts/ci/webkit-digit-followup-test.py'}
FILES.update('research/linux-pdf-unicode-20261114/'+n for n in ['digit_pdf_contract.py','test_digit_contract.py','audit_digit_existing.py','digit-offline-43670757867.json','result-43670757867.md','digit_fixture_preflight.py','digit-fixture-preflight-20261115.json','upstream-review-draft.md'])

def verify(compare, run, build, gate, native, digit, sha):
    assert run['id']==RUN and run['head_sha']==BASE and run['event']=='workflow_dispatch'
    assert run['status']=='completed' and run['conclusion']=='failure'
    assert run['path']=='.github/workflows/linux-webkit-build-research.yml'
    assert build['harnessSha']==BASE and build['status']=='private-runtime-built-not-accepted'
    assert build['preflight']['digitActualObject']=='passed' and build['compileExitCode']==0 and build['resourceStopReason'] is None
    assert gate['status']=='passed' and gate['sourceUnchanged'] is True
    assert gate['sourceSha256']=='49e8541ecc4890f22c9a6e5ff49dac106b999c01ac6565361f8fd384937adf70'
    assert gate['objectSha256']=='93ecc87125c7373c334bc28238decd206cb1102a4d7e3953f69cb1a3673aead6'
    assert build['digitPatchSha256']=='fe7952f48491b1b3a75759789795831c9f3638aff1768cbf1fd48a4f784a20a3'
    assert native['status']=='failed' and native['harnessSha']==BASE and native['privateRuntimeFinalCheck']['status']=='passed'
    assert len(native['runs'])==6 and all(r['exitCode']==0 and r['webProcesses'] for r in native['runs'])
    assert digit['status']=='failed' and digit['errors']==['digits: Baseline digit defect was not reproduced']
    assert set(digit['sourceText']['checks'])=={'links','no-links'}
    assert set(digit['geometry'])=={'paint-candidate-links','paint-candidate-no-links'}
    assert len(digit['geometry'])==2 and all(r['status']=='passed' for r in digit['geometry'].values())
    for checks in digit['sourceText']['checks'].values():
        for k in ['pages','pageMarkers','chineseTwice','intentionalRadicalsTwice','uriPageSet','allLinkTokensExactlyOnce']: assert checks[k]
    assert compare['base_commit']['sha']==BASE and compare['status']=='ahead'
    assert 0<len(compare['commits'])==compare['total_commits']<=10 and compare['commits'][-1]['sha']==sha
    assert 0<len(compare['files'])<=len(FILES)
    for row in compare['files']:
        assert row['filename'] in FILES and row['status'] in ['modified','added'] and 'previous_filename' not in row, 'Engine/product input changed'
    return {'status':'passed','inheritedRun':RUN,'inheritedSha':BASE,'candidateSha':sha,'originalOverallStatus':'failure','requiresNewDigitTUGate':False,'scope':'Exact successful TU/build sub-gates only; native Noto A/B remains to be run','changedFiles':[r['filename'] for r in compare['files']]}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=pathlib.Path);p.add_argument('sha');a=p.parse_args()
    root=a.root;prior=root/'prior-digit';load=lambda p:json.loads(p.read_text())
    result=verify(load(root/'digit-compare.json'),load(root/'prior-digit-run.json'),load(prior/'build-result.json'),load(prior/'digit-object-gate/result.json'),load(prior/'links-patched/native-result.json'),load(prior/'links-patched/digit-result.json'),a.sha)
    (root/'paint-inherited-gate.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

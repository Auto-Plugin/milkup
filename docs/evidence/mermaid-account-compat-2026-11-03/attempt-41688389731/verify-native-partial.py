#!/usr/bin/env python3
"""Offline partial native facts only; never changes the original run outcome."""
import hashlib
import importlib.util
import json
import sys
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True
root = Path(__file__).resolve().parent
verifier_path = root / 'verify-account-product-artifact-c377-windows-checkout.py'
spec = importlib.util.spec_from_file_location('strict_offline_verifier', verifier_path)
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
v.HARNESS = root / 'candidate-mermaid-product-e2e.mjs'
integrity_bytes = (root / 'verification.json').read_bytes()
integrity = v.parse_json(integrity_bytes)
v.require(integrity['evidenceVerified'] is True, 'Previously verified ZIP integrity required')
raw = v.read_input(root / 'artifact.zip', v.TOTAL_LIMIT + v.MIB)
v.require(v.sha256(raw) == integrity['zip']['sha256'], 'Actual archive changed after strict verification')
result = {'schema': 1, 'scope': 'Independent partial native ledger and actual decoded PNG binding only',
          'workflowRunId': v.RUN_ID, 'candidateSha': v.CANDIDATE,
          'archiveSha256': v.sha256(raw), 'strictVerificationSha256': v.sha256(integrity_bytes),
          'verifierSha256': v.sha256(verifier_path.read_bytes()),
          'pureValidatorHarnessSha256': v.HARNESS_SHA, 'pureValidatorHarnessFile': str(v.HARNESS),
          'productAcceptancePassed': False, 'originalFailedOutcomePreserved': True,
          'networkAccessed': False, 'archiveExtracted': False, 'inputsModified': False,
          'accounts': {}, 'errors': []}
with zipfile.ZipFile(root / 'artifact.zip') as archive:
    for account in v.ACCOUNTS:
        row = {'passed': False, 'errors': []}
        result['accounts'][account] = row
        try:
            original = integrity['accounts'][account]
            v.require(original['verified'] is True, 'Account retained evidence integrity required')
            files = {entry['name']: archive.read(account+'/'+entry['name']) for entry in original['files']}
            for entry in original['files']:
                data=files[entry['name']]
                v.require(len(data)==entry['bytes'] and v.sha256(data)==entry['sha256'], 'Archive file changed: '+entry['name'])
            report=v.parse_json(files['mermaid-product-e2e.json'])
            outer=v.parse_json(files['windows-standard-product-audit.json'])
            context=v.parse_json(files['standard-context.json'])
            sid=outer['accountSid'];session=context['sessionId']
            v.require(context['actualSid']==sid==context['expectedSid'], 'Exact recorded account SID required')
            v.require(type(session) is int and session>0 and session==context['expectedSessionId'], 'Exact recorded session required')
            v.require(report['expectedAccountKind']==outer['expectedAccountKind']==account, 'Account class mismatch')
            v.require(report['candidateSha']==v.CANDIDATE and outer['source']==v.CANDIDATE, 'Candidate mismatch')
            pids=[launch['productPid'] for launch in report['launches']]
            v.require(len(pids)==4 and len(set(pids))==4, 'Four directly observed product PIDs required')
            records=v.read_native_records(files)
            v.require(v._outer_equal(records,report['nativeAudit']), 'Original logs and report native events differ')
            decoded={image['name']:image for image in original['images']}
            matches=[];image_rows=[];screenshots=[]
            for step in report['steps']:
                for kind in ('image','screenshot'):
                    image=step.get(kind)
                    if image is None: continue
                    actual=decoded[image['file']]
                    for key in ('bytes','sha256','width','height','pixelSha256'):
                        v.require(image[key]==actual[key], 'Decoded '+kind+' differs in '+key)
                    v.require(actual['fullyDecoded'] is True and actual['nonuniform'] is True, 'Actual full nonuniform PNG decode required')
                    if kind=='screenshot':
                        screenshots.append({'step':step['name'],'file':image['file'],'sha256':actual['sha256'],'pixelSha256':actual['pixelSha256']})
                        continue
                    launch=next(item for item in report['launches'] if item['fixture']==step['fixture'])
                    native=image['native']
                    v.require(native['productPid']==launch['productPid'] and native['pngSha256']==actual['sha256'], 'DOM PNG native binding differs')
                    matches.append({'productPid':launch['productPid'],'requestId':native['requestId'],'bytes':actual['bytes'],'sha256':actual['sha256']})
                    image_rows.append({'step':step['name'],'file':image['file'],**matches[-1], 'width':actual['width'],'height':actual['height'],'pixelSha256':actual['pixelSha256']})
            v.require(len(matches)==7 and len(screenshots)==10, 'Expected seven PNG renders and ten step screenshots')
            replay=v.run_node({'mode':'ledger','sid':sid,'sessionId':session,'account':account,
                               'productPids':pids,'records':records,'pngMatches':matches})
            finished=[e for e in records if e['phase']=='finished']
            started=[e for e in records if e['phase']=='started']
            linked={}
            for role in ('child','browser','helperSelf','browserFromHelper'):
                tokens=[event[role+'TokenEvidence'] for event in started]
                linked[role]={'observedStartedProofs':len(tokens),'elevationTypes':sorted({token['elevationType'] for token in tokens}),
                              'linkedTargetTypes':sorted({token['linkedAuthority']['targetTokenType'] for token in tokens},key=lambda x: -1 if x is None else x),
                              'linkedTargetLevels':sorted({token['linkedAuthority']['targetImpersonationLevel'] for token in tokens},key=lambda x: -1 if x is None else x)}
            row.update(passed=True,originalReportStatus=report['status'],originalOuterStatus=outer['status'],
                       sid=sid,sessionId=session,nativeEvents=len(records),nativeJobs=replay['jobs'],
                       startedJobs=len(started),successfulJobs=sum(e['successful'] for e in finished),
                       cancelledJobs=sum(e['cancelled'] for e in finished),deadlineExpiredJobs=sum(e['deadlineExpired'] for e in finished),
                       parentOnlyCancelledJobs=sum(e['cancelled'] and not e['helperNativeProofVerified'] and e['browserSid'] is not None for e in finished),
                       fourNativeProofs=linked,innerCleanupVerifiedForEveryJob=True,
                       jobOutcomes=[{**{key:e.get(key) for key in ('requestId','productPid','successful','cancelled','deadlineExpired','ownedJobCreated','profileCreated','helperNativeProofVerified','jobActiveAfterStop','ipcThreadsCompleted','profileDeleted','privateTreeRemoved','cleanupUncertain','rendererErrorKind')},'started':any(s['productPid']==e['productPid'] and s['requestId']==e['requestId'] for s in started),'parentChildObserved':e.get('childTokenEvidence') is not None,'parentBrowserObserved':e.get('browserTokenEvidence') is not None} for e in finished],pngMatches=image_rows,stepScreenshots=screenshots,
                       stepsPassed=sum(s['passed'] is True for s in report['steps']),
                       originalLaunchOutcomes=[{k:launch.get(k) for k in ('fixture','productPid','exitCode','signal','closedByUi')} for launch in report['launches']])
        except Exception as error:
            row['errors'].append(str(error))
            if hasattr(error,'details'):row['underlyingReplayError']=error.details
            result['errors'].append(account+': '+str(error))
result['allPartialNativeFactsVerified']=not result['errors'] and all(row['passed'] for row in result['accounts'].values())
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(0 if result['allPartialNativeFactsVerified'] else 1)

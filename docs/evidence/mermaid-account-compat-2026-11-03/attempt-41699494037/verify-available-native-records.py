#!/usr/bin/env python3
"""Inspect retained native jobs even when the full product matrix stopped early.
Never changes the strict/full-matrix result or treats captured bytes as acceptance.
"""
import importlib.util
import json
import subprocess
import sys
import zipfile
from pathlib import Path
sys.dont_write_bytecode = True
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('frozen_verifier',root/'verify-account-product-artifact-b2415e9e.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
verification_bytes=(root/'verification.json').read_bytes()
integrity=v.parse_json(verification_bytes)
v.require(integrity['evidenceVerified'] is True,'Strict retained evidence integrity required')
v.require(v.sha256((root/'artifact.zip').read_bytes())==integrity['zip']['sha256'],'Archive changed since strict verification')
v.require(v.sha256(v.HARNESS.read_bytes())==v.HARNESS_SHA,'Exact frozen candidate import required')
node=r'''
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {AuditLedger}=await import(pathToFileURL(process.argv[2]).href);
const p=JSON.parse(readFileSync(0,'utf8'));
const ledger=new AuditLedger(p.sid,p.sessionId,p.account), errors=[], jobs=[], matches=[];
for(const event of p.records){assert(p.productPids.includes(event.productPid));ledger.accept(event,event.productPid)}
for(const job of ledger.jobs.values()){
 const row={productPid:job.productPid,requestId:job.requestId,admitted:!!job.admitted,started:!!job.started,
  finished:!!job.finished,startedFourProofsVerified:false,finishedFourProofsVerified:false,
  fullNativeCompletionAccepted:false,errors:[]};
 if(job.started){ledger.verifyOwnership(job.started);row.startedFourProofsVerified=true}
 if(job.started&&job.finished){ledger.verifyOwnership(job.finished);row.finishedFourProofsVerified=true}
 if(job.finished){for(const key of ['successful','cancelled','deadlineExpired','rendererStatus','rendererErrorKind',
  'capturedPngBytes','pngBytes','pngSha256','cleanupUncertain','cleanupFailureKinds','privateTreeRemoved',
  'profileCreated','profileDeleted','ownedJobCreated','jobActiveAfterStop','ipcThreadsCompleted',
  'ipcThreadCleanup','stdoutFailure','stderrFailure'])row[key]=job.finished[key]}
 try{ledger.verifyFinished(job);row.fullNativeCompletionAccepted=true}
 catch(error){row.errors.push(String(error));errors.push(`${job.productPid}:${job.requestId}: ${error}`)}
 jobs.push(row)
}
for(const png of p.pngMatches){try{const match=ledger.matchPng(png.productPid,png);assert.equal(match.requestId,png.requestId);matches.push({...match,matched:true})}
 catch(error){errors.push(`PNG ${png.file}: ${error}`);matches.push({file:png.file,matched:false,error:String(error)})}}
console.log(JSON.stringify({availableNativeJobsAccepted:errors.length===0,jobs,pngMatches:matches,errors}));
process.exitCode=errors.length?1:0;
'''
result={'schema':1,'scope':'Available retained native records and PNG bindings; incomplete product matrix is never full acceptance',
 'candidateSha':v.CANDIDATE,'workflowRunId':v.RUN_ID,'archiveSha256':integrity['zip']['sha256'],
 'strictVerificationSha256':v.sha256(verification_bytes),'frozenHarnessSha256':v.HARNESS_SHA,
 'productAcceptancePassed':False,'originalRunOutcomesPreserved':True,'accounts':{},'errors':[],
 'networkAccessed':False,'archiveExtracted':False,'inputsModified':False}
with zipfile.ZipFile(root/'artifact.zip') as archive:
 for account in v.ACCOUNTS:
  row={'passed':False,'errors':[]};result['accounts'][account]=row
  try:
   checks=integrity['accounts'][account];v.require(checks['verified'] is True,'Account integrity required')
   files={x['name']:archive.read(account+'/'+x['name']) for x in checks['files']}
   for item in checks['files']:v.require(len(files[item['name']])==item['bytes'] and v.sha256(files[item['name']])==item['sha256'],'Retained bytes changed')
   report=v.parse_json(files['mermaid-product-e2e.json']);outer=v.parse_json(files['windows-standard-product-audit.json']);context=v.parse_json(files['standard-context.json'])
   v.require(report['candidateSha']==v.CANDIDATE and report['harnessSha256']==v.EXPECTED_WINDOWS_HARNESS_SHA,'Exact candidate report required')
   sid=outer['accountSid'];session=context['sessionId'];v.require(context['actualSid']==sid==context['expectedSid'],'Actual login binding required')
   launches=report['launches'];pids=[x['productPid'] for x in launches]
   v.require(1<=len(pids)<=4 and len(pids)==len(set(pids)),'Unique actually observed product PIDs required')
   records=[]
   for launch in launches:
    logname=launch['fixture']+'-product.log';v.require(logname in files,'Observed product log missing')
    for line in files[logname].decode('utf-8-sig').splitlines():
     if line.startswith(v.AUDIT_PREFIX):
      payload=line[len(v.AUDIT_PREFIX):].encode();v.require(len(payload)<=8192,'Native JSON byte budget')
      records.append(v.parse_json(payload));v.require(len(records)<=512,'Native event budget')
   v.require(v._outer_equal(records,report['nativeAudit']),'Actual log/report event sequence mismatch')
   images={x['name']:x for x in checks['images']};pngs=[]
   for step in report['steps']:
    image=step.get('image')
    if image is None:continue
    decoded=images[image['file']]
    for field in ['bytes','sha256','width','height','pixelSha256']:v.require(image[field]==decoded[field],'Actual PNG decode differs: '+field)
    launch=next(x for x in launches if x['fixture']==step['fixture'])
    v.require(image['native']['productPid']==launch['productPid'] and image['native']['pngSha256']==decoded['sha256'],'PNG actor/hash binding mismatch')
    pngs.append({'file':image['file'],'productPid':launch['productPid'],'requestId':image['native']['requestId'],'bytes':decoded['bytes'],'sha256':decoded['sha256']})
   packet={'sid':sid,'sessionId':session,'account':account,'productPids':pids,'records':records,'pngMatches':pngs}
   completed=subprocess.run(['node','--input-type=module','-e',node,'offline-available-records',str(v.HARNESS)],input=json.dumps(packet).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,cwd='/tmp',check=False)
   v.require(len(completed.stdout)<=2*v.MIB and len(completed.stderr)<=2*v.MIB,'Bounded replay output required')
   replay=v.parse_json(completed.stdout)
   row.update(originalReportStatus=report['status'],originalOuterStatus=outer['status'],observedLaunches=len(launches),
    observedSteps=len(report['steps']),passedSteps=sum(x['passed'] is True for x in report['steps']),
    fullExpectedProductMatrixObserved=len(launches)==4 and len(report['steps'])==10,
    availableNativeEvents=len(records),retainedFullyDecodedPngs=len(images),
    availableNativeDiagramPngs=len(pngs),replayExitCode=completed.returncode,**replay)
   row['passed']=completed.returncode==0 and replay['availableNativeJobsAccepted'] is True
   row['errors']=replay['errors']
   if completed.stderr:row['replayStderr']=completed.stderr.decode(errors='replace')
  except Exception as error:row['errors'].append(str(error))
  result['errors'].extend(account+': '+error for error in row['errors'])
result['allAvailableNativeJobsAccepted']=not result['errors'] and all(x['passed'] for x in result['accounts'].values())
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(0 if result['allAvailableNativeJobsAccepted'] else 1)

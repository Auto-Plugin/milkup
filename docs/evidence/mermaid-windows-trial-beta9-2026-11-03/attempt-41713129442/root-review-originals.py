import json,collections
from pathlib import Path
root=Path(__file__).parent
result={'candidateSha':'a5556beea5cdd1570361c528b2326bc0ad8ba0c4','accounts':{},'scope':'Independent read of original installed body, close, native and outer cleanup records; not a substitute for full verifier'}
for kind in ['pure-standard','filtered-admin']:
 folder=root/'extracted/installed'/kind;p=json.loads((folder/'mermaid-product-e2e.json').read_text());outer=json.loads((folder/'windows-standard-product-audit.json').read_text())
 assert p['status']=='passed' and len(p['steps'])==10 and all(x['passed'] is True for x in p['steps'])
 assert len(p['launches'])==4
 for launch in p['launches']:
  assert launch['closedByUi'] is True and launch['exitCode']==0 and launch['signal'] is None and launch['stdioClosedAt']
  assert launch.get('unexpectedUnsavedConfirmation') is not True
 assert outer['status']=='passed' and outer['cleanupErrors']==[]
 for key in ['installedDirectoryRemoved','accountDeleted','profileDeleted','stageRemoved']: assert outer[key] is True
 assert outer['runtimeInstalled'] is False and outer['fixedRuntimeUsed'] is False
 jobs=[]
 for path in folder.glob('*-product.log'):
  for line in path.read_text().splitlines():
   if line.startswith('MILKUP_MERMAID_NATIVE_AUDIT '):
    x=json.loads(line.split(' ',1)[1])
    if x['phase']=='finished': jobs.append(x)
 assert len({x['requestId'] for x in jobs})==len(jobs)
 for x in jobs:
  assert x['cleanupUncertain'] is False and x['ipcThreadsCompleted'] is True and x['privateTreeRemoved'] is True
  if x['profileCreated']:assert x['profileDeleted'] is True
  if x['ownedJobCreated']:
   assert x['jobActiveAfterStop']==0 and x['helperProcessExitObservation']['handleReleasedBeforeAccounting'] is True
  for stream in x['ipcThreadCleanup']:assert stream['finished'] is True and stream['cancelRequested'] is False
  assert x['stdoutFailure'] is None and x['stderrFailure'] is None
  assert x['privateTreeCleanup']['absent'] is True
 counts=collections.Counter('success' if x['successful'] else 'cancelled' if x['cancelled'] else 'deadline' if x['deadlineExpired'] else 'boundedInvalid' for x in jobs)
 result['accounts'][kind]={'bodySteps':len(p['steps']),'naturalCloses':len(p['launches']),'exitCodes':[x['exitCode'] for x in p['launches']],'nativeJobs':len(jobs),'classification':dict(counts),'createdJobs':sum(x['ownedJobCreated'] for x in jobs),'createdProfiles':sum(x['profileCreated'] for x in jobs),'allNativeAndOuterCleanupPassed':True,'runtimeVersion':p['runtime']['version']}
result['status']='passed';(root/'root-independent-originals.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

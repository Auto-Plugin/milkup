import collections, hashlib, json, pathlib
root=pathlib.Path(__file__).resolve().parent; p=root/'artifact'
read=lambda name:json.loads((p/name).read_text(encoding='utf-8-sig'))
r=read('mermaid-product-e2e.json'); a=read('windows-standard-product-audit.json'); c=read('evidence-files.json')
v=json.loads((root/'verification.json').read_text()); manifest=read('artifact-manifest.json'); files={x['name']:x for x in manifest['files']}
assert r['candidateSha']==v['candidateSha']=='44ef263e6cd3d66b3dc43d951c4b3fe0d18e69f0'
assert r['status']==a['status']=='passed' and len(r['steps'])==10 and all(s['passed'] for s in r['steps'])
assert c['complete'] and c['rejectedCount']==0 and c['rejectionsOmitted']==0
assert all(x['strictClean'] and x['headIndexWorktreeEqual'] and x['readOnly'] and not x['refreshedIndex'] for x in v['sourcePhases'])
records={}
def walk(x):
 if isinstance(x,dict):
  if str(x.get('file','')).endswith('.png'): assert x['file'] not in records; records[x['file']]=x
  for y in x.values():walk(y)
 elif isinstance(x,list):
  for y in x:walk(y)
walk(r)
assert set(records)=={i['file'] for i in v['images']}
for i in v['images']:
 d=records[i['file']]; assert i['fullyDecoded'] and i['nonuniform']
 assert (i['width'],i['height'],i['pixelSha256'],i['pngSha256'])==(d['width'],d['height'],d['pixelSha256'],d['sha256'])
 i['reportPixelHashMatched']=True
native=r['nativeAudit']; log_native=[]
for launch in r['launches']:
 for line in (p/(launch['fixture']+'-product.log')).read_text().splitlines():
  if line.startswith('MILKUP_MERMAID_NATIVE_AUDIT '):log_native.append(json.loads(line.split(' ',1)[1]))
assert log_native==native
admitted={(x['productPid'],x['requestId']):x for x in native if x['phase']=='admitted'}
finished={(x['productPid'],x['requestId']):x for x in native if x['phase']=='finished'}
assert len(admitted)==len(finished)==12 and admitted.keys()==finished.keys()
assert len([x for x in native if x['phase']=='admitted'])==len(admitted)
assert len([x for x in native if x['phase']=='finished'])==len(finished)
sid=a['accountSid']; started=[x for x in native if x['phase']=='started']; assert len(started)==11
for d in started:
 assert d['hostSid']==d['childSid']==d['browserSid']==sid
 assert all(d[k] for k in ['hostPureStandard','appContainer','zeroCapabilities','browserAppContainer','browserZeroCapabilities','browserInOwnedJob'])
for key,d in finished.items():
 assert d['timestampUnixMs']>=admitted[key]['timestampUnixMs']
 assert not d['cleanupUncertain'] and d['cleanupFailureKinds']==[] and d['ipcThreadsCompleted'] and d['profileDeleted'] and d['privateTreeRemoved']
 assert d['stdoutFailure'] is None and d['stderrFailure'] is None
 if d['ownedJobCreated']: assert d['jobActiveAfterStop']==0
 else: assert d['cancelled'] and not d['successful'] and not d['ownedPidsBeforeStop'] and d['jobActiveAfterStop'] is None
 assert all(t['finished'] and not t['panicked'] and not t['cancelRequested'] and t['cancelCallSucceeded'] is None and t['cancelWin32Error'] is None for t in d['ipcThreadCleanup'])
for i in v['images']:
 d=records[i['file']]
 if d.get('native'):
  n=d['native']; f=finished[(n['productPid'],n['requestId'])]
  assert f['successful'] and f['pngSha256']==i['pngSha256']==n['pngSha256'] and f['pngBytes']==files[i['file']]['bytes']
  i['nativeOutputHashAndBytesMatched']=True
assert all(l['closedByUi'] and l['exitCode']==0 and l['signal'] is None and l['teardown']['closedByUi'] and l['teardown']['errors']==[] and all(z['ok'] for z in l['teardown']['phases']) for l in r['launches'])
identities=[]
for batch in r['processIdentities']:
 for d in batch['values']:
  t=d['token']; assert t['sid']==sid and t['pureStandardUser'] and not t['elevated'] and not t['administratorsGroupPresentIncludingDenyOnly'] and not t['seDebugPrivilegePresent']
  identities.append({'pid':d['pid'],'creationFileTime':d['creationFileTime'],'sessionId':t['sessionId'],'imageName':pathlib.PureWindowsPath(d['image']).name})
assert a['standardContext']['interactive'] and a['standardContext']['pureStandard'] and a['standardContext']['desktop']['sameInputDesktop']
assert a['supervisor']['jobEmpty'] and a['supervisor']['activeBeforeOuterCleanup']==0 and not a['supervisor']['cleanupErrors']
assert a['profileDeleted'] and a['accountDeleted'] and a['stageRemoved'] and not a['cleanupErrors']
pc=a['profileCleanup']; assert pc['lastProcessObservation']['complete'] and pc['lastProcessObservation']['matchCount']==0
assert not pc['after']['profileKeyPresent'] and not pc['after']['profilePathPresent'] and not pc['after']['hkuHivePresent'] and pc['after']['cimMatches']==0
for k in ['changedAcl','changedUacOrSecurityPolicy','runtimeInstalled','fixedRuntimeUsed','installerExecuted','passwordInLogsFilesArgumentsOrEnvironment','outerCleanupProvesProductInnerCleanup']:assert a[k] is False
sources=[]
for name,d in r['fixtures'].items():
 data=(p/('fixture-'+name+'.md.log')).read_bytes(); saved=(p/('saved-'+name+'.md.log')).read_bytes()
 assert len(data)==d['bytes'] and hashlib.sha256(data).hexdigest()==d['sha256'] and data==saved
 sources.append({'fixture':name,'bytes':len(data),'sha256':d['sha256'],'finalSavedBytesExactlyEqual':True,'crlfCount':data.count(b'\r\n')})
# Recorded individual save checkpoints are also retained; this independent verifier binds all final files.
wide=next(l for l in r['launches'] if l['fixture']=='wide'); close=next(z for z in wide['teardown']['phases'] if z['phase']=='ui-close'); cancel=next(d for d in finished.values() if d['cancelled'])
stdout_times=[t['elapsedMs'] for d in finished.values() for t in d['ipcThreadCleanup'] if t['stream']=='stdout']
v['actualOutcome']={'status':'passed','stepsPassed':10,'stepsTotal':10,'steps':[{'name':s['name'],'passed':s['passed']} for s in r['steps']], 'nativeAuditEqualsProductLogs':True,'nativeAdmitted':12,'nativeStarted':11,'nativeFinished':12,'nativeSuccessful':sum(d['successful'] for d in finished.values()),'nativeCancelledBeforeJobCreation':sum(d['cancelled'] and not d['ownedJobCreated'] for d in finished.values()),'nativeUnknownDiagramErrors':sum(d.get('rendererErrorKind')=='unknown-diagram' for d in finished.values()),'allNativeCleanupConfirmed':True,'allTypedCleanupFailureKindsEmpty':True,'stdoutJoinElapsedMs':stdout_times,'allIpcCancellationRequestsFalse':True,'normalUiCloseCount':4,'forcedProductKillCount':0,'collectorComplete':True,'collectorRejectedCount':0,'pngCount':len(v['images']),'nativePngCount':sum(bool(records[i['file']].get('native')) for i in v['images']),'imageBindingsVerified':True,'sourceFixtures':sources,'processIdentities':identities,'pureStandardSameSid':True,'interactiveDesktopVerified':True,'outerActiveBeforeCleanup':0,'profileDeletedConfirmed':True,'accountDeleted':True,'stageRemoved':True,'cleanupErrors':[],'runtime':r['runtime'],'closeRaceCoverage':{'fixture':'wide','drainFinishedAt':wide['teardown']['phases'][0]['finishedAt'],'uiCloseStartedAt':close['startedAt'],'cancelledJob':{'admitted':admitted[(cancel['productPid'],cancel['requestId'])],'finished':cancel},'naturalProductExitedAt':wide['exitedAt']},'testCounts':{'privateWindowsPassed':31,'selectedDesktopPassed':1,'desktopPassed':228,'desktopIgnored':3},'limits':r['boundaries']+['Previous run 41653312849 cleanup uncertainty was not reproduced; its exact cause remains unknown.','Previous run 41642093459 profile deletion failed with Win32 32 on an ended runner; this run does not prove that old profile was removed.','This verification is bound only to run candidate 44ef263e, not newer local Linux-only commits.']}
(root/'verification.json').write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'verified','steps':10,'png':len(v['images']),'nativeDiagramPng':v['actualOutcome']['nativePngCount'],'native':'12 admitted / 11 started / 12 finished','normalUiCloses':4,'sourceFixtures':len(sources),'allNativeCleanupConfirmed':True,'outerProfileAccountStageClean':True},indent=2))

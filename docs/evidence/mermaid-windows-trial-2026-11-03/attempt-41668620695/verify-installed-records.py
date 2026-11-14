"""Independent assertions over retained original evidence; no network or product execution."""
import collections,hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
hashbytes=lambda b:hashlib.sha256(b).hexdigest()
p=root/'installed';q=root/'inspection';r=read(p/'mermaid-product-e2e.json');a=read(p/'windows-standard-product-audit.json');i=read(p/'installation-result.json');c=read(p/'installed-binary-comparison.json');inp=read(q/'installer-input.json');pack=read(q/'packaging-record.json');av=read(root/'artifact-verification.json');run=read(root/'run-metadata.json')
sha='a5431693a4ea1e1a282c16b9cc9651e17b67f9ea'
assert run['head_sha']==sha and run['conclusion']=='success' and run['run_attempt']==1
assert all(x['candidateSha']==sha for x in [r,i,inp,pack]);assert a['source']==sha
assert all(x['status']=='passed' for x in [r,a,i,c]);assert i['productAcceptance']=='passed'
assert a['installation']==i and i['binaryComparison']==c
assert r['application']==i['installedBinary']['path'] and r['applicationSha256']==i['installedBinary']['sha256']==c['installedSha256']==c['expectedInstalledSha256']==inp['expectedInstalledBinarySha256']==pack['extractedApplication']['sha256']
assert c['builtSha256']==inp['builtBinarySha256']==pack['compiledApplication']['sha256']==a['binary']['sha256']
assert i['installer']['sha256']==pack['installer']['sha256'] and i['installer']['bytes']==pack['installer']['bytes']
assert c['transformation']=='__TAURI_BUNDLE_TYPE_VAR_UNK -> __TAURI_BUNDLE_TYPE_VAR_NSS'
assert i['expectedVersion']==inp['version']==pack['version']==i['installedBinary']['fileVersion']==i['installedBinary']['productVersion']=='2.0.0-beta.8'
assert inp['installMode']==pack['nsisInstallMode']=='currentUser' and inp['webviewInstallMode']==pack['webviewInstallMode']=='skip'
sid=i['actualSid'];session=i['sessionId'];assert sid==i['expectedSid']==a['accountSid']==r['context']['actualSid']==r['context']['nodeObservedSid'];assert session==i['expectedSessionId']==r['context']['sessionId']
assert a['standardContext']['interactive'] and a['standardContext']['pureStandard']
ir=i['installerRun'];assert ir['started'] and ir['exited'] and ir['exitCode']==0 and ir['identityVerified'] and ir['streamsDrained'] and not ir['timedOut'] and not ir['forcedProcessTermination'] and not ir['cleanupErrors']
for x in [ir['callerIdentity'],ir['startedProcess']]:
 t=x['token'];assert t['sid']==sid and t['sessionId']==session and t['pureStandardUser'] and not t['elevated'] and not t['administratorsGroupPresentIncludingDenyOnly'] and not t['seDebugPrivilegePresent'];assert x['inJob'] and x['sessionId']==session
assert ir['startedProcess']['image']==i['installer']['path'] and not ir['startedProcess']['imageTruncated']
identities=[x for group in r['processIdentities'] for x in group['values']]
for x in identities:
 t=x['token'];assert t['sid']==sid and t['sessionId']==session and t['pureStandardUser'] and not t['elevated'] and not t['administratorsGroupPresentIncludingDenyOnly'] and not t['seDebugPrivilegePresent']
for l in r['launches']:assert any(x['pid']==l['productPid'] and x['image']==r['application'] for x in identities)
assert i['bundledPlugins']==inp['bundledPlugins'] and len(i['bundledPlugins'])==10
expected={x['id']:x['version']for x in inp['bundledPlugins']};observed=r['steps'][0]['bundledPluginsObserved'];assert len(observed)==10 and {x['id']:x['version']for x in observed}==expected and all(x['checked']=='false' and x['busy'] not in [True,'true']for x in observed)
assert len(i['resources'])==1 and i['resources'][0]['relativePath']=='file.ico' and i['resources'][0]['verified']
assert [{k:v for k,v in x.items()if k!='verified'} for x in i['resources']]==inp['resources']
assert len(r['steps'])==10 and all(x['passed'] for x in r['steps'])
images=[x for item in av['artifacts']for x in item['images']];byfile={x['file']:x for x in images};assert len(byfile)==17
fin={(x['productPid'],x['requestId']):x for x in r['nativeAudit']if x['phase']=='finished'}
linked=[]
for step in r['steps']:
 for field in ['image','screenshot']:
  if field not in step:continue
  x=step[field];v=byfile[x['file']];b=(p/x['file']).read_bytes()
  assert x['bytes']==len(b) and x['sha256']==hashbytes(b)==v['pngSha256'] and x['pixelSha256']==v['pixelSha256'] and x['width']==v['width'] and x['height']==v['height']
  if field=='image':
   n=x['native'];f=fin[(n['productPid'],n['requestId'])];assert f['successful'] and f['pngSha256']==x['sha256']==n['pngSha256'] and f['pngBytes']==x['bytes'];linked.append(x['file'])
assert len(linked)==7
for name,fixture in r['fixtures'].items():
 b=(p/f'fixture-{name}.md.log').read_bytes();saved=(p/f'saved-{name}.md.log').read_bytes();assert len(b)==fixture['bytes'] and hashbytes(b)==fixture['sha256'] and b==saved
for step in r['steps']:
 if step.get('saved') and step['name'] not in ['03-real-edit-save-replacement','05-redo-exact-edit']:
  f=r['fixtures'][step['fixture']];assert step['saved']['bytes']==f['bytes'] and step['saved']['sha256']==f['sha256']
assert r['steps'][2]['saved']==r['steps'][4]['saved'] and r['steps'][2]['saved']!=r['steps'][1]['saved']
counts=collections.Counter(x['phase'] for x in r['nativeAudit']);assert counts['admitted']==counts['finished']==len(fin)
for f in fin.values():
 assert f['hostSid']==sid and f['hostPureStandard'] and not f['cleanupUncertain'] and f['ipcThreadsCompleted'] and f['privateTreeRemoved'] and not f['cleanupFailureKinds'] and not f['stdoutFailure'] and not f['stderrFailure']
 if f['profileCreated']:assert f['profileDeleted']
 if f['ownedJobCreated']:assert f['jobActiveAfterStop']==0
 for t in f['ipcThreadCleanup']:assert t['finished'] and not t['panicked'] and not t['cancelRequested']
for l in r['launches']:
 assert l['closedByUi'] and l['exitCode']==0 and l['signal'] is None and not l.get('discardedOwnedUnsavedFixture')
 t=l['teardown'];assert t['closedByUi'] and t['realUiCloseRequested'] and not t['errors'];assert all(x['ok'] for x in t['phases']) and not any('force' in x['phase'] for x in t['phases'])
assert len(r['launches'])==4
for k in ['installerExecuted','installedDirectoryRemoved','accountCreated','accountDeleted','profileDeleted','stageRemoved']:assert a[k] is True
for k in ['changedAcl','changedUacOrSecurityPolicy','runtimeInstalled','fixedRuntimeUsed','passwordInLogsFilesArgumentsOrEnvironment','outerCleanupProvesProductInnerCleanup']:assert a[k] is False
assert not a['cleanupErrors'] and a['supervisor']['jobEmpty'] and a['supervisor']['activeBeforeOuterCleanup']==0 and a['evidenceCopy']['complete'] and not a['evidenceCopy']['rejected']
pc=a['profileCleanup'];assert pc['lastProcessObservation']['complete'] and pc['lastProcessObservation']['matchCount']==0
assert all(pc['after'][k] is False for k in ['profileKeyPresent','profilePathPresent','hkuHivePresent']) and pc['after']['cimMatches']==0
source=[]
for phase in ['checkout','desktop-check','final']:
 x=read(q/f'mermaid-source-{phase}.json');assert x['candidateSha']==sha and x['readOnly'] and not x['refreshedIndex'] and x['rawStatus']=='' and len(x['files'])==3
 for f in x['files']:assert f['head']==f['index']==f['worktree'] and f['head']['crlf']==0 and f['head']['bareCr']==0
 assert (q/f'mermaid-source-{phase}.json').read_bytes()==(p/f'mermaid-source-{phase}.json').read_bytes()
 source.append({'phase':phase,'rawStatus':x['rawStatus'],'files':[{'path':f['path'],'bytes':f['worktree']['bytes'],'sha256':f['worktree']['sha256'],'crlf':f['worktree']['crlf']}for f in x['files']]})
dep=read(q/'windows-runtime-dependencies.json');assert dep==pack['dependencies'] and dep['status']=='passed' and dep['applicationSha256']==r['applicationSha256'] and not dep['extraVcRuntimeDlls'];assert hashbytes((q/'windows-runtime-imports.log').read_bytes())==dep['source']['importsSha256']
final=read(q/'mermaid-trial-finalization.json');assert final['candidateSha']==sha and final['deliveryReady'] and final['status']=='passed'
for item in final['installed']['records']:
 b=(p/item['name']).read_bytes();assert len(b)==item['bytes'] and hashbytes(b)==item['sha256']
summary={'status':'passed','candidateSha':sha,'runId':run['id'],'installedVersion':i['expectedVersion'],'installerSha256':i['installer']['sha256'],'installedBinarySha256':r['applicationSha256'],'pureStandardSameSid':sid,'sessionId':session,'actualInstallerPid':ir['pid'],'productPids':[l['productPid'] for l in r['launches']],'tenDefaultDisabledPluginsObserved':True,'stepsPassed':len(r['steps']),'pngDecodedAndBoundToBrowser':len(byfile),'pngBoundToExactNativeFinish':len(linked),'nativePhases':dict(counts),'nativeSuccessful':sum(x['successful']for x in fin.values()),'cancelledBeforeJob':sum(x['cancelled'] and not x['ownedJobCreated']for x in fin.values()),'unknownGrammarRejections':sum(x['rendererErrorKind']=='unknown-diagram'for x in fin.values()),'allInnerCleanupConfirmed':True,'allFourNaturalUiExit0':True,'outerActiveBeforeCleanup':a['supervisor']['activeBeforeOuterCleanup'],'newAccountProfileHkuInstallAndStageRemoved':True,'sourcePhases':source,'legacyScopeFieldsPreserved':{'productInstallationAccepted':r['installationAccepted'],'productVisualReviewAccepted':r['visualReviewAccepted'],'packagingInstallerExecuted':pack['installerExecuted'],'packagingInstalledProductAccepted':pack['installedProductAccepted']},'observations':[{'fixture':l['fixture'],'unexpectedUnsavedConfirmation':l.get('unexpectedUnsavedConfirmation',False),'discardedOwnedUnsavedFixture':l.get('discardedOwnedUnsavedFixture',False),'closeConfirmationDiagnosticRecorded':bool(l.get('closeConfirmationDiagnostic'))}for l in r['launches']]}
(root/'installed-record-verification.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in summary.items()if k not in ['sourcePhases','observations']},ensure_ascii=False))

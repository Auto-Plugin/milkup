from pathlib import Path
import hashlib,json,re,subprocess
root=Path('/workspace/milkup-render-timing-diagnostic')
evidence=Path('/workspace/milkup-markdown-extensions-phase4-evidence/supervisor')
base='065882e4ac8c638c2fe8eb6f7050ff9228e95ecc'
originals=['packages/plugin/src/worker-supervisor.ts','packages/plugin/src/document-render-rpc.ts','packages/plugin/src/isolation-module-host.ts']
helper='packages/plugin/src/render-timing-diagnostic.ts'
allow=set(originals+[helper])
def git(*args):return subprocess.check_output(['git',*args],cwd=root)
def sha(b):return hashlib.sha256(b).hexdigest()
changed=set(git('diff','--name-only',base).decode().splitlines())|set(git('ls-files','--others','--exclude-standard').decode().splitlines())
assert changed==allow,changed
assert git('rev-parse','HEAD').decode().strip()==base
assert subprocess.run(['git','symbolic-ref','-q','HEAD'],cwd=root,stdout=subprocess.DEVNULL).returncode==1
blocks=re.compile(rb'(?ms)^[ \t]*// DIAGNOSTIC-BEGIN\n.*?^[ \t]*// DIAGNOSTIC-END\n')
report={'diagnosticOnly':True,'base':base,'detached':True,'allowedChangesOnly':True,'built':False,'tested':False,'dependenciesInstalled':False,'files':{}}
inserted=[]
for name in originals:
 original=git('show',base+':'+name);current=(root/name).read_bytes();restored=blocks.sub(b'',current)
 assert restored==original,name
 added=blocks.findall(current);assert added,name
 inserted.extend(added)
 report['files'][name]={'baseSha256':sha(original),'diagnosticSha256':sha(current),'strippedSha256':sha(restored),'byteExactAfterRemovingHooks':True,'hookBlocks':len(added)}
helperBytes=(root/helper).read_bytes();report['files'][helper]={'diagnosticSha256':sha(helperBytes),'newDiagnosticOnlyHelper':True}
for forbidden in [rb'\bnew\s+Promise\b',rb'\bawait\b',rb'\bsetTimeout\s*\(',rb'\bsetInterval\s*\(',rb'\bqueueMicrotask\s*\(']:
 assert not re.search(forbidden,b'\n'.join(inserted)+helperBytes),forbidden
report['noNewPromiseAwaitTimerOrMicrotask']=True
report['mainWindowGuard']='WorkerGlobalScope prototype check; noop outside Worker; injected endpoint callback only'
report['debugProtocol']='milkup.diagnostic.render-timing.v1'
report['debugType']='trace'
report['authorityUnchanged']='All 3 originals byte-exact after removal of diagnostic blocks; debug protocol/type cannot match existing document-render result parser'
report['recordLimitPerRealm']=1024;report['batchLimit']=16;report['recordByteLimit']=384
report['dependenciesPresent']=[str(p.relative_to(root)) for p in root.glob('**/node_modules')]
assert not report['dependenciesPresent']
patch=git('diff','--binary',base,'--',*originals)
new=subprocess.run(['git','diff','--no-index','--binary','--','/dev/null',helper],cwd=root,stdout=subprocess.PIPE)
assert new.returncode==1
patch+=new.stdout
(evidence/'candidate09-diagnostic-hooks.patch').write_bytes(patch)
report['patchSha256']=sha(patch)
(evidence/'candidate09-diagnostic-static-report.json').write_text(json.dumps(report,indent=2)+'\n')
(evidence/'candidate09-diagnostic-sha256.txt').write_text('\n'.join([sha((root/n).read_bytes())+'  '+n for n in originals+[helper]])+'\n'+sha(patch)+'  candidate09-diagnostic-hooks.patch\n')
print(json.dumps({'changed':sorted(changed),'allOriginalsRestoredByteExact':True,'noNewAsyncOrTimer':True,'patchSha256':sha(patch),'dependenciesPresent':report['dependenciesPresent']},indent=2))

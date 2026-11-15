// One owned SIGKILL in isolated CI; production UI and completed checkpoint evidence.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, readlink, readdir, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startProduction } from '../../tests/helpers/native-production.mjs'
import { nativeFixture, x } from '../../tests/helpers/native-updates-fixture.mjs'
const out=path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR)
assert(process.env.GITHUB_ACTIONS==='true' && process.env.MILKUP_NATIVE_EXCLUSIVE_DISPLAY==='1' && process.getuid()!==0)
assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS)
await mkdir(out,{recursive:true})
const sha=b=>createHash('sha256').update(b).digest('hex')
const fixture=path.join(out,'recovery-original.md'), token=process.env.GITHUB_RUN_ID
const original=`ORIGINAL_${token}\n`, first=original+`CHECKPOINT_A_${token}`, latest=first+`_CHECKPOINT_B_${token}`
await writeFile(fixture,original,{flag:'wx'})
await writeFile(path.join(out,'expected-latest.md'),latest,{flag:'wx'})
const recoveryRoot=path.join(process.env.XDG_DATA_HOME,'app.milkup.desktop','recovery-v1')
const record={status:'running',sourceSha:process.env.MILKUP_RECOVERY_SOURCE_SHA,harnessSha:process.env.GITHUB_SHA,uid:process.getuid(),steps:[],launches:[],closes:[],checkpoints:[],errors:[],plannedInterruptions:1,spontaneousCrash:false,powerLoss:false}
const persist=()=>writeFile(path.join(out,'recovery-result.json'),JSON.stringify(record,null,2))
let app,owned,latestRecord,recoveredPath
const ui=nativeFixture(()=>app)
async function step(name,fn){record.currentStep=name;await persist();const at=performance.now();try{await fn();record.steps.push({name,status:'passed',durationMs:performance.now()-at})}catch(e){record.steps.push({name,status:'failed',error:String(e),durationMs:performance.now()-at});throw e}finally{await persist()}}
const birth=async pid=>(await readFile(`/proc/${pid}/stat`,'utf8')).split(') ').at(-1).split(' ')[19]
const state=()=>app.probe()
const editorText=()=>app.execute('return document.querySelector(".milkup-editor")?.textContent')
const overlay=()=>app.execute('const e=document.querySelector(".recovery-overlay");return !!e&&!e.hidden&&e.getClientRects().length>0')
async function start(file=fixture){
 const dir=path.join(out,`launch-${record.launches.length+1}`);await mkdir(dir)
 app=await startProduction(file,dir,{diagnostics:false,cleanupOwnedOnClose:false});app.click=pointerClick
 const window=ui.windowId(),pid=Number(x('getwindowpid',window));assert.equal(await readlink(`/proc/${pid}/exe`),process.env.TAURI_APP_PATH)
 owned={pid,birth:await birth(pid),uid:process.getuid(),executable:process.env.TAURI_APP_PATH,sha256:sha(await readFile(process.env.TAURI_APP_PATH)),fixture:file,root:out}
 assert.equal(owned.sha256,process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
 record.launches.push({...owned,window,at:new Date().toISOString()});await persist()
}
// A real pointer is required: Linux hides the Windows-only titlebar controls.
async function pointerClick(selector){
 const sample=()=>app.execute('const e=document.querySelector(arguments[0]);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,w:innerWidth,h:innerHeight,hit:e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),disabled:e.disabled===true}',selector)
 let r=await sample();assert(r,'Pointer target exists '+selector)
 if(!r.hit||r.x<0||r.y<0||r.x>=r.w||r.y>=r.h){await app.focus(selector);r=await sample()}
 assert(r?.hit&&r.width>0&&r.height>0&&!r.disabled&&r.x>=0&&r.y>=0&&r.x<r.w&&r.y<r.h,'Visible enabled native pointer target '+selector)
 const window=ui.windowId(),scale=Number(/WIDTH=(\d+)/.exec(x('getwindowgeometry','--shell',window))[1])/r.w
 record.inputs??=[];record.inputs.push({kind:'native-pointer',selector,window,...r});await persist()
 x('windowfocus','--sync',window);x('mousemove','--window',window,String(Math.round(r.x*scale)),String(Math.round(r.y*scale)),'click','1')
}

async function originalUnchanged(){assert.equal(await readFile(fixture,'utf8'),original)}
async function readRecord(id){assert(/^[A-Za-z0-9_.-]+$/.test(id));const p=path.join(recoveryRoot,id,'manifest.json');assert((await lstat(p)).isFile());return JSON.parse(await readFile(p,'utf8'))}
async function recordBytes(r){assert(/^[A-Za-z0-9_.-]+$/.test(r.payload)&&!r.payload.includes('..'));const p=path.join(recoveryRoot,r.id,r.payload);assert((await lstat(p)).isFile());const b=await readFile(p);assert.equal(b.length,r.bytes);assert.equal(sha(b),r.sha256);return b}
async function checkpoint(expected,label){
 const inputSettledAt=performance.now()
 await app.until(()=>app.execute('const a=document.querySelector("#app");return a?.dataset.recoveryPhase==="ready"&&Number(a.dataset.recoveryVersion)===Number(document.querySelector("[data-stat=version]")?.textContent)'),'latest acknowledged checkpoint',15000)
 const observed=await state();const names=await readdir(recoveryRoot);assert(names.length<100)
 const matches=[]
 for(const id of names){if(id==='copies')continue;try{const r=await readRecord(id);if(r.originalPath===fixture&&r.ownerPid===owned.pid&&r.ownerBirth===owned.birth&&r.disposition==='pending'&&r.version===observed.version)matches.push(r)}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e}}
 assert.equal(matches.length,1,'Exactly one current owned checkpoint')
 const r=matches[0];assert.equal((await recordBytes(r)).toString(),expected);await originalUnchanged()
 const sample={...r,label,inputSettledAt,ackObservedAt:performance.now(),observedVersion:observed.version,dirty:observed.dirty};assert(sample.dirty)
 record.checkpoints.push(sample);await writeFile(path.join(out,`${label}-manifest.json`),JSON.stringify(r,null,2));await writeFile(path.join(out,`${label}-payload.md`),expected);await persist();return r
}
async function promptFor(id){await app.until(async()=>await overlay()&&await app.execute('return !!document.querySelector("[data-recovery-restore="+CSS.escape(arguments[0])+"]")',id),'owned recovery offered',15000)}
async function releaseDeadSession(){
 try{await birth(owned.pid);assert.fail('Process must be gone before releasing WebDriver')}catch(e){if(e.code!=='ENOENT')throw e}
 try{await app.endSession()}catch(e){record.sessionReleaseErrors??=[];record.sessionReleaseErrors.push(String(e));if(!String(e).includes('invalid session id'))throw e}
 app=null;owned=null;await persist()
}
async function normalClose(){
 assert.equal(await birth(owned.pid),owned.birth);const window=ui.windowId();assert.equal(Number(x('getwindowpid',window)),owned.pid)
 const row={...owned,window,forced:false,processGone:false,before:await state()};assert.equal(row.before.dirty,false);assert.equal(await overlay(),false)
 record.closes.push(row);await persist();row.request=JSON.parse(execFileSync(process.env.MILKUP_NATIVE_CLOSE_HELPER,[window,String(owned.pid)],{encoding:'utf8'}))
 await app.until(async()=>{try{assert.equal(await birth(owned.pid),owned.birth);return false}catch(e){if(e.code==='ENOENT')return true;throw e}},'owned normal close',20000)
 row.processGone=true;await releaseDeadSession()
}
async function interruptOwned(reason){
 const request={...owned};const entry={reason,request,at:new Date().toISOString()};record.interruptions??=[];record.interruptions.push(entry);await persist()
 const result=execFileSync('/usr/bin/python3',['scripts/ci/owned-pidfd-signal.py'],{input:JSON.stringify(request),encoding:'utf8',timeout:15000});entry.result=JSON.parse(result);assert(entry.result.pidfdExited);await persist()
 await app.until(async()=>{try{assert.equal(await birth(owned.pid),owned.birth);return false}catch(e){if(e.code==='ENOENT')return true;throw e}},'interrupted process reaped',10000)
 await releaseDeadSession()
}
async function stableOriginal(){await originalUnchanged();assert((await editorText()).includes(`ORIGINAL_${token}`));assert(!(await editorText()).includes('CHECKPOINT_'));assert.equal((await state()).dirty,false)}
try{
 await step('open-exact-installed-original',async()=>{await start();await stableOriginal();assert.equal(await overlay(),false)})
 await step('first-completed-checkpoint',async()=>{await app.focus('.milkup-input-proxy');await app.key('ctrl+End');await app.text(`CHECKPOINT_A_${token}`);record.inputAEnd=performance.now();await checkpoint(first,'first')})
 await step('latest-completed-checkpoint-with-previous-generation',async()=>{await app.text(`_CHECKPOINT_B_${token}`);record.inputBEnd=performance.now();latestRecord=await checkpoint(latest,'latest');assert.equal(latestRecord.previous,record.checkpoints[0].payload);assert.equal(await readFile(path.join(recoveryRoot,latestRecord.id,latestRecord.previous),'utf8'),first);await app.shot('completed-latest-checkpoint')})
 await step('pidfd-bound-abrupt-interruption',async()=>{await originalUnchanged();assert.equal((await recordBytes(latestRecord)).toString(),latest);await interruptOwned('planned-single-abrupt-stop');assert.equal((await recordBytes(await readRecord(latestRecord.id))).toString(),latest);await originalUnchanged()})
 await step('restart-offers-pending-checkpoint-alongside-original',async()=>{await start();await promptFor(latestRecord.id);await stableOriginal();assert.equal((await recordBytes(await readRecord(latestRecord.id))).toString(),latest);await app.shot('restart-recovery-prompt')})
 await step('defer-recovery-keeps-original-and-pending-snapshot',async()=>{await pointerClick('[data-recovery-close]');await app.until(async()=>!await overlay(),'defer recovery');await stableOriginal();assert.equal((await readRecord(latestRecord.id)).disposition,'pending');await normalClose()})
 await step('second-restart-still-offers-deferred-snapshot',async()=>{await start();await promptFor(latestRecord.id);await stableOriginal();assert.equal((await recordBytes(await readRecord(latestRecord.id))).toString(),latest)})
 await step('restore-opens-independent-copy-with-exact-unsaved-bytes',async()=>{await pointerClick(`[data-recovery-restore="${latestRecord.id}"]`);await app.until(async()=>{const p=await state();return p.loading==='ready'&&p.path.startsWith(recoveryRoot+'/copies/recovered-')&&!p.dirty},'independent recovered copy');recoveredPath=(await state()).path;assert.equal(path.dirname(recoveredPath),path.join(recoveryRoot,'copies'));assert.equal(await readFile(recoveredPath,'utf8'),latest);assert((await editorText()).includes(`CHECKPOINT_B_${token}`));await originalUnchanged();await app.until(async()=>(await readRecord(latestRecord.id)).disposition==='restored'&&!await overlay(),'restored archive committed');record.recoveredPath=recoveredPath;await writeFile(path.join(out,'observed-recovered-copy.md'),await readFile(recoveredPath));await app.shot('restored-copy');await normalClose()})
 await step('third-restart-keeps-original-without-reoffering-restored-record',async()=>{await start();await stableOriginal();await app.delay(1500);assert.equal(await overlay(),false);assert.equal((await readRecord(latestRecord.id)).disposition,'restored');assert.equal((await recordBytes(await readRecord(latestRecord.id))).toString(),latest);assert.equal(await readFile(recoveredPath,'utf8'),latest)})
 await step('archived-history-still-retains-recovery-copy',async()=>{await pointerClick('[data-menu-toggle]');await pointerClick('[data-menu-section="file"]');await pointerClick('[data-open-recovery]');await promptFor(latestRecord.id);assert(await app.execute('return document.querySelector("[data-recovery-restore="+CSS.escape(arguments[0])+"]").closest("article").textContent.includes("已归档")',latestRecord.id));await pointerClick('[data-recovery-close]');await app.until(async()=>!await overlay(),'close history');await originalUnchanged();await normalClose()})
 await step('reopen-independent-recovered-file-after-normal-restart',async()=>{await start(recoveredPath);assert.equal(await readFile(recoveredPath,'utf8'),latest);assert((await editorText()).includes(`CHECKPOINT_B_${token}`));assert.equal((await state()).dirty,false);assert.equal(await overlay(),false);await originalUnchanged();await normalClose()})
}catch(e){record.errors.push(String(e));if(app){record.failureDom=await app.execute('return document.body.innerText.slice(0,10000)').catch(()=>null);await app.shot('failure').catch(()=>{})}}
finally{
 if(app&&owned){record.failureCleanup=true;try{await interruptOwned('failure-cleanup-only-owned-instance')}catch(e){record.errors.push('owned cleanup: '+String(e))}}
 record.finalOriginalSha256=sha(await readFile(fixture));record.originalPreserved=await readFile(fixture,'utf8')===original
 if(latestRecord){const r=await readRecord(latestRecord.id);record.finalManifest=r;await writeFile(path.join(out,'final-manifest.json'),JSON.stringify(r,null,2));await writeFile(path.join(out,'final-checkpoint-payload.md'),await recordBytes(r))}
 record.status=record.errors.length?'failed':'passed';await persist();console.log(JSON.stringify(record,null,2));if(record.errors.length)process.exitCode=1
}

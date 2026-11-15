// Production installed GTK application. Native keys drive edits/dialogs; DOM is observed.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, readlink, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startProduction } from '../../tests/helpers/native-production.mjs'
import { nativeFixture, x } from '../../tests/helpers/native-updates-fixture.mjs'
const out=path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR)
assert(process.env.MILKUP_NATIVE_EXCLUSIVE_DISPLAY==='1' && process.getuid()!==0)
assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS)
await mkdir(out,{recursive:true})
const sha=b=>createHash('sha256').update(b).digest('hex')
const fixture=path.join(out,'conflict-original.md'), rescue=path.join(out,'rescued-local.md')
const token=process.env.GITHUB_RUN_ID
const original=`BASE_${token}\n`, local=original+`LOCAL_UNSAVED_${token}`, external=`EXTERNAL_DISK_${token}\n`, externalLater=`EXTERNAL_RELOAD_${token}\n`
await writeFile(fixture,original,{flag:'wx'})
await writeFile(path.join(out,'expected-local.md'),local,{flag:'wx'})
await writeFile(path.join(out,'expected-external.md'),external,{flag:'wx'})
await writeFile(path.join(out,'expected-reloaded.md'),externalLater,{flag:'wx'})
const record={status:'running',sourceSha:'383c0712f21071467f2549d73a022b03db4b69aa',harnessSha:process.env.GITHUB_SHA,uid:process.getuid(),steps:[],snapshots:[],closes:[],errors:[],crashInjected:false}
const persist=()=>writeFile(path.join(out,'conflict-result.json'),JSON.stringify(record,null,2))
let app,owned
const ui=nativeFixture(()=>app)
async function step(name,fn){record.currentStep=name;await persist();const at=Date.now();try{await fn();record.steps.push({name,status:'passed',durationMs:Date.now()-at})}catch(e){record.steps.push({name,status:'failed',error:String(e),durationMs:Date.now()-at});throw e}finally{await persist()}}
const birth=async pid=>(await readFile(`/proc/${pid}/stat`,'utf8')).split(') ').at(-1).split(' ')[19]
async function start(file=fixture){app=await startProduction(file,out,{diagnostics:false});app.click=pointerClick;const window=ui.windowId(),pid=Number(x('getwindowpid',window));assert.equal(await readlink(`/proc/${pid}/exe`),process.env.TAURI_APP_PATH);owned={pid,birth:await birth(pid)};record.launches??=[];record.launches.push({...owned,window,at:new Date().toISOString()});await persist()}
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
async function normalClose(){
 assert.equal(await birth(owned.pid),owned.birth,'Close exact owned process generation')
 const window=ui.windowId();assert.equal(Number(x('getwindowpid',window)),owned.pid)
 const row={...owned,window,method:'X11-WM_PROTOCOLS-WM_DELETE_WINDOW',forced:false,processGone:false,before:await app.probe()};record.closes.push(row);await persist()
 assert.equal(row.before.dirty,false,'Do not discard unexpected unsaved changes during normal-close verification')
 row.request=JSON.parse(execFileSync(process.env.MILKUP_NATIVE_CLOSE_HELPER,[window,String(owned.pid)],{encoding:'utf8'}));await persist()
 await app.until(async()=>{try{return await birth(owned.pid)!==owned.birth}catch(e){if(e.code==='ENOENT')return true;throw e}},'owned product normal exit',20000)
 row.processGone=true;owned=null;await app.close();app=null;await persist()
}

const exists=async file=>{try{await readFile(file);return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
const externalState=()=>app.execute('return document.querySelector("[data-stat=external]")?.textContent')
const editorText=()=>app.execute('return document.querySelector(".milkup-editor")?.textContent')
async function snapshot(name){
 const dom=await app.execute('const n=document.querySelector("[data-notice]");return {external:document.querySelector("[data-stat=external]")?.textContent,notice:n?.textContent,noticeVisible:!!n&&!n.hidden&&n.getClientRects().length>0,editor:document.querySelector(".milkup-editor")?.textContent,recoveryPhase:document.querySelector("#app")?.dataset.recoveryPhase,recoveryVersion:document.querySelector("#app")?.dataset.recoveryVersion}')
 const row={name,dom,probe:await app.probe(),disk:await readFile(fixture,'utf8'),rescue:await exists(rescue)?await readFile(rescue,'utf8'):null}
 record.snapshots.push(row);await persist();return row
}
async function preserveBoth(name){const r=await snapshot(name);assert.equal(r.disk,external);assert(r.dom.editor.includes(`LOCAL_UNSAVED_${token}`));assert(r.dom.editor.includes(`BASE_${token}`));assert(!r.dom.editor.includes(`EXTERNAL_DISK_${token}`));assert(r.probe.dirty);return r}
async function menuCommand(command){if(!await app.execute('return !!document.querySelector("[data-app-menu]")?.getClientRects().length'))await ui.click('[data-menu-toggle]');await ui.click('[data-menu-section="file"]');await ui.click(`[data-command="${command}"]`);await ui.closeMenu()}
function saveDialog(){try{return x('search','--onlyvisible','--name','^(Save File|Save As|Save)$').split('\n').at(-1)}catch{return null}}
async function picker(destination){
 const win=await app.until(saveDialog,'real GTK Save As dialog',30000)
 assert.equal(Number(x('getwindowpid',win)),owned.pid);assert.equal(await birth(owned.pid),owned.birth)
 record.pickers??=[];const row={win,...owned,destination:destination??null};record.pickers.push(row);await persist()
 x('windowfocus','--sync',win);await app.delay(500)
 if(!destination){x('key','--clearmodifiers','Escape')}
 else{
  assert.equal(await exists(destination),false,'Rescue path must be new')
  x('mousemove','--window',win,'220','28','click','1');await app.delay(100);x('key','--clearmodifiers','ctrl+a');x('type','--clearmodifiers','--delay','2','--',destination);x('key','--clearmodifiers','ctrl+a');x('key','--clearmodifiers','ctrl+c')
  const clipboard=()=>execFileSync('/usr/bin/python3',['-c',"import gi;gi.require_version('Gtk','3.0');from gi.repository import Gtk,Gdk;print(Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text() or '',end='')"],{encoding:'utf8',timeout:5000})
  await app.until(()=>clipboard()===destination,'native Name entry exact rescue path');row.nameVerified=clipboard();await persist();x('key','--clearmodifiers','End');x('key','--clearmodifiers','Return')
 }
 await app.until(()=>!saveDialog(),'native Save As dialog closed',15000);x('windowfocus','--sync',ui.windowId())
}
async function captureCheckpoint(){
 await app.until(()=>app.execute('const a=document.querySelector("#app");return a?.dataset.recoveryPhase==="ready"&&Number(a.dataset.recoveryVersion)===Number(document.querySelector("[data-stat=version]")?.textContent)'),'completed checkpoint before external write',15000)
 const root=path.join(process.env.XDG_DATA_HOME,'app.milkup.desktop','recovery-v1'), candidates=await readdir(root);assert(candidates.length<100)
 for(const name of candidates){try{
  const dir=path.join(root,name),r=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'))
  if(r.originalPath!==fixture)continue
  assert(!r.payload.includes('/')&&!r.payload.includes('..'));const data=await readFile(path.join(dir,r.payload))
  if(sha(data)!==sha(Buffer.from(local)))continue
  assert.equal(r.sha256,sha(data));assert.equal(r.bytes,data.length);await writeFile(path.join(out,'observed-checkpoint.md'),data,{flag:'wx'});record.checkpoint={...r,verifiedSha256:sha(data),scope:'completed checkpoint observed; no crash or restart restoration tested'};await persist();return
 }catch(e){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e}}
 throw Error('No matching durable local checkpoint')
}
try{
 await step('open-exact-installed-production',start)
 record.binarySha256=sha(await readFile(process.env.TAURI_APP_PATH));assert.equal(record.binarySha256,process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
 await step('local-unsaved-edit-and-checkpoint',async()=>{await app.focus('.milkup-input-proxy');await app.key('ctrl+End');await app.text(`LOCAL_UNSAVED_${token}`);await app.until(async()=>(await app.probe()).dirty,'dirty edit committed');assert.equal(await readFile(fixture,'utf8'),original);await captureCheckpoint()})
 await step('real-external-write-observed-with-local-edit-retained',async()=>{await writeFile(fixture,external);await app.until(async()=>await externalState()==='conflict','real watcher conflict');record.initialConflict=await preserveBoth('external-watch-before-save');await app.shot('conflict-before-save')})
 await step('ordinary-save-refuses-external-overwrite',async()=>{await app.focus('.milkup-input-proxy');await app.key('ctrl+s');await app.until(()=>app.execute('const n=document.querySelector("[data-notice]");return n&&!n.hidden&&n.textContent.includes("文件已在编辑器外发生变化")'),'visible save refusal');await preserveBoth('save-blocked')})
 await step('dirty-reload-refused',async()=>{await menuCommand('reload-external');await app.until(()=>app.execute('return document.querySelector("[data-notice]")?.textContent.includes("无法重新载入：conflict")'),'dirty reload refused');await preserveBoth('reload-blocked')})
 await step('native-close-cancel-preserves-both-versions',async()=>{const win=ui.windowId();assert.equal(Number(x('getwindowpid',win)),owned.pid);record.closeCancelRequest=JSON.parse(execFileSync(process.env.MILKUP_NATIVE_CLOSE_HELPER,[win,String(owned.pid)],{encoding:'utf8'}));await app.until(()=>app.execute('return !document.querySelector("[data-close-confirm]").hidden'),'unsaved close confirmation');await ui.click('.dialog-button[data-close-confirm-action="cancel"]');await app.until(()=>app.execute('return document.querySelector("[data-close-confirm]").hidden'),'cancel close');assert.equal(await birth(owned.pid),owned.birth);await preserveBoth('close-cancelled')})
 await step('save-as-cancel-preserves-both-versions',async()=>{await app.focus('.milkup-input-proxy');await app.key('ctrl+shift+s');await picker();await app.until(async()=>!(await app.probe()).saving,'save dialog cancelled');assert.equal(await exists(rescue),false);await preserveBoth('save-as-cancelled')})
 await step('save-as-new-file-preserves-external-original',async()=>{await app.focus('.milkup-input-proxy');await app.key('ctrl+shift+s');await picker(rescue);await app.until(async()=>await exists(rescue)&&await readFile(rescue,'utf8')===local,'exact local rescue bytes');await app.until(async()=>{const p=await app.probe();return !p.saving&&!p.dirty&&p.path===rescue},'rescue saved state');assert.equal(await readFile(fixture,'utf8'),external);await snapshot('rescue-saved')})
 await step('normal-close-after-rescue',normalClose)
 await step('reopen-external-original',async()=>{await start(fixture);await app.until(async()=>(await editorText()).includes(`EXTERNAL_DISK_${token}`),'external version visible after reopen');assert.equal(await readFile(rescue,'utf8'),local);await snapshot('reopened-external')})
 await step('clean-external-change-explicit-reload',async()=>{await writeFile(fixture,externalLater);await app.until(async()=>await externalState()==='modified-clean','clean external change');const before=await snapshot('clean-before-reload');assert(before.dom.editor.includes(`EXTERNAL_DISK_${token}`));await menuCommand('reload-external');await app.until(async()=>await externalState()==='none'&&(await editorText()).includes(`EXTERNAL_RELOAD_${token}`),'explicit clean reload');assert.equal(await readFile(fixture,'utf8'),externalLater);assert.equal(await readFile(rescue,'utf8'),local);await snapshot('clean-reloaded')})
 await step('normal-close-after-reload',normalClose)
 await step('reopen-rescue-local-version',async()=>{await start(rescue);await app.until(async()=>(await editorText()).includes(`LOCAL_UNSAVED_${token}`),'local rescue visible after restart');assert.equal(await readFile(rescue,'utf8'),local);assert.equal(await readFile(fixture,'utf8'),externalLater);await snapshot('reopened-rescue')})
}catch(e){record.errors.push(String(e));if(app){record.failureDom=await app.execute('return document.body.innerText.slice(0,12000)').catch(()=>null);await app.shot('failure').catch(()=>{})}}
finally{
 if(app){try{await step('final-normal-close',normalClose)}catch(e){record.errors.push('close: '+String(e));record.forcedFailureCleanup=true;await app.close().catch(()=>{});app=null}}
 record.finalFiles={originalSha256:sha(await readFile(fixture)),rescueSha256:await exists(rescue)?sha(await readFile(rescue)):null};record.status=record.errors.length?'failed':'passed';await persist();console.log(JSON.stringify(record,null,2));if(record.errors.length)process.exitCode=1
}

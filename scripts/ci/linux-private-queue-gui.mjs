// Production installed GTK application. Native keys drive edits/dialogs; DOM is observed.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, readlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startProduction } from '../../tests/helpers/native-production.mjs'
import { nativeFixture, x } from '../../tests/helpers/native-updates-fixture.mjs'
const out=path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR)
assert(process.env.MILKUP_NATIVE_EXCLUSIVE_DISPLAY==='1' && process.getuid()!==0)
assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS)
await mkdir(out,{recursive:true})
const sha=b=>createHash('sha256').update(b).digest('hex')
const fixture=path.join(out,'source.md'), marker='MILKUP_LINUX_SAVED_'+Date.now()
const chinese=''
const original=`# MILKUP-PRIVATE-QUEUE-${process.env.GITHUB_RUN_ID}\n\nOne page received through the private loopback IPP queue.\n`
await writeFile(fixture,original,{flag:'wx'})
const expected=original
const record={status:'running',sourceSha:'383c0712f21071467f2549d73a022b03db4b69aa',harnessSha:process.env.GITHUB_SHA,uid:process.getuid(),steps:[],pdf:[],closes:[],errors:[],physicalPrintTested:false}
const persist=()=>writeFile(path.join(out,'gui-result.json'),JSON.stringify(record,null,2))
let app,owned
const ui=nativeFixture(()=>app)
async function step(name,fn){record.currentStep=name;await persist();const at=Date.now();try{await fn();record.steps.push({name,status:'passed',durationMs:Date.now()-at})}catch(e){record.steps.push({name,status:'failed',error:String(e),durationMs:Date.now()-at});throw e}finally{await persist()}}
const birth=async pid=>(await readFile(`/proc/${pid}/stat`,'utf8')).split(') ').at(-1).split(' ')[19]
async function start(){app=await startProduction(fixture,out,{diagnostics:false});app.click=pointerClick;const window=ui.windowId(),pid=Number(x('getwindowpid',window));assert.equal(await readlink(`/proc/${pid}/exe`),process.env.TAURI_APP_PATH);owned={pid,birth:await birth(pid)};record.launches??=[];record.launches.push({...owned,window,at:new Date().toISOString()});await persist()}
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
const panel='[data-plugin-ui="milkup.export-print:export-print-panel"]'
async function enableOutput(){await ui.list();const sel='.plugin-summary-card[data-plugin-id="milkup.export-print"] [role="switch"]';await ui.ready(sel);if(await app.execute('return document.querySelector(arguments[0]).getAttribute("aria-checked")!=="true"',sel))await ui.click(sel);await app.until(()=>app.execute('const e=document.querySelector(arguments[0]);return e?.getAttribute("aria-checked")==="true"&&!e.disabled',sel),'output enabled');await ui.closeMenu();if(!await app.execute('return document.querySelector("[data-sidebar-toggle]")?.getAttribute("aria-pressed")==="true"'))await ui.click('[data-sidebar-toggle]');const toggle=panel+' .plugin-ui-panel-toggle';await ui.ready(toggle);if(await app.execute('return document.querySelector(arguments[0]).getAttribute("aria-expanded")==="false"',toggle))await ui.click(toggle)}
async function field(key,value){const sel=panel+` [data-plugin-field-control="${key}"]`;await ui.ready(sel);await app.focus(sel);const options=await app.execute('return [...document.querySelector(arguments[0]).options].map(x=>x.value)',sel);const index=options.indexOf(value);assert(index>=0);await app.key('Home');for(let i=0;i<index;i++)await app.key('Down');await app.key('Tab');await app.until(()=>app.execute('return document.querySelector(arguments[0]).value===arguments[1]',sel,value),'field '+key)}

const queue=process.env.MILKUP_QUEUE_NAME
assert(/^MilkupPrivate[0-9]+$/.test(queue))
const queueControl=(...args)=>JSON.parse(execFileSync('python3',['scripts/ci/linux-private-queue-control.py',...args],{encoding:'utf8',timeout:20000}))
function printDialog(){try{return x('search','--onlyvisible','--name','^Print document$').split('\n').at(-1)}catch{return null}}
async function nativeDialog(action){
 const win=await app.until(printDialog,'owned native print dialog',45000),pid=Number(x('getwindowpid',win))
 assert.equal(await readlink(`/proc/${pid}/exe`),process.env.TAURI_APP_PATH)
 assert((await readFile(`/proc/${pid}/cmdline`,'utf8')).includes('--milkup-internal-output-helper'))
 const identity={win,pid,birth:await birth(pid)}
 const result=JSON.parse(execFileSync('/usr/bin/python3',['scripts/ci/linux-private-queue-dialog.py',String(pid),queue,action],{encoding:'utf8',timeout:20000}))
 record.dialogs??=[];record.dialogs.push({...identity,action,result});await persist()
 await app.until(()=>!printDialog(),'native print dialog closed',15000)
 x('windowfocus','--sync',ui.windowId())
}
async function printAction(action){
 await ui.click(panel+' [data-plugin-command="exportPrint.start"]')
 await nativeDialog(action)
 await app.until(()=>app.execute('const p=document.querySelector(arguments[0]);const a=p?.querySelector("[role=alert]");if(a)throw Error(a.textContent);return p?.textContent.includes(arguments[1])',panel,action==='cancel'?'已停止等待':'已提交打印'),'product print result',60000)
}
try{
 await step('open-exact-installed-production',start)
 record.binarySha256=sha(await readFile(process.env.TAURI_APP_PATH));assert.equal(record.binarySha256,process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
 await step('enable-output-through-ui',async()=>{await enableOutput();await field('format','print');await field('pageSize','a4');await field('orientation','portrait')})
 await step('native-dialog-cancel-without-job',async()=>{const before=queueControl('jobs');await printAction('cancel');const after=queueControl('jobs');assert.deepEqual(after.ids,before.ids);record.cancelBeforeSubmit={before,after,method:'application-native-GTK-dialog-Cancel'}})
 await step('native-non-file-print-receives-one-page',async()=>{const before=queueControl('jobs');await printAction('print');record.receipt=queueControl('receipt',String(before.ids.length),`MILKUP-PRIVATE-QUEUE-${process.env.GITHUB_RUN_ID}`);assert.equal(record.receipt.pages,1);assert.equal(record.receipt.markerCount,1);await app.shot('queue-submitted')})
 await step('cancel-only-owned-paused-queue-job',async()=>{queueControl('pause');const before=queueControl('jobs');await printAction('print');record.queueCancel=queueControl('cancel-new',JSON.stringify(before.ids));assert.equal(record.queueCancel.remainingActive,false);assert.equal(record.queueCancel.state,7);record.queueCancel.method='private-CUPS-Cancel-Job-not-application-rollback'})
 assert.equal(await readFile(fixture,'utf8'),original)
}catch(e){record.errors.push(String(e));if(app){record.failureDom=await app.execute('return document.body.innerText.slice(0,10000)').catch(()=>null);await app.shot('failure').catch(()=>{})}}
finally{
 if(app){try{await step('normal-product-close',normalClose)}catch(e){record.errors.push('close: '+String(e));record.forcedFailureCleanup=true;await app.close().catch(()=>{});app=null}}
 record.finalSourceSha256=sha(await readFile(fixture));record.status=record.errors.length?'failed':'passed';await persist();console.log(JSON.stringify(record,null,2));if(record.errors.length)process.exitCode=1
}

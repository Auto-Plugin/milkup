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
const fixture=path.join(out,'complex-pagination.md')
const expected=await readFile(fixture,'utf8')
const expectations=JSON.parse(await readFile(path.join(out,'expectations.json'),'utf8'))
const record={status:'running',sourceSha:'58c78973101acb0a22ca0cb5d24ef24bd9edc199',harnessSha:process.env.GITHUB_SHA,uid:process.getuid(),steps:[],launches:[],pdf:[],closes:[],errors:[],physicalPrintTested:false}
const persist=()=>writeFile(path.join(out,'gui-result.json'),JSON.stringify(record,null,2))
let app,owned
const ui=nativeFixture(()=>app)
async function step(name,fn){record.currentStep=name;await persist();const at=Date.now();try{await fn();record.steps.push({name,status:'passed',durationMs:Date.now()-at})}catch(e){record.steps.push({name,status:'failed',error:String(e),durationMs:Date.now()-at});throw e}finally{await persist()}}
const birth=async pid=>(await readFile(`/proc/${pid}/stat`,'utf8')).split(') ').at(-1).split(' ')[19]
const state=()=>app.probe()
const overlay=()=>app.execute('return [...document.querySelectorAll(".recovery-overlay,.dialog-overlay")].some(e=>!e.hidden&&e.getClientRects().length>0)')
async function start(file=fixture){
 const dir=path.join(out,`launch-${record.launches.length+1}`);await mkdir(dir)
 app=await startProduction(file,dir,{diagnostics:false,cleanupOwnedOnClose:false});app.click=pointerClick
 const window=ui.windowId(),pid=Number(x('getwindowpid',window));assert.equal(await readlink(`/proc/${pid}/exe`),process.env.TAURI_APP_PATH)
 owned={pid,birth:await birth(pid),uid:process.getuid(),executable:process.env.TAURI_APP_PATH,sha256:sha(await readFile(process.env.TAURI_APP_PATH)),fixture:file,root:out}
 assert.equal(owned.sha256,process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
 record.launches.push({...owned,window,at:new Date().toISOString()});record.productMaps=(await readFile(`/proc/${pid}/maps`,'utf8')).split('\n').filter(l=>/libwebkit|libjavascriptcore/i.test(l));assert(record.productMaps.length>0);assert(record.productMaps.every(l=>/\/usr\/lib\//.test(l)));await persist()
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
const panel='[data-plugin-ui="milkup.export-print:export-print-panel"]'
async function enableOutput(){await ui.list();const sel='.plugin-summary-card[data-plugin-id="milkup.export-print"] [role="switch"]';await ui.ready(sel);if(await app.execute('return document.querySelector(arguments[0]).getAttribute("aria-checked")!=="true"',sel))await ui.click(sel);await app.until(()=>app.execute('const e=document.querySelector(arguments[0]);return e?.getAttribute("aria-checked")==="true"&&!e.disabled',sel),'output enabled');await ui.closeMenu();if(!await app.execute('return document.querySelector("[data-sidebar-toggle]")?.getAttribute("aria-pressed")==="true"'))await ui.click('[data-sidebar-toggle]');const toggle=panel+' .plugin-ui-panel-toggle';await ui.ready(toggle);if(await app.execute('return document.querySelector(arguments[0]).getAttribute("aria-expanded")==="false"',toggle))await ui.click(toggle)}
async function field(key,value){const sel=panel+` [data-plugin-field-control="${key}"]`;await ui.ready(sel);await app.focus(sel);const options=await app.execute('return [...document.querySelector(arguments[0]).options].map(x=>x.value)',sel);const index=options.indexOf(value);assert(index>=0);await app.key('Home');for(let i=0;i<index;i++)await app.key('Down');await app.key('Tab');await app.until(()=>app.execute('return document.querySelector(arguments[0]).value===arguments[1]',sel,value),'field '+key)}
function dialog(){try{return x('search','--onlyvisible','--name','^Choose output destination$').split('\n').at(-1)}catch{return null}}
async function savePicker(destination){const win=await app.until(dialog,'native output destination',45000),pid=Number(x('getwindowpid',win));assert.equal(await readlink(`/proc/${pid}/exe`),process.env.TAURI_APP_PATH);assert((await readFile(`/proc/${pid}/cmdline`,'utf8')).includes('--milkup-internal-output-helper'));record.dialogs??=[];record.dialogs.push({win,pid,birth:await birth(pid),destination});await persist();x('windowfocus','--sync',win);await app.delay(500);x('key','--clearmodifiers','ctrl+l');await app.delay(150);x('key','--clearmodifiers','ctrl+a');x('type','--clearmodifiers','--delay','2','--',destination);x('key','--clearmodifiers','Tab');await app.delay(200);const g=x('getwindowgeometry','--shell',win),w=Number(/WIDTH=(\d+)/.exec(g)[1]),h=Number(/HEIGHT=(\d+)/.exec(g)[1]);x('mousemove','--window',win,String(w-50),String(h-24),'click','1');await app.until(()=>!dialog(),'native output picker closed',15000);x('windowfocus','--sync',ui.windowId())}
try{
 await step('open-exact-installed-synthetic-markdown',async()=>{await start();assert.equal((await state()).dirty,false);assert.equal(await readFile(fixture,'utf8'),expected)})
 await step('enable-output-through-product-ui',enableOutput)
 for(const paper of expectations.papers){
  await step('export-'+paper.name,async()=>{
   await field('format','pdf');await field('pageSize',paper.pageSize);await field('orientation',paper.orientation)
   await ui.click(panel+' [data-plugin-command="exportPrint.start"]')
   const destination=path.join(out,paper.name+'.pdf');await savePicker(destination)
   await app.until(async()=>{const s=await app.execute('const p=document.querySelector(arguments[0]);return {text:p?.textContent,error:p?.querySelector("[role=alert]")?.textContent}',panel);if(s.error)throw Error(s.error);return s.text?.includes('已保存')},'PDF committed',90000)
   const bytes=await readFile(destination);assert(bytes.subarray(0,5).toString()==='%PDF-')
   record.pdf.push({name:paper.name,destination,bytes:bytes.length,sha256:sha(bytes),settings:paper})
   await writeFile(path.join(out,paper.name+'-pdfinfo.txt'),execFileSync('pdfinfo',['-box',destination],{encoding:'utf8'}))
   await app.shot(paper.name+'-product-done');assert.equal(await readFile(fixture,'utf8'),expected)
  }).catch(e=>record.errors.push(String(e)))
 }
}catch(e){record.errors.push(String(e));if(app){record.failureDom=await app.execute('return document.body.innerText.slice(0,10000)').catch(()=>null);await app.shot('failure').catch(()=>{})}}
finally{
 if(app&&owned){try{await step('normal-close',normalClose)}catch(e){record.errors.push('normal close: '+String(e));try{await interruptOwned('failure-cleanup-only-owned-instance')}catch(cleanup){record.errors.push('owned cleanup: '+String(cleanup))}}}
 record.finalSourceSha256=sha(await readFile(fixture));record.status=record.errors.length?'failed':'passed';await persist();console.log(JSON.stringify(record,null,2));if(record.errors.length)process.exitCode=1
}

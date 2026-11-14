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
const chinese='中文复制验收：春风又绿江南岸，明月何时照我还。'
const paragraphs=Array.from({length:100},(_,i)=>`BODY-${String(i+1).padStart(3,'0')} This generated paragraph checks complete pagination and readable text.\n\n`)
const original=`# MILKUP-LINUX-PDF-START\n\n${chinese}\n\n`+paragraphs.join('')+'MILKUP-LINUX-PDF-END\n'
await writeFile(fixture,original,{flag:'wx'})
const expected=original+'\n'+marker
await writeFile(path.join(out,'expectations.json'),JSON.stringify({fixtureSha256:sha(Buffer.from(original)),expectedSavedSha256:sha(Buffer.from(expected)),chinese,markers:['MILKUP-LINUX-PDF-START',...paragraphs.map((_,i)=>`BODY-${String(i+1).padStart(3,'0')}`),'MILKUP-LINUX-PDF-END',marker],minimumPages:2,papers:[{name:'a4-portrait',pageSize:'a4',orientation:'portrait',width:595.276,height:841.89},{name:'letter-landscape',pageSize:'letter',orientation:'landscape',width:792,height:612}]},null,2))
const record={status:'running',sourceSha:'b877746f5dfd236dfc13f718ed23d837b8e4f89d',harnessSha:process.env.GITHUB_SHA,uid:process.getuid(),steps:[],pdf:[],closes:[],errors:[],physicalPrintTested:false}
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
function dialog(){try{return x('search','--onlyvisible','--name','^Choose output destination$').split('\n').at(-1)}catch{return null}}
async function savePicker(destination){const win=await app.until(dialog,'native output destination',45000),pid=Number(x('getwindowpid',win));assert.equal(await readlink(`/proc/${pid}/exe`),process.env.TAURI_APP_PATH);assert((await readFile(`/proc/${pid}/cmdline`,'utf8')).includes('--milkup-internal-output-helper'));record.dialogs??=[];record.dialogs.push({win,pid,birth:await birth(pid),destination});await persist();x('windowfocus','--sync',win);await app.delay(500);x('key','--clearmodifiers','ctrl+l');await app.delay(150);x('key','--clearmodifiers','ctrl+a');x('type','--clearmodifiers','--delay','2','--',destination);x('key','--clearmodifiers','Tab');await app.delay(200);const g=x('getwindowgeometry','--shell',win),w=Number(/WIDTH=(\d+)/.exec(g)[1]),h=Number(/HEIGHT=(\d+)/.exec(g)[1]);x('mousemove','--window',win,String(w-50),String(h-24),'click','1');await app.until(()=>!dialog(),'native output picker closed',15000);x('windowfocus','--sync',ui.windowId())}
try{
 await step('open-installed-production',start)
 record.binarySha256=sha(await readFile(process.env.TAURI_APP_PATH));assert.equal(record.binarySha256,process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
 await step('edit-and-save-real-keys',async()=>{await app.focus('.milkup-input-proxy');await app.key('ctrl+End');await app.key('Return');await app.text(marker);await app.key('ctrl+s');await app.until(async()=>await readFile(fixture,'utf8')===expected,'exact edited bytes saved',15000);await app.until(async()=>!(await app.probe()).dirty,'clean save state');await app.shot('edited-saved')})
 await step('normal-close-after-save',normalClose)
 await step('reopen-exact-saved-document',async()=>{await start();assert.equal(await readFile(fixture,'utf8'),expected);await app.focus('.milkup-input-proxy');await app.key('ctrl+End');await app.until(()=>app.execute('return document.querySelector(".milkup-editor")?.textContent.includes(arguments[0])',marker),'saved marker visible after new process');await app.shot('reopened-saved-marker')})
 await step('enable-output-through-product-ui',enableOutput)
 const expectations=JSON.parse(await readFile(path.join(out,'expectations.json'),'utf8'))
 for(const paper of expectations.papers){
  await step('pdf-'+paper.name,async()=>{
   await field('format','pdf');await field('pageSize',paper.pageSize);await field('orientation',paper.orientation)
   await ui.click(panel+' [data-plugin-command="exportPrint.start"]')
   const destination=path.join(out,paper.name+'.pdf');await savePicker(destination)
   await app.until(async()=>{const state=await app.execute('const p=document.querySelector(arguments[0]);return {text:p?.textContent,error:p?.querySelector("[role=alert]")?.textContent}',panel);if(state.error)throw Error(state.error);return state.text?.includes('已保存')},'PDF committed',90000)
   const bytes=await readFile(destination);const info=execFileSync('pdfinfo',[destination],{encoding:'utf8'}),raw=execFileSync('pdftotext',['-raw',destination,'-'],{encoding:'utf8'}),layout=execFileSync('pdftotext',['-layout',destination,'-'],{encoding:'utf8'});await writeFile(path.join(out,paper.name+'-pdfinfo.txt'),info);await writeFile(path.join(out,paper.name+'-text.txt'),raw);await writeFile(path.join(out,paper.name+'-layout.txt'),layout)
   const pages=Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);const size=/^Page size:\s+([\d.]+) x ([\d.]+)/m.exec(info);const markers=expectations.markers.map(marker=>({marker,count:raw.split(marker).length-1}));const row={name:paper.name,sha256:sha(bytes),bytes:bytes.length,pages,width:Number(size?.[1]),height:Number(size?.[2]),markers,chineseExpected:chinese,chineseExact:raw.includes(chinese),copyCheck:'Poppler text extraction, not a manual PDF-viewer clipboard check'};record.pdf.push(row);await persist();execFileSync('pdftoppm',['-f','1','-singlefile','-scale-to','1400','-png',destination,path.join(out,paper.name+'-page1')]);await app.shot(paper.name+'-product-done');assert(pages>=2,'At least two real PDF pages');assert(markers.every(m=>m.count===1),'Every source marker exactly once in PDF text');assert(row.chineseExact,'Exact original Chinese copy text without normalization');assert(Math.abs(row.width-paper.width)<2&&Math.abs(row.height-paper.height)<2,'Exact paper/orientation');assert.equal(await readFile(fixture,'utf8'),expected)
  }).catch(e=>{record.errors.push(String(e))})
 }
} catch(e){record.errors.push(String(e));if(app){record.failureDom=await app.execute('return document.body.innerText.slice(0,10000)').catch(()=>null);await app.shot('failure').catch(()=>{})}}
finally{
 if(app){try{await step('final-normal-close',normalClose)}catch(e){record.errors.push('close: '+String(e));record.forcedFailureCleanup=true;await app.close().catch(()=>{});app=null}}
 record.finalSourceSha256=sha(await readFile(fixture));record.status=record.errors.length?'failed':'passed';await persist();console.log(JSON.stringify(record,null,2));if(record.errors.length)process.exitCode=1
}

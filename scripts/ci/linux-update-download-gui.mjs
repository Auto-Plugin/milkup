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
const fixture=path.join(out,'update-document.md')
await writeFile(fixture,`UPDATE_DOCUMENT_${process.env.GITHUB_RUN_ID}\n`,{flag:'wx'})
const {startFixture}=await import('../release/test-support/in-app-update-server.mjs')
const artifact=await readFile(process.env.MILKUP_UPDATE_TARGET_DEB)
assert.equal(sha(artifact),'9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde')
const server=await startFixture({artifact,openssl:'/usr/bin/openssl',directory:out,maxMs:240000})
const {chmod}=await import('node:fs/promises')
process.env.MILKUP_CI_UPDATE_FIXTURE=path.join(out,'public-fixture.json')
await chmod(process.env.MILKUP_CI_UPDATE_FIXTURE,0o600)
const record={status:'running',targetSourceSha:"58c78973101acb0a22ca0cb5d24ef24bd9edc199",harnessSha:process.env.GITHUB_SHA,uid:process.getuid(),steps:[],snapshots:[],closes:[],errors:[],crashInjected:false}
const persist=()=>writeFile(path.join(out,'update-result.json'),JSON.stringify(record,null,2))
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

const state=()=>app.execute(`const e=document.querySelector('[data-application-updates]');return {text:e?.innerText,error:e?.querySelector('[role="alert"]')?.textContent??null,actions:[...e?.querySelectorAll('[data-application-update-action]')??[]].map(b=>b.dataset.applicationUpdateAction),version:document.querySelector('[data-app-version]')?.textContent}`)
const mode=value=>writeFile(path.join(out,'endpoint-mode.txt'),value)
const about=async()=>{if(!await app.execute('return !document.querySelector("[data-app-menu]")?.hidden'))await ui.click('[data-menu-toggle]');await ui.click('[data-menu-section="about"]')}
const clickAction=name=>ui.click(`[data-application-updates] [data-application-update-action="${name}"]`)
async function rejected(label,pattern){
 const value=await app.until(async()=>{const s=await state();return s.error?s:false},label,30000)
 assert.match(value.error,pattern);assert.match(value.version,/2\.0\.0-beta\.9/);assert(!value.actions.includes('install'))
 record.cases??=[];record.cases.push({label,state:value,requests:[...server.record.requests]});await persist()
}
try{
 await step('start-download-only-beta9',start)
 record.binarySha256=sha(await readFile(process.env.TAURI_APP_PATH));assert.equal(record.binarySha256,process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
 await step('about-rejects-wrong-manifest-signature',async()=>{await about();await rejected('bad-manifest',/signature|签名/i);assert.equal(server.record.requests.filter(r=>r.path==='/candidate.deb').length,0)})
 await step('signed-manifest-and-download-http-rejection',async()=>{await mode('download-error');await clickAction('check');await app.until(async()=>(await state()).actions.includes('download'),'signed beta10 offered');await clickAction('download');await rejected('http-503',/503|下载|status/i)})
 await step('corrupted-deb-rejected-before-install',async()=>{await mode('bad-artifact');await clickAction('download');await rejected('corrupt-deb',/signature|签名/i)})
 await step('exact-deb-download-and-signature-ready',async()=>{await mode('valid');await clickAction('download');record.ready=await app.until(async()=>{const s=await state();return s.actions.includes('install')?s:false},'verified exact beta10 deb',30000);assert(!record.ready.error);assert.match(record.ready.text,/2\.0\.0-beta\.10/);const transferred=server.record.requests.filter(r=>r.path==='/candidate.deb'&&r.mode==='valid');assert.equal(transferred.length,1);assert.equal(transferred[0].sha256,sha(artifact));assert.equal(transferred[0].bytes,artifact.length)})
 await step('clear-verified-download-without-install',async()=>{await clickAction('cancel');await app.until(async()=>{const s=await state();return s.actions.includes('download')&&!s.actions.includes('install')},'download cleared');record.cleared=await state()})
 await step('ordinary-edit-save-remains-usable',async()=>{await ui.click('[data-menu-close]');await app.focus('.milkup-input-proxy');await app.key('ctrl+End');await app.text('UPDATE_CHECK_ONLY_SAVED');await app.until(async()=>(await app.probe()).dirty,'dirty');await app.key('ctrl+s');await app.until(async()=>!(await app.probe()).dirty&&(await readFile(fixture,'utf8')).endsWith('UPDATE_CHECK_ONLY_SAVED'),'saved');record.documentSha256=sha(await readFile(fixture));assert.equal(sha(await readFile(process.env.TAURI_APP_PATH)),record.binarySha256);assert.equal(sha(await readFile(process.env.MILKUP_UPDATE_TARGET_DEB)),sha(artifact))})
}catch(e){record.errors.push(String(e));if(app)record.failureDom=await app.execute('return document.body.innerText.slice(0,12000)').catch(()=>null)}
finally{
 if(app){try{await step('normal-close',normalClose)}catch(e){record.errors.push('close: '+String(e));record.forcedFailureCleanup=true;await app.close().catch(()=>{});app=null}}
 await server.stop();record.endpoint=server.record;record.installRequested=false;record.credentialsEntered=false;record.status=record.errors.length?'failed':'passed-download-only';await persist();console.log(JSON.stringify({status:record.status,steps:record.steps,errors:record.errors}));if(record.errors.length)process.exitCode=1
}


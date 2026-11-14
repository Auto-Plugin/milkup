import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {startProduction} from '/tmp/milkup-windows-manual-candidate/tests/helpers/native-production.mjs'
import {beta5Fixture,observeBeta5} from '/tmp/milkup-windows-manual-candidate/tests/helpers/native-beta5-fixture.mjs'
const output='/tmp/milkup-beta5-windowed-table-readiness-diagnostic',file=output+'/windowed-integrity.md',sha=b=>createHash('sha256').update(b).digest('hex')
const original=await readFile('/tmp/milkup-beta5-windowed-final/evidence/windowed-integrity.md','utf8'),expected=original.replace('| Beta | 2 |','|  |  |\r\n| Beta | 2 |'),samples=[]
await writeFile(file,original,{flag:'wx'});assert.equal(sha(await readFile(process.env.TAURI_APP_PATH)),process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
let app,ui,started,commandBefore,commandApplied,result,recovery
const control='[data-plugin-ui="milkup.formatting:formatting-toolbar"] [data-plugin-command="formatting.tableAddRow"]'
const persist=()=>writeFile(output+'/readiness.json',JSON.stringify({binary:process.env.TAURI_APP_PATH,binarySha256:process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256,boundary:'Native Source to Live, read-only timed DOM observations, one toolbar click after continuously stable document/context/geometry, one Save after committed edit and public aria-busy false.',recovery,commandBefore,commandApplied,result,samples},null,2)+'\n')
async function observation(){
 const s=await observeBeta5(app),probe=await app.probe(),ui=await app.execute('const e=document.querySelector(arguments[0]),r=e?.getBoundingClientRect();return {busy:document.querySelector("[data-editor-host]")?.getAttribute("aria-busy"),target:e?{html:e.outerHTML,visible:!!r&&r.width>0&&r.height>0&&getComputedStyle(e).display!=="none",disabled:e.disabled,rect:r.toJSON()}:null}',control)
 return {at:new Date().toISOString(),elapsedMs:Date.now()-started,probe,cursor:s.cursor,focusEditor:s.focus.editor,previews:s.previews,tableLine:s.lines.find(l=>l.line==='27'),editor:s.editor,...ui}
}
try{
 app=await startProduction(file,output,{diagnostics:false});ui=beta5Fixture(app)
 recovery=await app.execute('const e=document.querySelector(".recovery-overlay");return e&&!e.hidden?e.textContent:null')
 if(recovery)await ui.pointer('[data-recovery-close]')
 await app.key('ctrl+0');await app.until(async()=>(await observeBeta5(app)).zoom===1,'zoom reset')
 await ui.position(original,original.indexOf('Alpha'),'source');commandBefore=await app.probe()
 started=Date.now();await app.key('ctrl+2')
 let lastSignature,stableSince=0,stable
 while(Date.now()-started<5000){
  const s=await observation();samples.push(s)
  const valid=s.probe.mode==='live'&&s.probe.version===commandBefore.version&&s.probe.path===file&&s.cursor===original.indexOf('Alpha')&&s.focusEditor&&s.busy==='false'&&s.target?.visible&&!s.target.disabled&&s.tableLine?.text==='| Alpha | 1 |'&&s.previews.length===2
  const signature=valid?JSON.stringify({target:s.target,table:s.tableLine.rect,previews:s.previews.map(p=>p.rect),editor:s.editor}):null
  if(signature&&signature===lastSignature){if(Date.now()-stableSince>=300){stable=s;break}}else{lastSignature=signature;stableSince=Date.now()}
  await persist();await app.delay(40)
 }
 assert(stable,'Bounded continuous current table/context geometry readiness')
 await app.shot('01-stable-before-single-click');execFileSync('/usr/bin/import',['-display',process.env.DISPLAY,'-window','root',output+'/01-stable-before-single-click-system.png'],{env:process.env})
 await ui.pointer(control)
 await app.until(async()=>{const s=await observation();samples.push(s);if(s.probe.version===commandBefore.version+1&&s.probe.dirty&&s.busy==='false'){const lines=await app.execute('return [...document.querySelectorAll(".milkup-line")].filter(e=>["28","29"].includes(e.dataset.line)).map(e=>({line:e.dataset.line,text:e.textContent,from:Number(e.dataset.from),to:Number(e.dataset.to)}))');if(lines.some(l=>l.line==='28'&&l.text==='|  |  |'&&l.from===expected.indexOf('|  |  |'))&&lines.some(l=>l.line==='29'&&l.text==='| Beta | 2 |'&&l.from===expected.indexOf('| Beta | 2 |'))){commandApplied={...s,lines};return true}}return false},'one edit committed and no longer busy')
 await app.key('ctrl+s');await app.until(async()=>!(await app.probe()).dirty&&(await readFile(file,'utf8'))===expected,'single Save exact expected bytes')
 result={bytes:Buffer.byteLength(expected),sha256:sha(await readFile(file)),probe:await app.probe()};await persist();await app.shot('02-committed-saved-single-command');execFileSync('/usr/bin/import',['-display',process.env.DISPLAY,'-window','root',output+'/02-committed-saved-single-command-system.png'],{env:process.env});console.log('DIAGNOSTIC PASS',samples.length,'samples',JSON.stringify(result))
}finally{await app?.close();await persist()}

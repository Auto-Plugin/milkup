// Native Pinyin keys only; read-only DOM listeners never inject Unicode or input events.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, readlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { verifyNativeImeCommit } from './native-ime-contract.mjs'
import { startProduction } from '../../tests/helpers/native-production.mjs'
import { nativeFixture, x } from '../../tests/helpers/native-updates-fixture.mjs'
const out=process.env.MILKUP_NATIVE_EVIDENCE_DIR,scale=Number(process.env.GDK_SCALE)
assert(out&&process.getuid()!==0&&[1,2].includes(scale))
assert.equal(process.env.GTK_IM_MODULE,'ibus');assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS)
await mkdir(out,{recursive:true})
const hash=b=>createHash('sha256').update(b).digest('hex')
const report={status:'running',sourceSha:process.env.BASELINE_SHA,harnessSha:process.env.GITHUB_SHA,scale,steps:[],keys:[],errors:[],closes:[],scope:'Installed exact candidate; real IBus libpinyin and GTK scale override, not Microsoft Pinyin or Windows system DPI'}
const persist=()=>writeFile(path.join(out,'ime-result.json'),JSON.stringify(report,null,2))
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const until=async(fn,label,ms=15000)=>{const t=Date.now();while(Date.now()-t<ms){const v=await fn();if(v)return v;await sleep(100)}throw Error('Timeout: '+label)}
const key=async value=>{report.keys.push({kind:'native-key',value,at:Date.now()});await persist();x('key','--clearmodifiers',value);await sleep(100)}
const type=async value=>{assert(/^[\x20-\x7e]+$/.test(value));report.keys.push({kind:'native-ascii-pinyin-or-literal-keys',value,at:Date.now()});await persist();x('type','--clearmodifiers','--delay','120','--',value);await sleep(200)}
const engine=name=>{execFileSync('ibus',['engine',name]);assert.equal(execFileSync('ibus',['engine'],{encoding:'utf8'}).trim(),name)}
const shot=name=>execFileSync('/usr/bin/python3',['-c',`import gi;gi.require_version('Gdk','3.0');from gi.repository import Gdk;w=Gdk.get_default_root_window();p=Gdk.pixbuf_get_from_window(w,0,0,w.get_width(),w.get_height());assert p;p.savev('${path.join(out,name+'.png')}', 'png', [], [])`])
async function step(name,fn){report.currentStep=name;await persist();const start=Date.now();try{await fn();report.steps.push({name,status:'passed',ms:Date.now()-start})}catch(e){report.steps.push({name,status:'failed',ms:Date.now()-start,error:String(e)});throw e}finally{await persist()}}
let app,owned,control
const fixture=path.join(out,'ime-document.md'),base='# IME_NATIVE_B877\n\n'
let expected=base
await writeFile(fixture,base,{flag:'wx'})
const birth=async pid=>(await readFile(`/proc/${pid}/stat`,'utf8')).split(') ').at(-1).split(' ')[19]
const ui=nativeFixture(()=>app)
async function start(){app=await startProduction(fixture,out,{diagnostics:false});const win=ui.windowId(),pid=Number(x('getwindowpid',win));assert.equal(await readlink(`/proc/${pid}/exe`),process.env.TAURI_APP_PATH);owned={pid,birth:await birth(pid),win};report.launches??=[];report.launches.push({...owned});await app.execute(`window.__imeAudit={events:[],overflow:false};for(const type of ['compositionstart','compositionupdate','compositionend','beforeinput','input','keydown','keyup'])document.addEventListener(type,e=>{const a=window.__imeAudit;if(a.events.length>=600){a.overflow=true;return}a.events.push({type:e.type,key:e.key??null,target:e.target?.className??null,data:e.data??null,trusted:e.isTrusted,composing:e.isComposing??null,inputType:e.inputType??null,time:performance.now()})},true)`);await persist()}
async function saveExact(){await key('ctrl+s');await app.until(async()=>await readFile(fixture,'utf8')===expected,'exact saved Unicode bytes',15000);await app.until(async()=>!(await app.probe()).dirty,'clean saved document');await sleep(2600);assert.equal(await readFile(fixture,'utf8'),expected)}
async function close(){assert.equal(await birth(owned.pid),owned.birth);assert.equal((await app.probe()).dirty,false);const row={...owned,forced:false,exited:false};report.closes.push(row);await persist();row.request=JSON.parse(execFileSync(process.env.MILKUP_NATIVE_CLOSE_HELPER,[owned.win,String(owned.pid)],{encoding:'utf8'}));await app.until(async()=>{try{return await birth(owned.pid)!==owned.birth}catch(e){if(e.code==='ENOENT')return true;throw e}},'normal process exit',20000);row.exited=true;await app.close();app=null;owned=null;await persist()}
try{
 await step('native-gtk-ime-positive-control',async()=>{
  control=spawn('/usr/bin/python3',['scripts/ci/linux-ime-control.py',out],{stdio:['ignore','inherit','inherit']})
  const win=await until(()=>{try{return x('search','--onlyvisible','--name','^MILKUP_IME_CONTROL$').split('\n').at(-1)}catch{return null}},'control window')
  assert.equal(Number(x('getwindowpid',win)),control.pid);x('windowfocus','--sync',win);await sleep(500);engine('libpinyin')
  await type('zhongwen');shot('control-preedit-candidates');await key('space');await key('comma');await key('period');await key('question');await key('exclam');await key('colon');await key('semicolon');await key('ctrl+s')
  await until(async()=>{try{return (await readFile(path.join(out,'control.txt'),'utf8')).length>0}catch{return false}},'control committed')
  report.controlText=await readFile(path.join(out,'control.txt'),'utf8');shot('control-committed');await persist();assert.equal(report.controlText,'中文，。？！：；','Native control establishes engine and punctuation key semantics')
  await key('ctrl+q');await until(()=>control.exitCode!==null,'control normal exit');assert.equal(control.exitCode,0);control=null
 })
 await step('installed-start-and-native-scale',async()=>{await start();report.binarySha256=hash(await readFile(process.env.TAURI_APP_PATH));assert.match(process.env.MILKUP_IME_EXPECTED_BINARY_SHA256??'',/^[a-f0-9]{64}$/);assert.equal(report.binarySha256,process.env.MILKUP_IME_EXPECTED_BINARY_SHA256);report.display=await app.execute('return {ratio:devicePixelRatio,width:innerWidth,height:innerHeight,appZoom:document.querySelector("#app")?.dataset.appearanceZoom}');assert.equal(report.display.ratio,scale);assert(!report.display.appZoom||Number(report.display.appZoom)===1);shot('installed-initial')})
 for(const mode of ['source','live'])await step('real-pinyin-'+mode,async()=>{
  engine('xkb:us::eng');await key(mode==='source'?'ctrl+1':'ctrl+2');await app.until(async()=>(await app.probe()).mode===mode,'editor mode');await app.focus('.milkup-input-proxy');await key('ctrl+End')
  if(mode==='live'){await key('Return');expected+='\n'}
  engine('libpinyin');const before=await app.execute('return window.__imeAudit.events.length')
  await type('zhongwen');await sleep(1200);shot(mode+'-preedit-candidates')
  report[mode+'Preedit']=await app.execute('return {audit:window.__imeAudit,activeTag:document.activeElement?.tagName,activeClass:document.activeElement?.className,proxy:document.querySelector(".milkup-input-proxy")?.value,focused:document.hasFocus()}');await persist()
  await key('space');expected+='中文';report[mode+'Commit']=await app.execute('return {audit:window.__imeAudit,proxy:document.querySelector(".milkup-input-proxy")?.value,dom:document.querySelector(".milkup-editor")?.textContent}');await persist();await saveExact()
  if(mode==='source'){await key('ctrl+z');expected=expected.slice(0,-2);await saveExact();await key('ctrl+shift+z');expected+='中文';await saveExact()}
  await type('zhongwen');shot(mode+'-second-identical-preedit');await key('space');expected+='中文';await saveExact()
  for(const p of ['comma','period','question','exclam','colon','semicolon'])await key(p)
  expected+='，。？！：；';await saveExact();shot(mode+'-punctuation-committed')
  await type('ceshi');shot(mode+'-cancel-candidates');await key('Escape');await saveExact()
  engine('xkb:us::eng');await type('_'+mode.toUpperCase());expected+='_'+mode.toUpperCase();await saveExact()
  const audit=await app.execute('return window.__imeAudit');report[mode]={audit,expected,savedSha256:hash(await readFile(fixture)),state:await app.probe()};await persist()
  assert(!audit.overflow);report[mode].eventsSinceStart=audit.events.slice(before);await persist()
 })
 await step('strict-native-composition-event-contract',async()=>{for(const mode of ['source','live'])report[mode].nativeCommit=verifyNativeImeCommit(report[mode].eventsSinceStart);await persist()})
 await step('normal-close-and-reopen-saved-unicode',async()=>{await close();await start();assert.equal(await readFile(fixture,'utf8'),expected);await app.focus('.milkup-input-proxy');await key('ctrl+End');await app.until(()=>app.execute('return document.querySelector(".milkup-editor")?.textContent.includes("_LIVE")'),'saved tail visible');shot('reopened');await close()})
}catch(e){report.errors.push(String(e));if(app){report.failureAudit=await app.execute('return window.__imeAudit').catch(()=>null);report.failureDom=await app.execute('return document.body.innerText.slice(0,8000)').catch(()=>null);shot('failure')}}
finally{
 if(control&&control.exitCode===null){control.kill('SIGTERM');report.forcedControlCleanup=true}
 if(app){try{if(!(await app.probe()).dirty)await close();else throw Error('Unexpected dirty document')}catch(e){report.errors.push('cleanup: '+String(e));report.forcedProductCleanup=true;await app.close().catch(()=>{})}}
 report.finalSourceSha256=hash(await readFile(fixture));report.status=report.errors.length?'failed':'passed';await persist();console.log(JSON.stringify(report,null,2));if(report.errors.length)process.exitCode=1
}

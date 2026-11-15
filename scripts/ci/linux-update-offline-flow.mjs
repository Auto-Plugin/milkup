// Executes the exact native harness orchestration over HTTP using its real
// client parser, actual product controller/UI and a controlled DOM/backend.
// No native GUI, native install or product acceptance is claimed here.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import https from 'node:https'
import {createHash} from 'node:crypto'
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createRequire,stripTypeScriptTypes} from 'node:module'
import {startFixture} from '../release/test-support/in-app-update-server.mjs'
import {verifyMinisign} from '../release/update-readiness.mjs'
import {unwrapWebDriverValue} from '../../tests/helpers/native-production.mjs'
const require=createRequire(path.join(path.resolve(process.env.MILKUP_OFFLINE_JSDOM_ROOT),'package.json'))
const {JSDOM}=require('jsdom')
assert.equal(require('jsdom/package.json').version,'27.4.0')
const output=path.resolve(process.argv[2]);await mkdir(output,{recursive:true})
const sha=b=>createHash('sha256').update(b).digest('hex')
const gui=await readFile('scripts/ci/linux-update-download-gui.mjs','utf8')
const transportSource=await readFile('tests/helpers/native-production.mjs','utf8')
const requestBody=transportSource.split('  const request = async (method, route, body) => {')[1]?.split('  const execute =')[0]
const tail=gui.slice(gui.indexOf('const state=()=>app.execute('))
assert(tail.startsWith('const state=')&&tail.includes("await step('ordinary-edit-save-remains-usable'"))
const stepSource=gui.slice(gui.indexOf('async function step('),gui.indexOf('const birth='))
const probeScript=/const probe = \(\) =>[\s\S]*?`([^`]+)`/.exec(transportSource)[1]
const original=JSON.parse(await readFile('scripts/ci/evidence/linux-update-download-43697294000/gui/update-result.json','utf8'))
const originalEnvelope=JSON.parse(original.steps.find(s=>s.status==='failed').error.slice('Error: '.length))
assert.equal(originalEnvelope.value.error,'检查更新失败：The signature verification failed')
const controllerSource=await readFile('apps/desktop/src/application-updates.ts','utf8')
const rendererSource=await readFile('apps/desktop/src/application-updates-ui.ts','utf8')
const js=source=>stripTypeScriptTypes(source,{mode:'strip'}).replace(/^import .*$/mg,'').replace(/export function /g,'function ')
const createController=Function(js(controllerSource)+';return createApplicationUpdatesController')()
const render=Function('Download','RefreshCw','RotateCw','X','iconSvg',js(rendererSource)+';return renderApplicationUpdates')('download','check','install','cancel',()=>'<svg aria-hidden="true"></svg>')
const runTail=Object.getPrototypeOf(async function(){}).constructor('assert','app','ui','out','record','persist','step','start','normalClose','readFile','writeFile','sha','process','server','artifact','fixture','path','console',tail)
const names=['start-download-only-beta9','about-rejects-wrong-manifest-signature','signed-manifest-and-download-http-rejection','corrupted-deb-rejected-before-install','exact-deb-download-and-signature-ready','clear-verified-download-without-install','ordinary-edit-save-remains-usable','normal-close']
const summary={scope:'offline orchestration only; real client HTTP/parser and product controller/UI, controlled page/backend',sourceHashes:{harness:sha(gui),transport:sha(transportSource),controller:sha(controllerSource),renderer:sha(rendererSource)},cases:[]}
for(const fault of [null,...names]){
 const root=await mkdtemp(path.join(tmpdir(),'milkup-offline-flow-'))
 let endpoint,driver,controller,dom,paintTimer
 const record={status:'running',steps:[],errors:[],closes:[],snapshots:[]}
 const persisted=[]
 const persist=async()=>{await writeFile(path.join(root,'result.json'),JSON.stringify(record));persisted.push(JSON.parse(JSON.stringify(record)))}
 const step=Function('record','persist',stepSource+';return step')(record,persist)
 let dirty=false,closed=false,forced=false,faultSent=false,stageStatus,release,modeReads=0,installCalls=0,domSamples=0
 const inputs=[]
 try{
  const artifact=Buffer.from('owned offline artifact: never executable')
  const binary=path.join(root,'inert-executable'),target=path.join(root,'target.bin'),fixture=path.join(root,'document.md')
  await writeFile(binary,'inert owned binary identity');await writeFile(target,artifact);await writeFile(fixture,'OFFLINE_DOCUMENT\n')
  endpoint=await startFixture({artifact,openssl:'/usr/bin/openssl',directory:root,maxMs:15000})
  const config=JSON.parse(await readFile(path.join(root,'public-fixture.json'),'utf8'))
  const get=route=>new Promise((resolve,reject)=>https.get(endpoint.base+route,{ca:endpoint.cert},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,bytes:Buffer.concat(chunks)}))}).on('error',reject))
  dom=new JSDOM('<div id="app" data-loading="ready" data-saving="false"></div><span data-stat="path"></span><span data-save-dot></span><button data-menu-toggle></button><div data-app-menu hidden><button data-menu-section="about"></button><button data-menu-close></button><span data-app-version>2.0.0-beta.9</span><div data-application-updates></div></div><textarea class="milkup-input-proxy"></textarea>',{url:'http://127.0.0.1/owned-offline-page'})
  const document=dom.window.document
  // jsdom has no layout innerText implementation; no layout result is asserted.
  Object.defineProperty(dom.window.HTMLElement.prototype,'innerText',{get(){return this.textContent}})
  document.querySelector('[data-stat="path"]').textContent=fixture
  const paint=()=>{clearTimeout(paintTimer);paintTimer=setTimeout(()=>{document.querySelector('[data-application-updates]').innerHTML=render(controller.state)},12)}
  const backend={
   async check(){
    const response=await get('/manifest.json');assert.equal(response.status,200)
    const envelope=JSON.parse(response.bytes),payload=Buffer.from(envelope.payload,'base64')
    try{verifyMinisign(payload,envelope.signature,config.channel.publicKey)}catch{throw Error(originalEnvelope.value.error)}
    release=JSON.parse(payload).release
    return {configured:true,currentVersion:'2.0.0-beta.9',channel:'beta',release:{...release,id:'owned-offline-release'}}
   },
   async stage(id){
    assert.equal(id,'owned-offline-release');const response=await get('/candidate.deb')
    if(response.status!==200)throw Error('下载或签名校验失败：Download request failed with status: '+response.status)
    try{verifyMinisign(response.bytes,release.platforms['linux-x86_64'].signature,config.channel.publicKey)}catch{throw Error('下载或签名校验失败：The signature verification failed')}
    stageStatus={phase:'ready',received:response.bytes.length,total:response.bytes.length}
   },
   async status(){assert(stageStatus);return stageStatus},
   async cancel(){stageStatus=undefined},
   async requestInstall(){installCalls++;throw Error('OFFLINE_INSTALL_FORBIDDEN')},
  }
  controller=createController({service:{adapter:backend,dispose(){}},currentVersion:'2.0.0-beta.9',changed:paint});paint()
  const execute=(script,args)=>dom.window.Function('document','location','window',`return (function(){${script}}).apply(null,${JSON.stringify(args)})`)(document,dom.window.location,dom.window)
  driver=createServer(async(req,res)=>{
   try{
    const chunks=[];for await(const b of req)chunks.push(b)
    const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{}
    let value=null
    if(!faultSent&&record.currentStep===fault){faultSent=true;res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({value:{error:'unknown error',message:'owned injected failure: '+fault}}));return}
    if(req.url==='/session/owned/execute/sync'){domSamples++;value=execute(body.script,body.args)}
    else if(req.url==='/owned-input'){
     inputs.push(body)
     if(body.kind==='click'){
      const element=document.querySelector(body.selector);assert(element,'Actual selector must exist: '+body.selector);assert(!element.disabled)
      if(body.selector==='[data-menu-toggle]')document.querySelector('[data-app-menu]').hidden=false
      else if(body.selector==='[data-menu-close]')document.querySelector('[data-app-menu]').hidden=true
      else if(body.selector==='[data-menu-section="about"]')assert(!document.querySelector('[data-app-menu]').hidden)
      else{assert(!document.querySelector('[data-app-menu]').hidden);const action=element.dataset.applicationUpdateAction;assert(['check','download','cancel'].includes(action),'Install is forbidden');void controller[action]();modeReads++}
     }else if(body.kind==='text'){
      const textarea=document.querySelector('.milkup-input-proxy');assert.equal(document.activeElement,textarea);textarea.value+=body.value;dirty=true;document.querySelector('[data-save-dot]').classList.add('is-dirty')
     }else if(body.kind==='key'){
      assert(['ctrl+End','ctrl+s'].includes(body.value));if(body.value==='ctrl+s'){await writeFile(fixture,'OFFLINE_DOCUMENT\n'+document.querySelector('.milkup-input-proxy').value);dirty=false;document.querySelector('[data-save-dot]').classList.remove('is-dirty')}
     }else throw Error('Unexpected input')
    }else if(req.method==='DELETE'&&req.url==='/session/owned'){closed=true;controller.dispose();value=null}
    else if(req.url==='/original-response'){value=originalEnvelope.value}
    else throw Error('Unexpected controlled WebDriver route '+req.url)
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({value}))
   }catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({value:{error:'unknown error',message:String(e)}}))}
  })
  await new Promise(resolve=>driver.listen(0,'127.0.0.1',resolve))
  const environment={env:{TAURI_DRIVER_URL:`http://127.0.0.1:${driver.address().port}`,TAURI_APP_PATH:binary,MILKUP_UPDATE_TARGET_DEB:target,MILKUP_NATIVE_EXPECTED_BINARY_SHA256:sha(await readFile(binary))},exitCode:0}
  const request=Function('fetch','nativeRequestTimeout','unwrapWebDriverValue','process',`const request = async (method, route, body) => {${requestBody};return request`)(fetch,()=>2000,unwrapWebDriverValue,environment)
  await assert.rejects(request('GET','/original-response'),/signature verification failed/)
  const app={
   execute:(script,...args)=>request('POST','/session/owned/execute/sync',{script,args}),
   until:async(fn,label)=>{const end=Date.now()+1200;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,8))}throw Error('Offline bounded timeout: '+label)},
   focus:selector=>app.execute('document.querySelector(arguments[0]).focus()',selector),
   key:value=>request('POST','/owned-input',{kind:'key',value}),
   text:value=>request('POST','/owned-input',{kind:'text',value}),
   probe:()=>app.execute(probeScript),
   close:async()=>{forced=true;await request('DELETE','/session/owned')},
  }
  const ui={click:async selector=>{await app.until(()=>app.execute('return !!document.querySelector(arguments[0])',selector),'rendered action '+selector);await request('POST','/owned-input',{kind:'click',selector})}}
  const start=async()=>{void controller.start();await app.execute('return document.querySelector("#app").dataset.loading')}
  const normalClose=async()=>{assert(!dirty,'Never discard unsaved synthetic state');await request('DELETE','/session/owned');record.closes.push({normal:true,controlledPageClosed:closed})}
  // Run the actual unchanged native tail, including error capture and finally.
  const orchestrationConsole=[]
  await runTail(assert,app,ui,root,record,persist,step,start,normalClose,readFile,writeFile,sha,environment,endpoint,artifact,fixture,path,{log:line=>orchestrationConsole.push(line)})
  const saved=JSON.parse(await readFile(path.join(root,'result.json'),'utf8'))
  assert.deepEqual(saved,record);assert(closed);assert.equal(installCalls,0);assert.equal(endpoint.record.status,'closed')
  if(fault){assert(faultSent);assert.equal(record.status,'failed');assert.equal(environment.exitCode,1);assert(record.steps.some(s=>s.name===fault&&s.status==='failed'));assert(record.errors.length);assert(persisted.some(p=>p.steps.some(s=>s.name===fault&&s.status==='failed')))}
  else{assert.equal(record.status,'passed-download-only');assert.deepEqual(record.steps.map(s=>[s.name,s.status]),names.map(n=>[n,'passed']));assert.equal(modeReads,5);assert.equal(endpoint.record.requests.length,5);assert.equal(environment.exitCode,0)}
  if(fault!=='normal-close'){assert.equal(forced,false);assert.equal(record.steps.at(-1).name,'normal-close');assert.equal(record.steps.at(-1).status,'passed')}
  else{assert.equal(forced,true);assert.equal(record.forcedFailureCleanup,true)}
  const result={fault,status:'passed-offline-contract',domSamples,delayedPaintMs:12,persistCount:persisted.length,closed,forced,inputs,record,orchestrationConsole}
  await writeFile(path.join(output,(fault??'complete')+'.json'),JSON.stringify(result,null,2))
  summary.cases.push({fault,status:result.status,closed,forced,steps:record.steps.map(s=>({name:s.name,status:s.status}))})
 }catch(error){
  summary.status='failed-offline-orchestration';summary.error=String(error)
  await writeFile(path.join(output,'failure-'+(fault??'complete')+'.json'),JSON.stringify({error:String(error),record,persisted},null,2))
  await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));throw error
 }finally{
  controller?.dispose();clearTimeout(paintTimer);dom?.window.close();await endpoint?.stop()
  if(driver){driver.closeAllConnections();await new Promise(resolve=>driver.close(resolve))}
  await rm(root,{recursive:true,force:true})
 }
}
summary.status='passed-offline-orchestration-only';await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary))

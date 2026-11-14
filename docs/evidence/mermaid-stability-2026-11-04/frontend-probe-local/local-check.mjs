import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { frontendBoundaryProbeScripts as scripts } from '/workspace/milkup-mermaid-stability/tests/windows/mermaid-frontend-boundary-probe.mjs'
const require = createRequire('/workspace/milkup-mermaid-stability/package.json')
const { chromium } = require('@playwright/test')
const server = createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html','content-security-policy':"script-src 'self' blob:; object-src 'none'"});res.end('<!doctype html><body><p>Owned local diagnostic fixture</p></body>')})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
try {
 const page=await browser.newPage(); page.on('console',m=>console.log('browser',m.text()));page.on('pageerror',e=>console.log('pageerror',String(e)))
 await page.goto(`http://127.0.0.1:${server.address().port}/`)
 await page.evaluate(()=>{window.__TAURI_INTERNALS__={invoke:async(command)=>{if(command!=='bridge_status')throw Error('Unexpected mock command');return 'ok'}}})
 const run=(frame,name,args=[],async=false)=>frame.evaluate(new Function('args',async?`return new Promise(resolve=>(function(){${scripts[name]}}).apply(null,[...args,value=>resolve(value?.frames?{...value,frames:value.frames.length}:value)]))`:`return (function(){${scripts[name]}}).apply(null,args)`),args)
 const nonce='a'.repeat(48), main=page.mainFrame()
 const initialized=await run(main,'initialize',[nonce],true)
 assert.equal(initialized.parentControl,'fulfilled-ok')
 const frames=page.frames().filter(f=>f!==main); assert.equal(frames.length,2); const children=[]; for(const f of frames){const text=await f.evaluate(()=>document.body.textContent); children[text.includes('navigation')?0:1]=f}
 const child=await run(children[0],'inspectFrame',[nonce,initialized.parentOrigin],true)
 assert.equal(child.parentDomReadable,false);assert.equal(child.nativeInvocation,'unavailable')
 await children[0].evaluate(()=>location.replace('about:blank'))
 await page.waitForTimeout(150)
 assert.equal(children[0].url(),'about:blank')
 await run(main,'prepareTelemetry',[nonce]); await run(children[1],'receiveTelemetry',[nonce,initialized.parentOrigin]); await run(main,'transferTelemetry',[nonce]); await page.waitForTimeout(100); assert.equal(await run(main,'telemetryReady',[nonce]),true); const start=await run(main,'armParent',[nonce])
 await run(children[1],'armChild',[nonce,initialized.parentOrigin,start])
 await page.waitForTimeout(2200)
 const observed=await run(main,'collect',[nonce]); console.log(JSON.stringify(observed))
 assert.equal(observed.exactSourceAndOpaqueOrigin,true)
 assert.equal(observed.cancellation.childStartObserved,true)
 assert.equal(observed.cancellation.ownedFrameRemoved,true)
 assert.equal(observed.cancellation.hardTerminationProven,false)
 assert.equal(await run(main,'cleanup',[nonce]),true)
 assert.equal(await page.locator('iframe').count(),0)
 const report={schema:1,scope:'Linux Chromium fixed diagnostic script operability only; parent bridge is mocked. No Windows/Tauri boundary, native capability, production resource loading, or hard-memory guarantee is established.',child,observed,cleanupConfirmed:true,status:'passed'}
 await writeFile('/workspace/mermaid-stability-evidence/frontend-probe/local-check.json',JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report))
} finally {await browser.close();await new Promise(resolve=>server.close(resolve))}

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
const repo = '/workspace/milkup-mermaid-stability'
const output = '/workspace/mermaid-stability-evidence/wide-scale-controls'
const raw = '/workspace/mermaid-stability-evidence/source-41760093749/extracted/gui-pure-standard'
const require = createRequire(repo + '/package.json')
const { build } = require('esbuild')
const { chromium } = require('@playwright/test')
const markdown = await readFile(raw + '/fixture-gui-wide.md.log', 'utf8')
const png = await readFile(raw + '/gui-wide-diagram.png')
const css = await readFile(repo + '/apps/desktop/src/style.css', 'utf8')
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox'] })
const reports=[]
try {
for (const kind of ['editor','source']) {
 const aliases = Object.fromEntries(['core', 'assets', 'input', 'markdown', 'view-dom'].map(name => ['@milkup/' + name, repo + '/packages/' + name + '/src/index.ts']))
 aliases['@milkup/core/internal/document-png-image'] = repo + '/packages/core/src/document-png-image.ts'
 const js = await build({ stdin: { contents: `
import { MemoryDocumentSource, MemoryTextDocument, EditorState, Selection } from '@milkup/core';
import { SourceDocumentView, EditorView } from '@milkup/view-dom';
import { createDocumentPngImage, documentPngResourceStats } from '@milkup/core/internal/document-png-image';
import { createDesktopDocumentPresentationService } from '${repo}/apps/desktop/src/document-presentation-service.ts';
const doc = new MemoryTextDocument(${JSON.stringify(markdown)});
const source = new MemoryDocumentSource({ documentId:'scale-proof', document:doc });
const bytes = Uint8Array.from(atob('${png.toString('base64')}'), c=>c.charCodeAt(0));
let renders=0, provides=0, releases=0, layouts=0;
const service = createDesktopDocumentPresentationService({
 current:()=>({ source, identity:${kind==='source'?'source':'doc'} }), theme:()=> 'light',
 renderers:()=>[{id:'mermaid',pluginId:'fixed-probe',contexts:['fence'],fenceLanguages:['mermaid']}],rendererGeneration:()=>1,cacheableFence:()=>true,
 render:async(_p,_r,input)=>{renders++;return {complete:true,fragments:[{from:input.from,to:input.to,layout:'block',accessibleText:'Wide diagram',content:createDocumentPngImage({bytes,width:3528,height:126,title:'Wide diagram',release:()=>releases++})}]};}
});
const view = ${kind==='source'?'new SourceDocumentView({source,':'new EditorView({state:new EditorState({doc,selection:Selection.cursor(0)}),'} parent:document.getElementById('root'),mode:'live',documentPresentation:{provide(...args){provides++;return service.provide(...args);}}});
let original;
window.probe={snapshot:()=>{
 const image=view.contentDOM.querySelector('img'), outer=view.contentDOM.querySelector('[data-document-png-view]'), viewport=view.contentDOM.querySelector('[data-document-png-viewport]'), button=view.contentDOM.querySelector('[data-document-png-scale]'); if(image&&!original)original=image;
 const row=outer?.closest('.milkup-line'), rowLine=Number(row?.dataset.line); return {rowHeight:row?.getBoundingClientRect().height,measuredRowHeight:view.lineTop ? view.lineTop(rowLine + 1) - view.lineTop(rowLine) : undefined,renders,provides,releases,image:image?{sameElement:image===original,src:image.src,width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight}:null,mode:outer?.dataset.documentPngView,buttonVisible:button?getComputedStyle(button.parentElement).display!=='none':false,buttonLabel:button?.textContent,viewport:viewport?{width:viewport.clientWidth,scrollWidth:viewport.scrollWidth,scrollLeft:viewport.scrollLeft,tabIndex:viewport.tabIndex}:null,doc:doc.text,rootScrollWidth:view.dom.scrollWidth,rootClientWidth:view.dom.clientWidth,stats:documentPngResourceStats()};},stop:()=>{view.destroy();service.clear();}};
`, resolveDir:repo, loader:'ts'}, alias:aliases, bundle:true, write:false, format:'esm', platform:'browser'})
 const html=`<html><head><style>${css}\nhtml,body{margin:0;height:100%}#root{width:1028px;height:693px}.milkup-editor{scrollbar-width:auto}.milkup-editor::-webkit-scrollbar{width:17px;height:17px}</style></head><body><main id="root"></main><script type="module">${js.outputFiles[0].text}</script></body></html>`
 const server=createServer((_q,r)=>{r.setHeader('Content-Type','text/html');r.end(html)})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const page=await browser.newPage({viewport:{width:1100,height:800}});const errors=[];page.on('pageerror',e=>errors.push(String(e)))
 await page.goto('http://127.0.0.1:'+server.address().port)
 const button=page.locator('[data-document-png-scale]');await button.waitFor({state:'visible'});await page.waitForTimeout(500)
 const fit=await page.evaluate(()=>window.probe.snapshot());assert.equal(fit.mode,'fit');assert.equal(fit.renders,1);assert.equal(fit.image.naturalWidth,3528);assert(fit.image.width<1000)
 await button.focus();await button.press('Enter');await page.waitForTimeout(1000)
 const natural=await page.evaluate(()=>window.probe.snapshot());assert.equal(natural.mode,'natural');assert.equal(natural.image.width,3528);assert.equal(natural.image.height,126);assert.equal(natural.image.src,fit.image.src);assert.equal(natural.image.sameElement,true);assert.equal(natural.renders,fit.renders);assert.equal(natural.provides,fit.provides);assert.equal(natural.doc,markdown);if(kind==='source')assert(Math.abs(natural.rowHeight-natural.measuredRowHeight)<1);assert(natural.rootScrollWidth<=natural.rootClientWidth);assert(natural.viewport.scrollWidth>natural.viewport.width)
 await page.screenshot({path:output+'/'+kind+'-natural.png'})
 const viewport=page.locator('[data-document-png-viewport]');await viewport.focus();await viewport.press('ArrowRight');await viewport.press('ArrowRight');await page.waitForTimeout(500)
 const scrolled=await page.evaluate(()=>window.probe.snapshot());assert(scrolled.viewport.scrollLeft>0);assert.equal(scrolled.mode,'natural');assert.equal(scrolled.renders,fit.renders);assert.equal(scrolled.provides,fit.provides)
 await button.focus();await button.press('Space');await page.waitForTimeout(1000)
 const restored=await page.evaluate(()=>window.probe.snapshot());assert.equal(restored.mode,'fit');assert.equal(restored.viewport.scrollLeft,0);assert.equal(restored.image.src,fit.image.src);assert.equal(restored.renders,fit.renders);assert.equal(restored.provides,fit.provides);assert.equal(restored.doc,markdown);if(kind==='source')assert(Math.abs(restored.rowHeight-restored.measuredRowHeight)<1)
 await page.screenshot({path:output+'/'+kind+'-fit.png'})
 await button.click();await page.waitForTimeout(3000);const stable=await page.evaluate(()=>window.probe.snapshot());assert.equal(stable.mode,'natural');assert.equal(stable.renders,fit.renders);assert.equal(stable.provides,fit.provides);assert.equal(stable.image.src,fit.image.src);assert.equal(stable.image.sameElement,true)
 await page.evaluate(()=>window.probe.stop());await page.waitForTimeout(100);const stopped=await page.evaluate(()=>window.probe.snapshot());assert.deepEqual(stopped.stats,{bytes:0,images:0,decodedOwners:0});assert.equal(errors.length,0)
 const report={kind,mode:'Actual Linux Chromium with production views/service and recorded native PNG; mocked render provider, not native Windows acceptance',fit,natural,scrolled,restored,stable,stopped,errors};reports.push(report);await writeFile(output+'/'+kind+'-browser-check.json',JSON.stringify(report,null,2)+'\n');console.log(kind,JSON.stringify({renders:stable.renders,provides:stable.provides,natural:[natural.image.width,natural.image.height],scrollLeft:scrolled.viewport.scrollLeft,cleanup:stopped.stats}))
 await page.close();await new Promise(resolve=>server.close(resolve))
}
} finally {await browser.close()}
await writeFile(output+'/summary.json',JSON.stringify({passed:true,reports},null,2)+'\n')

// Offline inspection of actual saved HTML. Not a product renderer or native UI.
const {createRequire}=require('node:module')
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto')
const {chromium}=createRequire('/workspace/milkup/package.json')('@playwright/test')
async function main(){
 const [input,fixtureId,output]=process.argv.slice(2)
 if(!input||!fixtureId||!output)throw Error('usage: node review-html.cjs ACTUAL.html FIXTURE_ID OUTPUT_DIR')
 const raw=await fs.readFile(input),manifest=JSON.parse(await fs.readFile('/workspace/milkup/tests/fixtures/p5-output/milestone06/manifest.json','utf8'))
 const fixture=manifest.fixtures.find(f=>f.id===fixtureId)
 if(!fixture)throw Error('Unknown fixture')
 await fs.mkdir(output,{recursive:true})
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true})
 try{
  const context=await browser.newContext({viewport:{width:1200,height:1000},offline:true,javaScriptEnabled:false,serviceWorkers:'block',acceptDownloads:false})
  const requests=[],blocked=[],errors=[]
  await context.route(/^(https?|file|ftp):/,async route=>{blocked.push(route.request().url());await route.abort()})
  const page=await context.newPage();page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(String(e)))
  await page.setContent(raw.toString('utf8'),{waitUntil:'load'})
  await page.evaluate(()=>document.fonts.ready)
  const dom=await page.evaluate(()=>{
   const box=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
   const all=s=>[...document.querySelectorAll(s)]
   const ids=all('[id]').map(n=>n.id)
   return {bodyText:document.body.innerText,bodyBounds:box(document.body),documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,documentHeight:document.documentElement.scrollHeight,csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,unsafeElements:all('script,iframe,object,embed,base,form,link').map(n=>n.outerHTML),eventHandlers:all('*').flatMap(n=>[...n.attributes].filter(a=>/^on/i.test(a.name)).map(a=>({tag:n.tagName,name:a.name}))),duplicateIds:ids.filter((id,i)=>ids.indexOf(id)!==i),fallbacks:all('.source-fallback').map(n=>n.textContent),warnings:all('.export-warning li').map(n=>n.textContent),diagrams:all('.presentation-block').filter(n=>n.querySelector('svg')).map(n=>({bounds:box(n),svg:[...n.querySelectorAll('svg')].map(s=>({viewBox:s.getAttribute('viewBox'),bounds:box(s)})),labels:[...n.querySelectorAll('svg text')].map(t=>({text:t.textContent,bounds:box(t)})),rectCount:n.querySelectorAll('svg rect').length,arrowReferenceCount:n.querySelectorAll('[marker-end],[marker-start]').length,markup:n.outerHTML})),images:all('img').map(n=>({alt:n.alt,loaded:n.complete&&n.naturalWidth>0,naturalWidth:n.naturalWidth,naturalHeight:n.naturalHeight,bounds:box(n)}))}
  })
  const screenshots=[]
  if(dom.documentHeight<=5000){await page.screenshot({path:path.join(output,'whole-page.png'),fullPage:true});screenshots.push('whole-page.png')}
  else{
   await page.screenshot({path:path.join(output,'document-start.png')});screenshots.push('document-start.png')
   await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.screenshot({path:path.join(output,'document-end.png')});screenshots.push('document-end.png')
  }
  const graphs=page.locator('.presentation-block').filter({has:page.locator('svg')})
  for(let i=0;i<await graphs.count();i++){const name=`diagram-${i+1}.png`;await graphs.nth(i).screenshot({path:path.join(output,name)});screenshots.push(name)}
  const counts=Object.fromEntries(fixture.bodyMarkersExactlyOnce.map(m=>[m,[...dom.bodyText.matchAll(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Za-z0-9_-])','g'))].length]))
  const report={scope:'Independent offline sandboxed headless viewer of actual saved UTF8 bytes using setContent, no DISPLAY. Not direct-file navigation or native PDF/print acceptance.',input,artifactSHA256:crypto.createHash('sha256').update(raw).digest('hex'),fixtureId,fixtureSHA256:fixture.sourceSHA256,browserVersion:browser.version(),dom,bodyMarkerCounts:counts,network:{requests,blocked},pageErrors:errors,screenshots,visualReview:'PENDING_ACTUAL_PIXEL_INSPECTION',remaining:['Actual producer version/provenance and all expected node/arrow pixels require review.','No timeout-remediation or deterministic-reliability claim follows from one visible output.','PDF codepoint and long-block pagination boundaries are separate.']}
  await fs.writeFile(path.join(output,'review.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({input,diagramCount:dom.diagrams.length,expected:fixture.diagrams.length,fallbackCount:dom.fallbacks.length,bodyMarkerFailures:Object.entries(counts).filter(([,n])=>n!==1),requests,errors,screenshots},null,2))
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exit(1)})

const {createRequire}=require('node:module'),fs=require('node:fs/promises')
const {chromium}=createRequire('/workspace/milkup/package.json')('@playwright/test')
const base='/workspace/milkup-export-print-evidence/milestone01/content/final-html10/'
async function main(){
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
 try{
  const results=[]
  for(const [name,file] of [['complete','complete.html'],['without-images','without-images.html']]){
   const context=await browser.newContext({offline:true,viewport:{width:1200,height:1000}}),page=await context.newPage()
   await page.setContent(await fs.readFile('/workspace/milkup-export-print-evidence/milestone01/native-ui/runs/p5-html-10/'+file,'utf8'),{waitUntil:'load'})
   await page.evaluate(()=>document.fonts.ready)
   const detail=await page.evaluate(()=>{
    const bounds=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
    const math=[...document.querySelectorAll('math')].map(e=>({display:e.getAttribute('display'),namespace:e.namespaceURI,text:e.textContent,markup:e.outerHTML,bounds:bounds(e)}))
    const diagrams=[...document.querySelectorAll('.presentation-block')].filter(e=>e.querySelector('svg')).map(e=>({bounds:bounds(e),svgCount:e.querySelectorAll('svg').length,text:[...e.querySelectorAll('svg text')].map(t=>({text:t.textContent,bounds:bounds(t)})),markup:e.outerHTML}))
    const links=[...document.querySelectorAll('a[href^="#source-"]')].map(e=>({label:e.textContent,href:e.getAttribute('href'),target:document.getElementById(e.getAttribute('href').slice(1))?.textContent}))
    const headingLeads=[...document.querySelectorAll('.heading-lead')].map(e=>({display:getComputedStyle(e).display,children:[...e.children].map(c=>c.tagName),heading:e.querySelector('h1,h2,h3,h4,h5,h6')?.textContent}));return {math,diagrams,links,headingLeads,warningText:[...document.querySelectorAll('.export-warning li')].map(e=>e.textContent),fallbackCount:document.querySelectorAll('.source-fallback').length}
   })
   await page.emulateMedia({media:'print'})
   detail.printStyles=await page.evaluate(()=>({headingLeads:[...document.querySelectorAll('.heading-lead')].map(e=>({display:getComputedStyle(e).display,breakInside:getComputedStyle(e).breakInside,pageBreakInside:getComputedStyle(e).pageBreakInside})),warningAside:[...document.querySelectorAll('aside.export-warning')].map(e=>({breakInside:getComputedStyle(e).breakInside,pageBreakInside:getComputedStyle(e).pageBreakInside}))}))
   await page.emulateMedia({media:'screen'})
   const clicks=[]
   for(const link of detail.links){
    await page.locator(`a[href="${link.href}"]`).click()
    clicks.push(await page.evaluate(href=>{const t=document.getElementById(href.slice(1)),r=t.getBoundingClientRect();return {href,hash:location.hash,targetVisible:r.bottom>0&&r.top<innerHeight,targetText:t.textContent,targetBounds:{top:r.top,bottom:r.bottom},scrollY}},link.href))
   }
   detail.anchorClickChecks=clicks
   await page.locator('math').nth(0).screenshot({path:base+'rich-'+name+'-math-inline.png'})
   await page.locator('math').nth(1).screenshot({path:base+'rich-'+name+'-math-display.png'})
   await page.locator('.presentation-block:has(svg)').screenshot({path:base+'rich-'+name+'-diagram.png'})
   results.push({name,...detail})
   await context.close()
  }
  const comparison={mathMarkupIdentical:JSON.stringify(results[0].math.map(x=>x.markup))===JSON.stringify(results[1].math.map(x=>x.markup)),diagramMarkupIdentical:JSON.stringify(results[0].diagrams.map(x=>x.markup))===JSON.stringify(results[1].diagrams.map(x=>x.markup)),footnoteLinkPairsIdentical:JSON.stringify(results[0].links)===JSON.stringify(results[1].links)}
  await fs.writeFile(base+'production-rich-details.json',JSON.stringify({results,comparison},null,2)+'\n')
  for(let i=0;i<2;i++){
   const target=base+(i===0?'production-rich-html-review.json':'production-rich-without-images-review.json'),d=JSON.parse(await fs.readFile(target,'utf8'))
   d.richSemanticReview=results[i];d.variantComparison=comparison
   d.remainingAcceptance=['Independent offline Chromium review of actual file bytes via setContent; direct file:// opening remains blocked by environment administrator policy.','Native WebKit PDF/print output and cross-platform checks require their own evidence; this screenshot does not establish those results.']
   await fs.writeFile(target,JSON.stringify(d,null,2)+'\n')
  }
  console.log(JSON.stringify({comparison,results:results.map(x=>({name:x.name,math:x.math.map(m=>({display:m.display,text:m.text,bounds:m.bounds})),diagramLabels:x.diagrams.flatMap(d=>d.text.map(t=>t.text)),anchors:x.anchorClickChecks}))},null,2))
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exit(1)})

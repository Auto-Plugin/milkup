const fs=require('node:fs'); const crypto=require('node:crypto');
const {chromium}=require('/workspace/milkup/node_modules/@playwright/test');
const run='/workspace/milkup-plugin-lifecycle-evidence/milestone02/native-ui/runs/p6-m02-cold-output-01';
const out=__dirname;const html=fs.readFileSync(run+'/cold-first.html','utf8');
(async()=>{let browser;const requests=[];const errors=[];try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1200,height:1000},offline:true,serviceWorkers:'block'});
 await context.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
 await page.setContent(html,{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:out+'/top.png'});
 const dom=await page.evaluate(()=>({math:[...document.querySelectorAll('math')].map(e=>({display:e.getAttribute('display'),text:e.textContent,box:e.getBoundingClientRect().toJSON()})),svg:[...document.querySelectorAll('svg')].map(e=>({box:e.getBoundingClientRect().toJSON(),texts:[...e.querySelectorAll('text')].map(n=>n.textContent)})),links:[...document.querySelectorAll('a')].map(e=>({href:e.getAttribute('href'),text:e.textContent,resolved:!!document.getElementById(e.getAttribute('href').slice(1))})),images:[...document.images].map(e=>({complete:e.complete,width:e.naturalWidth,height:e.naturalHeight})),warnings:document.querySelector('.export-warning')?.textContent}));
 await page.evaluate(()=>window.scrollTo(0,document.querySelector('math').getBoundingClientRect().top+scrollY-100));
 await page.screenshot({path:out+'/rich.png'});
 await page.locator('.export-warning').screenshot({path:out+'/warnings.png'});
 fs.writeFileSync(out+'/viewer.json',JSON.stringify({method:'Original production HTML bytes passed unmodified to Playwright setContent; about:blank document, not file-navigation compatibility proof; installed Chromium offline artifact viewer only, not product output engine',browser:browser.version(),sandbox:true,network:'offline context; all routed requests aborted',requests,errors,sha256:crypto.createHash('sha256').update(html).digest('hex'),dom},null,2)+'\n');
}finally{if(browser)await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

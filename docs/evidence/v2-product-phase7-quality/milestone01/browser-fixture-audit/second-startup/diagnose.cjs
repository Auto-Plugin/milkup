const {build}=require('/workspace/milkup/node_modules/esbuild');
const {chromium}=require('/workspace/milkup/node_modules/@playwright/test');
const fs=require('fs');
const dir=__dirname;
(async()=>{
 await build({entryPoints:['tests/helpers/formatting-plugin.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:dir+'/fixture.cjs'});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
 const context=await browser.newContext({baseURL:'http://127.0.0.1:1420'});
 const page=await context.newPage(); const events=[];
 page.on('console',m=>{if(m.type()==='error')events.push({type:'console-error',text:m.text()})});
 page.on('pageerror',e=>events.push({type:'pageerror',text:String(e)}));
 try {await require(dir+'/fixture.cjs').formattingFixture(page)}catch(e){events.push({type:'fixture-error',text:String(e)})}
 const registry=await page.evaluate(()=>{const v=JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')); for(const r of v.records)r.manifest.main=r.manifest.main.slice(0,60);return v});
 fs.writeFileSync(dir+'/diagnostic.json',JSON.stringify({events,registry},null,2));
 await browser.close();
 console.log(JSON.stringify({events,records:registry.records.map(r=>({id:r.manifest.id,state:r.state,enabled:r.enabled,errors:r.errors})),auditRecords:registry.auditRecords},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});

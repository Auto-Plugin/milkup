import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {startProduction} from '/tmp/milkup-windows-manual-candidate/tests/helpers/native-production.mjs'
import {nativeFixture,x} from '/tmp/milkup-windows-manual-candidate/tests/helpers/native-updates-fixture.mjs'
const output='/tmp/milkup-beta3-native/sidebar-visible';await mkdir(output,{recursive:true});let app;const ui=nativeFixture(()=>app);
const snapshot=()=>app.execute(`return {zoom:Number(document.querySelector('#app').dataset.appearanceZoom),panels:[...document.querySelectorAll('.plugin-ui-sidebar-panel')].map(e=>({id:e.dataset.pluginUi,rect:e.getBoundingClientRect().toJSON()})),focus:document.activeElement?.outerHTML.slice(0,400)}`);
async function shot(name){await app.shot(name+'-webdriver');execFileSync('/usr/bin/import',['-display',process.env.DISPLAY,'-window','root',output+'/'+name+'-system.png'],{env:process.env,timeout:10000})}
try{
 app=await startProduction('/tmp/milkup-beta3-native/evidence/beta3-feedback.md',output,{diagnostics:false});
 await ui.click('[data-sidebar-toggle]');const before=await snapshot();await shot('before');
 const p=await app.execute(`const e=document.querySelector('.plugin-ui-panel-resize:not([hidden])'),r=e.getBoundingClientRect();return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2,zoom:Number(document.querySelector('#app').dataset.appearanceZoom)}`);
 const px=Math.round(p.x*p.zoom),py=Math.round(p.y*p.zoom);
 x('mousemove','--window',ui.windowId(),String(px),String(py),'mousedown','1');x('mousemove','--window',ui.windowId(),String(px),String(py+70));await app.delay(100);x('mouseup','1');await app.delay(100);
 const after=await snapshot();assert(Math.abs(after.panels[0].rect.height-before.panels[0].rect.height-70/p.zoom)<2);await shot('after');
 await writeFile(output+'/result.json',JSON.stringify({passed:true,input:'native X11 pointer movement +70 physical pixels',before,after},null,2));
}finally{await app?.close()}

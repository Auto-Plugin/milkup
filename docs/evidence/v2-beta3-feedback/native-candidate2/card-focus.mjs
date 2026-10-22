import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {startProduction} from '/tmp/milkup-windows-manual-candidate/tests/helpers/native-production.mjs'
import {nativeFixture} from '/tmp/milkup-windows-manual-candidate/tests/helpers/native-updates-fixture.mjs'
const binary=process.env.TAURI_APP_PATH
assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
const output='/tmp/milkup-beta3-native-final/card-active'
await mkdir(output)
let app
const ui=nativeFixture(()=>app)
try{
 app=await startProduction('/tmp/milkup-beta3-native-final/smoke/beta3-feedback.md',output,{diagnostics:false})
 await ui.list()
 const selector='.plugin-summary-card[data-plugin-id="milkup.outline"] [role="switch"]'
 await ui.ready(selector)
 await app.focus(selector)
 const states=[]
 for(const checked of ['false','true']){
  await app.key('Return')
  await app.until(()=>app.execute('const e=document.querySelector(arguments[0]);return e.getAttribute("aria-checked")===arguments[1]&&e.getAttribute("aria-busy")!=="true"',selector,checked),'toggle completes')
  const state=await app.execute('const e=document.querySelector(arguments[0]),r=e.getBoundingClientRect();return {checked:e.getAttribute("aria-checked"),disabled:e.disabled,ariaDisabled:e.getAttribute("aria-disabled"),busy:e.getAttribute("aria-busy"),focused:document.activeElement===e,visible:!!e.getClientRects().length,menu:!!document.querySelector("[data-app-menu]").getClientRects().length,rect:r.toJSON(),focus:document.activeElement.outerHTML}',selector)
  assert(state.focused&&state.visible&&state.menu&&!state.disabled)
  states.push(state)
 }
 await app.shot('card-toggle-active')
 execFileSync('/usr/bin/import',['-display',process.env.DISPLAY,'-window','root','/tmp/milkup-beta3-native-final/final-evidence/card-toggle-active-system.png'])
 await writeFile('/tmp/milkup-beta3-native-final/final-evidence/card-toggle-active.json',JSON.stringify({binary,sha256:process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256,states,passed:true},null,2)+'\n')
}finally{await app?.close()}

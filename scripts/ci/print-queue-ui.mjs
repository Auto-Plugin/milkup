import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// Production-asset native WebView; editor/plugin mutations use real W3C input.
// Account identity and process lifetime are checked by the ordinary-user coordinator.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { observe } from '../../tests/windows/mermaid-product-e2e.mjs'
const [driverPort, debugPort, document, output, productPid, productBirth, productImage, queue, marker] = process.argv.slice(2)
for (const port of [driverPort, debugPort]) assert(/^\d{4,5}$/.test(port) && +port < 65536)
assert(/^Milkup-Isolated-[a-f0-9]{32}$/.test(queue))
assert(/^MILKUP_SPOOL_[a-f0-9]{32}$/.test(marker))
const record = {
  status: 'running',
  inputs: [],
  observations: [],
  boundary:
    'Real application print to dedicated paused non-file queue, exact job and system cancellation; not installed-package, physical-print or fidelity acceptance',
}
const file = path.join(output, 'print-ui.json')
const persist = () => writeFile(file, JSON.stringify(record, null, 2))
const deadline = Date.now() + 240000
let session
const request = async (method, route, body) => {
  assert(Date.now() < deadline, 'Complete health check exceeded 240 seconds')
  record.lastRequest = { method, route, at: new Date().toISOString() }
  const response = await fetch(`http://127.0.0.1:${driverPort}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(
      Math.max(1, Math.min(route === '/session' ? 60000 : 15000, deadline - Date.now())),
    ),
  })
  const result = await response.json()
  if (!response.ok || result.value?.error) throw Error(JSON.stringify(result).slice(0, 3000))
  return Object.hasOwn(result, 'value') ? result.value : result
}
const execute = (script, ...args) =>
  request('POST', `/session/${session}/execute/sync`, { script, args })
const state = () => execute(observe)
const until = async (fn, label, limit = 30000) => {
  const end = Math.min(deadline, Date.now() + limit)
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await delay(100)
  }
  throw Error('Timed out: ' + label)
}
const actions = async (type, list) => {
  record.inputs.push({ type, actions: list, at: new Date().toISOString() })
  assert(record.inputs.length <= 100)
  await request('POST', `/session/${session}/actions`, {
    actions: [
      {
        type,
        id: type,
        ...(type === 'pointer' ? { parameters: { pointerType: 'mouse' } } : {}),
        actions: list,
      },
    ],
  })
}
const chord = (key) =>
  actions('key', [
    { type: 'keyDown', value: '\uE009' },
    { type: 'keyDown', value: key },
    { type: 'keyUp', value: key },
    { type: 'keyUp', value: '\uE009' },
  ])
const typeText = (text) =>
  actions(
    'key',
    [...text]
      .map((value) => (value === '\n' ? '\uE007' : value))
      .flatMap((value) => [
        { type: 'keyDown', value },
        { type: 'keyUp', value },
      ]),
  )
const click = async (selector) => {
  const point = await until(
    () =>
      execute(
        `const e=document.querySelector(arguments[0]);if(!e)return null;const r=e.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2),h=document.elementFromPoint(x,y);return r.width&&r.height&&!e.disabled&&h&&(e===h||e.contains(h))?{x,y}:null`,
        selector,
      ),
    'visible real click target ' + selector,
  )
  await actions('pointer', [
    { type: 'pointerMove', origin: 'viewport', duration: 0, ...point },
    { type: 'pointerDown', button: 0 },
    { type: 'pointerUp', button: 0 },
  ])
}
const menu = async () => {
  if (!(await state()).menu) await click('[data-menu-toggle]')
  await click('[data-menu-section="plugins"]')
  return until(async () => {
    const c = (await state()).cards.find((v) => v.id === 'milkup.diagrams')
    return c && c.busy !== 'true' ? c : false
  }, 'plugin initialization')
}
try {
  await persist()
  await until(async () => {
    try {
      return (await request('GET', '/status')).ready
    } catch {
      return false
    }
  }, 'owned driver ready')
  record.devTools = await until(
    async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
          signal: AbortSignal.timeout(1000),
        })
        if (!response.ok) return false
        const value = await response.json()
        assert(typeof value.webSocketDebuggerUrl === 'string')
        return value
      } catch (error) {
        record.lastDevToolsError = String(error)
        return false
      }
    },
    'owned WebView2 loopback readiness before attachment',
    45000,
  )
  await persist()
  const response = await request('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'webview2',
        'ms:edgeChromium': true,
        'ms:edgeOptions': { debuggerAddress: `127.0.0.1:${debugPort}` },
      },
    },
  })
  session = record.sessionId = response.sessionId
  assert(session)
  await persist()
  await request('POST', `/session/${session}/timeouts`, {
    script: 15000,
    pageLoad: 15000,
    implicit: 0,
  })
  const opened = await until(async () => {
    const s = await state()
    return s.loading === 'ready' &&
      path.resolve(s.path).toLowerCase() === path.resolve(document).toLowerCase()
      ? s
      : false
  }, 'exact installed document')
  assert(['tauri:', 'http:', 'https:'].includes(opened.protocol))
  assert(['tauri.localhost', 'localhost'].includes(opened.hostname) || opened.protocol === 'tauri:')
  assert.equal(opened.developmentProbe, 'undefined')
  record.observations.push({ name: 'opened', state: opened })
  async function exportPanel() {
    if (!(await state()).menu) await click('[data-menu-toggle]')
    await click('[data-menu-section="plugins"]')
    const card = await until(
      async () =>
        (await state()).cards.find((c) => c.id === 'milkup.export-print' && c.busy !== 'true'),
      'export plugin available',
    )
    if (card.checked !== 'true')
      await click('.plugin-summary-card[data-plugin-id="milkup.export-print"] [role="switch"]')
    await until(
      async () =>
        (await state()).cards.some(
          (c) => c.id === 'milkup.export-print' && c.checked === 'true' && c.busy !== 'true',
        ),
      'export plugin enabled',
    )
    await click('[data-menu-close]')
    if (
      !(await execute(
        `return document.querySelector('[data-sidebar-toggle]')?.getAttribute('aria-pressed')==='true'`,
      ))
    )
      await click('[data-sidebar-toggle]')
    const other = await execute(
      `return [...document.querySelectorAll('[data-plugin-slot="sidebar-panel"] section')].filter(e=>e.getAttribute('aria-label')!=='导出与打印'&&e.querySelector('.plugin-ui-panel-toggle')?.getAttribute('aria-expanded')==='true').map(e=>e.dataset.pluginUi)`,
    )
    for (const key of other) await click(`[data-plugin-ui="${key}"] .plugin-ui-panel-toggle`)
    const panel = 'section[aria-label="导出与打印"]'
    if (
      await execute(
        `return document.querySelector(arguments[0])?.dataset.collapsed==='true'`,
        panel,
      )
    )
      await click(panel + ' .plugin-ui-panel-toggle')
    return panel
  }

  const panel = await exportPanel()
  await click(`${panel} [data-plugin-field-control="format"]`)
  await actions('key', ['\uE011','\uE015','\uE015','\uE007'].flatMap(value=>[{type:'keyDown',value},{type:'keyUp',value}]))
  await until(()=>execute(`return document.querySelector(arguments[0])?.value==='print'`,`${panel} [data-plugin-field-control="format"]`),'real print format')
  record.printPhases=[]
  for(const cancel of [true,false]) {
    const receipt=path.join(output,cancel?'print-dialog-cancel.json':'print-spool.json')
    const helper=spawn('pwsh.exe',['-NoLogo','-NoProfile','-File',fileURLToPath(new URL('./print-dialog-input.ps1',import.meta.url)),'-ProductId',productPid,'-CreationTicks',productBirth,'-Image',productImage,'-Queue',queue,'-Marker',marker,'-Receipt',receipt,...(cancel?['-Cancel']:[])],{windowsHide:true,stdio:['ignore','pipe','pipe']})
    let log='',overflow=false
    for(const stream of [helper.stdout,helper.stderr])stream.on('data',b=>{if(Buffer.byteLength(log)+b.length>65536)overflow=true;else log+=b.toString()})
    let timer
    const ended=new Promise((resolve,reject)=>{helper.once('error',reject);helper.once('close',code=>{clearTimeout(timer);resolve(code)});timer=setTimeout(()=>{helper.kill();reject(Error('Native print input exceeded 100 seconds'))},100000)})
    ended.catch(()=>{})
    try {
      await until(async()=>{try{return (await readFile(receipt+'.ready','utf8'))==='ready'}catch{return false}},'native print helper ready',15000)
      await click(`${panel} [data-plugin-command="exportPrint.start"]`)
      const code=await ended
      const proof=JSON.parse((await readFile(receipt,'utf8')).replace(/^\uFEFF/,''))
      record.printPhases.push(proof);await persist()
      assert.equal(code,0,log);assert(!overflow)
      assert.equal(proof.status,cancel?'passed-native-dialog-cancel-no-job':'passed-spooled-and-system-cancelled')
      record.panelStatus=await until(()=>execute(`const p=document.querySelector(arguments[0]);const t=[...p.querySelectorAll('[role="status"]')].map(e=>e.textContent).join(String.fromCharCode(10));return t.includes(arguments[1])?t:false`,panel,cancel?'已停止等待':'已提交打印'),'application reports exact print result')
      await writeFile(path.join(output,cancel?'print-cancel.png':'print-submitted.png'),Buffer.from(await request('GET',`/session/${session}/screenshot`),'base64'))
    }finally{if(helper.exitCode===null&&helper.signalCode===null)helper.kill();await ended.catch(()=>{});clearTimeout(timer);await writeFile(receipt+'.log',log)}
  }
  assert((await readFile(document,'utf8')).includes(marker))
  record.status='passed-ui-queue-contract-await-normal-close'
}catch(error){record.status='failed';record.error=error?.stack??String(error);process.exitCode=1}
finally{await persist()}

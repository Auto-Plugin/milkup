// Local Chromium exercises the exact fixed engine and bootstrap. These tests do
// not stand in for Windows WebView2, AppContainer, IME, DPI, or installer evidence.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = '/workspace/milkup-mermaid-rebuild/apps/desktop/src-tauri/mermaid-engine/assets'
const executable = process.env.MILKUP_TEST_CHROMIUM || '/usr/bin/chromium'
const enginePath = process.env.MILKUP_TEST_MERMAID_ENGINE || join(here, 'mermaid-12.2.0.min.js')
const evidence = process.env.MILKUP_TEST_MERMAID_EVIDENCE
const available = await access(executable).then(
  () => true,
  () => false,
)
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function startBrowser() {
  const profile = await mkdtemp(join(tmpdir(), 'milkup-mermaid-bootstrap-'))
  const browser = spawn(
    executable,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
    ],
    { stdio: 'ignore' },
  )
  let socket
  const close = async () => {
    socket?.close()
    if (browser.exitCode === null && browser.signalCode === null) {
      const stopped = new Promise((resolve) => browser.once('exit', resolve))
      browser.kill('SIGTERM')
      const forced = setTimeout(() => browser.kill('SIGKILL'), 2000)
      await stopped
      clearTimeout(forced)
    }
    await rm(profile, { recursive: true, force: true })
  }
  try {
    let port
    for (let attempt = 0; attempt < 500; attempt++) {
      try {
        port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]
        break
      } catch {
        await pause(20)
      }
    }
    assert.ok(port, 'Chromium exposed its owned debugging port within 10 seconds')
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    socket = new WebSocket(tabs[0].webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    let serial = 0
    const pending = new Map()
    socket.addEventListener('message', ({ data }) => {
      const value = JSON.parse(data)
      if (!value.id || !pending.has(value.id)) return
      const { resolve, reject, timer } = pending.get(value.id)
      pending.delete(value.id)
      clearTimeout(timer)
      value.error ? reject(new Error(JSON.stringify(value.error))) : resolve(value.result)
    })
    const command = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++serial
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Chromium command deadline: ${method}`))
        }, 10000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params }))
      })
    const evaluate = async (expression) => {
      const value = await command('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      assert.equal(value.exceptionDetails, undefined, JSON.stringify(value.exceptionDetails))
      return value.result.value
    }
    await command('Page.navigate', { url: 'about:blank' })
    await evaluate(`${await readFile(enginePath, 'utf8')}\n;void 0`)
    const bootstrap = await readFile(join(here, 'bootstrap.js'), 'utf8')
    const render = async (source, options = {}) => {
      const request = {
        protocol: 1,
        requestId: 'local-test',
        fixtureId: 'local-test',
        source,
        width: 640,
        theme: 'default',
        look: 'classic',
        ...options,
      }
      await command('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await evaluate(`document.body.innerHTML='<div id="target"></div>';
        window.testMessages=[];
        window.chrome={webview:{postMessage(value){testMessages.push(value)},
          addEventListener(type, listener){window.testListener=listener}}};void 0`)
      await evaluate(`${bootstrap}\n;void 0`)
      await evaluate(`testListener({data:${JSON.stringify(request)}})`)
      const result = await evaluate(
        'testMessages.find(value=>value.phase==="rendered" || value.phase==="error")',
      )
      assert.ok(result, 'bootstrap completed a render or bounded error')
      if (result.phase === 'rendered') {
        await command('Emulation.setDeviceMetricsOverride', {
          width: result.width,
          height: result.height,
          deviceScaleFactor: 1,
          mobile: false,
        })
        await evaluate('testListener({data:{phase:"capture"}})')
        const capture = await evaluate('testMessages.find(value=>value.phase==="capture-ready")')
        assert.equal(capture.activeLinkElements, 0)
        assert.equal(capture.executableElements, 0)
      }
      return result
    }
    const snapshot = async (id) => {
      const { data } = await command('Page.captureScreenshot', { format: 'png' })
      const png = Buffer.from(data, 'base64')
      if (evidence) {
        await mkdir(evidence, { recursive: true })
        await writeFile(join(evidence, `${id}.png`), png)
      }
      return {
        bytes: png.length,
        sha256: createHash('sha256').update(png).digest('hex'),
        width: png.readUInt32BE(16),
        height: png.readUInt32BE(20),
      }
    }
    return { close, evaluate, render, snapshot }
  } catch (error) {
    await close()
    throw error
  }
}


const browser=await startBrowser();
const source='C4Component\nComponent(parser, "Parser", "TypeScript", "Reads notes")\nComponent(view, "View", "TypeScript", "Shows notes")\nRel(parser, view, "Presents")';
const geometry=()=>browser.evaluate(`(()=>{const svg=document.querySelector('#target>svg');const b=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};return {viewBox:svg.getAttribute('viewBox'),nodes:[...svg.querySelectorAll('.c4-shape')].map(e=>({id:e.id,box:b(e),shapes:[...e.querySelectorAll('rect,circle')].map(s=>({tag:s.localName,box:b(s),stroke:getComputedStyle(s).strokeWidth}))})),lines:[...svg.querySelectorAll('line')].map(e=>({box:b(e),x1:e.getAttribute('x1'),y1:e.getAttribute('y1'),x2:e.getAttribute('x2'),y2:e.getAttribute('y2'),group:e.parentElement.outerHTML})),labels:[...svg.querySelectorAll('[data-milkup-c4-label]')].map(e=>({box:b(e),text:b(e.querySelector('text')),backing:b(e.querySelector('rect'))}))}})()`);
try {
 const result=await browser.render(source);
 const before=await geometry();
 const png=await browser.snapshot('baseline-c4-default');
 await writeFile(join(evidence,'baseline-c4.json'),JSON.stringify({result,geometry:before,png},null,2));
 await writeFile(join(evidence,'baseline-c4.svg'),await browser.evaluate("document.querySelector('#target>svg').outerHTML"));
 await browser.evaluate(`(async()=>{document.body.innerHTML='<div id="target"></div>';const target=document.querySelector('#target');target.innerHTML=(await mermaid.render('official-raw',${JSON.stringify(source)},target)).svg;await document.fonts.ready;})()`);
 await writeFile(join(evidence,'official-raw-c4.json'),JSON.stringify(await geometry(),null,2));
 await writeFile(join(evidence,'official-raw-c4.svg'),await browser.evaluate("document.querySelector('#target>svg').outerHTML"));
} finally {await browser.close()}

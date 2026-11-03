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

const here = dirname(fileURLToPath(import.meta.url))
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

async function assertC4NodeContrast(browser, records, id, theme) {
  const labels = await browser.evaluate(`(()=>{
    const rows=[];
    for(const node of document.querySelectorAll('#target .c4-shape')) {
      const shape=[...node.children].find(child=>['rect','circle','ellipse','path','polygon'].includes(child.localName));
      if(!shape) continue;
      for(const leaf of node.querySelectorAll('.label text, .label tspan')) {
        if(leaf.children.length || !leaf.textContent.trim()) continue;
        rows.push({text:leaf.textContent,shapeClass:node.getAttribute('class'),
          fill:getComputedStyle(shape).fill,ink:getComputedStyle(leaf).fill});
      }
    }
    return rows;
  })()`)
  assert.ok(labels.length > 0, 'C4 fixture has visible leaf labels')
  const luminance = (color) => {
    const channels = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const srgb = value / 255
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
      })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  for (const label of labels) {
    const background = luminance(label.fill)
    const foreground = luminance(label.ink)
    label.contrast =
      (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
    assert.ok(
      label.contrast >= 4.5,
      `${label.text}: actual ${label.ink} on ${label.fill} has ${label.contrast.toFixed(2)}:1 contrast`,
    )
    if (id !== 'custom-backgrounds') {
      const expected = /c4-(person|system)(?:\s|$)/.test(label.shapeClass)
        ? 'rgb(255, 255, 255)'
        : 'rgb(0, 0, 0)'
      assert.equal(
        label.ink,
        expected,
        `${label.text}: deep blue retains white; lighter fill uses black`,
      )
    }
  }
  records.push({ id, theme, labels })
}

const wide =
  'flowchart LR\n' + Array.from({ length: 16 }, (_, i) => `N${i + 1}[Stage ${i + 1}]`).join(' --> ')
const c4 =
  'C4Component\nComponent(parser, "Parser", "TypeScript", "Reads notes")\n' +
  'Component(view, "View", "TypeScript", "Shows notes")\nRel(parser, view, "Presents")'

test(
  'private bootstrap preserves natural geometry, readable C4 labels and closed appearance',
  {
    skip: !available && `Set MILKUP_TEST_CHROMIUM to an existing local Chromium executable`,
    timeout: 60000,
  },
  async (t) => {
    const browser = await startBrowser()
    const contrastRecords = []
    try {
      for (const theme of ['default', 'dark']) {
        await t.test(`wide diagram remains natural size in ${theme}`, async () => {
          const result = await browser.render(wide, { width: 320, theme })
          assert.equal(result.phase, 'rendered', result.message)
          assert.ok(
            result.width > 1280,
            `natural width ${result.width} must exceed the old 1280px cap`,
          )
          assert.ok(
            result.height > 64,
            `natural height ${result.height} must retain readable labels`,
          )
          const geometry =
            await browser.evaluate(`(()=>{const svg=document.querySelector('#target>svg');
          const matrix=svg.getScreenCTM();const box=svg.getBBox();const view=svg.viewBox.baseVal;
          return {scaleX:matrix.a,scaleY:matrix.d, left:box.x-view.x,top:box.y-view.y,
            right:view.x+view.width-box.x-box.width,bottom:view.y+view.height-box.y-box.height,
            labels:svg.querySelectorAll('.node').length,
            background:getComputedStyle(document.body).backgroundColor}})()`)
          assert.equal(geometry.scaleX, 1)
          assert.equal(geometry.scaleY, 1)
          for (const edge of ['left', 'top', 'right', 'bottom'])
            assert.ok(geometry[edge] >= 15, `${edge} ink padding`)
          assert.equal(geometry.labels, 16)
          assert.equal(
            geometry.background,
            theme === 'dark' ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)',
          )
          await browser.snapshot(`flow-wide-${theme}`)
        })
        await t.test(`C4 relationship label clears its line in ${theme}`, async () => {
          const result = await browser.render(c4, { width: 640, theme })
          assert.equal(result.phase, 'rendered', result.message)
          assert.equal(result.adjustedC4Labels, 1)
          const geometry =
            await browser.evaluate(`(()=>{const wrapper=document.querySelector('[data-milkup-c4-label]');
          const label=wrapper.querySelector('text').getBoundingClientRect();
          const line=wrapper.parentElement.querySelector('line').getBoundingClientRect();
          return {labelBottom:label.bottom,lineY:line.y,
            backing:getComputedStyle(wrapper.querySelector('rect')).fill,
            ink:getComputedStyle(wrapper.querySelector('text')).fill}})()`)
          assert.ok(
            geometry.labelBottom < geometry.lineY,
            'relationship text is above the connecting line',
          )
          assert.equal(
            geometry.backing,
            theme === 'dark' ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)',
          )
          assert.equal(geometry.ink, theme === 'dark' ? 'rgb(226, 228, 233)' : 'rgb(68, 68, 68)')
          await assertC4NodeContrast(browser, contrastRecords, 'component', theme)
          const png = await browser.snapshot(`c4-component-${theme}`)
          assert.equal(png.width, result.width)
          assert.equal(png.height, result.height)
          assert.ok(
            result.width - result.svgBBox.width <= 34,
            'C4 has only horizontal crop padding',
          )
          assert.ok(
            result.height - result.svgBBox.height <= 34,
            'C4 has only vertical crop padding',
          )
        })
      }
      for (const [kind, source] of [
        [
          'context',
          'C4Context\nPerson(reader, "Reader")\nSystem(editor, "Editor", "Writes notes")\nRel(reader, editor, "Writes")',
        ],
        [
          'container',
          'C4Container\nPerson(reader, "Reader")\nContainer(editor, "Editor", "Desktop", "Notes")\nRel(reader, editor, "Writes")',
        ],
        [
          'dynamic',
          'C4Dynamic\nPerson(reader, "Reader")\nSystem(editor, "Editor", "Writes notes")\nRel(reader, editor, "Writes")',
        ],
        [
          'deployment',
          'C4Deployment\nDeployment_Node(workstation, "Workstation", "Windows") {\nContainer(editor, "Editor", "Desktop", "Notes")\n}',
        ],
      ]) {
        for (const theme of ['default', 'dark']) {
          await t.test(
            `C4 ${kind} ${theme} crops blank canvas and preserves ink padding`,
            async () => {
              const result = await browser.render(source, { width: 640, theme })
              assert.equal(result.phase, 'rendered', result.message)
              assert.equal(result.adjustedC4Labels, kind === 'deployment' ? 0 : 1)
              const padding =
                await browser.evaluate(`(()=>{const svg=document.querySelector('#target>svg');
              const box=svg.getBBox(); const view=svg.viewBox.baseVal; return {
                left:box.x-view.x,top:box.y-view.y,right:view.x+view.width-box.x-box.width,
                bottom:view.y+view.height-box.y-box.height}})()`)
              for (const edge of ['left', 'top', 'right', 'bottom']) {
                assert.ok(
                  padding[edge] >= 16 && padding[edge] < 17,
                  `${edge} is only the intended ink padding`,
                )
              }
              assert.ok(result.width - result.svgBBox.width <= 34, 'no large horizontal C4 canvas')
              assert.ok(result.height - result.svgBBox.height <= 34, 'no large vertical C4 canvas')
              await assertC4NodeContrast(browser, contrastRecords, kind, theme)
              const png = await browser.snapshot(`c4-${kind}-${theme}`)
              assert.equal(png.width, result.width)
              assert.equal(png.height, result.height)
            },
          )
        }
      }
      for (const theme of ['default', 'dark']) {
        await t.test(`C4 contrast follows actual custom backgrounds in ${theme}`, async () => {
          const result = await browser.render(
            c4 +
              '\nUpdateElementStyle(parser, $bgColor="#ffffff", $fontColor="#ffffff")\nUpdateElementStyle(view, $bgColor="#123456", $fontColor="#000000")',
            { width: 640, theme },
          )
          assert.equal(result.phase, 'rendered', result.message)
          await assertC4NodeContrast(browser, contrastRecords, 'custom-backgrounds', theme)
          const labels = contrastRecords.at(-1).labels
          assert.ok(
            labels.some(
              (label) => label.fill === 'rgb(255, 255, 255)' && label.ink === 'rgb(0, 0, 0)',
            ),
          )
          assert.ok(
            labels.some(
              (label) => label.fill === 'rgb(18, 52, 86)' && label.ink === 'rgb(255, 255, 255)',
            ),
          )
          await browser.snapshot(`c4-custom-backgrounds-${theme}`)
        })
      }
      if (evidence)
        await writeFile(
          join(evidence, 'c4-contrast-results.json'),
          JSON.stringify(
            {
              scope:
                'Local Chromium C4 nominal leaf-text contrast and retained actual PNGs; not native Windows acceptance',
              browser: await browser.evaluate('navigator.userAgent'),
              records: contrastRecords,
            },
            null,
            2,
          ),
        )
      await t.test(
        'small diagrams are cropped to their actual content and neo remains supported',
        async () => {
          const result = await browser.render('flowchart LR\nA[Read] --> B[Save]', {
            width: 1280,
            look: 'neo',
          })
          assert.equal(result.phase, 'rendered', result.message)
          assert.ok(result.width < 600, 'no mandatory 1280px empty canvas')
        },
      )
      await t.test(
        'unknown appearances, widths, and over-budget geometry fail visibly',
        async () => {
          for (const options of [
            { width: 159 },
            { width: 8193 },
            { width: 200.5 },
            { theme: 'base' },
            { look: 'custom' },
          ]) {
            assert.equal((await browser.render('flowchart LR\nA-->B', options)).phase, 'error')
          }
          const huge =
            'flowchart LR\n' +
            Array.from({ length: 100 }, (_, i) => `N${i}[Stage ${i}]`).join(' --> ')
          const result = await browser.render(huge)
          assert.equal(result.phase, 'error')
          assert.match(result.message, /pixel budget/)
        },
      )
      await t.test(
        'HTML labels, negative coordinates, and inert links retain safety assertions',
        async () => {
          const result = await browser.render(
            'flowchart LR\nA["<b>Draft</b><br/>Second line"] --> B[Save]\nclick A "https://example.invalid/"',
          )
          assert.equal(result.phase, 'rendered', result.message)
          assert.equal(
            await browser.evaluate('document.querySelectorAll("#target a[href]").length'),
            0,
          )
        },
      )
      // Optional read-only corpus from a separately retained prototype checkout.
      // Only authored text and the closed classic/neo preset enter this bootstrap.
      const corpusRoot = process.env.MILKUP_TEST_MERMAID_CORPUS
      if (corpusRoot) {
        const manifest = JSON.parse(
          await readFile(join(corpusRoot, 'fixtures-manifest.json'), 'utf8'),
        )
        assert.equal(manifest.engine.version, '12.2.0')
        const records = []
        for (const fixture of manifest.fixtures) {
          assert.match(fixture.path, /^fixtures\/[a-zA-Z0-9_.-]+$/)
          const source = await readFile(join(corpusRoot, fixture.path), 'utf8')
          assert.equal(createHash('sha256').update(source).digest('hex'), fixture.sha256)
          for (const theme of ['default', 'dark']) {
            await t.test(`retained corpus ${fixture.id} ${theme}`, async () => {
              const result = await browser.render(source, {
                width: 640,
                theme,
                look: fixture.initializeOverrides?.look ?? 'classic',
              })
              const png =
                result.phase === 'rendered'
                  ? await browser.snapshot(`corpus-${fixture.id}-${theme}`)
                  : null
              records.push({ id: fixture.id, theme, sourceSha256: fixture.sha256, result, png })
              assert.equal(result.phase, 'rendered', result.message)
              assert.equal(result.diagramType, fixture.expectedRegistrationId)
            })
          }
        }
        if (evidence)
          await writeFile(
            join(evidence, 'corpus-results.json'),
            JSON.stringify(
              {
                platform: process.platform,
                browser: await browser.evaluate('navigator.userAgent'),
                scope:
                  'Local Chromium product bootstrap; not native WebView2 or product editor acceptance',
                records,
              },
              null,
              2,
            ),
          )
      }
    } finally {
      await browser.close()
    }
  },
)

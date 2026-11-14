// Production Linux/X11 pixel + real-disk regression. No dev server or editor injection.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { startProduction } from '../helpers/native-production.mjs'
const root = path.resolve(
  process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? `/tmp/milkup-visual-fixes-${Date.now()}`,
)
const before = process.env.MILKUP_VISUAL_BASELINE === '1'
await mkdir(root, { recursive: true })
const developmentServer = await fetch('http://127.0.0.1:1420', {
  signal: AbortSignal.timeout(500),
}).then(
  () => true,
  () => false,
)
assert.equal(developmentServer, false, 'Close the development server before production validation')
const fixture = [
  '| L | C | R |',
  '| :--- | :---: | ---: |',
  '| identifier_without_breaks_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789 | 完成 | 123.45 |',
  '',
  '- [ ] 中文 😀 é task',
  '- plain',
  '- [X] done',
  '',
  '**粗体中的 *斜体*** tail 后文',
  '',
  '```js',
  'console.log("' + 'abcdefghijklmnopqrstuvwxyz'.repeat(8) + '")',
  '```',
  '',
  '结束',
  '',
].join('\r\n')
const env = { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' }
const results = [],
  metrics = []
let app, file, original, windowId
const sha = (data) => createHash('sha256').update(data).digest('hex')
const record = async (name, ok, evidence) => {
  results.push({ name, ok: !!ok, evidence })
  await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
  if (!ok && !before) throw Error(name + ': ' + JSON.stringify(evidence))
}
const shot = async (name) => {
  await app.delay(500)
  execFileSync('import', ['-window', 'root', path.join(root, name + '.png')], { env })
}
const resize = async (w, h) => {
  execFileSync('xdotool', ['windowsize', '--sync', windowId, String(w), String(h)], { env })
  await app.delay(150)
}
const pointer = async (selector) => {
  await app.execute(
    'document.querySelector(arguments[0]).scrollIntoView({block:"center",inline:"nearest"})',
    selector,
  )
  await app.delay(100)
  const r = await app.execute(
    'const e=document.querySelector(arguments[0]),r=e.getBoundingClientRect();return {x:r.x+Math.min(25,r.width/2),y:r.y+r.height/2,dpr:devicePixelRatio}',
    selector,
  )
  execFileSync(
    'xdotool',
    [
      'mousemove',
      '--window',
      windowId,
      String(Math.round(r.x * r.dpr)),
      String(Math.round(r.y * r.dpr)),
      'click',
      '1',
    ],
    { env },
  )
  await app.delay(150)
}
const save = async (expected) => {
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+s')
  await app.until(
    async () => {
      const p = await app.probe()
      return !p.saving && !p.dirty && (await readFile(file)).equals(Buffer.from(expected))
    },
    'exact bytes saved',
    20000,
  )
}
const theme = async (value) => {
  if (
    await app.execute(
      'return document.querySelector("select[data-appearance-theme]").value===arguments[0]',
      value,
    )
  )
    return
  await app.click('[data-menu-toggle]')
  await app.until(
    () => app.execute('return !document.querySelector("[data-app-menu]").hidden'),
    'menu open',
  )
  await app.click('[data-menu-section="appearance"]')
  await app.until(
    () => app.execute('return !document.querySelector("[data-menu-panel=appearance]").hidden'),
    'appearance open',
  )
  await app.focus('[data-appearance-theme]')
  await app.key(value === 'dark' ? 'End' : 'Home')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector("select[data-appearance-theme]").value===arguments[0]&&!document.querySelector("select[data-appearance-theme]").disabled',
        value === 'dark' ? 'dark' : 'system',
      ),
    'theme ready',
  )
  if (value === 'light') {
    await app.focus('[data-appearance-theme]')
    await app.key('Down')
  }
  await app.key('Tab')
  await app.until(
    () =>
      app.execute(
        'return document.documentElement.dataset.theme===arguments[0]&&!document.querySelector("[data-appearance-theme]").disabled',
        value,
      ),
    'theme ' + value,
  )
  await app.key('Escape')
}
const zoom = async (value) => {
  await app.key('ctrl+0')
  await app.until(
    () => app.execute('return document.querySelector("#app").dataset.appearanceZoom==="1"'),
    'reset scale',
  )
  for (let i = 0; i < [1, 1.25, 1.5, 2].indexOf(value); i++) {
    await app.key('ctrl+plus')
    await app.until(
      () => app.execute('return !document.querySelector("select[data-appearance-zoom]").disabled'),
      'native scale applied',
    )
  }
  await app.until(
    () =>
      app.execute(
        'return Number(document.querySelector("#app").dataset.appearanceZoom)===arguments[0]',
        value,
      ),
    'native scale ' + value,
  )
}
try {
  for (const kind of ['ordinary', 'windowed']) {
    original = fixture + (kind === 'windowed' ? 'windowed tail 中文 😀\r\n'.repeat(120000) : '')
    file = path.join(root, kind + '.md')
    await writeFile(file, original)
    app = await startProduction(file, root)
    const ids = execFileSync('xdotool', ['search', '--onlyvisible', '--class', 'milkup-desktop'], {
      env,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
    assert.equal(ids.length, 1)
    windowId = ids[0]
    const view = await app.execute(
      'return document.querySelector(".milkup-editor").outerHTML.slice(0,400)',
    )
    await writeFile(path.join(root, kind + '-view.txt'), view)
    await record(
      kind + ' view path',
      view.includes('milkup-source-document-view') === (kind === 'windowed'),
      view,
    )
    for (const color of before ? ['light'] : ['light', 'dark']) {
      await theme(color)
      for (const scale of before ? [1] : [1, 1.25, 1.5, 2]) {
        await zoom(scale)
        for (const size of before
          ? [[760, 520]]
          : [
              [1100, 760],
              [760, 520],
            ]) {
          await resize(...size)
          const label = `${kind}-${color}-${scale * 100}-${size[0]}`
          await app.focus('.milkup-input-proxy')
          await app.key('ctrl+1')
          await app.key('ctrl+Home')
          await app.until(async () => (await app.probe()).cursor === 0, 'source home')
          await shot(label + '-source')
          await pointer('.milkup-line[data-line="12"]')
          await app.key('End')
          await app.delay(150)
          const sourceCaret = await app.execute(
            `const c=document.querySelector('.milkup-cursor'),r=c.getBoundingClientRect(),v=document.querySelector('.milkup-editor'),b=v.getBoundingClientRect();return {position:Number(c.dataset.position),left:r.left,right:r.right,viewLeft:b.left,viewRight:b.right,scrollLeft:v.scrollLeft}`,
          )
          await record(
            label + ' source End caret',
            sourceCaret.position === fixture.indexOf(')\r\n```') + 1 &&
              sourceCaret.left >= sourceCaret.viewLeft &&
              sourceCaret.right <= sourceCaret.viewRight,
            sourceCaret,
          )
          await shot(label + '-source-end')
          await app.key('Home')
          await app.key('ctrl+Home')
          await app.until(async () => (await app.probe()).cursor === 0, 'source restored home')
          await app.key('ctrl+2')
          await app.until(
            () =>
              app.execute(
                'return document.querySelector(".milkup-editor").dataset.mode==="live"&&document.querySelectorAll(".milkup-table-cell").length===6&&!!document.querySelector(".milkup-inline-strong")',
              ),
            'live fixture render complete',
          )
          const m = await app.execute(`
            const cells=[...document.querySelectorAll('.milkup-table-cell')];
            const long=cells[3],r=document.createRange();r.selectNodeContents(long);
            const b=long.getBoundingClientRect();
            const task=document.querySelector('.milkup-task-marker');
            const emphasis=document.querySelector('.milkup-line[data-line="9"]');
            const editor=document.querySelector('.milkup-editor');
            return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,zoom:document.querySelector('#app').dataset.appearanceZoom,cssZoom:getComputedStyle(document.documentElement).zoom,theme:document.documentElement.dataset.theme,view:editor.dataset,alignment:cells.map(e=>getComputedStyle(e).textAlign),longCell:{left:b.left,right:b.right},textRects:[...r.getClientRects()].filter(r=>r.width>0).map(r=>({left:r.left,right:r.right})),emphasisText:emphasis.innerText,italics:[...emphasis.querySelectorAll('.milkup-inline-emphasis')].map(e=>e.innerText),focusShadow:getComputedStyle(editor).boxShadow,taskText:task.closest('.milkup-line').innerText,taskTag:task.tagName,taskRole:task.getAttribute('role'),taskChecked:task.dataset.checked};`)
          metrics.push({ label, ...m })
          await writeFile(path.join(root, 'metrics.json'), JSON.stringify(metrics, null, 2))
          await record(
            label + ' native viewport',
            Math.abs(m.width - size[0] / scale) < 2 && Number(m.cssZoom) === 1 && m.theme === color,
            m,
          )
          await record(
            label + ' alignment',
            JSON.stringify(m.alignment) ===
              JSON.stringify(['left', 'center', 'right', 'left', 'center', 'right']),
            m.alignment,
          )
          await record(
            label + ' unbroken cell',
            m.textRects.every(
              (r) => r.left >= m.longCell.left - 1 && r.right <= m.longCell.right + 1,
            ),
            { cell: m.longCell, text: m.textRects },
          )
          await record(
            label + ' nested emphasis',
            m.emphasisText === '粗体中的 斜体 tail 后文' &&
              JSON.stringify(m.italics) === JSON.stringify(['斜体']),
            { text: m.emphasisText, italics: m.italics },
          )
          await record(label + ' quiet focus', m.focusShadow === 'none', m.focusShadow)
          await record(label + ' single task marker', !m.taskText.includes('•'), m.taskText)
          await shot(label + '-live-table')
          await pointer('.milkup-task-marker')
          const toggled = await app.execute(
            'return document.querySelector(".milkup-task-marker").dataset.checked==="true"',
          )
          await record(label + ' task edits', toggled, await app.probe())
          await shot(label + '-task')
          if (toggled) {
            const changed = original.replace('- [ ]', '- [x]')
            await save(changed)
            await app.key('ctrl+z')
            await save(original)
            await app.key('ctrl+shift+z')
            await save(changed)
            await app.key('ctrl+z')
            await save(original)
            await app.focus('.milkup-task-marker')
            await app.key('space')
            await app.until(
              () =>
                app.execute(
                  'return document.querySelector(".milkup-task-marker").dataset.checked==="true"',
                ),
              'Space toggle',
            )
            await save(changed)
            await app.key('ctrl+z')
            await save(original)
            await record(label + ' task undo redo keyboard exact CRLF Unicode', true, {
              sha256: sha(await readFile(file)),
              original: sha(original),
            })
          }
          await pointer('.milkup-line[data-line="12"]')
          await app.key('End')
          await app.delay(200)
          const c = await app.execute(
            `const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};const line=document.querySelector('.milkup-line[data-line="12"]');return {caret:rect(document.querySelector('.milkup-cursor')),view:rect(document.querySelector('.milkup-editor')),line:rect(line),scrollLeft:line.scrollLeft,position:Number(document.querySelector('.milkup-cursor').dataset.position)}`,
          )
          const visible =
            c.position === fixture.indexOf(')\r\n```') + 1 &&
            c.caret.left >= c.view.left &&
            c.caret.right <= c.view.right &&
            c.caret.top >= c.view.top &&
            c.caret.bottom <= c.view.bottom + 1
          await record(label + ' code End caret', visible, c)
          await shot(label + '-code-end')
          if (visible) {
            await app.key('shift+Left')
            await app.delay(100)
            const selections = await app.execute(
              'return [...document.querySelectorAll(".milkup-selection")].map(e=>({from:Number(e.dataset.from),to:Number(e.dataset.to),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))',
            )
            await record(
              label + ' code selection',
              selections.length === 1 &&
                selections[0].to - selections[0].from === 1 &&
                selections[0].right <= c.view.right + 1,
              selections,
            )
            await app.text('Z')
            await save(original.replace(')\r\n```', 'Z\r\n```'))
            await app.key('ctrl+z')
            await save(original)
            await shot(label + '-code-selection-history')
          }
          await app.focus('.milkup-input-proxy')
          await app.key('ctrl+1')
          await app.key('ctrl+Home')
          await app.text('EDIT ')
          await save('EDIT ' + original)
          await app.key('ctrl+z')
          await save(original)
          await record(label + ' source history exact bytes', true, {
            bytes: Buffer.byteLength(original),
            sha256: sha(await readFile(file)),
          })
        }
      }
    }
    await app.close()
    app = undefined
  }
} catch (error) {
  if (app) {
    await shot('failure').catch(() => {})
    await writeFile(
      path.join(root, 'failure.json'),
      JSON.stringify({ error: String(error), state: await app.probe().catch(() => null) }, null, 2),
    )
  }
  throw error
} finally {
  await app?.close()
}
console.log(
  JSON.stringify({
    cases: results.length,
    failed: results.filter((r) => !r.ok).length,
    baseline: before,
  }),
)

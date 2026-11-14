import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
const root = path.resolve(
  process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? '/workspace/.milkup-v2-phase18/appearance',
)
await mkdir(root, { recursive: true })
const original = Buffer.from(
  '# 外观与编辑\r\n\r\n中文 😀 Alpha text\r\n\r\n- first\r\n- second\r\n\r\n```js\r\nconst value = 42\r\n```\r\n\r\n| Name | Value |\r\n| --- | --- |\r\n| Apple | 42 |\r\n\r\n> quote\r\n',
)
const file = path.join(root, 'appearance.md')
await writeFile(file, original)
const largeFile = path.join(root, 'windowed.md'),
  large = Buffer.concat([original, Buffer.from('large body 中文 😀\r\n'.repeat(120000))])
await writeFile(largeFile, large)
let app = await startProduction(file, root)
const env = { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' }
const results = [],
  metrics = []
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const shot = async (name) => {
  await app.delay(250)
  execFileSync('import', ['-window', 'root', path.join(root, name + '.png')], { env })
}
const check = async (name, fn) => {
  await fn()
  results.push({ name, ok: true })
  console.log('PASS ' + name)
  await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
}
const measure = async (label) => {
  const value = await app.execute(
    `const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};return {label:arguments[0],width:innerWidth,height:innerHeight,dpr:devicePixelRatio,cssZoom:getComputedStyle(document.documentElement).zoom,theme:document.documentElement.dataset.theme,zoom:document.querySelector('#app').dataset.appearanceZoom,background:getComputedStyle(document.querySelector('.editor-panel')).backgroundColor,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,app:rect(document.querySelector('#app')),editor:rect(document.querySelector('.milkup-editor')),active:document.activeElement?.outerHTML.slice(0,200),mode:document.querySelector('.milkup-editor').dataset.mode,appearanceError:document.querySelector('[data-appearance-error]').hidden?null:document.querySelector('[data-appearance-error]').textContent}`,
    label,
  )
  metrics.push(value)
  await writeFile(path.join(root, 'metrics.json'), JSON.stringify(metrics, null, 2))
  return value
}
const resize = async (width, height, launch = file) => {
  const owner = await ownedApplication(app.application, launch)
  const ids = execFileSync('xdotool', ['search', '--onlyvisible', '--class', 'milkup-desktop'], {
    env,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
  const owned = ids.filter((id) =>
    execFileSync('xprop', ['-id', id, '_NET_WM_PID'], { env, encoding: 'utf8' }).includes(
      '= ' + owner.identity.pid,
    ),
  )
  assert.equal(owned.length, 1)
  execFileSync('xdotool', ['windowsize', '--sync', owned[0], String(width), String(height)], {
    env,
  })
  await app.delay(200)
}
const menu = async () => {
  await app.click('[data-menu-toggle]')
  await app.until(
    () => app.execute('return !document.querySelector("[data-app-menu]").hidden'),
    'menu visible',
  )
  await app.click('[data-menu-section="appearance"]')
  await app.until(
    () => app.execute('return !document.querySelector("[data-menu-panel=appearance]").hidden'),
    'appearance panel visible',
  )
}
const theme = async (value) => {
  await menu()
  await app.focus('[data-appearance-theme]')
  await app.key(value === 'dark' ? 'End' : 'Home')
  await app.until(
    () => app.execute('return !document.querySelector("[data-appearance-theme]").disabled'),
    'theme control enabled',
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
    'native theme ' + value,
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
      'scale applied',
    )
  }
  await app.until(
    () =>
      app.execute(
        'return Number(document.querySelector("#app").dataset.appearanceZoom)===arguments[0]',
        value,
      ),
    'scale ' + value,
  )
}
const saved = async (expected) => {
  await app.key('ctrl+s')
  await app.until(async () => {
    const p = await app.probe()
    return !p.saving && !p.dirty && (await readFile(file)).equals(expected)
  }, 'exact saved bytes')
}
try {
  await app.key('ctrl+2')
  await resize(1100, 760)
  for (const color of ['light', 'dark']) {
    await theme(color)
    for (const scale of [1.25, 1.5, 2]) {
      await check(
        `${color} ${scale * 100}% uses native viewport scaling with clean document`,
        async () => {
          await zoom(scale)
          await resize(1100, 760)
          const m = await measure(`${color}-${scale}-wide`)
          assert.equal(m.theme, color)
          assert.equal(Number(m.zoom), scale)
          assert.equal(Number(m.cssZoom), 1)
          assert(Math.abs(m.width - 1100 / scale) < 2)
          assert(Math.abs(m.height - 760 / scale) < 2)
          assert.equal(m.overflow, false)
          assert.equal(m.appearanceError, null)
          assert.equal((await app.probe()).dirty, false)
          assert((await readFile(file)).equals(original))
          await shot(`${color}-${scale}-wide`)
        },
      )
      await check(
        `${color} ${scale * 100}% narrow search, sidebar and appearance controls remain reachable`,
        async () => {
          await resize(760, 520)
          const m = await measure(`${color}-${scale}-narrow`)
          assert.equal(m.overflow, false)
          await app.key('ctrl+f')
          await app.focus('[data-search-input]')
          await app.key('ctrl+a')
          await app.text('Alpha')
          await app.until(
            async () => !(await app.probe()).searching && (await app.probe()).count === '1/1',
            'complete search',
          )
          const bounds = await app.execute(
            'return [...document.querySelectorAll(".floating-search input,.floating-search button")].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {right:r.right,left:r.left,bottom:r.bottom}})',
          )
          assert(bounds.length >= 4)
          assert(
            bounds.every((b) => b.left >= 0 && b.right <= m.width + 1 && b.bottom <= m.height + 1),
          )
          await shot(`${color}-${scale}-search`)
          await app.key('Escape')
          await app.click('[data-sidebar-toggle]')
          assert(await app.execute('return document.querySelector(".editor-panel").inert'))
          await shot(`${color}-${scale}-sidebar`)
          await app.key('Escape')
          assert(await app.execute('return !document.querySelector(".editor-panel").inert'))
          await menu()
          await shot(`${color}-${scale}-menu`)
          await app.key('Escape')
        },
      )
    }
  }
  await check(
    'native pointer hit testing at 200% lands on the intended Unicode-safe source position',
    async () => {
      await app.key('ctrl+1')
      await app.focus('.milkup-input-proxy')
      await app.key('ctrl+Home')
      await app.until(async () => (await app.probe()).cursor === 0, 'source start for hit test')
      const hit = await app.execute(
        `const w=document.createTreeWalker(document.querySelector('.milkup-editor-content'),NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const i=n.textContent.indexOf('Alpha');if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+1);const b=r.getBoundingClientRect();return {x:b.right-0.1,y:b.y+b.height/2,dpr:devicePixelRatio}}}return null`,
      )
      assert(hit)
      const owner = await ownedApplication(app.application, file)
      const ids = execFileSync(
        'xdotool',
        ['search', '--onlyvisible', '--class', 'milkup-desktop'],
        { env, encoding: 'utf8' },
      )
        .trim()
        .split('\n')
      const idsOwned = ids.filter((id) =>
        execFileSync('xprop', ['-id', id, '_NET_WM_PID'], { env, encoding: 'utf8' }).includes(
          '= ' + owner.identity.pid,
        ),
      )
      assert.equal(idsOwned.length, 1)
      execFileSync(
        'xdotool',
        [
          'mousemove',
          '--window',
          idsOwned[0],
          String(Math.round(hit.x * hit.dpr)),
          String(Math.round(hit.y * hit.dpr)),
          'click',
          '1',
        ],
        { env },
      )
      const expected = original.toString().indexOf('Alpha') + 1
      await app.until(async () => (await app.probe()).cursor === expected, 'pointer caret position')
      await writeFile(
        path.join(root, 'pointer.json'),
        JSON.stringify({ hit, expected, observed: (await app.probe()).cursor }, null, 2),
      )
      await shot('dark-200-pointer')
    },
  )
  await check(
    '200% editing, caret, undo, redo and save preserve CRLF and Unicode bytes',
    async () => {
      await app.key('ctrl+1')
      await app.focus('.milkup-input-proxy')
      await app.key('ctrl+Home')
      await app.until(async () => (await app.probe()).cursor === 0, 'document start at 200%')
      await app.text('EDIT ')
      await app.until(async () => (await app.probe()).cursor === 5, 'typed cursor')
      const expected = Buffer.concat([Buffer.from('EDIT '), original])
      await saved(expected)
      await app.key('ctrl+z')
      await saved(original)
      await app.key('ctrl+shift+z')
      await saved(expected)
      const geometry = await app.execute(
        'const c=document.querySelector(".milkup-cursor").getBoundingClientRect(),v=document.querySelector(".milkup-editor").getBoundingClientRect();return {cursor:{x:c.x,y:c.y,bottom:c.bottom},view:{x:v.x,y:v.y,right:v.right,bottom:v.bottom}}',
      )
      assert(geometry.cursor.x >= geometry.view.x && geometry.cursor.x <= geometry.view.right)
      assert(
        geometry.cursor.y >= geometry.view.y && geometry.cursor.bottom <= geometry.view.bottom + 1,
      )
      await shot('dark-200-edit')
      await app.key('ctrl+z')
      await saved(original)
      await writeFile(
        path.join(root, 'bytes.json'),
        JSON.stringify(
          { original: sha(original), saved: sha(await readFile(file)), geometry },
          null,
          2,
        ),
      )
    },
  )
  await check('theme and 200% native scale survive a real application restart', async () => {
    await app.close()
    app = await startProduction(file, root)
    const m = await measure('restart-dark-200')
    assert.equal(m.theme, 'dark')
    assert.equal(m.zoom, '2')
    assert(Math.abs(m.width - 550) < 2)
    assert.equal((await app.probe()).dirty, false)
    assert((await readFile(file)).equals(original))
    await shot('restart-dark-200')
  })
  await check(
    'native zoom select remains visible by keyboard in the 200% minimum window',
    async () => {
      await resize(760, 520)
      await menu()
      await app.focus('select[data-appearance-zoom]')
      assert(
        await app.execute(
          'return document.activeElement===document.querySelector("select[data-appearance-zoom]")',
        ),
        'zoom select receives focus',
      )
      await app.key('Home')
      await app.until(
        () => app.execute('return document.querySelector("#app").dataset.appearanceZoom==="1"'),
        'zoom select 100%',
      )
      await app.focus('select[data-appearance-zoom]')
      await app.key('End')
      await app.until(
        () => app.execute('return document.querySelector("#app").dataset.appearanceZoom==="2"'),
        'zoom select 200%',
      )
      await app.focus('select[data-appearance-zoom]')
      const bounds = await app.execute(
        'const e=document.querySelector("select[data-appearance-zoom]"),r=e.getBoundingClientRect(),p=e.closest("section").getBoundingClientRect();return {top:r.top,bottom:r.bottom,areaTop:p.top,areaBottom:p.bottom,height:innerHeight}',
      )
      assert(
        bounds.top >= bounds.areaTop &&
          bounds.bottom <= Math.min(bounds.areaBottom, bounds.height) + 1,
      )
      await writeFile(path.join(root, 'select-bounds.json'), JSON.stringify(bounds, null, 2))
      await shot('dark-200-zoom-select-focused')
      await app.key('Escape')
      await app.focus('.milkup-input-proxy')
      await app.text('UNSAVED')
      await app.key('ctrl+n')
      await app.until(
        () => app.execute('return !document.querySelector("[data-close-confirm]").hidden'),
        '200% dirty confirmation',
      )
      await app.focus('[data-close-confirm-action="save"]')
      await shot('dark-200-unsaved-confirmation')
      await app.key('Escape')
      await app.key('ctrl+z')
      await saved(original)
    },
  )
  await check(
    '200% narrow table toolbar scrolls its controls into view and preserves undo bytes',
    async () => {
      await app.key('ctrl+2')
      await app.key('ctrl+f')
      await app.focus('[data-search-input]')
      await app.key('ctrl+a')
      await app.text('Apple')
      await app.until(async () => {
        const p = await app.probe()
        return !p.searching && p.count === '1/1'
      }, 'table search')
      await app.key('Escape')
      await app.until(
        () => app.execute('return !document.querySelector("[data-table-tools]").hidden'),
        'table toolbar',
      )
      await app.focus('[data-table-action="add-column"]')
      const bounds = await app.execute(
        'const r=document.activeElement.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}',
      )
      assert(
        bounds.left >= 0 && bounds.right <= bounds.width + 1 && bounds.bottom <= bounds.height + 1,
      )
      await shot('dark-200-table-tools')
      await app.key('Return')
      await app.until(async () => (await app.probe()).dirty, 'column inserted')
      await app.focus('.milkup-input-proxy')
      await app.key('ctrl+z')
      await saved(original)
    },
  )
  await check(
    'windowed live and source views render at native 200% and save exact large bytes',
    async () => {
      await app.close()
      app = await startProduction(largeFile, root)
      await resize(760, 520, largeFile)
      await app.key('ctrl+2')
      await shot('windowed-dark-200-live')
      await app.key('ctrl+1')
      await app.focus('.milkup-input-proxy')
      await app.key('ctrl+Home')
      await app.text('LARGE ')
      await app.key('ctrl+s')
      const expected = Buffer.concat([Buffer.from('LARGE '), large])
      await app.until(async () => {
        const p = await app.probe()
        return !p.saving && !p.dirty && (await readFile(largeFile)).equals(expected)
      }, 'large save at 200%')
      await app.key('ctrl+z')
      await app.key('ctrl+s')
      await app.until(async () => {
        const p = await app.probe()
        return !p.saving && !p.dirty && (await readFile(largeFile)).equals(large)
      }, 'large undo bytes')
      await measure('windowed-dark-200')
      await shot('windowed-dark-200-source')
      await writeFile(
        path.join(root, 'large-bytes.json'),
        JSON.stringify(
          { bytes: large.length, original: sha(large), saved: sha(await readFile(largeFile)) },
          null,
          2,
        ),
      )
    },
  )
} catch (error) {
  await writeFile(
    path.join(root, 'failure-controls.json'),
    JSON.stringify(
      await app
        .execute(
          'return {active:document.activeElement.outerHTML,selects:[...document.querySelectorAll("select")].map(e=>({outer:e.outerHTML,value:e.value,disabled:e.disabled})),theme:document.documentElement.dataset.theme,zoom:document.querySelector("#app").dataset.appearanceZoom}',
        )
        .catch(() => null),
      null,
      2,
    ),
  )
  results.push({ ok: false, error: String(error), state: await app.probe().catch(() => null) })
  await shot('failure').catch(() => {})
  throw error
} finally {
  await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
  await app.close()
}
console.log(JSON.stringify({ passed: results.length }))

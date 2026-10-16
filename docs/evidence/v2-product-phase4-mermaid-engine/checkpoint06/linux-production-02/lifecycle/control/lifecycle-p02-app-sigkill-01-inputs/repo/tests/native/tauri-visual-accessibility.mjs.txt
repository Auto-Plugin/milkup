// Packaged Linux WebKit review. System keys and X11 screenshots; no editor-state injection.
// CSS zoom below is explicitly a diagnostic magnification, not shipped UI or OS DPI support.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? '/tmp/milkup-v2-phase16/production-visual'
await mkdir(output, { recursive: true })
const env = { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' }
const mixed =
  '# 视觉与键盘审查\n\n普通正文 中文 English `inline code`。\n\n- 项目一\n- 项目二\n\n```js\nconst answer = 42\n```\n\n| 名称 | 状态 |\n| --- | --- |\n| 键盘 | 待检查 |\n\n## 下一节\n段落结尾。\n'
const results = []
for (const [kind, original] of [
  ['empty', ''],
  ['normal', mixed],
  ['long', mixed + '长文正文 中文 abcdefghijklmnopqrstuvwxyz\n'.repeat(50000)],
]) {
  const root = path.join(output, kind)
  await mkdir(root, { recursive: true })
  const file = path.join(root, 'review.md')
  await writeFile(file, original)
  const app = await startProduction(file, root)
  const snapshots = []
  const observe = () =>
    app.execute(
      `const rect=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();return {width:innerWidth,height:innerHeight,ratio:devicePixelRatio,zoom:getComputedStyle(document.documentElement).zoom,focus:document.activeElement?.outerHTML.slice(0,350),editor:rect('[data-editor-host]'),menu:!document.querySelector('[data-app-menu]').hidden,soft:getComputedStyle(document.documentElement).getPropertyValue('--text-soft'),focusStyle:{outline:getComputedStyle(document.activeElement).outline,shadow:getComputedStyle(document.querySelector('.milkup-editor')).boxShadow}}`,
    )
  const shot = async (name) => {
    await app.delay(250)
    execFileSync('import', ['-window', 'root', path.join(root, name + '.png')], { env })
    snapshots.push({ name, state: await app.probe(), dom: await observe() })
  }
  const focused = (selector) =>
    app.until(
      () =>
        app.execute(
          'return document.activeElement===document.querySelector(arguments[0])',
          selector,
        ),
      'focus ' + selector,
    )
  const resize = async (width, height) => {
    const win = execFileSync('xdotool', ['search', '--class', 'milkup-desktop'], {
      env,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .at(-1)
    execFileSync('xdotool', ['windowsize', win, String(width), String(height)], { env })
    await app.until(
      () =>
        app.execute('return innerWidth===arguments[0]&&innerHeight===arguments[1]', width, height),
      'native window size',
    )
  }
  try {
    await shot('wide-live')
    if (kind === 'empty') {
      await app.key('F6')
      await focused('[data-sidebar-toggle]')
      await app.key('F6')
      await focused('[data-menu-toggle]')
      await shot('shell-keyboard-focus')
    }
    await app.click('[data-menu-toggle]')
    for (let n = 0; n < 20; n++) {
      await app.key(n % 2 ? 'Tab' : 'shift+Tab')
      assert(
        await app.execute(
          'return document.querySelector("[data-app-menu]").contains(document.activeElement)',
        ),
      )
    }
    await shot('menu-focus-contained')
    await app.click('[data-menu-close]')
    await focused('.milkup-input-proxy')
    if (kind !== 'empty') {
      await app.key('ctrl+f')
      await app.text('inline')
      await app.until(async () => {
        const p = await app.probe()
        return p.query === 'inline' && p.count === '1/1' && !p.searching
      }, 'completed search')
      await shot('search-wide')
      await app.click('[data-menu-toggle]')
      await app.key('Escape')
      await app.until(
        () =>
          app.execute(
            'return document.querySelector("[data-app-menu]").hidden&&!document.querySelector("[data-floating-search]").hidden',
          ),
        'menu closes before search',
      )
      await focused('.milkup-input-proxy')
      await app.key('Escape')
      await resize(760, 520)
      await app.key('ctrl+f')
      await shot('search-narrow')
      assert((await observe()).editor.height > 200)
      await app.key('Escape')
      for (let n = 0; n < 3; n++) {
        await app.key('ctrl+1')
        await app.until(async () => (await app.probe()).mode === 'source', 'source mode')
        const styles = await app.execute(
          `return Array.from(document.querySelectorAll('.milkup-line[data-line="3"] *')).map(e=>({background:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderWidth}))`,
        )
        assert(styles.every((s) => s.background === 'rgba(0, 0, 0, 0)' && s.border === '0px'))
        if (n === 0) await shot('source-narrow')
        await app.key('ctrl+2')
        await app.until(async () => (await app.probe()).mode === 'live', 'live mode')
      }
      await app.key('ctrl+f')
      await app.focus('[data-search-input]')
      await app.key('ctrl+a')
      await app.text('待检查')
      await app.until(async () => {
        const p = await app.probe()
        return (
          p.query === '待检查' &&
          p.count === '1/1' &&
          [mixed.indexOf('待检查'), mixed.indexOf('待检查') + 3].includes(p.cursor)
        )
      }, 'table result revealed')
      await app.key('Escape')
      await app.key('F6')
      await focused('[data-table-action="select-cell"]')
      await shot('table-keyboard-focus')
      await app.key('shift+F6')
      await focused('.milkup-input-proxy')
      await app.key('Escape')
      await resize(1100, 760)
    }
    if (kind === 'normal') {
      // Preserve and restore all diagnostic styles; production assets stay unmodified.
      for (const scale of [1.25, 1.5, 2]) {
        await app.execute(
          `document.documentElement.style.zoom=arguments[0];document.querySelector('.desktop-shell').style.height=(innerHeight/arguments[0])+'px';document.querySelector('.desktop-shell').style.width=(innerWidth/arguments[0])+'px'`,
          scale,
        )
        await shot('diagnostic-css-zoom-' + scale)
      }
      await app.execute(
        `document.documentElement.style.removeProperty('zoom');document.querySelector('.desktop-shell').style.removeProperty('height');document.querySelector('.desktop-shell').style.removeProperty('width')`,
      )
      await app.focus('.milkup-input-proxy')
      await app.text('X')
      await app.until(async () => (await app.probe()).dirty, 'dirty edit')
      await app.key('ctrl+n')
      await app.until(
        () => app.execute('return !document.querySelector("[data-close-confirm]").hidden'),
        'confirm open',
      )
      await shot('unsaved-dialog-wide')
      await resize(760, 520)
      await shot('unsaved-dialog-narrow')
      for (let n = 0; n < 10; n++) {
        await app.key(n % 2 ? 'Tab' : 'shift+Tab')
        assert(
          await app.execute(
            'return document.querySelector("[data-close-confirm]").contains(document.activeElement)',
          ),
        )
      }
      // Real disk conflict, only the isolated fixture is replaced.
      await rm(file)
      await mkdir(file)
      await app.click('[data-close-confirm-action="save"]')
      await app.until(
        () => app.execute('return !document.querySelector("[data-transition-error]").hidden'),
        'visible native save error',
      )
      await shot('native-save-error')
      await rm(file, { recursive: true })
      await writeFile(file, original)
      await app.key('Escape')
      await focused('.milkup-input-proxy')
      await app.key('ctrl+z')
      await app.key('ctrl+1')
      await app.until(
        () =>
          app.execute(
            'return Array.from(document.querySelectorAll(".milkup-line")).map(e=>e.textContent.replace(/\\u200b/g, "")).join("\\n")===arguments[0]',
            original,
          ),
        'undo returns original source',
      )
      assert.equal(await readFile(file, 'utf8'), original)
    }
    results.push({ kind, ok: true, snapshots })
  } catch (error) {
    await shot('failure').catch(() => {})
    results.push({ kind, ok: false, error: String(error), snapshots })
    throw error
  } finally {
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
    await app.close()
  }
}
console.log(
  JSON.stringify(
    results.map(({ kind, ok, snapshots }) => ({ kind, ok, screenshots: snapshots.length })),
  ),
)

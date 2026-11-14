import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { ownNativeClipboard } from '../helpers/native-clipboard.mjs'
import { startProduction } from '../helpers/native-production.mjs'
import { observeNativeMemory } from '../helpers/native-process-memory.mjs'
const root = path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? '/tmp/milkup-production-tables')
await mkdir(root, { recursive: true })
const file = path.join(root, 'tables.md'),
  table =
    '\r\n| Name | Value |\r\n| --- | --- |\r\n' +
    Array.from({ length: 96 }, (_, i) => `| r${i}中文😀 | v${i} |\r\n`).join('') +
    '\r\nafter\r\n',
  original = Buffer.from(
    table +
      '\r\n| OverA | OverB |\r\n| --- | --- |\r\n' +
      Array.from({ length: 200 }, (_, i) => `| big${i} | raw |\r\n`).join('') +
      '\r\n' +
      ('x'.repeat(62) + '\r\n').repeat(32768),
  )
await writeFile(file, original)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  app = await startProduction(file, root),
  finishMemory = observeNativeMemory(),
  results = []
await writeFile(
  path.join(root, 'fixture.json'),
  JSON.stringify(
    {
      bytes: original.length,
      sha256: hash(original),
      supportedTableRows: 97,
      overBudgetTableRows: 201,
    },
    null,
    2,
  ),
)
const check = async (name, fn) => {
  const at = performance.now()
  await fn()
  results.push({ name, ms: performance.now() - at, status: 'PASS' })
  console.log('PASS ' + name)
  await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
}
const query = async (text) => {
  await app.key('ctrl+f')
  await app.focus('[data-search-input]')
  await app.key('ctrl+a')
  await app.text(text)
  await app.until(
    async () => {
      const p = await app.probe()
      return p.query === text && !p.searching && p.count === '1/1' && !p.replaceDisabled
    },
    'exact complete query',
    30000,
  )
  const expected = original.toString().indexOf(text) + text.length
  await app.until(async () => (await app.probe()).cursor === expected, 'search selection revealed')
  await app.key('Escape')
  await app.focus('.milkup-input-proxy')
}
const save = async (expected) => {
  await app.key('ctrl+s')
  await app.until(
    async () => {
      const p = await app.probe()
      return !p.saving && !p.dirty && hash(await readFile(file)) === hash(expected)
    },
    'saved complete bytes',
    20000,
  )
}
const undo = async () => {
  await app.key('ctrl+z')
  await save(original)
}
const geometry = () =>
  app.execute(
    `const cursor=document.querySelector('.milkup-cursor');const row=cursor&&document.querySelector('.milkup-line[data-line="'+cursor.dataset.line+'"]');const rect=e=>{const r=e?.getBoundingClientRect();return r&&{left:r.left,top:r.top,right:r.right,bottom:r.bottom,height:r.height,width:r.width}};return {cursor:rect(cursor),row:rect(row),viewport:rect(document.querySelector('.milkup-editor')),cells:Array.from(row?.querySelectorAll('.milkup-table-cell')??[]).map(rect),position:cursor?.dataset.position,rows:document.querySelectorAll('.milkup-line').length,breaks:row?.querySelectorAll('br').length,toolbarHidden:document.querySelector('[data-table-tools]').hidden}`,
  )
try {
  await app.key('ctrl+2')
  await check(
    'production full table context and native cell navigation beyond header viewport',
    async () => {
      await query('Name')
      assert((await geometry()).cells.length === 2)
      await app.shot('complete-header')
      await query('r80')
      await app.key('Home')
      await app.until(async () => (await app.probe()).cursor === table.indexOf('r80'), 'cell Home')
      assert.equal((await geometry()).toolbarHidden, false)
      await app.key('BackSpace')
      await app.delay(100)
      assert.equal((await app.probe()).dirty, false)
      await app.key('Tab')
      await app.until(
        async () => (await app.probe()).cursor === table.indexOf('v80') + 3,
        'next selected cell',
      )
      await app.key('Home')
      await app.key('Down')
      await app.until(
        async () => (await app.probe()).cursor === table.indexOf('v81'),
        'down same column',
      )
      await app.key('shift+Home')
      await app.key('shift+End')
      const selection = (await app.probe()).selection
      assert(
        selection.some((s) => s.from === table.indexOf('v81') && s.to === table.indexOf('v81') + 3),
      )
      const g = await geometry()
      assert(g.cells.length === 2 && g.rows < 100)
      assert(g.cursor.top >= g.viewport.top && g.cursor.bottom <= g.viewport.bottom)
      await app.shot('cross-window-cell-navigation')
      await save(original)
    },
  )
  await check('production multiline cell typing and atomic history', async () => {
    await query('r80')
    await app.key('End')
    await app.key('shift+Return')
    await app.until(async () => (await geometry()).breaks === 1, 'visual br rendered')
    await app.text('quick123')
    await app.until(
      async () => (await app.probe()).cursor === table.indexOf('r80') + 'r80中文😀'.length + 4 + 8,
      'typing delivered',
    )
    const expected = Buffer.from(original.toString().replace('r80中文😀', 'r80中文😀<br>quick123'))
    await save(expected)
    await app.until(async () => (await geometry()).breaks === 1, 'multiline persists after save')
    const g = await geometry()
    assert(g.row.height > 40)
    assert(g.cursor.top >= g.row.top && g.cursor.bottom <= g.row.bottom + 1)
    await writeFile(path.join(root, 'multiline-geometry.json'), JSON.stringify(g, null, 2))
    await app.shot('multiline-cell')
    await app.key('ctrl+z')
    await save(Buffer.from(original.toString().replace('r80中文😀', 'r80中文😀<br>')))
    await undo()
    await app.key('ctrl+y')
    await app.key('ctrl+y')
    await save(expected)
    await app.key('ctrl+z')
    await undo()
  })
  await check('production complete column operation undo redo exact bytes', async () => {
    await query('r80')
    await app.key('Home')
    await app.click('[data-table-action="add-column"]')
    await app.until(async () => (await app.probe()).dirty, 'column edit')
    await app.focus('.milkup-input-proxy')
    await app.key('ctrl+s')
    await app.until(async () => {
      const p = await app.probe()
      // The dirty dot is hidden while saving; wait for the write acknowledgement.
      return !p.saving && !p.dirty
    }, 'column saved')
    const changed = await readFile(file),
      head = changed.toString().slice(0, 5000)
    assert(head.includes('| Name |  | Value |'))
    assert(head.includes('| r95中文😀 |  | v95 |'))
    await app.shot('whole-column-saved')
    await undo()
    await app.key('ctrl+y')
    await save(changed)
    await undo()
  })
  await check(
    'production last-row navigation appends row with complete undo and reopen',
    async () => {
      await query('v95')
      await app.key('Tab')
      await app.until(async () => (await app.probe()).dirty, 'last cell creates row')
      const expected = Buffer.from(
        original
          .toString()
          .replace('| r95中文😀 | v95 |\r\n', '| r95中文😀 | v95 |\r\n|  |  |\r\n'),
      )
      await save(expected)
      await undo()
      await app.execute(
        'localStorage.setItem("milkup.desktop.nativeTestPaths",JSON.stringify({open:arguments[0]}))',
        file,
      )
      await app.key('ctrl+n')
      await app.until(async () => (await app.probe()).path !== file, 'close document')
      await app.key('ctrl+o')
      await app.until(async () => {
        const p = await app.probe()
        return p.path === file && p.loading === 'ready'
      }, 'reopen')
      await query('r80')
      assert((await geometry()).cells.length === 2)
      await save(original)
    },
  )
  await check(
    'production real clipboard multiline Unicode paste remains inside one cell',
    async () => {
      await query('r80')
      await app.key('End')
      const release = await ownNativeClipboard('|中文😀\r\nnext')
      try {
        await app.key('ctrl+v')
        const expected = Buffer.from(
          original.toString().replace('r80中文😀', 'r80中文😀\\|中文😀<br>next'),
        )
        await app.until(async () => (await app.probe()).dirty, 'real paste accepted')
        await save(expected)
        await app.until(async () => (await geometry()).breaks === 1, 'pasted break visible')
        await app.shot('native-clipboard-cell')
        await undo()
        await app.key('ctrl+y')
        await save(expected)
        await undo()
      } finally {
        release()
      }
    },
  )
  await check('production delete row and column preserve entire table history', async () => {
    await query('r80')
    await app.click('[data-table-action="delete-row"]')
    await app.focus('.milkup-input-proxy')
    await save(Buffer.from(original.toString().replace('| r80中文😀 | v80 |\r\n', '')))
    await undo()
    await query('r80')
    await app.key('Home')
    await app.click('[data-table-action="add-column"]')
    await app.until(async () => (await app.probe()).dirty, 'column added')
    await app.focus('.milkup-input-proxy')
    await app.key('ctrl+s')
    await app.until(async () => {
      const p = await app.probe()
      // The dirty dot is hidden while saving; wait for the write acknowledgement.
      return !p.saving && !p.dirty
    }, 'column saved')
    const added = await readFile(file)
    await app.click('[data-table-action="delete-column"]')
    await app.focus('.milkup-input-proxy')
    await save(original)
    await app.key('ctrl+z')
    await save(added)
    await undo()
  })
  await check('production over-budget table stays literal with no structural toolbar', async () => {
    await query('big150')
    const g = await geometry()
    assert.equal(g.cells.length, 0)
    assert.equal(g.toolbarHidden, true)
    await app.shot('over-budget-literal')
    await save(original)
  })
  const diagnostics = await app.execute('return window.__productionDiagnostics')
  await writeFile(path.join(root, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2))
  assert.equal(diagnostics.errors.length, 0)
  assert.equal(diagnostics.cspViolations.length, 0)
} catch (error) {
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify(
      { error: String(error), state: await app.probe(), geometry: await geometry() },
      null,
      2,
    ),
  )
  await app.shot('failure')
  throw error
} finally {
  await writeFile(path.join(root, 'memory.json'), JSON.stringify(await finishMemory(), null, 2))
  await app.close()
}

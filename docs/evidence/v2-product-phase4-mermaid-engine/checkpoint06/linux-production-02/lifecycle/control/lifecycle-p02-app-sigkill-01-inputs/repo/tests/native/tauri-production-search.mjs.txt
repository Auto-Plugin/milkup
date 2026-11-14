import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import net from 'node:net'
import { observeNativeMemory } from '../helpers/native-process-memory.mjs'
import { startProduction } from '../helpers/native-production.mjs'
const root = path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? '/tmp/milkup-production-search')
await mkdir(root, { recursive: true })
const large = process.env.MILKUP_PRODUCTION_CASE === 'large',
  file = path.join(root, large ? 'numbered.md' : 'unicode.md')
if (large) {
  assert(process.env.MILKUP_SEARCH_FIXTURE)
  await copyFile(process.env.MILKUP_SEARCH_FIXTURE, file)
} else
  await writeFile(
    file,
    '😀İ I i Σ ΟΣ 中文😀\r\n' + ('x'.repeat(62) + '\r\n').repeat(32768) + 'tailneedle 中文😀\r\n',
  )
const original = await readFile(file),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const devPortOpen = await new Promise((resolve) => {
  const socket = net.connect(1420, '127.0.0.1')
  socket.once('connect', () => {
    socket.destroy()
    resolve(true)
  })
  socket.once('error', () => resolve(false))
})
assert.equal(devPortOpen, false, 'development server must be stopped')
await writeFile(
  path.join(root, 'fixture.json'),
  JSON.stringify(
    { bytes: original.length, sha256: hash(original), developmentServerRunning: false },
    null,
    2,
  ),
)
const app = await startProduction(file, root),
  results = [],
  finishMemory = observeNativeMemory()
const check = async (name, fn) => {
  const at = performance.now()
  await fn()
  results.push({ name, ms: performance.now() - at, status: 'PASS' })
  console.log('PASS ' + name)
  await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
}
const query = async (value, count) => {
  await app.key('ctrl+f')
  await app.focus('[data-search-input]')
  await app.key('ctrl+a')
  await app.text(value)
  await app.until(
    async () => {
      const p = await app.probe()
      if (p.message?.startsWith('搜索失败')) throw Error(p.message)
      return (
        p.query === value &&
        !p.searching &&
        p.count === (count ? `1/${count}` : '0/0') &&
        (count ? !p.replaceDisabled : p.message.includes('没有匹配'))
      )
    },
    'complete search ' + value,
    125000,
  )
  return app.probe()
}
const save = async (expected) => {
  await app.key('Escape')
  await app.key('ctrl+s')
  await app.until(
    async () => {
      const p = await app.probe()
      if (p.saving || p.dirty) return false
      const actual = await readFile(file)
      return hash(actual) === hash(expected)
    },
    'complete saved bytes',
    20000,
  )
}
const replace = async (value, all) => {
  await app.focus('[data-replace-input]')
  await app.key('ctrl+a')
  await app.text(value)
  await app.until(
    () =>
      app.execute(
        'return document.querySelector("[data-replace-input]").value===arguments[0]',
        value,
      ),
    'replacement input delivered',
  )
  await app.click(all ? '[data-replace-all]' : '[data-replace-one]')
  await app.until(
    async () => {
      const p = await app.probe()
      if (!p.replacing && p.notice?.includes('失败')) throw Error(p.notice)
      return !p.replacing && p.dirty
    },
    'replacement commit',
    25000,
  )
}
try {
  for (const mode of ['source', 'live']) {
    await app.key('Escape')
    await app.key(mode === 'source' ? 'ctrl+1' : 'ctrl+2')
    await check(mode + ' production Unicode Worker and UTF16 selection', async () => {
      const p = await query(large ? 'tailneedle' : 'i', large ? 1 : 4)
      const expected = large ? original.toString().indexOf('tailneedle') + 10 : 3
      await app.until(
        async () => (await app.probe()).cursor === expected,
        'exact UTF16 search selection',
      )
      const diagnostics = await app.execute('return window.__productionDiagnostics')
      assert(diagnostics.workers.some((w) => w.messages > 0))
      assert(diagnostics.workers.every((w) => w.errors.length === 0))
      await app.shot(mode + '-worker-search')
    })
    await check(mode + ' cancelled old query cannot overwrite new Unicode search', async () => {
      await app.key('ctrl+f')
      await app.key('ctrl+a')
      await app.text('x')
      if (large) await app.until(async () => (await app.probe()).searching, 'old search running')
      else await app.delay(170)
      await query('tailneedle', 1)
      assert.equal((await app.probe()).query, 'tailneedle')
    })
    if (large)
      await check(mode + ' cancels a running non-ASCII production Worker query', async () => {
        const before = await app.execute('return window.__productionDiagnostics.workers.length')
        await app.key('ctrl+f')
        await app.focus('[data-search-input]')
        await app.key('ctrl+a')
        await app.text('İ')
        await app.until(
          async () => {
            const p = await app.probe()
            const workers = await app.execute('return window.__productionDiagnostics.workers')
            return (
              p.query === 'İ' &&
              p.searching &&
              workers.length > before &&
              workers.at(-1).messages > 0
            )
          },
          'non-ASCII Worker actively scanning',
          15000,
        )
        await query('tailneedle', 1)
        await writeFile(
          path.join(root, mode + '-unicode-cancel.json'),
          JSON.stringify(
            {
              state: await app.probe(),
              workers: await app.execute(
                'return window.__productionDiagnostics.workers.slice(arguments[0])',
                before,
              ),
            },
            null,
            2,
          ),
        )
      })
    if (large)
      await check(mode + ' editing during dense search invalidates stale versions', async () => {
        await app.key('ctrl+f')
        await app.focus('[data-search-input]')
        await app.key('ctrl+a')
        await app.text('x')
        await app.until(async () => (await app.probe()).searching, 'dense search running')
        const started = performance.now(),
          before = (await app.probe()).version
        await app.focus('.milkup-input-proxy')
        await app.key('ctrl+Home')
        await app.text('Q')
        await app.until(async () => {
          const p = await app.probe()
          return p.dirty && p.version > before
        }, 'input committed during search')
        await writeFile(
          path.join(root, mode + '-input-response.json'),
          JSON.stringify(
            { nativeKeyboardToVersionMs: performance.now() - started, state: await app.probe() },
            null,
            2,
          ),
        )
        await app.until(
          async () => {
            const p = await app.probe()
            return !p.searching && p.count === '1/83558400' && !p.replaceDisabled
          },
          'complete dense search at edited version',
          30000,
        )
        await save(Buffer.concat([Buffer.from('Q'), original]))
        await app.key('ctrl+z')
        await save(original)
      })
    if (large)
      await check(mode + ' cancel complete native replacement before commit', async () => {
        await query('row', 1638400)
        await app.focus('[data-replace-input]')
        await app.key('ctrl+a')
        await app.text('R')
        await app.until(
          () => app.execute('return document.querySelector("[data-replace-input]").value==="R"'),
          'replacement input delivered',
        )
        await app.click('[data-replace-all]')
        await app.until(async () => (await app.probe()).replacing, 'preparation started')
        await app.click('[data-replace-cancel]')
        await app.until(async () => !(await app.probe()).replacing, 'cancel finished')
        assert.equal((await app.probe()).dirty, false)
        assert.equal(hash(await readFile(file)), hash(original))
      })
    await check(mode + ' single replace undo redo exact bytes', async () => {
      await query('tailneedle', 1)
      await replace('TAIL', false)
      const expected = Buffer.from(original.toString().replace('tailneedle', 'TAIL'))
      await save(expected)
      await app.key('ctrl+z')
      await save(original)
      await app.key('ctrl+y')
      await save(expected)
      await app.key('ctrl+z')
      await save(original)
    })
    await check(mode + ' complete replace all undo redo and reopen', async () => {
      const needle = large ? 'row' : 'i',
        count = large ? 1638400 : 4
      await query(needle, count)
      await replace(large ? 'R' : '$1😀', true)
      const expected = large
        ? Buffer.from(original.toString().replaceAll('row', 'R'))
        : Buffer.from(original.toString().replace(/[İIi]/g, () => '$1😀'))
      await save(expected)
      await app.key('ctrl+z')
      await save(original)
      await app.key('ctrl+y')
      await save(expected)
      await app.shot(mode + '-replacement-saved')
      await app.key('ctrl+z')
      await save(original)
      await app.execute(
        'localStorage.setItem("milkup.desktop.nativeTestPaths",JSON.stringify({open:arguments[0]}))',
        file,
      )
      await app.key('ctrl+n')
      await app.until(async () => (await app.probe()).path !== file, 'closed document')
      await app.key('ctrl+o')
      await app.until(async () => {
        const p = await app.probe()
        return p.path === file && p.loading === 'ready'
      }, 'reopen')
      assert.equal(hash(await readFile(file)), hash(original))
      await query('tailneedle', 1)
    })
  }
  const diagnostics = await app.execute(
    'return {...window.__productionDiagnostics,resources:performance.getEntriesByType("resource").map(r=>({url:r.name,kind:r.initiatorType}))}',
  )
  await writeFile(path.join(root, 'runtime-resources.json'), JSON.stringify(diagnostics, null, 2))
  assert.equal(diagnostics.cspViolations.length, 0)
  assert.equal(diagnostics.errors.length, 0)
  console.log(JSON.stringify({ passed: results.length, bytes: original.length }))
} catch (error) {
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify(
      {
        error: String(error),
        state: await app.probe(),
        diagnostics: await app.execute('return window.__productionDiagnostics'),
      },
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

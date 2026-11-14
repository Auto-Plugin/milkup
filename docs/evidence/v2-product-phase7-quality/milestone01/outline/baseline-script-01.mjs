// Offline algorithm/keyboard audit. This does not launch Milkup or a native display.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const mode = process.argv[2]
const output = process.argv[3]
assert(['index', 'keyboard'].includes(mode) && output, 'Usage: node tests/performance/p7-outline-baseline.mjs index|keyboard NEW_OUTPUT_DIR')
await mkdir(output, { recursive: true })
const encode = new TextEncoder()
const bytes = (value) => encode.encode(value).length
async function load(relative) {
  const result = await build({
    entryPoints: [path.join(root, relative)], bundle: true, write: false,
    platform: 'node', format: 'esm', target: 'es2022',
    alias: { '@milkup/plugin-sdk': path.join(root, 'packages/plugin-sdk/src/index.js') },
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
function headings(count, long = false) {
  let offset = 0
  return Array.from({ length: count }, (_, ordinal) => {
    const level = ordinal % 900 === 0 ? 1 : ordinal % 30 === 0 ? 2 : 3 + ordinal % 4
    const label = long ? `标题 ${ordinal} ${'中文👩🏽‍💻é'.repeat(300)}`.slice(0, 4096)
      : ordinal % 15 === 0 ? 'Duplicate 中文' : `Heading ${ordinal} 中文 👩🏽‍💻 é`
    const from = offset
    offset += label.length + level + 12
    return { id: String(ordinal), kind: 'heading', from, to: from + label.length,
      line: ordinal * 2 + 1, lineOffset: 0, level, label, labelFrom: from, labelTo: from + label.length }
  })
}
function storage() {
  const pages = new Map()
  const stats = { reads: 0, writes: 0, readKeys: 0, writtenKeys: 0, readBytes: 0,
    writtenBytes: 0, maxPageBytes: 0, maxBatchBytes: 0 }
  return { pages, stats, store: {
    async get(key) {
      stats.reads++; stats.readKeys++
      const value = pages.get(key) ?? null
      stats.readBytes += bytes(value ?? '')
      return value
    },
    async getMany(keys) {
      stats.reads++; stats.readKeys += keys.length
      const values = keys.map((key) => pages.get(key) ?? null)
      const total = values.reduce((sum, value) => sum + bytes(value ?? ''), 0)
      assert(total <= 256 * 1024); stats.readBytes += total
      return values
    },
    async set() { throw new Error('Expected batched writes') },
    async setMany(entries) {
      stats.writes++; stats.writtenKeys += entries.length
      const total = entries.reduce((sum, entry) => sum + bytes(entry.value), 0)
      assert(entries.length <= 32 && total <= 256 * 1024)
      stats.writtenBytes += total; stats.maxBatchBytes = Math.max(stats.maxBatchBytes, total)
      for (const { key, value } of entries) {
        assert(bytes(value) <= 64 * 1024)
        stats.maxPageBytes = Math.max(stats.maxPageBytes, bytes(value)); pages.set(key, value)
      }
    },
    async dispose() { pages.clear() },
  } }
}
const report = { mode, kind: 'offline; no native interaction, disk latency, scanner or IPC measured',
  node: process.version, startedAt: new Date().toISOString(), sourceHashes: {}, results: [] }
for (const file of ['plugins/outline/plugin.json', 'plugins/outline/src/outline-index.ts',
  'plugins/outline/src/plugin.ts', 'apps/desktop/src/controlled-tree-ui.ts',
  'packages/plugin-sdk/src/index.js', 'tests/performance/p7-outline-baseline.mjs']) {
  report.sourceHashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')
}
if (mode === 'index') {
  const { OutlineIndex } = await load('plugins/outline/src/outline-index.ts')
  for (const [count, long] of [[8, false], [8775, false], [18000, false], [512, true]]) {
    for (let repetition = 1; repetition <= 3; repetition++) {
      const source = headings(count, long), db = storage(), index = new OutlineIndex(db.store, 7)
      const item = { count, longLabels: long, repetition,
        fixtureSha256: createHash('sha256').update(JSON.stringify(source)).digest('hex'), operations: [] }
      async function measure(name, action) {
        const before = { ...db.stats }, start = performance.now()
        await action()
        item.operations.push({ name, elapsedMs: performance.now() - start,
          io: Object.fromEntries(Object.keys(before).filter((key) => !key.startsWith('max'))
            .map((key) => [key, db.stats[key] - before[key]])), visible: index.visibleSize })
      }
      await measure('append-and-finish', async () => {
        for (const heading of source) await index.append(heading)
        await index.finish(); assert.equal(index.size, count)
      })
      await measure('full-title-and-position-verification', async () => {
        for (let start = 0; start < count; start += 500) {
          const rows = await index.rows(start, Math.min(count, start + 500))
          assert.deepEqual(rows.map((row) => [row.ordinal, row.title, row.from, row.line]),
            source.slice(start, start + 500).map((heading, offset) =>
              [start + offset, heading.label, heading.from, heading.line]))
        }
      })
      await measure('collapse-all-reset-only', async () => { index.resetCollapsed(true); await index.flush() })
      await measure('collapse-all-visible-rows-160', async () => {
        const rows = await index.rows(0, Math.min(160, index.visibleSize))
        assert(rows.every((row) => row.level === 1))
      })
      await measure('expand-all-and-visible-rows-160', async () => {
        index.resetCollapsed(false); await index.rows(0, Math.min(160, count))
      })
      await measure('scroll-tail-160', () => index.rows(Math.max(0, count - 160), count))
      await measure('scroll-middle-160', () => index.rows(Math.floor(count / 2), Math.min(count, Math.floor(count / 2) + 160)))
      await measure('collapse-local-first-root-and-rows', async () => {
        await index.setCollapsed(0, true); await index.flush()
        await index.rows(0, Math.min(160, index.visibleSize))
      })
      await measure('expand-local-first-root-and-rows', async () => {
        await index.setCollapsed(0, false); await index.flush(); await index.rows(0, Math.min(160, count))
      })
      await measure('lookup-tail-line-metadata-rank', async () => {
        const ordinal = await index.atLine(source.at(-1).line)
        assert.equal(ordinal, count - 1); assert.equal((await index.get(ordinal)).from, source.at(-1).from)
        assert.equal(await index.rank(ordinal), count - 1)
      })
      item.storage = { ...db.stats, pages: db.pages.size,
        chargedBytes: [...db.pages.values()].reduce((sum, value) => sum + bytes(value), 0) }
      report.results.push(item)
      console.log(`${count} headings long=${long} repetition=${repetition}: complete`)
    }
  }
} else {
  const require = createRequire(import.meta.url)
  const vitestRequire = createRequire(require.resolve('vitest/package.json'))
  const { JSDOM } = vitestRequire('jsdom')
  const dom = new JSDOM('<main></main>')
  for (const name of ['Element', 'HTMLElement', 'HTMLButtonElement']) globalThis[name] = dom.window[name]
  const { decorateControlledTrees } = await load('apps/desktop/src/controlled-tree-ui.ts')
  const { default: plugin } = await load('plugins/outline/src/plugin.ts')
  const source = headings(8), db = storage()
  const activation = plugin.activate({ pluginId: 'milkup.outline', permissions: ['document:read'], host: {
    storage: { createTemporaryStore: async () => db.store },
    ui: { requestUpdate: async () => {}, revealLine: async () => {} },
    document: { scan: () => ({ cancel: async () => {}, async *[Symbol.asyncIterator]() {
      const common = { scanId: 'baseline', documentId: 'baseline', version: 1,
        scannedLineCount: 16, totalLineCount: 16, resultCount: 8 }
      yield { ...common, type: 'batch', items: source }
      yield { ...common, type: 'done', reason: 'complete', complete: true }
    } }) },
  } })
  const render = () => plugin.renderers['outline-panel']({ node: {
    phase: 'update', documentId: 'baseline', documentVersion: 1, documentLineCount: 16,
  } })
  let tree
  const start = performance.now()
  do {
    tree = render()
    if (JSON.stringify(tree).includes('全文索引完成') && JSON.stringify(tree).includes('treeitem')) break
    assert(performance.now() - start < 5000, 'Outline readiness timeout')
    await new Promise((resolve) => setTimeout(resolve, 10))
  } while (true)
  function mount(node) {
    if (typeof node !== 'object' || node === null) return dom.window.document.createTextNode(String(node ?? ''))
    assert.equal(node.type, 'element')
    const element = dom.window.document.createElement(node.tag)
    for (const [key, value] of Object.entries(node.attributes ?? {})) element.setAttribute(key, value)
    if (node.text !== undefined) element.textContent = node.text
    for (const child of node.children ?? []) element.append(mount(child))
    return element
  }
  const main = dom.window.document.querySelector('main')
  main.append(mount(tree))
  decorateControlledTrees(main, new Map(), () => {})
  const navigation = [...main.querySelectorAll('.plugin-list-item')]
  assert.equal(navigation.length, 8)
  navigation[0].focus()
  const event = new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
  navigation[0].dispatchEvent(event)
  report.results.push({ name: 'actual-outline-output-with-host-tree-keyboard-controller',
    headingCount: navigation.length, treeItems: main.querySelectorAll('[role="treeitem"]').length,
    focusAfterDown: dom.window.document.activeElement.textContent,
    expectedFocus: navigation[1].textContent, arrowDownPrevented: event.defaultPrevented,
    focusMoved: dom.window.document.activeElement === navigation[1],
    treeTabStops: [...main.querySelectorAll('[role="tree"] button')].filter((button) => button.tabIndex >= 0).length,
    note: 'DOM unit reproduction only; default Tab/Enter remains available. No native keyboard/screen-reader claim.' })
  await writeFile(path.join(output, 'actual-outline.html'), main.outerHTML, { flag: 'wx' })
  await activation.dispose(); await plugin.deactivate(); dom.window.close()
}
await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
if (mode === 'keyboard') {
  assert.equal(report.results[0].focusMoved, true, 'P7 RED: ArrowDown must move to the next outline heading')
  assert.equal(report.results[0].treeTabStops, 1, 'P7 RED: outline tree must have one roving Tab stop')
}

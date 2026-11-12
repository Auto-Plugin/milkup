// Paired CPU/index experiment only. No native scanner, disk, IPC or UI timing.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import { build } from 'esbuild'

const [baseline, output] = process.argv.slice(2)
assert.match(baseline ?? '', /^[a-f0-9]{40}$/)
assert.ok(output, 'Usage: outline-append-comparison.mjs <baseline-sha> <new-output-dir>')
await mkdir(output, { recursive: false })
const sourcePath = 'plugins/outline/src/outline-index.ts'
const sources = {
  before: execFileSync('git', ['show', `${baseline}:${sourcePath}`], { encoding: 'utf8' }),
  after: await readFile(sourcePath, 'utf8'),
}
const classes = {}
for (const [name, source] of Object.entries(sources)) {
  const compiled = await build({
    stdin: { contents: source, loader: 'ts', resolveDir: path.dirname(path.resolve(sourcePath)) },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  })
  classes[name] = (
    await import(
      `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
    )
  ).OutlineIndex
}
const headings = Array.from({ length: 18000 }, (_, i) => ({
  id: String(i),
  kind: 'heading',
  from: i * 100,
  to: i * 100 + 30,
  line: i * 2 + 1,
  lineOffset: 0,
  level: i % 900 === 0 ? 1 : i % 30 === 0 ? 2 : 3 + (i % 4),
  label: `Title ${i} 中文`,
  labelFrom: i * 100,
  labelTo: i * 100 + 15,
}))
const sha = (value) => createHash('sha256').update(value).digest('hex')
const samples = []
for (let pair = 0; pair < 9; pair++) {
  // Alternate order. Pair zero warms both implementations and is retained but
  // excluded from the summary. Do not silently select the fastest trials.
  for (const name of pair % 2 ? ['after', 'before'] : ['before', 'after']) {
    const pages = new Map(),
      io = { reads: 0, writes: 0 }
    const store = {
      async get(key) {
        io.reads++
        return pages.get(key) ?? null
      },
      async getMany(keys) {
        io.reads++
        return keys.map((key) => pages.get(key) ?? null)
      },
      async set() {
        throw Error('Expected bounded batch writes')
      },
      async setMany(entries) {
        io.writes++
        assert.ok(entries.length <= 32)
        assert.ok(
          entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.value), 0) <= 256 * 1024,
        )
        for (const { key, value } of entries) {
          assert.ok(Buffer.byteLength(value) <= 64 * 1024)
          pages.set(key, value)
        }
      },
      async dispose() {
        pages.clear()
      },
    }
    const index = new classes[name](store, 7)
    const start = performance.now()
    for (const heading of headings) await index.append(heading)
    await index.finish()
    const elapsedMs = performance.now() - start
    const appendIo = { ...io }
    const storedSha256 = sha(JSON.stringify([...pages].sort(([a], [b]) => a.localeCompare(b))))
    assert.equal(index.size, headings.length)
    for (let start = 0; start < headings.length; start += 500) {
      const rows = await index.rows(start, Math.min(headings.length, start + 500))
      assert.deepEqual(
        rows.map((row) => [row.ordinal, row.title, row.line]),
        headings
          .slice(start, start + 500)
          .map((heading, offset) => [start + offset, heading.label, heading.line]),
      )
    }
    index.resetCollapsed(true)
    assert.equal(index.visibleSize, 20)
    assert.deepEqual(
      (await index.rows(0, 20)).map((row) => row.ordinal),
      Array.from({ length: 20 }, (_, i) => i * 900),
    )
    samples.push({ pair, name, warmup: pair === 0, elapsedMs, appendIo, storedSha256 })
  }
}
for (let pair = 0; pair < 9; pair++) {
  const [a, b] = samples.filter((sample) => sample.pair === pair)
  assert.deepEqual(a.appendIo, b.appendIo, 'Optimization changed storage transaction counts')
  assert.equal(a.storedSha256, b.storedSha256, 'Optimization changed persisted index bytes')
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return (sorted[3] + sorted[4]) / 2
}
const medians = Object.fromEntries(
  ['before', 'after'].map((name) => [
    name,
    median(
      samples
        .filter((sample) => sample.name === name && !sample.warmup)
        .map((sample) => sample.elapsedMs),
    ),
  ]),
)
const report = {
  kind: 'paired CPU/index only; excludes native scan/storage/IPC/input/paint; not a native p95 result',
  node: process.version,
  baseline,
  currentHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(
    Object.entries(sources).map(([name, source]) => [name, sha(source)]),
  ),
  fixtureSha256: sha(JSON.stringify(headings)),
  headingCount: headings.length,
  samples,
  medians,
  medianReductionPercent: (1 - medians.after / medians.before) * 100,
}
await writeFile(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ medians, medianReductionPercent: report.medianReductionPercent }))

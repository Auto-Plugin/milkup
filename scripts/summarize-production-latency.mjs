// Recomputes all distributions from retained production samples, including every miss.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
const root = path.resolve(process.argv[2]),
  groups = new Map(),
  runs = [],
  violations = [],
  resources = []
const summary = (values) => {
  const sorted = values.slice().sort((a, b) => a - b),
    n = sorted.length
  return {
    n,
    min: sorted[0],
    median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    max: sorted.at(-1),
  }
}
const counters = (value) =>
  Object.fromEntries(
    value
      .trim()
      .split('\n')
      .map((line) => {
        const [key, number] = line.split(/\s+/)
        return [key, Number(number)]
      }),
  )
const delta = (before, after) =>
  Object.fromEntries(
    Object.entries(counters(after)).map(([key, value]) => [key, value - counters(before)[key]]),
  )
for (const name of (await readdir(root)).sort()) {
  const match =
    /^regression-(baseline|candidate)-(175k|1m|10m|100m)-(short|long)-(source|live)-r([123])$/.exec(
      name,
    )
  if (!match) continue
  const d = JSON.parse(await readFile(path.join(root, name, 'samples.json'), 'utf8'))
  assert(d.metadata.probeVersion === 2, 'do not mix probe versions')
  assert(d.complete === true, 'partial run requires review; no silent omission')
  const diagnostics = JSON.parse(await readFile(path.join(root, name, 'diagnostics.json'), 'utf8'))
  const memory = JSON.parse(await readFile(path.join(root, name, 'memory.json'), 'utf8'))
  const log = await readFile(path.join(root, name, 'run.log'), 'utf8')
  runs.push({
    name,
    build: match[1],
    metadata: d.metadata,
    open: d.samples.find((s) => s.kind === 'open-to-ready'),
    save: d.samples.find((s) => s.kind === 'save-to-ready'),
    windowAppearanceMs: Number(/NATIVE_STARTUP_WINDOW (\d+)ms/.exec(log)?.[1]),
    maxProcessSumRssKiB: memory.maxProcessSumRssKiB,
    maxTimerGap: diagnostics.maxTimerGap,
    maxFrameGap: Math.max(0, ...diagnostics.frameGaps.map((f) => f.gap)),
    longTaskSupported: diagnostics.longTaskSupported,
    memoryEventsDelta: delta(d.resources[0].events, d.resources.at(-1).events),
    cpuDelta: delta(d.resources[0].cpu, d.resources.at(-1).cpu),
  })
  resources.push(...d.resources.map((r) => ({ ...r, run: name })))
  for (const sample of d.samples.filter((s) => 'frameMs' in s)) {
    assert(sample.trusted, 'non-native sample')
    assert.equal(sample.overTarget, sample.frameMs > sample.targetMs)
    const key = [
      match[1],
      match[2],
      match[3],
      match[4],
      sample.kind,
      sample.temperature ?? '',
    ].join('/')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ ...sample, run: name })
    if (sample.overTarget) violations.push({ ...sample, run: name })
  }
}
const cells = Array.from(groups, ([key, samples]) => ({
  key,
  domMs: summary(samples.map((s) => s.domMs)),
  frameMs: summary(samples.map((s) => s.frameMs)),
  externalMs: summary(samples.map((s) => s.externalCommandToObservedMs)),
  misses: samples.filter((s) => s.overTarget).length,
  targetMs: samples[0].targetMs,
}))
console.log(
  JSON.stringify(
    {
      protocol: 2,
      runs,
      cells,
      violations,
      resources: {
        anonymous: summary(resources.map((r) => r.anonymous)),
        memoryCurrent: summary(resources.map((r) => r.memoryCurrent)),
        fileCache: summary(resources.map((r) => r.fileCache)),
      },
    },
    null,
    2,
  ),
)

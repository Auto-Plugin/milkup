import { expect, it } from 'vitest'
import type { SdkDocumentScanHeading, SdkTemporaryStore } from '@milkup/plugin-sdk'
import { OutlineIndex } from './outline-index'

function fixture(count: number) {
  const stack: number[] = []
  return Array.from({ length: count }, (_, i) => {
    const level = i % 900 === 0 ? 1 : i % 30 === 0 ? 2 : 3 + (i % 4)
    while (
      stack.length &&
      (stack.at(-1)! % 900 === 0 ? 1 : stack.at(-1)! % 30 === 0 ? 2 : 3 + (stack.at(-1)! % 4)) >=
        level
    )
      stack.pop()
    const ancestors = [...stack]
    stack.push(i)
    const label = i % 15 === 0 ? 'Duplicate' : `Title ${i}`
    const item: SdkDocumentScanHeading = {
      id: String(i),
      kind: 'heading',
      from: i * 100,
      to: i * 100 + 30,
      line: i * 2 + 1,
      lineOffset: 0,
      level,
      label,
      labelFrom: i * 100,
      labelTo: i * 100 + label.length,
    }
    return { item, ancestors }
  })
}
function storage() {
  const data = new Map<string, string>()
  const counters = { writes: 0, reads: 0, maxPage: 0, maxBatch: 0 }
  const size = (s: string) => new TextEncoder().encode(s).length
  const store: SdkTemporaryStore = {
    async get(k) {
      counters.reads++
      return data.get(k) ?? null
    },
    async getMany(keys) {
      counters.reads++
      const values = keys.map((k) => data.get(k) ?? null)
      expect(values.reduce((n, v) => n + size(v ?? ''), 0)).toBeLessThanOrEqual(256 * 1024)
      return values
    },
    async set() {
      throw new Error('use batched storage')
    },
    async setMany(entries) {
      counters.writes++
      expect(entries.length).toBeLessThanOrEqual(32)
      const bytes = entries.reduce((n, e) => n + size(e.value), 0)
      counters.maxBatch = Math.max(counters.maxBatch, bytes)
      expect(bytes).toBeLessThanOrEqual(256 * 1024)
      for (const { key, value } of entries) {
        counters.maxPage = Math.max(counters.maxPage, size(value))
        expect(size(value)).toBeLessThanOrEqual(64 * 1024)
        data.set(key, value)
      }
    },
    async dispose() {
      data.clear()
    },
  }
  return { store, counters, data }
}

it.each([8775, 18000])(
  'matches an independent hierarchy oracle for %i headings and sparse/global folds',
  async (count) => {
    const source = fixture(count),
      folded = Array<boolean>(count).fill(false)
    const { store, counters, data } = storage()
    const index = new OutlineIndex(store, 7)
    for (const { item } of source) await index.append(item)
    await index.finish()
    expect(index.size).toBe(count)
    expect(data.size).toBeLessThan(500)
    // Full traversal proves every heading remains available, including duplicate titles.
    for (let start = 0; start < count; start += 500) {
      const rows = await index.rows(start, Math.min(count, start + 500))
      expect(rows.map((r) => [r.ordinal, r.title, r.from, r.ancestors])).toEqual(
        source
          .slice(start, start + 500)
          .map(({ item, ancestors }, offset) => [start + offset, item.label, item.from, ancestors]),
      )
    }
    let seed = 38271
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
    for (let round = 0; round < 90; round++) {
      if (round % 15 === 0) {
        const collapsed = round % 30 === 0
        const writes = counters.writes,
          reads = counters.reads
        index.resetCollapsed(collapsed)
        folded.fill(collapsed)
        await index.flush()
        expect(counters.writes).toBe(writes)
        expect(counters.reads).toBe(reads)
      } else {
        const ordinal =
          round % 7 === 0 ? Math.floor((random() % count) / 900) * 900 : random() % (count - 1)
        const collapsed = !folded[ordinal]
        if (source[ordinal + 1]?.ancestors.includes(ordinal)) folded[ordinal] = collapsed
        const writes = counters.writes,
          reads = counters.reads
        await index.setCollapsed(ordinal, collapsed)
        await index.flush()
        expect(counters.writes - writes).toBeLessThanOrEqual(2)
        expect(counters.reads - reads).toBeLessThanOrEqual(8)
      }
      const expected = source.flatMap(({ ancestors }, i) =>
        ancestors.every((a) => !folded[a]) ? [i] : [],
      )
      expect(index.visibleSize).toBe(expected.length)
      const start = random() % expected.length,
        end = Math.min(expected.length, start + 71)
      expect((await index.rows(start, end)).map((r) => r.ordinal)).toEqual(
        expected.slice(start, end),
      )
      for (const ordinal of [0, count - 1, random() % count, expected[start]!]) {
        expect(await index.rank(ordinal)).toBe(expected.indexOf(ordinal))
        expect(await index.atLine(source[ordinal]!.item.line + 1)).toBe(ordinal)
        expect((await index.get(ordinal))?.collapsed).toBe(folded[ordinal])
      }
    }
    expect(await index.atLine(0)).toBe(-1)
    await expect(index.rows(0, 501)).rejects.toThrow('500')
  },
  30000,
)

it('keeps fold overrides and lazy range updates correct while appending through tree growth', async () => {
  const source = fixture(5000),
    folded = Array<boolean>(source.length).fill(false)
  const { store } = storage(),
    index = new OutlineIndex(store, 3)
  for (let i = 0; i < source.length; i++) {
    await index.append(source[i]!.item)
    if ([125, 127, 129, 4000, 4095, 4096, 4200].includes(i)) {
      index.resetCollapsed(true)
      folded.fill(true)
      const root = Math.floor(i / 900) * 900
      await index.setCollapsed(root, false)
      folded[root] = false
      await index.flush()
    }
    if ([128, 150, 4097, 4300, 4999].includes(i)) {
      const expected = source
        .slice(0, i + 1)
        .flatMap(({ ancestors }, n) => (ancestors.every((a) => !folded[a]) ? [n] : []))
      expect(index.visibleSize).toBe(expected.length)
      expect((await index.rows(0, expected.length)).map((r) => r.ordinal)).toEqual(expected)
    }
  }
  await index.finish()
  index.resetCollapsed(false)
  expect(index.visibleSize).toBe(5000)
  expect((await index.rows(4490, 4510)).map((r) => r.ordinal)).toEqual(
    Array.from({ length: 20 }, (_, i) => 4490 + i),
  )
})

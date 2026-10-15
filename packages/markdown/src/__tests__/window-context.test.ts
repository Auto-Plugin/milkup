import { expect, it } from 'vitest'
import { createMarkdownWindowContextReader } from '../extensions/window-context'
function setup(text: string) {
  let version = 0
  const rows = text.split('\n')
  let offset = 0
  const lines = rows.map((raw, i) => {
    const text = raw.replace(/\r$/, '')
    const line = { number: i + 1, from: offset, to: offset + text.length, text }
    offset += raw.length + 1
    return line
  })
  const calls: number[] = []
  const source = {
    documentId: 'doc',
    get version() {
      return version
    },
    lineCount: lines.length,
    async readLineWindow(a: number, b: number, budget?: number) {
      calls.push(b - a + 1)
      const selected = lines.slice(a - 1, b)
      const from = selected[0]!.from,
        to = selected.at(-1)!.to
      const value = text.slice(from, to)
      if (value.length > (budget ?? Infinity)) throw new RangeError('text budget')
      return { from, to, text: value, lines: selected }
    },
  }
  const window = (a: number, b: number) => ({
    documentId: 'doc',
    version,
    source: text.slice(lines[a - 1]!.from, lines[b - 1]!.to),
    from: lines[a - 1]!.from,
    to: lines[b - 1]!.to,
    fromLine: a,
    toLine: b,
    completeStart: a === 1,
    completeEnd: b === lines.length,
  })
  return {
    source,
    window,
    calls,
    change() {
      version++
    },
  }
}
it('protects a window inside an earlier fence and excludes inline code/link destinations', async () => {
  const f = setup('```md\n[^fake]\n```\ntext `[^code]` [label](x$y) $real$')
  const reader = createMarkdownWindowContextReader({ source: () => f.source })
  const inside = await reader.read(f.window(2, 2))
  expect(inside.contextKnown).toBe(true)
  expect(inside.blocks[0]).toMatchObject({ kind: 'fence', complete: false })
  const plain = await reader.read(f.window(4, 4))
  expect(
    plain.protectedRanges.map((r) =>
      f.window(4, 4).source.slice(r.from - f.window(4, 4).from, r.to - f.window(4, 4).from),
    ),
  ).toEqual(expect.arrayContaining(['`[^code]`', 'x$y']))
})
it('returns whole valid fence ranges and preserves absolute CRLF Unicode positions', async () => {
  const f = setup('😀\r\n```mermaid\r\ngraph LR\r\n```\r\nend')
  const r = await createMarkdownWindowContextReader({ source: () => f.source }).read(f.window(2, 4))
  expect(r.blocks).toContainEqual(
    expect.objectContaining({
      kind: 'fence',
      info: 'mermaid',
      complete: true,
      from: 4,
      to: 29,
      contentRanges: [{ from: 16, to: 26 }],
    }),
  )
})
it('falls back after uncertain nested code or HTML and respects work budgets', async () => {
  const f = setup('> ```\n> code\n> ```\nplain')
  const r = await createMarkdownWindowContextReader({ source: () => f.source }).read(f.window(4, 4))
  expect(r.contextKnown).toBe(false)
  const g = setup('x\nx\nx\nx\nvisible')
  const limited = await createMarkdownWindowContextReader({
    source: () => g.source,
    maxScanLines: 2,
  }).read(g.window(5, 5))
  expect(limited.contextKnown).toBe(false)
  expect(g.calls.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2)
  const h = setup('<script>\n[^fake]\n</script>\nnormal')
  expect(
    (await createMarkdownWindowContextReader({ source: () => h.source }).read(h.window(2, 2)))
      .blocks[0]?.kind,
  ).toBe('code')
})
it('invalidates cached context on version change and rejects aborted/stale windows', async () => {
  const f = setup('a\nb')
  const reader = createMarkdownWindowContextReader({ source: () => f.source })
  const old = f.window(2, 2)
  f.change()
  await expect(reader.read(old)).rejects.toThrow(/stale/)
  const abort = new AbortController()
  abort.abort()
  await expect(reader.read(f.window(1, 1), { signal: abort.signal })).rejects.toMatchObject({
    name: 'AbortError',
  })
})

it('keeps delimiter escapes available to plugin rules instead of masking TeX commands', async () => {
  const source = String.raw`$\int x\,dx$ and $\{x\}$ and \$literal`
  const f = setup(source)
  expect(
    (await createMarkdownWindowContextReader({ source: () => f.source }).read(f.window(1, 1)))
      .protectedRanges,
  ).toEqual([])
})

it('resumes budgeted prefix scans and clears checkpoints when source changes', async () => {
  const f = setup('a\nb\nc\nd\nvisible')
  const reader = createMarkdownWindowContextReader({ source: () => f.source, maxScanLines: 2 })
  expect(await reader.read(f.window(5, 5))).toMatchObject({
    pending: true,
    scannedThroughLine: 2,
    reason: 'budget',
  })
  expect(await reader.read(f.window(5, 5))).toMatchObject({ pending: false, contextKnown: true })
  f.change()
  expect(await reader.read(f.window(5, 5))).toMatchObject({ pending: true, scannedThroughLine: 2 })
})

it('rejects a version change while an asynchronous prefix read is pending', async () => {
  const f = setup('```\nbody\n```')
  const original = f.source.readLineWindow.bind(f.source)
  f.source.readLineWindow = async (...args) => {
    const result = await original(...args)
    f.change()
    return result
  }
  await expect(
    createMarkdownWindowContextReader({ source: () => f.source }).read(f.window(2, 2)),
  ).rejects.toThrow('stale')
})

it('honors per-operation remaining line and UTF-16 budgets without increasing constructor limits', async () => {
  const f = setup('abc\ndef\nghi\nvisible')
  const reader = createMarkdownWindowContextReader({ source: () => f.source })
  expect(await reader.read(f.window(4, 4), { maxScanLines: 1 })).toMatchObject({
    pending: true,
    scannedThroughLine: 1,
  })
  const count = f.calls.length
  expect(await reader.read(f.window(4, 4), { maxScanChars: 0 })).toMatchObject({
    pending: true,
    scannedChars: 0,
  })
  expect(f.calls).toHaveLength(count)
  const next = await reader.read(f.window(4, 4), { maxScanChars: 4 })
  expect(next).toMatchObject({ pending: true, scannedThroughLine: 2 })
  expect(next.scannedChars).toBeLessThanOrEqual(4)
  expect(await reader.read(f.window(4, 4))).toMatchObject({ contextKnown: true })

  const g = setup('a\nb\nc\nvisible')
  const limited = createMarkdownWindowContextReader({ source: () => g.source, maxScanLines: 1 })
  expect(await limited.read(g.window(4, 4), { maxScanLines: 100 })).toMatchObject({
    pending: true,
    scannedThroughLine: 1,
  })
})

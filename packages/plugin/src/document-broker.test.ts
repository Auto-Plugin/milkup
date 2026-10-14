import { MemoryDocumentSource } from '@milkup/core'
import { describe, expect, it, vi } from 'vitest'

import {
  createPluginDocumentBroker,
  createPluginDocumentHostCapabilities,
  type PluginDocumentScanEvent,
  type PluginDocumentScanSource,
} from './document-broker'

describe('plugin document broker', () => {
  it('streams Markdown headings across line windows and ignores fenced code', async () => {
    const source = new MemoryDocumentSource({
      documentId: 'outline-doc',
      text: ['# One', '```md', '# ignored', '```', '## Two ##', 'tail'].join('\n'),
      version: 4,
    })
    const broker = createPluginDocumentBroker({ pluginId: 'outline', source: () => source })
    const events = await collectEvents(
      createPluginDocumentHostCapabilities(broker).scan({
        query: { kind: 'markdownHeadings' },
        windowSizeLines: 1,
        batchSize: 1,
      }),
    )
    const headings = events
      .filter((event) => event.type === 'batch')
      .flatMap((event) => event.items)

    expect(headings).toMatchObject([
      { kind: 'heading', level: 1, label: 'One', line: 1, lineOffset: 0 },
      { kind: 'heading', level: 2, label: 'Two', line: 5, lineOffset: 0 },
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      complete: true,
      reason: 'complete',
      scannedLineCount: 6,
      totalLineCount: 6,
      resultCount: 2,
      version: 4,
    })
  })

  // CommonMark 0.31.2 section 4.3, top-level heading context.
  it.each([
    {
      name: 'single equal underline',
      text: 'Alpha\n=\n',
      expected: [
        {
          level: 1,
          label: 'Alpha',
          line: 1,
        },
      ],
    },
    {
      name: 'single dash underline',
      text: 'Alpha\n-\n',
      expected: [
        {
          level: 2,
          label: 'Alpha',
          line: 1,
        },
      ],
    },
    {
      name: 'multiline paragraph',
      text: 'Alpha\nbeta\n---\n',
      expected: [
        {
          level: 2,
          label: 'Alpha\nbeta',
          line: 1,
        },
      ],
    },
    {
      name: 'adjacent headings and thematic break',
      text: '---\nAlpha\n---\nBeta\n---\n',
      expected: [
        {
          level: 2,
          label: 'Alpha',
          line: 2,
        },
        {
          level: 2,
          label: 'Beta',
          line: 4,
        },
      ],
    },
    {
      name: 'no empty heading',
      text: '===\n',
      expected: [],
    },
    {
      name: 'blank paragraph boundary',
      text: 'Alpha\n\n---\n',
      expected: [],
    },
    {
      name: 'indented code',
      text: '    Alpha\n---\n',
      expected: [],
    },
    {
      name: 'tab indented code',
      text: '\tAlpha\n---\n',
      expected: [],
    },
    {
      name: 'indented underline',
      text: 'Alpha\n    ---\n',
      expected: [],
    },
    {
      name: 'indented paragraph continuation',
      text: 'Alpha\n    beta\n---\n',
      expected: [
        {
          level: 2,
          label: 'Alpha\nbeta',
          line: 1,
        },
      ],
    },
    {
      name: 'list boundary',
      text: '- Alpha\n---\n',
      expected: [],
    },
    {
      name: 'lazy list continuation',
      text: '- Alpha\nbeta\n===\n',
      expected: [],
    },
    {
      name: 'ordered marker cannot interrupt paragraph',
      text: 'Alpha\n2. beta\n---\n',
      expected: [
        {
          level: 2,
          label: 'Alpha\n2. beta',
          line: 1,
        },
      ],
    },
    {
      name: 'empty bullet cannot interrupt paragraph',
      text: 'Alpha\n+\n---\n',
      expected: [
        {
          level: 2,
          label: 'Alpha\n+',
          line: 1,
        },
      ],
    },
    {
      name: 'blockquote boundary',
      text: '> Alpha\n---\n',
      expected: [],
    },
    {
      name: 'lazy blockquote continuation',
      text: '> Alpha\nbeta\n===\n',
      expected: [],
    },
    {
      name: 'thematic break interrupts paragraph',
      text: 'Alpha\n***\nBeta\n---\n',
      expected: [
        {
          level: 2,
          label: 'Beta',
          line: 3,
        },
      ],
    },
    {
      name: 'internally spaced underlines',
      text: 'Alpha\n= =\n\nBeta\n--- -\n',
      expected: [],
    },
    {
      name: 'unfinished inline code',
      text: '`Alpha\n---\n',
      expected: [
        {
          level: 2,
          label: '`Alpha',
          line: 1,
        },
      ],
    },
    {
      name: 'escaped block marker',
      text: '\\> Alpha\n---\n',
      expected: [
        {
          level: 2,
          label: '\\> Alpha',
          line: 1,
        },
      ],
    },
    {
      name: 'escaped underline',
      text: 'Alpha\n\\---\n',
      expected: [],
    },
    {
      name: 'fenced pseudo headings',
      text: '```\nAlpha\n---\n# Pseudo\n```\nReal\n===\n',
      expected: [
        {
          level: 1,
          label: 'Real',
          line: 6,
        },
      ],
    },
    {
      name: 'backtick in fence info',
      text: '```info`literal\n---\n',
      expected: [
        {
          level: 2,
          label: '```info`literal',
          line: 1,
        },
      ],
    },
    {
      name: 'ATX closing markers',
      text: '## ATX ##\n---\n# ###\n### escaped \\###\n',
      expected: [
        {
          level: 2,
          label: 'ATX',
          line: 1,
        },
        {
          level: 1,
          label: '',
          line: 3,
        },
        {
          level: 3,
          label: 'escaped \\###',
          line: 4,
        },
      ],
    },
    {
      name: 'ATX paragraph boundary',
      text: 'before\n# Root\nAfter\n---\n',
      expected: [
        {
          level: 1,
          label: 'Root',
          line: 2,
        },
        {
          level: 2,
          label: 'After',
          line: 3,
        },
      ],
    },
    {
      name: 'pipe table boundary',
      text: '| A | B |\n| --- | --- |\n| X | Y |\n---\n# Root\n',
      expected: [
        {
          level: 1,
          label: 'Root',
          line: 5,
        },
      ],
    },
    {
      name: 'HTML comment boundary',
      text: '<!--\n# Pseudo\nTitle\n---\n-->\n# Real\n',
      expected: [
        {
          level: 1,
          label: 'Real',
          line: 6,
        },
      ],
    },
    {
      name: 'HTML block boundary',
      text: '<div>\nTitle\n---\n</div>\n\nReal\n---\n',
      expected: [
        {
          level: 2,
          label: 'Real',
          line: 6,
        },
      ],
    },
    {
      name: 'incomplete inline HTML',
      text: '<a title="long\n---\n',
      expected: [
        {
          level: 2,
          label: '<a title="long',
          line: 1,
        },
      ],
    },
    {
      name: 'inline HTML cannot interrupt paragraph',
      text: 'Alpha\n<span>\n---\n',
      expected: [
        {
          level: 2,
          label: 'Alpha\n<span>',
          line: 1,
        },
      ],
    },
    {
      name: 'standalone HTML tag block',
      text: '<span>\nTitle\n---\n\n# Real\n',
      expected: [
        {
          level: 1,
          label: 'Real',
          line: 5,
        },
      ],
    },
    {
      name: 'ATX interrupts quote continuation',
      text: '> paragraph\n## Root\n',
      expected: [
        {
          level: 2,
          label: 'Root',
          line: 2,
        },
      ],
    },
  ])('recognizes Setext/ATX context: $name', async ({ text, expected }) => {
    const source = new MemoryDocumentSource({ documentId: 'headings', text })
    const events = await collectEvents(
      createPluginDocumentHostCapabilities(
        createPluginDocumentBroker({
          pluginId: 'headings',
          source: () => source,
          yieldToMainThread: async () => {},
        }),
      ).scan({ query: { kind: 'markdownHeadings' }, windowSizeLines: 1, batchSize: 1 }),
    )
    expect(
      batchItems(events).map((item) =>
        item.kind === 'heading' ? { level: item.level, label: item.label, line: item.line } : item,
      ),
    ).toEqual(expected)
  })

  it('emits a cross-range Setext heading once in the underline range with bounded paragraph context', async () => {
    const source = new MemoryDocumentSource({
      documentId: 'long-paragraph',
      text: [...Array.from({ length: 8192 }, () => 'paragraph'), '---', '# Following'].join('\n'),
    })
    const reads: number[] = []
    const broker = createPluginDocumentBroker({
      pluginId: 'headings',
      yieldToMainThread: async () => {},
      source: () => ({
        documentId: source.documentId,
        version: source.version,
        lineCount: source.lineCount,
        readLineWindow: (from, to, budget) => {
          reads.push(from)
          return source.readLineWindow(from, to, budget)
        },
      }),
    })
    const host = createPluginDocumentHostCapabilities(broker)
    for (const fromLine of [1, 4097]) {
      const events = await collectEvents(
        host.scan({ query: { kind: 'markdownHeadings' }, fromLine, toLine: fromLine + 4095 }),
      )
      expect(batchItems(events)).toEqual([])
      expect(events.at(-1)).toMatchObject({ complete: true, scannedLineCount: 4096 })
    }
    reads.length = 0
    const tail = await collectEvents(
      host.scan({ query: { kind: 'markdownHeadings' }, fromLine: 8193 }),
    )
    expect(reads[0]).toBe(8193)
    const headings = batchItems(tail)
    expect(headings).toHaveLength(2)
    expect(headings[0]).toMatchObject({
      kind: 'heading',
      line: 1,
      from: 0,
      level: 2,
      labelTruncated: true,
      labelTo: source.length - '\n---\n# Following'.length,
    })
    if (headings[0]?.kind === 'heading') expect(headings[0].label).toHaveLength(4096)
    expect(headings[1]).toMatchObject({ kind: 'heading', line: 8194, label: 'Following' })
    expect(tail.at(-1)).toMatchObject({ scannedLineCount: 2, complete: true })
  })

  it('uses a cold prefix and clears excluded heading context before a ranged Setext result', async () => {
    const source = new MemoryDocumentSource({
      documentId: 'cold',
      text: ['ATX body', '# Excluded', 'Title', 'continuation', '===', 'Second', '-'].join('\n'),
    })
    const events = await collectEvents(
      createPluginDocumentHostCapabilities(
        createPluginDocumentBroker({ pluginId: 'reader', source: () => source }),
      ).scan({
        query: { kind: 'markdownHeadings', levels: [2] },
        fromLine: 5,
        toLine: 7,
        windowSizeLines: 1,
      }),
    )
    expect(batchItems(events)).toMatchObject([{ level: 2, label: 'Second', line: 6 }])
    expect(batchItems(events)).toHaveLength(1)
  })

  it('bounds each next call and keeps diagnostic counters off protocol events', async () => {
    const source = new MemoryDocumentSource({ documentId: 'metrics', text: 'body\n'.repeat(10000) })
    const reports: unknown[] = []
    let reads = 0
    const broker = createPluginDocumentBroker({
      pluginId: 'metrics',
      yieldToMainThread: async () => {},
      onDiagnostics: (report) => {
        reports.push(report)
        throw new Error('observer failure')
      },
      source: () => ({
        documentId: source.documentId,
        version: source.version,
        lineCount: source.lineCount,
        readLineWindow: (from, to, budget) => {
          reads++
          return source.readLineWindow(from, to, budget)
        },
      }),
    })
    const start = await broker.start({ query: { kind: 'markdownHeadings' }, windowSizeLines: 4096 })
    const event = await broker.next(start.scanId)
    expect(reads).toBeGreaterThan(0)
    expect(reads).toBeLessThanOrEqual(4)
    expect(event).toMatchObject({ type: 'progress' })
    expect(event).not.toHaveProperty('metrics')
    await broker.cancel(start.scanId)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      reason: 'cancelled',
      nextCount: 1,
      progressCount: 1,
      readCount: reads,
      yieldCount: reads,
    })
    expect(reports[0]).toHaveProperty('maxScanCpuMs')
  })

  it('supports text and restricted regular expression scans with captures', async () => {
    const source = new MemoryDocumentSource({
      documentId: 'find-doc',
      text: ['TODO first', 'skip', 'TODO second'].join('\n'),
    })
    const broker = createPluginDocumentBroker({ pluginId: 'finder', source: () => source })
    const host = createPluginDocumentHostCapabilities(broker)
    const textEvents = await collectEvents(
      host.scan({ query: { kind: 'text', text: 'todo' }, windowSizeLines: 2 }),
    )
    const regexpEvents = await collectEvents(
      host.scan({
        query: { kind: 'regexp', pattern: 'TODO\\s+(\\w+)' },
        windowSizeLines: 3,
      }),
    )

    expect(batchItems(textEvents)).toMatchObject([
      { kind: 'match', line: 1, lineOffset: 0, text: 'TODO' },
      { kind: 'match', line: 3, lineOffset: 0, text: 'TODO' },
    ])
    expect(batchItems(regexpEvents)).toMatchObject([
      { kind: 'match', text: 'TODO first', captures: ['first'] },
      { kind: 'match', text: 'TODO second', captures: ['second'] },
    ])
    await expect(
      collectEvents(host.scan({ query: { kind: 'regexp', pattern: '(a+)+$' } })),
    ).rejects.toThrow('unsafe nested quantifier')
  })

  it('limits scanning to an explicit line range', async () => {
    const source = new MemoryDocumentSource({
      documentId: 'range-doc',
      text: ['# One', 'text', '## Two', 'text', '### Three'].join('\n'),
    })
    const broker = createPluginDocumentBroker({ pluginId: 'outline', source: () => source })
    const events = await collectEvents(
      createPluginDocumentHostCapabilities(broker).scan({
        query: { kind: 'markdownHeadings' },
        fromLine: 2,
        toLine: 4,
        windowSizeLines: 2,
      }),
    )

    expect(batchItems(events)).toMatchObject([{ kind: 'heading', label: 'Two', line: 3 }])
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      complete: true,
      scannedLineCount: 3,
      totalLineCount: 5,
      resultCount: 1,
    })
  })

  it('inherits fenced-code context before a requested range and only counts requested lines', async () => {
    const source = new MemoryDocumentSource({
      documentId: 'range-fence',
      text: ['# Earlier', '```md', '# Not a heading', '```', '## Real', 'tail'].join('\n'),
    })
    const events = await collectEvents(
      createPluginDocumentHostCapabilities(
        createPluginDocumentBroker({ pluginId: 'reader', source: () => source }),
      ).scan({
        query: { kind: 'markdownHeadings' },
        fromLine: 3,
        toLine: 5,
        windowSizeLines: 1,
      }),
    )
    expect(batchItems(events)).toMatchObject([{ label: 'Real', line: 5 }])
    expect(events.at(-1)).toMatchObject({ scannedLineCount: 3, resultCount: 1, complete: true })
  })

  it('reuses bounded fence checkpoints only for the same document version', async () => {
    let source = new MemoryDocumentSource({
      documentId: 'cached',
      version: 1,
      text: ['```', ...Array.from({ length: 300 }, () => '# code'), '```', '# Real'].join('\n'),
    })
    const reads: number[] = []
    const broker = createPluginDocumentBroker({
      pluginId: 'reader',
      yieldToMainThread: async () => {},
      source: () => ({
        documentId: source.documentId,
        version: source.version,
        lineCount: source.lineCount,
        readLineWindow: (from, to, budget) => {
          reads.push(from)
          return source.readLineWindow(from, to, budget)
        },
      }),
    })
    const host = createPluginDocumentHostCapabilities(broker)
    await collectEvents(
      host.scan({ query: { kind: 'markdownHeadings' }, fromLine: 200, toLine: 250 }),
    )
    reads.length = 0
    const next = await collectEvents(
      host.scan({ query: { kind: 'markdownHeadings' }, fromLine: 251, toLine: 303 }),
    )
    expect(reads[0]).toBe(251)
    expect(batchItems(next)).toMatchObject([{ label: 'Real', line: 303 }])
    source = new MemoryDocumentSource({
      documentId: 'cached',
      version: 2,
      text: Array.from({ length: 303 }, () => '# New').join('\n'),
    })
    reads.length = 0
    await collectEvents(
      host.scan({ query: { kind: 'markdownHeadings' }, fromLine: 251, toLine: 303 }),
    )
    expect(reads[0]).toBe(1)
  })

  it('splits scan windows before native text materialization and rejects an oversized single line', async () => {
    let source = new MemoryDocumentSource({
      documentId: 'budget',
      text: Array.from({ length: 128 }, () => 'x'.repeat(4096)).join('\n'),
    })
    const successfulSizes: number[] = []
    const broker = createPluginDocumentBroker({
      pluginId: 'reader',
      yieldToMainThread: async () => {},
      source: () => ({
        documentId: source.documentId,
        version: source.version,
        lineCount: source.lineCount,
        readLineWindow: async (from, to, budget) => {
          expect(budget).toBe(262_144)
          const window = await source.readLineWindow(from, to, budget)
          successfulSizes.push(window.text.length)
          return window
        },
      }),
    })
    const host = createPluginDocumentHostCapabilities(broker)
    const events = await collectEvents(host.scan({ query: { kind: 'markdownHeadings' } }))
    expect(events.at(-1)).toMatchObject({ scannedLineCount: 128, complete: true })
    expect(successfulSizes.length).toBeGreaterThan(1)
    expect(Math.max(...successfulSizes)).toBeLessThanOrEqual(262_144)
    source = new MemoryDocumentSource({ documentId: 'oversized', text: '# ' + 'x'.repeat(262_144) })
    await expect(collectEvents(host.scan({ query: { kind: 'markdownHeadings' } }))).rejects.toThrow(
      'text budget',
    )
    await expect(broker.start({ query: { kind: 'markdownHeadings' } })).resolves.toBeDefined()
  })

  it('pins mutable native source versions and suppresses in-flight reads after cancellation', async () => {
    const source = new MemoryDocumentSource({ documentId: 'mutable', text: '# Old' })
    let version = 1
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const read = vi.fn(async () => {
      await waiting
      return source.readLineWindow(1, 1)
    })
    const mutable = {
      documentId: 'mutable',
      get version() {
        return version
      },
      lineCount: 1,
      readLineWindow: read,
    }
    const broker = createPluginDocumentBroker({
      pluginId: 'reader',
      source: () => mutable,
      yieldToMainThread: async () => {},
    })
    const started = await broker.start({ query: { kind: 'markdownHeadings' } })
    const next = broker.next(started.scanId)
    await vi.waitFor(() => expect(read).toHaveBeenCalled())
    version = 2
    release()
    await expect(next).resolves.toMatchObject({
      type: 'done',
      reason: 'invalidated',
      version: 1,
      currentVersion: 2,
    })
    const cancelled = await broker.start({ query: { kind: 'markdownHeadings' } })
    const pending = broker.next(cancelled.scanId)
    await broker.cancelAll()
    await expect(pending).resolves.toMatchObject({
      type: 'done',
      reason: 'cancelled',
      resultCount: 0,
    })
  })

  it.each(['version', 'document', 'closed', 'cancelled', 'unchanged'] as const)(
    'classifies a rejected in-flight read after the source is %s',
    async (change) => {
      let version = 1
      let rejectRead!: (error: Error) => void
      const read = vi.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectRead = reject
          }),
      )
      const source = {
        documentId: 'original',
        get version() {
          return version
        },
        lineCount: 128,
        readLineWindow: read,
      }
      let current: PluginDocumentScanSource | undefined = source
      const broker = createPluginDocumentBroker({
        pluginId: 'reader',
        source: () => current,
        maxConcurrentScans: 1,
        yieldToMainThread: async () => {},
      })
      const started = await broker.start({ query: { kind: 'markdownHeadings' } })
      const pending = broker.next(started.scanId)
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
      if (change === 'version' || change === 'cancelled') version = 2
      if (change === 'document') current = { ...source, documentId: 'replacement' }
      if (change === 'closed') current = undefined
      if (change === 'cancelled') await broker.cancel(started.scanId)
      const failure = new Error('Invalid line window')
      rejectRead(failure)
      if (change === 'unchanged') await expect(pending).rejects.toBe(failure)
      else {
        await expect(pending).resolves.toMatchObject({
          type: 'done',
          reason: change === 'cancelled' ? 'cancelled' : 'invalidated',
          complete: false,
          version: 1,
          resultCount: 0,
        })
      }
      // Terminal failures must release the single available scan slot.
      current = source
      await expect(broker.start({ query: { kind: 'markdownHeadings' } })).resolves.toBeDefined()
    },
  )

  it.each([false, true])(
    'suppresses a late batch when cancellation is confirmed=%s',
    async (confirmed) => {
      let releaseNext!: (event: PluginDocumentScanEvent) => void
      let confirmCancellation!: () => void
      const next = vi.fn(
        () =>
          new Promise<PluginDocumentScanEvent>((resolve) => {
            releaseNext = resolve
          }),
      )
      const cancel = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            confirmCancellation = resolve
          }),
      )
      const scanner = createPluginDocumentHostCapabilities({
        start: async () => ({ scanId: 'late-batch', documentId: 'd', version: 1, lineCount: 1 }),
        next,
        cancel,
      }).scan({ query: { kind: 'markdownHeadings' } })
      const iterator = scanner[Symbol.asyncIterator]()
      const pending = iterator.next()
      await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1))
      const cancelling = scanner.cancel()
      if (confirmed) {
        confirmCancellation()
        await cancelling
      }
      releaseNext({
        type: 'batch',
        scanId: 'late-batch',
        documentId: 'd',
        version: 1,
        scannedLineCount: 1,
        totalLineCount: 1,
        resultCount: 1,
        items: [
          {
            id: 'heading',
            kind: 'heading',
            from: 0,
            to: 7,
            line: 1,
            lineOffset: 0,
            level: 1,
            label: 'stale',
            labelFrom: 2,
            labelTo: 7,
          },
        ],
      })
      await expect(pending).resolves.toEqual({ value: undefined, done: true })
      confirmCancellation()
      await cancelling
      await expect(iterator.next()).resolves.toMatchObject({ done: true })
      expect(next).toHaveBeenCalledTimes(1)
      expect(cancel).toHaveBeenCalledTimes(1)
    },
  )

  it('cancels a scanner whose asynchronous start resolves after disposal', async () => {
    let release!: (value: {
      scanId: string
      documentId: string
      version: number
      lineCount: number
    }) => void
    const start = vi.fn(
      () =>
        new Promise<{ scanId: string; documentId: string; version: number; lineCount: number }>(
          (resolve) => {
            release = resolve
          },
        ),
    )
    const next = vi.fn()
    const cancel = vi.fn(async () => {})
    const scanner = createPluginDocumentHostCapabilities({ start, next, cancel }).scan({
      query: { kind: 'markdownHeadings' },
    })
    const pending = scanner[Symbol.asyncIterator]().next()
    await scanner.cancel()
    release({ scanId: 'late', documentId: 'd', version: 0, lineCount: 1 })
    await expect(pending).resolves.toMatchObject({ done: true })
    expect(cancel).toHaveBeenCalledWith('late')
    expect(next).not.toHaveBeenCalled()
  })

  it('yields before bounded scan slices so large windows remain cooperative', async () => {
    const source = new MemoryDocumentSource({
      documentId: 'cooperative-doc',
      text: Array.from({ length: 1200 }, (_, index) => `line ${index + 1}`).join('\n'),
    })
    const windows: Array<{ fromLine: number; toLine: number }> = []
    let yieldCount = 0
    const broker = createPluginDocumentBroker({
      pluginId: 'scanner',
      source: () => ({
        documentId: source.documentId,
        version: source.version,
        lineCount: source.lineCount,
        readLineWindow: async (fromLine, toLine) => {
          windows.push({ fromLine, toLine })
          return source.readLineWindow(fromLine, toLine)
        },
      }),
      yieldToMainThread: async () => {
        yieldCount += 1
      },
    })

    const events = await collectEvents(
      createPluginDocumentHostCapabilities(broker).scan({
        query: { kind: 'text', text: 'missing' },
        windowSizeLines: 4_096,
      }),
    )

    expect(events.at(-1)).toMatchObject({ type: 'done', scannedLineCount: 1200 })
    expect(windows).toHaveLength(3)
    expect(windows.every(({ fromLine, toLine }) => toLine - fromLine + 1 <= 512)).toBe(true)
    expect(yieldCount).toBe(windows.length)
  })

  it('invalidates an active scan when the document version changes', async () => {
    let source: PluginDocumentScanSource = new MemoryDocumentSource({
      documentId: 'changing-doc',
      text: ['# One', 'tail'].join('\n'),
      version: 1,
    })
    const broker = createPluginDocumentBroker({ pluginId: 'outline', source: () => source })
    const started = await broker.start({
      query: { kind: 'markdownHeadings' },
      windowSizeLines: 1,
    })

    await expect(broker.next(started.scanId)).resolves.toMatchObject({ type: 'batch' })
    source = new MemoryDocumentSource({
      documentId: 'changing-doc',
      text: '# Changed',
      version: 2,
    })

    await expect(broker.next(started.scanId)).resolves.toMatchObject({
      type: 'done',
      complete: false,
      reason: 'invalidated',
      version: 1,
      currentVersion: 2,
    })
  })

  it('cancels scans when an async iteration stops early', async () => {
    const source = new MemoryDocumentSource({ documentId: 'doc', text: '# One' })
    const broker = createPluginDocumentBroker({ pluginId: 'outline', source: () => source })
    const scanner = createPluginDocumentHostCapabilities(broker).scan({
      query: { kind: 'markdownHeadings' },
    })
    let scanId = ''

    for await (const event of scanner) {
      scanId = event.scanId
      break
    }

    await expect(broker.next(scanId)).rejects.toThrow(`Unknown document scan: ${scanId}`)
  })

  it('releases a failed scan so it no longer consumes the concurrency limit', async () => {
    const failingSource: PluginDocumentScanSource = {
      documentId: 'broken-doc',
      version: 0,
      lineCount: 1,
      readLineWindow: async () => {
        throw new Error('read failed')
      },
    }
    const broker = createPluginDocumentBroker({
      pluginId: 'outline',
      source: () => failingSource,
      maxConcurrentScans: 1,
    })
    const first = await broker.start({ query: { kind: 'markdownHeadings' } })

    await expect(broker.next(first.scanId)).rejects.toThrow('read failed')
    await expect(broker.start({ query: { kind: 'markdownHeadings' } })).resolves.toMatchObject({
      documentId: 'broken-doc',
    })
  })
})

async function collectEvents(
  scanner: AsyncIterable<PluginDocumentScanEvent>,
): Promise<readonly PluginDocumentScanEvent[]> {
  const events: PluginDocumentScanEvent[] = []
  for await (const event of scanner) events.push(event)
  return events
}

function batchItems(events: readonly PluginDocumentScanEvent[]) {
  return events.filter((event) => event.type === 'batch').flatMap((event) => event.items)
}

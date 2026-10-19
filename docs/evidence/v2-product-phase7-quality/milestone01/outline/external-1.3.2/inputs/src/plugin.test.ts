import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  SdkDocumentScanEvent,
  SdkDocumentScanHeading,
  SdkDocumentScanner,
  SdkDocumentScanRequest,
  SdkTemporaryStore,
} from '@milkup/plugin-sdk'
import plugin from './plugin'

afterEach(async () => {
  await plugin.deactivate()
})

function heading(
  title: string,
  line: number,
  level = 1,
  from = line * 100,
): SdkDocumentScanHeading {
  return {
    id: `${from}`,
    kind: 'heading',
    from,
    to: from + title.length,
    line,
    lineOffset: 0,
    level,
    label: title,
    labelFrom: from,
    labelTo: from + title.length,
  }
}
function storage() {
  const pages = new Map<string, string>()
  let maximumValueBytes = 0
  const get = vi.fn(async (key: string) => pages.get(key) ?? null)
  const set = vi.fn(async (key: string, value: string) => {
    maximumValueBytes = Math.max(maximumValueBytes, new TextEncoder().encode(value).length)
    expect(maximumValueBytes).toBeLessThanOrEqual(256 * 1024)
    pages.set(key, value)
  })
  const dispose = vi.fn(async () => {
    pages.clear()
  })
  const store: SdkTemporaryStore = {
    get,
    set,
    getMany: async (keys) => {
      const values = await Promise.all(keys.map(get))
      if (
        values.reduce((total, value) => total + new TextEncoder().encode(value ?? '').length, 0) >
        256 * 1024
      )
        throw new Error('batch budget exceeded')
      return values
    },
    setMany: async (entries) => {
      expect(
        entries.reduce((total, entry) => total + new TextEncoder().encode(entry.value).length, 0),
      ).toBeLessThanOrEqual(256 * 1024)
      for (const { key, value } of entries) await set(key, value)
    },
    dispose,
  }
  return { store, pages, get, set, dispose, maximumValueBytes: () => maximumValueBytes }
}
function scanResult(
  items: readonly SdkDocumentScanHeading[],
  totalLines: number,
  request: SdkDocumentScanRequest,
  reason = 'complete' as 'complete' | 'cancelled' | 'invalidated' | 'truncated',
): SdkDocumentScanner {
  const fromLine = request.fromLine ?? 1
  const toLine = Math.min(totalLines, request.toLine ?? totalLines)
  const selected = items.filter((item) => item.line >= fromLine && item.line <= toLine)
  const scannedLineCount = Math.max(0, toLine - fromLine + 1)
  const common = {
    scanId: 'test',
    documentId: 'doc',
    version: 1,
    scannedLineCount,
    totalLineCount: totalLines,
    resultCount: selected.length,
  }
  return {
    cancel: vi.fn(async () => {}),
    async *[Symbol.asyncIterator]() {
      for (let start = 0; start < selected.length; start += 128)
        yield { ...common, type: 'batch', items: selected.slice(start, start + 128) }
      yield { ...common, type: 'done', reason, complete: reason === 'complete' }
    },
  }
}
function setup(
  items: readonly SdkDocumentScanHeading[],
  lines: number,
  customScan?: (request: SdkDocumentScanRequest) => SdkDocumentScanner,
) {
  const stores: ReturnType<typeof storage>[] = []
  const scan = vi.fn(customScan ?? ((request) => scanResult(items, lines, request)))
  const revealLine = vi.fn(async (_line: number) => {})
  const requestUpdate = vi.fn(async () => {})
  const createTemporaryStore = vi.fn(async () => {
    const value = storage()
    stores.push(value)
    return value.store
  })
  const lifecycle = plugin.activate({
    pluginId: 'outline',
    permissions: ['document:read'],
    host: {
      document: { scan },
      storage: {
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
        createTemporaryStore,
      },
      ui: { revealLine, requestUpdate },
    },
  })
  return { scan, revealLine, stores, requestUpdate, createTemporaryStore, lifecycle }
}
function render(
  documentId = 'doc',
  version = 1,
  activeLine?: number,
  virtual?: { from: number; to: number },
  mode: 'source' | 'live' = 'live',
): unknown {
  return plugin.renderers['outline-panel']({
    node: {
      phase: 'update',
      documentId,
      documentVersion: version,
      viewMode: mode,
      ...(activeLine === undefined ? {} : { viewport: { activeLine } }),
      ...(virtual
        ? {
            virtualViewport: {
              id: 'outline',
              fromIndex: virtual.from,
              toIndex: virtual.to,
              userInitiated: true,
            },
          }
        : {}),
    },
  })
}
function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (!value || typeof value !== 'object') return ''
  const node = value as { text?: string; children?: unknown[] }
  return node.text ?? node.children?.map(text).join('') ?? ''
}
interface Element {
  text?: string
  attributes: Record<string, string>
  action?: { command: string; input?: unknown }
}
function elements(value: unknown, match: (item: Element) => boolean): Element[] {
  if (!value || typeof value !== 'object') return []
  const node = value as Element & { children?: unknown[] }
  const element = { ...node, attributes: node.attributes ?? {} }
  return [
    ...(match(element) ? [element] : []),
    ...(node.children ?? []).flatMap((child) => elements(child, match)),
  ]
}
function action(value: unknown, command: string, title?: string) {
  const result = elements(
    value,
    (element) =>
      element.action?.command === command && (title === undefined || element.text === title),
  )[0]?.action?.input
  expect(result).toBeDefined()
  return result
}
function activeTitle(value: unknown): string | undefined {
  return elements(value, (element) => element.attributes['aria-current'] === 'location')[0]?.text
}
function rows(value: unknown) {
  return elements(value, (element) => element.attributes.role === 'treeitem')
}
async function complete(id = 'doc', version = 1) {
  await vi.waitFor(() => expect(text(render(id, version))).toContain('全文索引完成'), {
    timeout: 10000,
  })
  await vi.waitFor(() => expect(rows(render(id, version)).length).toBeGreaterThan(0), {
    timeout: 10000,
  })
}
function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('complete paged outline index', () => {
  it('ignores delayed echoes of the last returned slice rather than oscillating between old and prepared ranges', async () => {
    const env = setup(
      Array.from({ length: 1000 }, (_, i) => heading(`Title ${i}`, i + 1)),
      1000,
    )
    render()
    await complete()
    render('doc', 1, 1000)
    await vi.waitFor(() => expect(activeTitle(render())).toBe('Title 999'))
    const old = elements(render(), (e) => e.attributes['data-virtual-list'] === 'outline')[0]!
      .attributes
    const oldRange = {
      from: Number(old['data-virtual-start']),
      to: Number(old['data-virtual-end']),
    }
    const before = env.requestUpdate.mock.calls.length
    render('doc', 1, undefined, { from: 300, to: 400 })
    await vi.waitFor(() => expect(env.requestUpdate.mock.calls.length).toBeGreaterThan(before))
    // The host echoes the slice it received synchronously, before async preparation.
    render('doc', 1, undefined, oldRange)
    const after = env.requestUpdate.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(env.requestUpdate.mock.calls.length).toBe(after)
    expect(
      elements(render(), (e) => e.attributes['data-virtual-list'] === 'outline')[0]!.attributes[
        'data-virtual-start'
      ],
    ).toBe('300')
    // A later real scroll back to that old range is still accepted.
    render('doc', 1, undefined, oldRange)
    await vi.waitFor(() =>
      expect(
        elements(render(), (e) => e.attributes['data-virtual-list'] === 'outline')[0]!.attributes[
          'data-virtual-start'
        ],
      ).toBe(String(oldRange.from)),
    )
  })

  it('stops following the old active heading immediately and keeps the newest scroll request during storage reads', async () => {
    const env = setup(
      Array.from({ length: 5000 }, (_, i) => heading(`Title ${i}`, i + 1)),
      5000,
    )
    render()
    await complete()
    render('doc', 1, 5000)
    await vi.waitFor(() => expect(activeTitle(render())).toBe('Title 4999'))
    const pending = gate(),
      started = gate()
    const store = env.stores[0]!
    store.get.mockImplementationOnce(async (key) => {
      started.resolve()
      await pending.promise
      return store.pages.get(key) ?? null
    })
    const immediate = render('doc', 1, undefined, { from: 1500, to: 1600 })
    expect(
      elements(immediate, (e) => e.attributes['data-virtual-list'] === 'outline')[0]!.attributes[
        'data-virtual-follow-active'
      ],
    ).toBe('false')
    await started.promise
    render('doc', 1, undefined, { from: 3500, to: 3600 })
    pending.resolve()
    await vi.waitFor(() => {
      const list = elements(render(), (e) => e.attributes['data-virtual-list'] === 'outline')[0]!
      expect(list.attributes['data-virtual-start']).toBe('3500')
      expect(list.attributes['data-virtual-end']).toBe('3600')
      expect(text(render())).toContain('Title 3500')
    })
    expect(env.scan).toHaveBeenCalledTimes(2)
  })

  it('ignores host slice echoes and settles without a render feedback loop', async () => {
    const env = setup([heading('Root', 1), heading('Child', 2, 2)], 2)
    render()
    await complete()
    await new Promise((resolve) => setTimeout(resolve, 30))
    const count = env.requestUpdate.mock.calls.length
    for (const userInitiated of [false, true]) {
      for (let i = 0; i < 5; i++) {
        plugin.renderers['outline-panel']({
          node: {
            phase: 'update',
            documentId: 'doc',
            documentVersion: 1,
            virtualViewport: { id: 'outline', fromIndex: 0, toIndex: 2, userInitiated },
          },
        })
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }
    expect(env.requestUpdate.mock.calls.length).toBe(count)
    await plugin.commands['outline.collapseAll']()
    await vi.waitFor(() => expect(rows(render()).length).toBe(1))
    expect(env.scan).toHaveBeenCalledTimes(1)
  })
  it('indexes every contiguous range, preserves the full hierarchy and does not rescan when navigating', async () => {
    const fixture = [
      heading('Root', 1),
      ...[2, 3, 4, 5, 6].map((level) => heading(`H${level}`, level * 1800, level)),
      heading('Tail', 17000),
    ]
    const env = setup(fixture, 18000)
    render('doc', 1, 1)
    await complete()
    expect(env.scan.mock.calls.map(([request]) => [request.fromLine, request.toLine])).toEqual([
      [1, 4096],
      [4097, 8192],
      [8193, 12288],
      [12289, 16384],
      [16385, 20480],
    ])
    // Scan completion precedes the asynchronous refresh of the visible slice.
    // An earlier nonempty slice can still be returned while that refresh runs.
    await vi.waitFor(() =>
      expect(rows(render()).map((row) => row.attributes['aria-level'])).toEqual([
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '1',
      ]),
    )
    const tail = action(render(), 'outline.gotoHeading', 'Tail')
    await plugin.commands['outline.gotoHeading']({}, tail)
    expect(env.revealLine).toHaveBeenCalledWith(17000)
    render('doc', 1, 17000)
    await vi.waitFor(() => expect(activeTitle(render())).toBe('Tail'))
    render('doc', 1, 8000, undefined, 'source')
    await vi.waitFor(() => expect(activeTitle(render())).toBe('H4'))
    render('doc', 1, 1, undefined, 'live')
    await vi.waitFor(() => expect(activeTitle(render())).toBe('Root'))
    expect(env.scan).toHaveBeenCalledTimes(5)
  })

  it('folds subtrees across scan boundaries, highlights ancestors and restores a navigated child', async () => {
    setup(
      [
        heading('Root', 1),
        heading('Child', 5000, 2),
        heading('Grandchild', 10000, 6),
        heading('Sibling', 15000),
      ],
      16000,
    )
    render('doc', 1, 10000)
    await complete()
    const childAction = action(render(), 'outline.gotoHeading', 'Grandchild')
    const toggle = elements(
      render(),
      (item) =>
        item.action?.command === 'outline.toggleHeading' &&
        item.attributes['aria-label'] === '折叠 Root',
    )[0]!.action!.input
    await plugin.commands['outline.toggleHeading']({}, toggle)
    await vi.waitFor(() => expect(rows(render())).toHaveLength(2))
    expect(activeTitle(render())).toBe('Root')
    expect(text(render())).not.toContain('Grandchild')
    await plugin.commands['outline.gotoHeading']({}, childAction)
    await vi.waitFor(() => expect(rows(render())).toHaveLength(4))
    expect(activeTitle(render())).toBe('Grandchild')
    await plugin.commands['outline.collapseAll']()
    await vi.waitFor(() => expect(rows(render())).toHaveLength(2))
    await plugin.commands['outline.expandAll']()
    await vi.waitFor(() => expect(rows(render())).toHaveLength(4))
  })

  it('uses source identity for duplicate titles and rejects stale version actions immediately', async () => {
    const env = setup([heading('Duplicate', 1), heading('Duplicate', 3)], 5)
    render()
    await complete()
    const actions = elements(
      render(),
      (item) => item.action?.command === 'outline.gotoHeading',
    ).map((item) => item.action!.input)
    expect((actions[0] as { id: string }).id).not.toBe((actions[1] as { id: string }).id)
    render('doc', 2)
    await expect(plugin.commands['outline.gotoHeading']({}, actions[1])).rejects.toThrow('过期')
    await complete('doc', 2)
    expect(env.createTemporaryStore).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(env.stores[0]!.dispose).toHaveBeenCalledTimes(1))
  })

  it('discards old scans after quick document changes and disposes each temporary index', async () => {
    const pending = gate()
    const old = scanResult([heading('Old', 1)], 10, { fromLine: 1, toLine: 4096 })
    const scan = vi.fn((request: SdkDocumentScanRequest): SdkDocumentScanner =>
      scan.mock.calls.length === 1
        ? {
            cancel: old.cancel,
            async *[Symbol.asyncIterator]() {
              await pending.promise
              yield* old
            },
          }
        : scanResult([heading('New', 1)], 10, request),
    )
    const env = setup([], 10, scan)
    render('old')
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(1))
    render('new')
    await complete('new')
    pending.resolve()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(text(render('new'))).not.toContain('Old')
    expect(text(render('new'))).toContain('New')
    await env.lifecycle.dispose()
    expect(env.stores.every((item) => item.dispose.mock.calls.length === 1)).toBe(true)
  })

  it('invalidates cached visible ancestors when a later range adds their first child', async () => {
    const pending = gate()
    setup([heading('Root', 1), heading('Child', 5000, 2)], 6000, (request) => {
      const result = scanResult([heading('Root', 1), heading('Child', 5000, 2)], 6000, request)
      if (request.fromLine === 1) return result
      return {
        cancel: async () => pending.resolve(),
        async *[Symbol.asyncIterator]() {
          await pending.promise
          yield* result
        },
      }
    })
    render()
    await vi.waitFor(() => expect(rows(render())).toHaveLength(1))
    expect(elements(render(), (x) => x.attributes['aria-label'] === '折叠 Root')).toHaveLength(0)
    pending.resolve()
    await complete()
    await vi.waitFor(() =>
      expect(elements(render(), (x) => x.attributes['aria-label'] === '折叠 Root')).toHaveLength(1),
    )
    await plugin.commands['outline.collapseAll']()
    await vi.waitFor(() => expect(rows(render())).toHaveLength(1))
    await plugin.commands['outline.expandAll']()
    await vi.waitFor(() => expect(rows(render())).toHaveLength(2))
  })
  it('shows a partial index honestly, supports cancellation/retry and does not reuse cancelled identities', async () => {
    const pending = gate()
    let first = true
    const env = setup([heading('First', 1), heading('Last', 9000)], 10000, (request) => {
      if (request.fromLine === 4097 && first) {
        first = false
        return {
          cancel: vi.fn(async () => pending.resolve()),
          async *[Symbol.asyncIterator]() {
            await pending.promise
            // The public scanner can stop iteration silently after explicit cancel.
            return
          },
        }
      }
      return scanResult([heading('First', 1), heading('Last', 9000)], 10000, request)
    })
    render()
    await vi.waitFor(() => expect(rows(render())).toHaveLength(1))
    expect(text(render())).toContain('全文索引尚未完成')
    const stale = action(render(), 'outline.gotoHeading', 'First')
    await plugin.commands['outline.cancel']()
    expect(text(render())).toContain('扫描已取消')
    await plugin.commands['outline.retry']()
    await expect(plugin.commands['outline.gotoHeading']({}, stale)).rejects.toThrow('过期')
    await complete()
    expect(text(render())).toContain('Last')
    expect(env.createTemporaryStore).toHaveBeenCalledTimes(2)
  })

  it('supports empty documents and reports storage capability or quota failures explicitly', async () => {
    const env = setup([], 1)
    render()
    await vi.waitFor(() => expect(text(render())).toContain('文档无标题'))
    expect(text(render())).toContain('全文索引完成 · 0 个标题')
    await env.lifecycle.dispose()
    plugin.activate({
      pluginId: 'outline',
      permissions: [],
      host: { document: { scan: () => scanResult([], 1, {}) } },
    })
    render()
    await vi.waitFor(() => expect(text(render())).toContain('宿主不支持'))
  })

  it('does not silently complete after invalidated, truncated or interrupted scans', async () => {
    for (const reason of ['invalidated', 'truncated', 'interrupted'] as const) {
      setup([], 10, (request) =>
        reason === 'interrupted'
          ? { cancel: async () => {}, async *[Symbol.asyncIterator]() {} }
          : scanResult([heading('Partial', 1)], 10, request, reason),
      )
      render()
      await vi.waitFor(() => expect(text(render())).toMatch(/文档已变化|大纲加载失败/))
      expect(text(render())).not.toContain('全文索引完成')
      if (reason === 'invalidated') {
        await vi.waitFor(() => expect(rows(render())).toHaveLength(1))
        await expect(
          plugin.commands['outline.gotoHeading'](
            {},
            action(render(), 'outline.gotoHeading', 'Partial'),
          ),
        ).rejects.toThrow('过期')
      }
      await plugin.deactivate()
    }
  })

  it('accepts Setext headings starting before the next range and deduplicates overlap by source offset', async () => {
    const env = setup([], 8200, (request) => {
      const base = scanResult([], 8200, request)
      return {
        cancel: base.cancel,
        async *[Symbol.asyncIterator]() {
          const items =
            request.fromLine === 1
              ? [heading('ATX', 1)]
              : request.fromLine === 4097
                ? [heading('ATX', 1), heading('Setext at boundary', 4096, 2)]
                : []
          yield {
            scanId: 's',
            documentId: 'doc',
            version: 1,
            type: 'batch',
            scannedLineCount: Math.min(4096, 8200 - (request.fromLine ?? 1) + 1),
            totalLineCount: 8200,
            resultCount: items.length,
            items,
          } satisfies SdkDocumentScanEvent
          yield* base
        },
      }
    })
    render()
    await complete()
    expect(rows(render())).toHaveLength(2)
    expect(text(render())).toContain('Setext at boundary')
    expect(env.scan).toHaveBeenCalledTimes(3)
  })

  it('keeps every indexed title available beyond 16384 lines while rendering no more than 500 rows', async () => {
    const fixture = Array.from({ length: 18000 }, (_, index) =>
      heading(`Title ${index}`, index + 1),
    )
    const env = setup(fixture, 18000)
    render()
    await complete()
    expect(text(render())).toContain('全文索引完成 · 18000 个标题')
    render('doc', 1, undefined, { from: 17400, to: 18000 })
    await vi.waitFor(
      () =>
        expect(text(render('doc', 1, undefined, { from: 17400, to: 18000 }))).toContain(
          'Title 17400',
        ),
      { timeout: 10000 },
    )
    expect(rows(render())).toHaveLength(500)
    render('doc', 1, 18000)
    await vi.waitFor(() => expect(activeTitle(render())).toBe('Title 17999'), { timeout: 10000 })
    render('doc', 1, 1)
    await vi.waitFor(() => expect(activeTitle(render())).toBe('Title 0'), { timeout: 10000 })
    expect(env.scan).toHaveBeenCalledTimes(5)
    expect(env.stores[0]!.pages.size).toBeGreaterThan(0)
    expect(env.stores[0]!.pages.size).toBeLessThan(1000)
    const readsBefore = env.stores[0]!.get.mock.calls.length
    render('doc', 1, 9000)
    await vi.waitFor(() => expect(activeTitle(render())).toBe('Title 8999'), { timeout: 10000 })
    expect(env.stores[0]!.get.mock.calls.length).toBeGreaterThan(readsBefore)
  }, 20000)

  it('bounds persisted pages for worst-case escaped labels while preserving folds', async () => {
    const long = '\u0001'.repeat(4096)
    const fixture = Array.from({ length: 300 }, (_, index) =>
      heading(index === 0 ? 'Root' : long, index + 1, index === 0 ? 1 : 2),
    )
    const env = setup(fixture, 300)
    render()
    await complete()
    expect(env.stores[0]!.maximumValueBytes()).toBeLessThanOrEqual(64 * 1024)
    await plugin.commands['outline.collapseAll']()
    await vi.waitFor(() => expect(rows(render())).toHaveLength(1))
    await plugin.commands['outline.expandAll']()
    await vi.waitFor(() => expect(rows(render()).length).toBeGreaterThan(1))
    expect(text(render())).toContain('300 个标题')
  }, 15000)

  it('does not accept a delayed old-document navigation as current selection', async () => {
    const env = setup([heading('First', 1), heading('Second', 5)], 10)
    const pending = gate()
    env.revealLine.mockImplementation(async () => pending.promise)
    render()
    await complete()
    const command = plugin.commands['outline.gotoHeading'](
      {},
      action(render(), 'outline.gotoHeading', 'Second'),
    )
    await vi.waitFor(() => expect(env.revealLine).toHaveBeenCalledTimes(1))
    render('new', 1, 1)
    pending.resolve()
    await expect(command).rejects.toThrow('过期')
    await complete('new')
    expect(activeTitle(render('new'))).toBe('First')
  })
})

it('reports a temporary-index quota failure without presenting a complete or silently empty outline', async () => {
  const env = setup([heading('Retained source title', 1)], 10)
  const failing = storage()
  failing.store.setMany = async () => {
    throw new Error('Temporary index quota exceeded')
  }
  env.createTemporaryStore.mockResolvedValueOnce(failing.store)
  render()
  await vi.waitFor(() => expect(text(render())).toContain('Temporary index quota exceeded'))
  expect(text(render())).not.toContain('全文索引完成')
  expect(text(render())).not.toContain('文档无标题')
  await env.lifecycle.dispose()
  expect(failing.dispose).toHaveBeenCalledTimes(1)
})

it('disposes delayed storage creation on disable without scheduling stale updates', async () => {
  const env = setup([heading('Old', 1)], 10)
  const pending = gate()
  const delayed = storage()
  env.createTemporaryStore.mockImplementationOnce(async () => {
    await pending.promise
    return delayed.store
  })
  render()
  await vi.waitFor(() => expect(env.createTemporaryStore).toHaveBeenCalledTimes(1))
  const disposed = plugin.deactivate()
  const calls = env.requestUpdate.mock.calls.length
  pending.resolve()
  await disposed
  await vi.waitFor(() => expect(delayed.dispose).toHaveBeenCalledTimes(1))
  expect(env.requestUpdate).toHaveBeenCalledTimes(calls)
  expect(env.scan).not.toHaveBeenCalled()
})

it('does not highlight a guessed current heading before the active line has been scanned', async () => {
  const pending = gate()
  setup([heading('First', 1), heading('Current', 9000)], 10000, (request) => {
    const scanner = scanResult([heading('First', 1), heading('Current', 9000)], 10000, request)
    return request.fromLine === 4097
      ? {
          cancel: async () => pending.resolve(),
          async *[Symbol.asyncIterator]() {
            await pending.promise
            yield* scanner
          },
        }
      : scanner
  })
  render('doc', 1, 9000)
  await vi.waitFor(() => expect(rows(render())).toHaveLength(1))
  expect(activeTitle(render())).toBeUndefined()
  pending.resolve()
  await complete()
  await vi.waitFor(() => expect(activeTitle(render())).toBe('Current'))
})

it('debounces rapid edits/undo-redo and waits for old temporary-store disposal before indexing the newest version', async () => {
  const env = setup([heading('Latest title', 1)], 10)
  let activeStores = 0
  let maximumStores = 0
  const closeGate = gate()
  const first = storage()
  first.store.dispose = async () => {
    await closeGate.promise
    activeStores -= 1
  }
  env.createTemporaryStore.mockImplementation(async () => {
    activeStores += 1
    maximumStores = Math.max(maximumStores, activeStores)
    if (env.createTemporaryStore.mock.calls.length === 1) return first.store
    const next = storage()
    const dispose = next.store.dispose
    next.store.dispose = async () => {
      await dispose()
      activeStores -= 1
    }
    return next.store
  })
  render('doc', 1)
  await complete()
  const stale = action(render(), 'outline.gotoHeading', 'Latest title')
  for (const version of [2, 3, 4, 3, 4, 5, 6, 7, 8, 9]) render('doc', version)
  await expect(plugin.commands['outline.gotoHeading']({}, stale)).rejects.toThrow('过期')
  // Even after the debounce expires, the newer store cannot overtake old asynchronous cleanup.
  await new Promise((resolve) => setTimeout(resolve, 160))
  expect(env.createTemporaryStore).toHaveBeenCalledTimes(1)
  closeGate.resolve()
  await complete('doc', 9)
  expect(env.createTemporaryStore).toHaveBeenCalledTimes(2)
  expect(maximumStores).toBe(1)
  expect(env.scan).toHaveBeenCalledTimes(2)
  await env.lifecycle.dispose()
  expect(activeStores).toBe(0)
})

it('cancels a debounced startup before allocating a store and can retry normally', async () => {
  const env = setup([heading('Restarted', 1)], 1)
  render()
  await plugin.commands['outline.cancel']()
  await new Promise((resolve) => setTimeout(resolve, 150))
  expect(env.createTemporaryStore).not.toHaveBeenCalled()
  expect(text(render())).toContain('扫描已取消')
  await plugin.commands['outline.retry']()
  await complete()
  expect(env.createTemporaryStore).toHaveBeenCalledTimes(1)
})

it('reports failed sparse fold writes rather than claiming the folded tree is complete', async () => {
  const env = setup([heading('Root', 1), heading('Child', 2, 2)], 3)
  render()
  await complete()
  env.stores[0]!.store.setMany = async () => {
    throw new Error('fold write quota exceeded')
  }
  await expect(
    plugin.commands['outline.toggleHeading']({}, action(render(), 'outline.toggleHeading')),
  ).rejects.toThrow('fold write quota exceeded')
  expect(text(render())).toContain('折叠视图更新失败')
  expect(text(render())).not.toContain('全文索引完成')
})

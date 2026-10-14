import { afterEach, describe, expect, it, vi } from 'vitest'

import plugin from './plugin'

afterEach(() => plugin.deactivate())

describe('outline plugin manual paging', () => {
  it('keeps two adjacent pages and evicts only the opposite page', async () => {
    const requestUpdate = vi.fn(async () => undefined)
    const revealLine = vi.fn(async () => undefined)
    const scanRequests: Array<{ fromLine: number; toLine: number }> = []
    const lifecycle = plugin.activate({
      pluginId: 'outline',
      permissions: ['document:read', 'ui:write'],
      host: {
        document: {
          scan(request: unknown) {
            const { fromLine, toLine } = request as { fromLine: number; toLine: number }
            scanRequests.push({ fromLine, toLine })
            const headings =
              fromLine <= 1
                ? [heading('Block one start', 1), heading('Block one end', 8_000)]
                : fromLine <= 8_193
                  ? [heading('Block two start', 9_000), heading('Block two end', 16_000)]
                  : [heading('Block three start', 17_000), heading('Block three end', 24_000)]
            return scanner(headings, toLine - fromLine + 1)
          },
        },
        ui: { requestUpdate, revealLine },
      },
    })

    plugin.renderers['outline-panel']({
      node: { phase: 'mount', documentId: 'doc-a', viewport: { activeLine: 1 } },
    })
    await vi.waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(1))

    const firstPage = plugin.renderers['outline-panel']({
      node: { phase: 'update', documentId: 'doc-a', viewport: { activeLine: 1 } },
    })
    expect(outputText(firstPage)).toContain('Block one start')
    expect(outputText(firstPage)).not.toContain('Block two start')

    const loadingAfter = plugin.renderers['outline-panel']({
      node: {
        phase: 'update',
        documentId: 'doc-a',
        virtualViewport: {
          id: 'outline',
          fromIndex: 0,
          toIndex: 2,
          userInitiated: true,
          edge: 'after',
          requestId: 1,
        },
      },
    })
    expect(
      hasElement(loadingAfter, (attributes) => attributes['data-host-icon'] === 'loader-circle'),
    ).toBe(true)
    await vi.waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(2))

    const secondPage = plugin.renderers['outline-panel']({
      node: { phase: 'update', documentId: 'doc-a' },
    })
    expect(outputText(secondPage)).toContain('Block one start')
    expect(outputText(secondPage)).toContain('Block two start')
    expect(outputText(secondPage)).not.toContain('Block three start')

    const loadingThird = plugin.renderers['outline-panel']({
      node: {
        phase: 'update',
        documentId: 'doc-a',
        virtualViewport: {
          id: 'outline',
          fromIndex: 0,
          toIndex: 4,
          userInitiated: true,
          edge: 'after',
          requestId: 2,
        },
      },
    })
    expect(
      hasElement(loadingThird, (attributes) => attributes['data-host-icon'] === 'loader-circle'),
    ).toBe(true)
    await vi.waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(3))

    const thirdPage = plugin.renderers['outline-panel']({
      node: { phase: 'update', documentId: 'doc-a' },
    })
    expect(outputText(thirdPage)).not.toContain('Block one start')
    expect(outputText(thirdPage)).toContain('Block two start')
    expect(outputText(thirdPage)).toContain('Block three start')

    const loadingBefore = plugin.renderers['outline-panel']({
      node: {
        phase: 'update',
        documentId: 'doc-a',
        virtualViewport: {
          id: 'outline',
          fromIndex: 0,
          toIndex: 1,
          userInitiated: true,
          edge: 'before',
          requestId: 3,
        },
      },
    })
    expect(
      hasElement(loadingBefore, (attributes) => attributes['data-host-icon'] === 'loader-circle'),
    ).toBe(true)
    await vi.waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(4))

    const previousPage = plugin.renderers['outline-panel']({
      node: { phase: 'update', documentId: 'doc-a' },
    })
    expect(outputText(previousPage)).toContain('Block one start')
    expect(outputText(previousPage)).toContain('Block two start')
    expect(outputText(previousPage)).not.toContain('Block three start')

    await plugin.commands['outline.gotoHeading']({}, { line: 16_000 })
    const selected = plugin.renderers['outline-panel']({
      node: { phase: 'update', documentId: 'doc-a', viewport: { activeLine: 15_000 } },
    })
    expect(revealLine).toHaveBeenCalledWith(16_000)
    expect(
      hasElement(
        selected,
        (attributes) => attributes.class?.split(' ').includes('is-active') === true,
      ),
    ).toBe(true)

    expect(scanRequests).toEqual([
      { fromLine: 1, toLine: 8_192 },
      { fromLine: 8_193, toLine: 16_384 },
      { fromLine: 16_385, toLine: 24_576 },
      { fromLine: 1, toLine: 8_192 },
    ])
    await lifecycle.dispose()
  })
})

function heading(label: string, line: number) {
  return {
    id: String(line),
    kind: 'heading' as const,
    from: line,
    to: line + label.length,
    line,
    lineOffset: 0,
    level: 1,
    label,
    labelFrom: line,
    labelTo: line + label.length,
  }
}

function scanner(
  items: readonly ReturnType<typeof heading>[],
  scannedLineCount: number,
  totalLineCount = 40_000,
) {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        scanId: 'test',
        documentId: 'doc-a',
        version: 1,
        type: 'batch' as const,
        scannedLineCount,
        totalLineCount,
        resultCount: items.length,
        items,
      }
      yield {
        scanId: 'test',
        documentId: 'doc-a',
        version: 1,
        type: 'done' as const,
        scannedLineCount,
        totalLineCount,
        resultCount: items.length,
        complete: true,
        reason: 'complete' as const,
      }
    },
    cancel: async () => undefined,
  }
}

function outputText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (!value || typeof value !== 'object') return ''
  const output = value as { text?: string; children?: readonly unknown[] }
  return output.text ?? output.children?.map(outputText).join('') ?? ''
}

function hasElement(
  value: unknown,
  predicate: (attributes: Record<string, string>) => boolean,
): boolean {
  if (!value || typeof value !== 'object') return false
  const output = value as {
    attributes?: Record<string, string>
    children?: readonly unknown[]
  }
  return (
    predicate(output.attributes ?? {}) ||
    output.children?.some((child) => hasElement(child, predicate)) === true
  )
}

it('rescans a changed document version and follows the preceding heading', async () => {
  let title = 'Original'
  const scan = vi.fn(() => scanner([heading(title, 1), { ...heading('Child', 3), level: 3 }], 4))
  const lifecycle = plugin.activate({
    pluginId: 'outline',
    permissions: ['document:read', 'ui:write'],
    host: { document: { scan }, ui: { requestUpdate: async () => {}, revealLine: async () => {} } },
  })
  const render = (version: number, activeLine: number, phase: 'update' | 'mount' = 'update') =>
    plugin.renderers['outline-panel']({
      node: { phase, documentId: 'same', documentVersion: version, viewport: { activeLine } },
    })
  render(1, 1, 'mount')
  await vi.waitFor(() => expect(outputText(render(1, 2))).toContain('Original'))
  expect(
    hasElement(
      render(1, 2),
      (a) => a['aria-current'] === 'location' && a['aria-label']?.includes('Original') === true,
    ),
  ).toBe(true)
  title = 'Renamed'
  render(2, 2)
  await vi.waitFor(() => expect(outputText(render(2, 2))).toContain('Renamed'))
  expect(outputText(render(2, 4))).not.toContain('Original')
  expect(
    hasElement(
      render(2, 4),
      (a) => a['aria-current'] === 'location' && a['aria-label']?.includes('Child') === true,
    ),
  ).toBe(true)
  expect(scan).toHaveBeenCalledTimes(2)
  await lifecycle.dispose()
})

it('renders H1–H6, folds subtrees, highlights folded ancestors and reveals navigation targets', async () => {
  const headings = [1, 2, 3, 4, 5, 6].map((level) => ({ ...heading(`H${level}`, level), level }))
  headings.push(heading('Sibling', 8))
  const revealLine = vi.fn(async () => {})
  const lifecycle = activateWith(() => scanner(headings, 10, 10), revealLine)
  render('tree', 1, 6, 'mount')
  await vi.waitFor(() => expect(outputText(render('tree', 1, 6))).toContain('H6'))
  expect(
    elements(render('tree', 1, 6), (a) => a.role === 'treeitem').map((a) => a['aria-level']),
  ).toEqual(['1', '2', '3', '4', '5', '6', '1'])
  await plugin.commands['outline.toggleHeading']({}, { line: 2 })
  const folded = render('tree', 1, 6)
  expect(outputText(folded)).toContain('H2')
  expect(outputText(folded)).not.toContain('H3')
  expect(outputText(folded)).toContain('Sibling')
  expect(
    hasElement(
      folded,
      (a) => a['aria-current'] === 'location' && a['aria-label']?.includes('H2') === true,
    ),
  ).toBe(true)
  await plugin.commands['outline.toggleHeading']({}, { line: 1 })
  await plugin.commands['outline.toggleHeading']({}, { line: 1 })
  expect(outputText(render('tree', 1, 6))).not.toContain('H3')
  await plugin.commands['outline.gotoHeading']({}, { line: 6 })
  expect(revealLine).toHaveBeenCalledWith(6)
  expect(outputText(render('tree', 1, 6))).toContain('H6')
  await plugin.commands['outline.collapseAll']()
  expect(elements(render('tree', 1, 6), (a) => a.role === 'treeitem')).toHaveLength(2)
  await plugin.commands['outline.expandAll']()
  expect(elements(render('tree', 1, 6), (a) => a.role === 'treeitem')).toHaveLength(7)
  await lifecycle.dispose()
})

it('does not reset a deep active line or version on virtual-only renders and mode changes', async () => {
  const scan = vi.fn(() => scanner([heading('Deep heading', 20_000)], 8192))
  const lifecycle = activateWith(scan)
  render('deep', 9, 20_000, 'mount')
  await vi.waitFor(() => expect(outputText(render('deep', 9, 20_000))).toContain('Deep heading'))
  const virtualOnly = plugin.renderers['outline-panel']({
    node: {
      documentId: 'deep',
      phase: 'update',
      virtualViewport: { id: 'outline', fromIndex: 0, toIndex: 10, userInitiated: true },
    },
  })
  expect(hasElement(virtualOnly, (a) => a['aria-current'] === 'location')).toBe(true)
  plugin.renderers['outline-panel']({
    node: { documentId: 'deep', phase: 'update', viewMode: 'source' },
  })
  plugin.renderers['outline-panel']({
    node: { documentId: 'deep', phase: 'update', viewMode: 'live' },
  })
  expect(scan).toHaveBeenCalledTimes(1)
  expect(scan.mock.calls[0]?.[0]).toMatchObject({ fromLine: 15_904, toLine: 24_095 })
  await lifecycle.dispose()
})

it('ignores an older scan completing after a document switch', async () => {
  const old = deferredScanner('Obsolete', 1)
  const newer = deferredScanner('Current', 2)
  const scan = vi.fn().mockReturnValueOnce(old.scanner).mockReturnValueOnce(newer.scanner)
  const lifecycle = activateWith(scan)
  render('old', 1, 1, 'mount')
  await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(1))
  render('new', 1, 2)
  await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2))
  newer.resolve()
  await vi.waitFor(() => expect(outputText(render('new', 1, 2))).toContain('Current'))
  old.resolve()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(outputText(render('new', 1, 2))).not.toContain('Obsolete')
  expect(old.scanner.cancel).toHaveBeenCalledTimes(1)
  await lifecycle.dispose()
})

it('ignores a stale version completing after an edit and resets obsolete fold keys', async () => {
  const old = deferredScanner('Old title', 1)
  const scan = vi
    .fn()
    .mockReturnValueOnce(old.scanner)
    .mockImplementation(() => scanner([heading('New title', 1)], 5, 5))
  const lifecycle = activateWith(scan)
  render('doc', 1, 1, 'mount')
  await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(1))
  render('doc', 2, 1)
  await vi.waitFor(() => expect(outputText(render('doc', 2, 1))).toContain('New title'))
  old.resolve()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(outputText(render('doc', 2, 1))).not.toContain('Old title')
  await lifecycle.dispose()
})

it('cleans up a disabled scanner without allowing its completion to overwrite a new activation', async () => {
  const old = deferredScanner('Disabled result', 1)
  const lifecycle = activateWith(() => old.scanner)
  render('old', 1, 1, 'mount')
  await vi.waitFor(() => expect(old.started()).toBe(true))
  await lifecycle.dispose()
  const newLifecycle = activateWith(() => scanner([heading('Enabled result', 1)], 1, 1))
  render('new', 1, 1, 'mount')
  old.resolve()
  await vi.waitFor(() => expect(outputText(render('new', 1, 1))).toContain('Enabled result'))
  expect(outputText(render('new', 1, 1))).not.toContain('Disabled result')
  await newLifecycle.dispose()
})

it('distinguishes an empty document from a partially scanned region', async () => {
  const lifecycle = activateWith(() => scanner([], 1, 1))
  render('empty', 1, 1, 'mount')
  await vi.waitFor(() => expect(outputText(render('empty', 1, 1))).toContain('文档无标题'))
  expect(outputText(render('empty', 1, 1))).toContain('已加载全文')
  await lifecycle.dispose()
  const second = activateWith(() => scanner([], 8192, 40_000))
  render('partial', 1, 1, 'mount')
  await vi.waitFor(() => expect(outputText(render('partial', 1, 1))).toContain('当前区域无标题'))
  expect(outputText(render('partial', 1, 1))).toContain('已加载第 1–8192 行 / 共 40000 行')
  expect(outputText(render('partial', 1, 1))).not.toContain('已加载全文')
  await second.dispose()
})

it('bounds each page, cached title tree, rendered rows and fold state across eviction', async () => {
  const scan = vi.fn((request: { fromLine?: number; toLine?: number }) => {
    const from = request.fromLine ?? 1
    return scanner(
      Array.from({ length: 8192 }, (_, index) => ({
        ...heading(`Title ${from + index}`, from + index),
        level: (index % 2) + 1,
      })),
      8192,
    )
  })
  const lifecycle = activateWith(scan)
  render('large', 1, 1, 'mount')
  await vi.waitFor(() => expect(outputText(render('large', 1, 1))).toContain('Title 1'))
  await plugin.commands['outline.collapseAll']()
  for (let requestId = 1; requestId <= 2; requestId++) {
    edge('large', requestId, 'after')
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(requestId + 1))
    await vi.waitFor(() => expect(outputText(render('large', 1))).toContain(`共 40000 行`))
    // Completion is signalled by the trailing edge becoming idle.
    await vi.waitFor(() =>
      expect(hasElement(render('large', 1), (a) => a['data-host-icon'] === 'loader-circle')).toBe(
        false,
      ),
    )
  }
  const page = plugin.renderers['outline-panel']({
    node: {
      documentId: 'large',
      documentVersion: 1,
      phase: 'update',
      virtualViewport: { id: 'outline', fromIndex: 0, toIndex: 50_000, userInitiated: true },
    },
  })
  expect(elements(page, (a) => a.role === 'treeitem').length).toBeLessThanOrEqual(500)
  expect(
    Number(elements(page, (a) => a['data-virtual-list'] === 'outline')[0]?.['data-virtual-total']),
  ).toBeLessThanOrEqual(16384)
  expect(outputText(page)).toContain('已加载第 8193–24576 行')
  expect(
    scan.mock.calls.every(
      ([request]) => (request.toLine ?? 0) - (request.fromLine ?? 1) + 1 <= 8192,
    ),
  ).toBe(true)
  await lifecycle.dispose()
})

it('reports unavailable scans and rejected navigation without corrupting the current selection', async () => {
  const lifecycle = activateWith(() => {
    throw new Error('unavailable')
  })
  render('bad', 1, 1, 'mount')
  await vi.waitFor(() => expect(outputText(render('bad', 1, 1))).toContain('大纲加载失败'))
  await expect(plugin.commands['outline.gotoHeading']({}, { line: 0 })).rejects.toThrow(
    '标题行号无效',
  )
  await lifecycle.dispose()
})

function activateWith(
  scan: (
    request: import('@milkup/plugin-sdk').SdkDocumentScanRequest,
  ) => import('@milkup/plugin-sdk').SdkDocumentScanner,
  revealLine = async (_line: number) => {},
) {
  return plugin.activate({
    pluginId: 'outline',
    permissions: ['document:read', 'ui:write'],
    host: { document: { scan }, ui: { requestUpdate: async () => {}, revealLine } },
  })
}

function render(
  documentId: string,
  documentVersion: number,
  activeLine?: number,
  phase: 'mount' | 'update' = 'update',
) {
  return plugin.renderers['outline-panel']({
    node: {
      phase,
      documentId,
      documentVersion,
      ...(activeLine === undefined ? {} : { viewport: { activeLine } }),
    },
  })
}

function edge(documentId: string, requestId: number, direction: 'before' | 'after') {
  return plugin.renderers['outline-panel']({
    node: {
      phase: 'update',
      documentId,
      documentVersion: 1,
      virtualViewport: {
        id: 'outline',
        fromIndex: 0,
        toIndex: 160,
        userInitiated: true,
        edge: direction,
        requestId,
      },
    },
  })
}

function elements(
  value: unknown,
  predicate: (attributes: Record<string, string>) => boolean,
): Record<string, string>[] {
  if (!value || typeof value !== 'object') return []
  const output = value as { attributes?: Record<string, string>; children?: unknown[] }
  return [
    ...(predicate(output.attributes ?? {}) ? [output.attributes ?? {}] : []),
    ...(output.children ?? []).flatMap((child) => elements(child, predicate)),
  ]
}

function deferredScanner(label: string, line: number) {
  let resolve!: () => void
  let started = false
  const pending = new Promise<void>((done) => {
    resolve = done
  })
  return {
    resolve,
    started: () => started,
    scanner: {
      cancel: vi.fn(async () => {}),
      async *[Symbol.asyncIterator]() {
        started = true
        await pending
        yield* scanner([heading(label, line)], 10, 10)
      },
    },
  }
}

it('follows an active title beyond the initial render slice and preserves manual virtual scrolling', async () => {
  const lifecycle = activateWith(() =>
    scanner(
      Array.from({ length: 8192 }, (_, index) => heading(`Title ${index + 1}`, index + 1)),
      8192,
      8192,
    ),
  )
  render('dense', 1, 4000, 'mount')
  await vi.waitFor(() =>
    expect(
      hasElement(
        render('dense', 1, 4000),
        (a) => a['aria-current'] === 'location' && a['aria-label']?.includes('Title 4000') === true,
      ),
    ).toBe(true),
  )
  const manuallyScrolled = plugin.renderers['outline-panel']({
    node: {
      phase: 'update',
      documentId: 'dense',
      virtualViewport: { id: 'outline', fromIndex: 0, toIndex: 20, userInitiated: true },
    },
  })
  expect(outputText(manuallyScrolled)).toContain('Title 1')
  expect(outputText(manuallyScrolled)).not.toContain('Title 4000')
  await lifecycle.dispose()
})

it('restarts an in-flight scan when the caret moves beyond its window', async () => {
  const old = deferredScanner('Old region', 1)
  const scan = vi
    .fn()
    .mockReturnValueOnce(old.scanner)
    .mockImplementation(() => scanner([heading('New region', 25_000)], 8192))
  const lifecycle = activateWith(scan)
  render('jump', 1, 1, 'mount')
  await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(1))
  render('jump', 1, 25_000)
  await vi.waitFor(() => expect(outputText(render('jump', 1, 25_000))).toContain('New region'))
  old.resolve()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(outputText(render('jump', 1, 25_000))).not.toContain('Old region')
  expect(scan.mock.calls[1]?.[0]).toMatchObject({ fromLine: 20_904, toLine: 29_095 })
  await lifecycle.dispose()
})

it('does not let delayed navigation from a previous document overwrite the new active heading', async () => {
  let finish!: () => void
  const navigation = new Promise<void>((resolve) => {
    finish = resolve
  })
  const lifecycle = activateWith(
    () => scanner([heading('First', 1), heading('Second', 5)], 10, 10),
    async () => navigation,
  )
  render('old', 1, 1, 'mount')
  await vi.waitFor(() => expect(outputText(render('old', 1, 1))).toContain('Second'))
  const command = plugin.commands['outline.gotoHeading']({}, { line: 5 })
  render('new', 1, 1)
  await vi.waitFor(() => expect(outputText(render('new', 1, 1))).toContain('First'))
  finish()
  await command
  const result = render('new', 1)
  expect(
    hasElement(
      result,
      (a) => a['aria-current'] === 'location' && a['aria-label']?.includes('First') === true,
    ),
  ).toBe(true)
  await lifecycle.dispose()
})

it('does not leave loading stuck after an interrupted iterator', async () => {
  const lifecycle = activateWith(() => ({
    cancel: async () => {},
    async *[Symbol.asyncIterator]() {},
  }))
  render('interrupted', 1, 1, 'mount')
  await vi.waitFor(() => expect(outputText(render('interrupted', 1, 1))).toContain('大纲加载失败'))
  await lifecycle.dispose()
})

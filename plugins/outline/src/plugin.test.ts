import { describe, expect, it, vi } from 'vitest'

import plugin from './plugin'

describe('outline plugin manual paging', () => {
  it('keeps two adjacent pages and evicts only the opposite page', async () => {
    const requestUpdate = vi.fn(async () => undefined)
    const revealLine = vi.fn(async () => undefined)
    const scanRequests: Array<{ fromLine: number; toLine: number }> = []
    const lifecycle = plugin.activate({
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
  }
}

function scanner(items: readonly ReturnType<typeof heading>[], scannedLineCount: number) {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'batch' as const,
        scannedLineCount,
        totalLineCount: 40_000,
        resultCount: items.length,
        items,
      }
      yield {
        type: 'done' as const,
        scannedLineCount,
        totalLineCount: 40_000,
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

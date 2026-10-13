import { describe, expect, it } from 'vitest'
import { MemoryDocumentSource, type EditorDocumentSource, type Line } from '@milkup/core'
import { SourceDocumentView } from '../source-document-view'

function generatedSource(lineCount = 1_638_402, width = 64): EditorDocumentSource {
  const line = (number: number): Line => ({
    number,
    from: (number - 1) * width,
    to: number * width - 1,
    text: String(number).padEnd(width - 1, 'x'),
  })
  return {
    documentId: 'generated-scroll',
    version: 0,
    lineCount,
    length: lineCount * width - 1,
    async readLineWindow(fromLine, toLine) {
      const lines = Array.from({ length: toLine - fromLine + 1 }, (_, i) => line(fromLine + i))
      return {
        fromLine,
        toLine,
        from: lines[0]!.from,
        to: lines.at(-1)!.to,
        text: lines.map((l) => l.text).join('\n'),
        lines,
      }
    },
    async lineAtPosition(position) {
      return line(Math.min(lineCount, Math.floor(position / width) + 1))
    },
    async positionAtLineOffset(number, offset) {
      return (number - 1) * width + Math.min(width - 1, offset)
    },
    snapshot() {
      return { documentId: this.documentId, version: 0, lineCount, length: this.length! }
    },
  }
}

function viewFor(source = generatedSource()) {
  return new SourceDocumentView({
    parent: document.createElement('main'),
    source,
    editable: true,
    virtualViewport: { enabled: true, lineHeight: 21, viewportHeight: 693, overscanLines: 24 },
  })
}

function height(view: SourceDocumentView) {
  const spacers = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('[data-spacer]')).reduce(
    (n, e) => n + Number.parseFloat(e.style.height),
    0,
  )
  return spacers + view.contentDOM.querySelectorAll('.milkup-line').length * 21
}

describe('bounded document scroll coordinates', () => {
  it('keeps physical height bounded and reaches the last logical line at the scrollbar end', async () => {
    const view = viewFor()
    await view.renderVisibleWindow()
    expect(height(view)).toBeLessThan(16_000_000)
    view.dom.scrollTop = height(view) - 693
    await view.renderVisibleWindow()
    expect(Number(view.contentDOM.dataset.toLine)).toBe(view.source.lineCount)
    expect(height(view)).toBeLessThan(16_000_000)
    view.destroy()
  })
  it('maps explicit far jumps and subsequent scroll events to the same lines', async () => {
    const view = viewFor()
    for (const line of [1_600_000, 50, 1_638_402, 738_419, 1]) {
      await view.scrollToLine(line)
      expect(view.dom.scrollTop).toBeLessThan(16_000_000)
      await view.renderVisibleWindow()
      expect(Number(view.contentDOM.dataset.fromLine)).toBeLessThanOrEqual(line)
      expect(Number(view.contentDOM.dataset.toLine)).toBeGreaterThanOrEqual(line)
      expect(height(view)).toBeLessThan(16_000_000)
    }
    view.destroy()
  })
  it('uses document end/start and page navigation while preserving shifted selection direction', async () => {
    const view = viewFor()
    await view.renderVisibleWindow()
    const key = async (key: string, ctrlKey = false, shiftKey = false) => {
      view.inputDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key, ctrlKey, shiftKey, bubbles: true, cancelable: true }),
      )
      await view.flushPendingEdits()
    }
    await key('End', true)
    expect(view.selection.main.head).toBe(view.source.length)
    await key('PageUp', false, true)
    expect(view.selection.main.anchor).toBe(view.source.length)
    expect(view.selection.main.head).toBeLessThan(view.selection.main.anchor)
    await key('PageDown')
    expect(view.selection.main.head).toBe(view.source.length)
    await key('Home', true)
    expect(view.selection.main.head).toBe(0)
    view.destroy()
  })
  it('bounds long-line overscan while keeping the entire visible viewport', async () => {
    const view = viewFor(generatedSource(258, 4096))
    view.dom.scrollTop = 100 * 21
    await view.renderVisibleWindow()
    const from = Number(view.contentDOM.dataset.fromLine),
      to = Number(view.contentDOM.dataset.toLine)
    expect(from).toBeLessThanOrEqual(101)
    expect(to).toBeGreaterThanOrEqual(133)
    expect(to - from + 1).toBeLessThanOrEqual(42)
    view.destroy()
  })
})

it('reuses repeated source windows but invalidates them when the source revision changes', async () => {
  const source = generatedSource(1000)
  const calls: string[] = []
  let revision = 0
  const read = source.readLineWindow.bind(source)
  const changing = {
    ...source,
    get version() {
      return revision
    },
    async readLineWindow(from: number, to: number) {
      calls.push(`${revision}:${from}-${to}`)
      const result = await read(from, to)
      return {
        ...result,
        lines: result.lines.map((line) => ({
          ...line,
          text: line.text.replace(/^./, String(revision)),
        })),
      }
    },
  }
  const view = viewFor(changing)
  await view.renderVisibleWindow()
  await view.scrollToLine(700)
  const afterFirst = calls.length
  await view.scrollToLine(700)
  expect(calls.length).toBe(afterFirst)
  revision++
  await view.renderVisibleWindow()
  expect(calls.length).toBeGreaterThan(afterFirst)
  expect(view.contentDOM.querySelector('.milkup-line')?.textContent?.startsWith('1')).toBe(true)
  view.destroy()
})

it('keeps document Home and the first visible line reachable with real content padding', async () => {
  const view = viewFor()
  view.contentDOM.style.padding = '24px 26px 48px'
  await view.renderVisibleWindow()
  await view.scrollToLine(view.source.lineCount)
  await view.scrollToLine(1)
  await view.renderVisibleWindow()
  expect(view.contentDOM.dataset.fromLine).toBe('1')
  expect(view.contentDOM.querySelector('.milkup-line')?.getAttribute('data-from')).toBe('0')
  view.destroy()
})

it('leaves the root overlay scrollbar gesture to the browser', async () => {
  const view = viewFor()
  await view.renderVisibleWindow()
  Object.defineProperties(view.dom, {
    scrollHeight: { value: 8_000_000 },
    clientHeight: { value: 700 },
    offsetWidth: { value: 1100 },
    clientWidth: { value: 1100 },
  })
  view.dom.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 }) as DOMRect
  const event = new MouseEvent('pointerdown', {
    clientX: 1097,
    clientY: 10,
    button: 0,
    bubbles: true,
    cancelable: true,
  })
  view.dom.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  expect(view.selection.main.head).toBe(0)
  view.destroy()
})

it('preserves edge pixel coordinates and round trips distant logical offsets', async () => {
  const { boundedScrollGeometry } = await import('../bounded-scroll')
  const geometry = boundedScrollGeometry(1_638_402, 21, 694, 72)
  expect(geometry.toLogical(24)).toBe(24)
  expect(geometry.toPhysical(24)).toBe(24)
  for (const physical of [0, 5, 1024, 2048, 88_888, 4_321_987, 7_999_000, 7_999_378]) {
    expect(geometry.toPhysical(geometry.toLogical(physical))).toBeCloseTo(physical, 5)
  }
})

it('reports logical viewport lines to plugin UI after a far jump', async () => {
  const view = viewFor()
  await view.renderVisibleWindow()
  await view.scrollToLine(1_600_000)
  expect(view.visibleLineRange.fromLine).toBe(1_600_000)
  expect(view.visibleLineRange.toLine).toBeGreaterThan(1_600_000)
  view.destroy()
})

it('invalidates source windows when a replacement source restarts the same document revision', async () => {
  const view = viewFor(new MemoryDocumentSource({ documentId: 'reopened', text: 'before' }))
  await view.renderVisibleWindow()
  view.updateSource(new MemoryDocumentSource({ documentId: 'reopened', text: 'after' }))
  await view.renderVisibleWindow()
  expect(view.contentDOM.querySelector('.milkup-line')?.textContent).toBe('after')
  view.destroy()
})

it('does not let an in-flight old source repopulate the replacement source cache', async () => {
  const source = new MemoryDocumentSource({ documentId: 'replacement-race', text: 'before' })
  const read = source.readLineWindow.bind(source)
  let release!: () => void
  let began!: () => void
  const started = new Promise<void>((resolve) => {
    began = resolve
  })
  source.readLineWindow = async (from, to) => {
    const window = await read(from, to)
    began()
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return window
  }
  const view = viewFor(source)
  const previous = view.renderVisibleWindow()
  await started
  view.updateSource(new MemoryDocumentSource({ documentId: 'replacement-race', text: 'after' }))
  await view.renderVisibleWindow()
  release()
  await previous
  await view.renderVisibleWindow()
  expect(view.contentDOM.querySelector('.milkup-line')?.textContent).toBe('after')
  view.destroy()
})

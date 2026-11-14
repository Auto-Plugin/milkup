import { afterEach, expect, it } from 'vitest'
import {
  DocumentPresentation,
  type DocumentPresentationConfig,
  type DocumentPresentationResponse,
  type DocumentPresentationWindow,
} from '../document-presentation'

const managers: DocumentPresentation[] = []
afterEach(() => {
  managers.splice(0).forEach((manager) => manager.destroy())
  document.body.replaceChildren()
})
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}
function response(window: DocumentPresentationWindow): DocumentPresentationResponse {
  return {
    declarations: [],
    request: {
      documentId: 'viewport',
      version: 0,
      source: window.source,
      from: window.from,
      to: window.to,
      fromLine: window.fromLine,
      toLine: window.toLine,
      completeStart: window.completeStart,
      completeEnd: window.completeEnd,
      selection: window.selection,
      width: window.width,
      contextKnown: true,
      protectedRanges: [],
      blocks: [],
      theme: 'light',
      target: 'screen',
    },
    result: { complete: true, fragments: [] },
  }
}
function fixture(config: DocumentPresentationConfig, collapsed = false, lineCount = 40) {
  const root = document.createElement('main'),
    content = document.createElement('div')
  root.append(content)
  document.body.append(root)
  let scroll = 0
  const rect = (top: number, height: number) => ({
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: 400,
    width: 400,
    height,
    toJSON: () => ({}),
  })
  root.getBoundingClientRect = () => rect(0, 20)
  const source = Array.from(
    { length: lineCount },
    (_, i) => `line${String(i + 1).padStart(2, '0')}`,
  ).join('\n')
  for (let i = 0; i < lineCount; i++) {
    const line = document.createElement('div')
    line.className = 'milkup-line'
    line.dataset.line = String(i + 1)
    line.dataset.from = String(i * 7)
    line.dataset.to = String(i * 7 + 6)
    line.textContent = source.slice(i * 7, i * 7 + 6)
    if (collapsed && i > 8 && i < 20) {
      line.dataset.presentationOwner = '9'
      line.dataset.presentationCollapsed = 'true'
      line.style.display = 'none'
    }
    line.getBoundingClientRect = () =>
      collapsed && i > 8 && i < 20
        ? rect(0, 0)
        : rect(i * 10 + (collapsed && i >= 20 ? 80 : 0) - scroll, collapsed && i === 8 ? 200 : 10)
    content.append(line)
  }
  const identity = {}
  const manager = new DocumentPresentation(
    root,
    content,
    config,
    () => ({
      mode: 'live',
      sourceIdentity: identity,
      sourceVersion: 0,
      selection: { anchor: source.length, head: source.length },
      lineCount,
      read: (from, to) => source.slice(from, to),
    }),
    () => {},
    () => {},
  )
  managers.push(manager)
  return {
    manager,
    root,
    content,
    source,
    scroll: (value: number) => {
      scroll = value
      root.dispatchEvent(new Event('scroll'))
    },
  }
}
const viewport = (window: DocumentPresentationWindow) => ({
  from: Reflect.get(window, 'visibleFrom'),
  to: Reflect.get(window, 'visibleTo'),
})

it('reports actual visible source instead of overscan or a remote editing selection', async () => {
  const calls: DocumentPresentationWindow[] = []
  const f = fixture({
    provide: (window) => {
      calls.push(window)
      return response(window)
    },
  })
  f.scroll(40)
  await settle()
  const request = calls.at(-1)!
  expect(request.from).toBe(0)
  expect(viewport(request)).toEqual({ from: 28, to: 41 })
  expect(request.selection.head).toBe(f.source.length)
})

it('refreshes priority when scrolling inside the same overscan source window', async () => {
  const calls: DocumentPresentationWindow[] = []
  const f = fixture({
    provide: (window) => {
      calls.push(window)
      return { ...response(window), result: { complete: false, fragments: [] } }
    },
  })
  f.scroll(40)
  await settle()
  const first = calls.at(-1)!
  f.scroll(50)
  await settle()
  const second = calls.at(-1)!
  expect(second.from).toBe(first.from)
  expect(second.to).toBe(first.to)
  expect(viewport(second)).toEqual({ from: 35, to: 48 })
  expect(calls).toHaveLength(2)
  f.scroll(50)
  await settle()
  expect(calls).toHaveLength(2)
})

it('cancels a stale viewport job without changing source or selection', async () => {
  const jobs: { window: DocumentPresentationWindow; signal: AbortSignal; finish: () => void }[] = []
  const f = fixture({
    provide: (window, { signal }) =>
      new Promise((resolve) =>
        jobs.push({ window, signal, finish: () => resolve(response(window)) }),
      ),
  })
  f.scroll(40)
  await settle()
  f.scroll(50)
  await settle()
  expect(jobs).toHaveLength(2)
  expect(jobs[0]!.signal.aborted).toBe(true)
  jobs[1]!.finish()
  jobs[0]!.finish()
  await settle()
  expect(viewport(jobs[1]!.window)).toEqual({ from: 35, to: 48 })
  expect(f.content.textContent).toBe(f.source.replaceAll('\n', ''))
  expect(jobs[1]!.window.selection).toEqual(jobs[0]!.window.selection)
})

it('maps the bottom of a tall preview to its complete collapsed source block', async () => {
  const calls: DocumentPresentationWindow[] = []
  const f = fixture(
    {
      provide: (window) => {
        calls.push(window)
        return response(window)
      },
    },
    true,
  )
  f.scroll(250)
  await settle()
  expect(viewport(calls.at(-1)!)).toEqual({ from: 56, to: 139 })
  for (let i = 0; i < 8; i++) {
    f.manager.schedule()
    await settle()
  }
  expect(calls).toHaveLength(1)
})

it('keeps a complete response when only visible priority changes inside its source window', async () => {
  const calls: DocumentPresentationWindow[] = []
  const f = fixture({
    provide: (window) => {
      calls.push(window)
      return response(window)
    },
  })
  f.scroll(40)
  await settle()
  const first = calls[0]!
  f.scroll(50)
  await settle()
  expect(calls).toHaveLength(1)
  expect(first.from).toBe(0)
  expect(f.content.textContent).toBe(f.source.replaceAll('\n', ''))
})

it('cancels a superseded window job when returning to an already complete cached window', async () => {
  const calls: DocumentPresentationWindow[] = []
  let pending: { signal: AbortSignal; finish: () => void } | undefined
  const f = fixture(
    {
      provide: (window, options) => {
        calls.push(window)
        if (calls.length === 1) return response(window)
        return new Promise((resolve) => {
          pending = { signal: options.signal, finish: () => resolve(response(window)) }
        })
      },
    },
    false,
    99,
  )
  f.scroll(40)
  await settle()
  f.scroll(800)
  await settle()
  expect(calls).toHaveLength(2)
  expect(calls[1]!.from).not.toBe(calls[0]!.from)
  const obsolete = pending!
  f.scroll(40)
  await settle()
  expect(obsolete.signal.aborted).toBe(true)
  obsolete.finish()
  await settle()
  f.scroll(40)
  await settle()
  expect(calls).toHaveLength(2)
})

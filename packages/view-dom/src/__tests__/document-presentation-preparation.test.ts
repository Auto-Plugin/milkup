import { afterEach, expect, it, vi } from 'vitest'
import {
  DocumentPresentation,
  type DocumentPresentationConfig,
  type DocumentPresentationResponse,
  type DocumentPresentationWindow,
  type PresentationSnapshot,
} from '../document-presentation'

const presentations: DocumentPresentation[] = []
afterEach(() => {
  for (const presentation of presentations.splice(0)) presentation.destroy()
  vi.useRealTimers()
  document.body.replaceChildren()
})
function response(
  window: DocumentPresentationWindow,
  contextKnown = true,
): DocumentPresentationResponse {
  return {
    declarations: [],
    request: {
      documentId: 'slow-source',
      version: 1,
      from: window.from,
      to: window.to,
      source: window.source,
      fromLine: window.fromLine,
      toLine: window.toLine,
      completeStart: window.completeStart,
      completeEnd: window.completeEnd,
      selection: window.selection,
      width: window.width,
      theme: 'light',
      target: 'screen',
      contextKnown,
      protectedRanges: [],
      blocks: [],
    },
    result: { fragments: [], complete: contextKnown },
  }
}
function make(config: DocumentPresentationConfig, changes: Partial<PresentationSnapshot> = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const root = document.createElement('main'),
    content = document.createElement('div')
  const line = document.createElement('div')
  line.className = 'milkup-line'
  line.dataset.line = '1'
  line.dataset.from = '0'
  line.dataset.to = '4'
  line.textContent = 'body'
  content.append(line)
  root.append(content)
  document.body.append(root)
  const identity = {}
  const presentation = new DocumentPresentation(
    root,
    content,
    config,
    () => ({
      mode: 'live',
      sourceIdentity: identity,
      sourceVersion: 1,
      selection: { anchor: 4, head: 4 },
      lineCount: 1,
      read: (from, to) => 'body'.slice(from, to),
      ...changes,
    }),
    () => {},
    () => {},
  )
  presentations.push(presentation)
  presentation.schedule()
  return presentation
}
it('resumes settled host preparation after its deadline without viewport or selection events', async () => {
  const provide = vi.fn<DocumentPresentationConfig['provide']>()
  provide
    .mockImplementationOnce(
      (_window, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    .mockImplementation((window) => response(window))
  make({ provide })
  await vi.advanceTimersByTimeAsync(0)
  expect(provide).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(provide.mock.calls[0]![1].signal.aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(999)
  expect(provide).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(provide).toHaveBeenCalledTimes(2)
})
it('never overlaps a timed-out native read that has not settled, then resumes after settlement', async () => {
  let finish!: () => void
  const provide = vi.fn<DocumentPresentationConfig['provide']>()
  provide
    .mockImplementationOnce(
      (window) =>
        new Promise((resolve) => {
          finish = () => resolve(response(window))
        }),
    )
    .mockImplementation((window) => response(window))
  const presentation = make({ provide })
  await vi.advanceTimersByTimeAsync(30_000)
  expect(provide).toHaveBeenCalledTimes(1)
  expect(provide.mock.calls[0]![1].signal.aborted).toBe(true)
  presentation.schedule()
  await vi.advanceTimersByTimeAsync(0)
  expect(provide).toHaveBeenCalledTimes(1)
  finish()
  await vi.advanceTimersByTimeAsync(1001)
  expect(provide).toHaveBeenCalledTimes(2)
})
it('does not resume timed-out preparation after destruction', async () => {
  const provide = vi.fn<DocumentPresentationConfig['provide']>(
    (_window, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
  )
  const presentation = make({ provide })
  await vi.advanceTimersByTimeAsync(10_000)
  presentation.destroy()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(provide).toHaveBeenCalledTimes(1)
})
for (const outcome of ['rejection', 'unknown-context'] as const) {
  it(`does not automatically retry ordinary ${outcome}`, async () => {
    const provide = vi.fn<DocumentPresentationConfig['provide']>((window) =>
      outcome === 'rejection' ? Promise.reject(Error('unavailable')) : response(window, false),
    )
    make({ provide })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(provide).toHaveBeenCalledTimes(1)
  })
}

for (const change of [
  'source',
  'version',
  'store-version',
  'selection',
  'mode',
  'window',
  'width',
] as const) {
  it(`cancels the settled retry when its ${change} no longer matches`, async () => {
    const provide = vi.fn<DocumentPresentationConfig['provide']>(
      (_window, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
    )
    const changes: Partial<PresentationSnapshot> = {}
    make({ provide }, changes)
    await vi.advanceTimersByTimeAsync(10_000)
    if (change === 'source') Object.assign(changes, { sourceIdentity: {} })
    if (change === 'version') Object.assign(changes, { sourceVersion: 2 })
    if (change === 'store-version') Object.assign(changes, { documentVersion: 2 })
    if (change === 'selection') Object.assign(changes, { selection: { anchor: 0, head: 0 } })
    if (change === 'mode') Object.assign(changes, { mode: 'source' })
    if (change === 'window') document.querySelector<HTMLElement>('.milkup-line')!.dataset.to = '3'
    if (change === 'width')
      Object.defineProperty(document.querySelector('.milkup-line')!.parentElement, 'clientWidth', {
        value: 900,
      })
    await vi.advanceTimersByTimeAsync(2000)
    expect(provide).toHaveBeenCalledTimes(1)
  })
}
it('does not let an old retry interfere with a replacement config', async () => {
  const provide = vi.fn<DocumentPresentationConfig['provide']>(
    (_window, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
  )
  const presentation = make({ provide })
  await vi.advanceTimersByTimeAsync(10_000)
  const replacement = vi.fn<DocumentPresentationConfig['provide']>((window) => response(window))
  presentation.setConfig({ provide: replacement })
  await vi.advanceTimersByTimeAsync(2000)
  expect(provide).toHaveBeenCalledTimes(1)
  expect(replacement).toHaveBeenCalledTimes(1)
})
it('retires the old timer when a new epoch starts another job', async () => {
  const provide = vi.fn<DocumentPresentationConfig['provide']>()
  provide
    .mockImplementationOnce(
      (_window, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
    )
    .mockImplementation((window) => response(window))
  const presentation = make({ provide })
  await vi.advanceTimersByTimeAsync(10_000)
  presentation.refresh()
  await vi.advanceTimersByTimeAsync(2000)
  expect(provide).toHaveBeenCalledTimes(2)
})
it('cannot revive a retired job when its uncancellable read settles after config replacement', async () => {
  let finish!: () => void
  const provide = vi.fn<DocumentPresentationConfig['provide']>(
    (window) =>
      new Promise((resolve) => {
        finish = () => resolve(response(window))
      }),
  )
  const presentation = make({ provide })
  await vi.advanceTimersByTimeAsync(10_000)
  const replacement = vi.fn<DocumentPresentationConfig['provide']>((window) => response(window))
  presentation.setConfig({ provide: replacement })
  await vi.advanceTimersByTimeAsync(0)
  finish()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(provide).toHaveBeenCalledTimes(1)
  expect(replacement).toHaveBeenCalledTimes(1)
})
it('continues settled preparation in separate bounded attempts rather than only once', async () => {
  const provide = vi.fn<DocumentPresentationConfig['provide']>()
  const stalled: DocumentPresentationConfig['provide'] = (_window, { signal }) =>
    new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    )
  provide
    .mockImplementationOnce(stalled)
    .mockImplementationOnce(stalled)
    .mockImplementation((window) => response(window))
  make({ provide })
  await vi.advanceTimersByTimeAsync(22_001)
  expect(provide).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(provide).toHaveBeenCalledTimes(3)
})

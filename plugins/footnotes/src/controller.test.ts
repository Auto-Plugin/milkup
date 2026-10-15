import { afterEach, expect, it, vi } from 'vitest'
import type {
  SdkPluginDocumentHost,
  SdkDocumentPresentationRequest as Request,
} from '@milkup/plugin-sdk'
import { createFootnoteController } from './controller'
const source = 'A[^x]\n[^x]: body'
const request: Request = {
  documentId: 'doc',
  version: 1,
  from: 0,
  to: source.length,
  source,
  fromLine: 1,
  toLine: 2,
  completeStart: true,
  completeEnd: true,
  contextKnown: true,
  protectedRanges: [],
  blocks: [],
  selection: { anchor: 99, head: 99 },
  theme: 'light',
  target: 'screen',
  width: 800,
}
function host() {
  let from = 0
  const lines = source.split('\n').map((text, i) => {
    const line = { number: i + 1, from, to: from + text.length, text }
    from += text.length + 1
    return line
  })
  return {
    readWindow: vi.fn(async () => ({
      documentId: 'doc',
      version: 1,
      fromLine: 1,
      toLine: 2,
      from: 0,
      to: source.length,
      text: source,
      totalLines: 2,
      completeStart: true,
      completeEnd: true,
      lines,
    })),
    invalidatePresentation: vi.fn(async () => {}),
    scan: vi.fn(),
  } as unknown as SdkPluginDocumentHost
}
afterEach(() => vi.useRealTimers())
it('returns immediately then indexes bounded pages and invalidates its own presentation', async () => {
  vi.useFakeTimers()
  const api = host(),
    controller = createFootnoteController(api)
  expect(controller.render(request, { signal: new AbortController().signal })).toEqual({
    fragments: [],
    complete: false,
  })
  expect(api.readWindow).not.toHaveBeenCalled()
  await vi.runAllTimersAsync()
  expect(api.readWindow).toHaveBeenCalledWith(
    { documentId: 'doc', version: 1, fromLine: 1, lineCount: 256 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  )
  expect(api.invalidatePresentation).toHaveBeenCalledWith({
    documentId: 'doc',
    version: 1,
    rendererId: 'footnotes',
  })
  expect(controller.render(request, { signal: new AbortController().signal }).complete).toBe(true)
  controller.dispose()
})
it('cancels delayed old-version scans and disposal without leaving stale output', async () => {
  vi.useFakeTimers()
  const api = host(),
    controller = createFootnoteController(api)
  controller.render(request, { signal: new AbortController().signal })
  controller.render({ ...request, version: 2 }, { signal: new AbortController().signal })
  controller.dispose()
  await vi.runAllTimersAsync()
  expect(api.readWindow).not.toHaveBeenCalled()
  expect(controller.render(request, { signal: new AbortController().signal }).fragments).toEqual([])
})

it('ignores a late read after document change and keeps a failed scan partial', async () => {
  vi.useFakeTimers()
  const api = host()
  let finish!: (value: Awaited<ReturnType<SdkPluginDocumentHost['readWindow']>>) => void
  vi.mocked(api.readWindow).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const controller = createFootnoteController(api)
  controller.render(request, { signal: new AbortController().signal })
  await vi.advanceTimersByTimeAsync(80)
  const pending = vi.mocked(api.readWindow).mock.calls[0]![1]!.signal!
  controller.render({ ...request, version: 2 }, { signal: new AbortController().signal })
  expect(pending.aborted).toBe(true)
  finish({
    documentId: 'doc',
    version: 1,
    fromLine: 1,
    toLine: 1,
    from: 0,
    to: 5,
    text: 'A[^x]',
    totalLines: 1,
    completeStart: true,
    completeEnd: true,
    lines: [{ number: 1, from: 0, to: 5, text: 'A[^x]' }],
  })
  await Promise.resolve()
  expect(api.invalidatePresentation).not.toHaveBeenCalled()
  vi.mocked(api.readWindow).mockRejectedValueOnce({ code: 'too-large' })
  await vi.runAllTimersAsync()
  expect(
    controller.render({ ...request, version: 2 }, { signal: new AbortController().signal })
      .complete,
  ).toBe(false)
  controller.dispose()
})

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

function pagedHost(texts: readonly string[], delayMs = 300) {
  let from = 0
  const lines = texts.map((text, i) => {
    const line = { number: i + 1, from, to: from + text.length, text }
    from += text.length + 1
    return line
  })
  const notifications: number[] = []
  const api = {
    readWindow: vi.fn(async ({ fromLine }: { fromLine: number }) => {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
      const line = lines[fromLine - 1]!
      return {
        documentId: 'doc',
        version: 1,
        fromLine,
        toLine: fromLine,
        from: line.from,
        to: line.to,
        text: line.text,
        totalLines: lines.length,
        completeStart: fromLine === 1,
        completeEnd: fromLine === lines.length,
        lines: [line],
      }
    }),
    invalidatePresentation: vi.fn(async () => {
      notifications.push(Date.now())
    }),
    scan: vi.fn(),
  } as unknown as SdkPluginDocumentHost
  return { api, notifications }
}

it('does not notify for slow plain-text pages and flushes completion exactly once', async () => {
  vi.useFakeTimers()
  const { api } = pagedHost(['plain 中文🙂', 'still ordinary', 'last paragraph'])
  const controller = createFootnoteController(api)
  controller.render(request, { signal: new AbortController().signal })
  await vi.runAllTimersAsync()
  expect(api.readWindow).toHaveBeenCalledTimes(3)
  expect(api.invalidatePresentation).toHaveBeenCalledTimes(1)
  expect(controller.render(request, { signal: new AbortController().signal }).complete).toBe(true)
  controller.dispose()
})

it('flushes new references, definitions, cross-page bodies and duplicates, but skips ordinary pages', async () => {
  vi.useFakeTimers()
  const { api } = pagedHost([
    'A[^x]',
    'ordinary',
    '[^x]: body',
    '    continuation',
    '[^x]: duplicate',
    'last',
  ])
  const controller = createFootnoteController(api)
  controller.render(request, { signal: new AbortController().signal })
  await vi.runAllTimersAsync()
  expect(api.invalidatePresentation).toHaveBeenCalledTimes(5)
  controller.dispose()
})

it('coalesces rapid dirty pages and delays the final dirty flush to preserve the 250ms bound', async () => {
  vi.useFakeTimers()
  const { api, notifications } = pagedHost(['A[^x]', '[^x]: body', '    continuation', 'last'], 10)
  const controller = createFootnoteController(api)
  controller.render(request, { signal: new AbortController().signal })
  await vi.runAllTimersAsync()
  expect(api.invalidatePresentation).toHaveBeenCalledTimes(2)
  expect(notifications[1]! - notifications[0]!).toBeGreaterThanOrEqual(250)
  controller.dispose()
})

it('cancels a pending final dirty flush when disposed', async () => {
  vi.useFakeTimers()
  const { api } = pagedHost(['A[^x]', '[^x]: body'], 10)
  const controller = createFootnoteController(api)
  controller.render(request, { signal: new AbortController().signal })
  await vi.advanceTimersByTimeAsync(110)
  expect(api.invalidatePresentation).toHaveBeenCalledTimes(1)
  controller.dispose()
  await vi.runAllTimersAsync()
  expect(api.invalidatePresentation).toHaveBeenCalledTimes(1)
})

it('flushes a terminal partial reason so unresolved references never become false missing diagnoses', async () => {
  vi.useFakeTimers()
  const { api } = pagedHost(['A[^missing]', '> ```'])
  const text = 'A[^missing]\n> ```'
  const visible = { ...request, source: text, to: text.length }
  const controller = createFootnoteController(api)
  controller.render(visible, { signal: new AbortController().signal })
  await vi.runAllTimersAsync()
  expect(api.invalidatePresentation).toHaveBeenCalledTimes(2)
  const output = controller.render(visible, { signal: new AbortController().signal })
  expect(output.complete).toBe(false)
  expect(output.fragments[0]?.message).toContain('nested-context')
  expect(output.fragments[0]?.message).not.toContain('未定义')
  controller.dispose()
})

it('keeps a failed notification dirty and retries only within the notification rate bound', async () => {
  vi.useFakeTimers()
  const { api, notifications } = pagedHost(['A[^x]', '[^x]: body'], 10)
  vi.mocked(api.invalidatePresentation).mockImplementationOnce(async () => {
    notifications.push(Date.now())
    throw new Error('temporary')
  })
  const controller = createFootnoteController(api)
  controller.render(request, { signal: new AbortController().signal })
  await vi.runAllTimersAsync()
  expect(api.invalidatePresentation).toHaveBeenCalledTimes(2)
  expect(notifications[1]! - notifications[0]!).toBeGreaterThanOrEqual(250)
  expect(controller.render(request, { signal: new AbortController().signal }).complete).toBe(true)
  controller.dispose()
})

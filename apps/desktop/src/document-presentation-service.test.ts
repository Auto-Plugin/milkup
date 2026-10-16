import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MemoryDocumentSource,
  MemoryTextDocument,
  type DocumentPresentationRequest,
} from '@milkup/core'
import { createDesktopDocumentPresentationService } from './document-presentation-service'

afterEach(() => vi.useRealTimers())

function fixture(text = 'Hello $x$\n') {
  const doc = new MemoryTextDocument(text)
  const source = new MemoryDocumentSource({ documentId: 'doc', version: 1, document: doc })
  const window = {
    sourceIdentity: doc,
    sourceVersion: 1,
    source: text,
    from: 0,
    to: text.length,
    fromLine: 1,
    toLine: doc.lineCount,
    completeStart: true,
    completeEnd: true,
    selection: { anchor: 0, head: 0 },
    width: 760,
  }
  return { doc, source, window }
}
const declaration = { id: 'extension', pluginId: 'test', contexts: ['text'] as const }
function result(request: DocumentPresentationRequest) {
  const from = request.source.indexOf('$')
  return {
    complete: true,
    fragments: [
      {
        from,
        to: from + 3,
        layout: 'inline' as const,
        content: { type: 'text' as const, text: 'x' },
        accessibleText: 'x',
      },
    ],
  }
}
describe('desktop document presentation service', () => {
  it('uses trusted context and validates inert results', async () => {
    const { doc, source, window } = fixture()
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source, identity: doc }),
      theme: () => 'dark',
      renderers: () => [declaration],
      render: async (_p, _r, request) => result(request),
    })
    const response = await service.provide(window, { signal: new AbortController().signal })
    expect(response.request.theme).toBe('dark')
    expect(response.request.contextKnown).toBe(true)
    expect(response.result.fragments).toHaveLength(1)
  })
  it('rejects results after document replacement even when IDs and versions match', async () => {
    const { doc, source, window } = fixture()
    let identity: object = doc
    let finish!: () => void
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source, identity }),
      theme: () => 'light',
      renderers: () => [declaration],
      render: async (_p, _r, request) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return result(request)
      },
    })
    const pending = service.provide(window, { signal: new AbortController().signal })
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 0))
    identity = {}
    finish()
    await expect(pending).rejects.toThrow()
  })
  it('rejects a mutable native source version changed while its renderer is pending', async () => {
    const { doc, source, window } = fixture()
    let version = 1
    const mutableSource = {
      documentId: source.documentId,
      get version() {
        return version
      },
      lineCount: source.lineCount,
      readLineWindow: source.readLineWindow.bind(source),
    }
    let finish!: () => void
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: mutableSource, identity: doc }),
      theme: () => 'light',
      renderers: () => [declaration],
      render: async (_p, _r, request) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return result(request)
      },
    })
    const pending = service.provide(window, { signal: new AbortController().signal })
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 0))
    version = 2
    finish()
    await expect(pending).rejects.toThrow()
  })
  it('rejects source replacement with unchanged view identity, document ID and version', async () => {
    const { doc, source, window } = fixture()
    let currentSource = source
    let finish!: () => void
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: currentSource, identity: doc }),
      theme: () => 'light',
      renderers: () => [declaration],
      render: async (_p, _r, request) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return result(request)
      },
    })
    const pending = service.provide(window, { signal: new AbortController().signal })
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 0))
    currentSource = new MemoryDocumentSource({ documentId: 'doc', version: 1, document: doc })
    finish()
    await expect(pending).rejects.toThrow()
  })
  it('drops code-overlap and stale contributions while preserving source', async () => {
    const { doc, source, window } = fixture('`$x$`\n')
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source, identity: doc }),
      theme: () => 'light',
      renderers: () => [declaration],
      render: async (_p, _r, request) => result(request),
    })
    const response = await service.provide(window, { signal: new AbortController().signal })
    expect(response.result.fragments).toEqual([])
    expect(response.result.complete).toBe(false)
    expect(source.version).toBe(1)
  })
  it('invalidates in-flight work and does not cache a rejected provider', async () => {
    const { doc, source, window } = fixture()
    let fail = true
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source, identity: doc }),
      theme: () => 'light',
      renderers: () => [declaration],
      render: async (_p, _r, request) => {
        if (fail) throw Error('unavailable')
        return result(request)
      },
    })
    expect(
      (await service.provide(window, { signal: new AbortController().signal })).result.complete,
    ).toBe(false)
    fail = false
    service.invalidate()
    expect(
      (await service.provide(window, { signal: new AbortController().signal })).result.fragments,
    ).toHaveLength(1)
  })
})

describe('bounded slow-source presentation preparation', () => {
  async function slowSource() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const doc = new MemoryTextDocument(Array.from({ length: 2001 }, () => 'body').join('\n'))
    const memory = new MemoryDocumentSource({ documentId: 'slow', version: 1, document: doc })
    let version = 1
    const readLineWindow = vi.fn(async (from: number, to: number, max?: number) => {
      // Model a native read with no cancellation parameter. Its late result must
      // still pass the real context reader's cancellation/version guard.
      await new Promise((resolve) => setTimeout(resolve, 750))
      return memory.readLineWindow(from, to, max)
    })
    const source = {
      documentId: 'slow',
      get version() {
        return version
      },
      lineCount: doc.lineCount,
      readLineWindow,
    }
    const tail = await memory.readLineWindow(2000, 2001)
    const window = () => ({
      sourceIdentity: doc,
      sourceVersion: version,
      documentVersion: version,
      source: tail.text,
      from: tail.from,
      to: tail.to,
      fromLine: 2000,
      toLine: 2001,
      completeStart: false,
      completeEnd: true,
      selection: { anchor: tail.from, head: tail.from },
      width: 760,
    })
    const render = vi.fn(async () => ({ complete: true, fragments: [] }))
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source, identity: doc }),
      theme: () => 'light',
      renderers: () => [declaration],
      render,
    })
    return { service, source, window, render, readLineWindow, nextVersion: () => version++ }
  }
  it('retains completed prefix checkpoints across a settled ten-second preparation abort', async () => {
    const f = await slowSource(),
      controller = new AbortController()
    const pending = Promise.resolve(
      f.service.provide(f.window(), { signal: controller.signal }),
    ).catch((error: unknown) => error)
    setTimeout(() => controller.abort(), 10_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(f.render).not.toHaveBeenCalled()
    expect(f.readLineWindow).toHaveBeenCalledTimes(14)
    await vi.advanceTimersByTimeAsync(800)
    expect(await pending).toBeInstanceOf(Error)
    f.readLineWindow.mockClear()
    const resumed = f.service.provide(f.window(), { signal: new AbortController().signal })
    expect(f.readLineWindow.mock.calls[0]![0]).toBe(1665)
    await vi.advanceTimersByTimeAsync(5000)
    expect((await resumed).request.contextKnown).toBe(true)
    expect(f.render).toHaveBeenCalledTimes(1)
  })
  it('does not publish a prefix checkpoint from an uncancellable read resolved after abort', async () => {
    const f = await slowSource(),
      controller = new AbortController()
    const pending = Promise.resolve(
      f.service.provide(f.window(), { signal: controller.signal }),
    ).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(400)
    controller.abort()
    await vi.advanceTimersByTimeAsync(400)
    expect(await pending).toBeInstanceOf(Error)
    f.readLineWindow.mockClear()
    const resumed = f.service.provide(f.window(), { signal: new AbortController().signal })
    expect(f.readLineWindow.mock.calls[0]![0]).toBe(1)
    await vi.advanceTimersByTimeAsync(13_000)
    expect((await resumed).request.contextKnown).toBe(true)
    expect(f.render).toHaveBeenCalledTimes(1)
  })
  it('discards prefix checkpoints when the same source moves to another document version', async () => {
    const f = await slowSource()
    const pending = Promise.resolve(
      f.service.provide(f.window(), { signal: new AbortController().signal }),
    ).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(1600)
    f.nextVersion()
    await vi.advanceTimersByTimeAsync(800)
    expect(await pending).toBeInstanceOf(Error)
    expect(f.render).not.toHaveBeenCalled()
    f.readLineWindow.mockClear()
    const resumed = f.service.provide(f.window(), { signal: new AbortController().signal })
    expect(f.readLineWindow.mock.calls[0]![0]).toBe(1)
    await vi.advanceTimersByTimeAsync(13_000)
    expect((await resumed).request.version).toBe(2)
    expect(f.render).toHaveBeenCalledTimes(1)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MemoryDocumentSource,
  MemoryTextDocument,
  type DocumentPresentationRequest,
} from '@milkup/core'
import { createDesktopDocumentPresentationService } from './document-presentation-service'
import { parseMarkdownWindow } from '@milkup/markdown'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

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
  it.each(['text', 'fence'] as const)(
    'preserves explicit %s provider preparation in the aggregate',
    async (kind) => {
      const { doc, source, window } = fixture(
        kind === 'fence' ? '```test\nhello\n```\n' : 'Hello\n',
      )
      const service = createDesktopDocumentPresentationService({
        current: () => ({ source, identity: doc }),
        theme: () => 'light',
        renderers: () => [
          {
            ...declaration,
            contexts: [kind],
            ...(kind === 'fence' ? { fenceLanguages: ['test'] } : {}),
          },
        ],
        render: async () => ({ complete: false, fragments: [], pending: true }),
      })
      const response = await service.provide(window, { signal: new AbortController().signal })
      expect(response.result).toEqual({ complete: false, fragments: [], pending: true })
    },
  )

  it('rejects a result from a replaced activation with the same declared renderer ID', async () => {
    const { doc, source, window } = fixture()
    let generation = 1
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source, identity: doc }),
      theme: () => 'light',
      renderers: () => [declaration],
      rendererGeneration: () => generation,
      render: async (_p, _r, request) => {
        generation++
        return result(request)
      },
    })
    const response = await service.provide(window, { signal: new AbortController().signal })
    expect(response.result).toEqual({ complete: false, fragments: [] })
  })
  it('revalidates completed provider ownership while another provider is still preparing', async () => {
    const { doc, source, window } = fixture()
    let generation = 1
    let finish!: () => void
    const other = { ...declaration, pluginId: 'other' }
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source, identity: doc }),
      theme: () => 'light',
      renderers: () => [declaration, other],
      rendererGeneration: (id) => (id === declaration.pluginId ? generation : 1),
      render: async (id, _r, request) => {
        if (id === declaration.pluginId) return result(request)
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return { complete: true, fragments: [] }
      },
    })
    const response = service.provide(window, { signal: new AbortController().signal })
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
    generation++
    finish()
    await expect(response).rejects.toMatchObject({ code: 'revoked' })
  })
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

describe('viewport-prioritized bounded fence presentation', () => {
  const fenceDeclaration = {
    id: 'diagram',
    pluginId: 'generic-diagram',
    contexts: ['fence'] as const,
    fenceLanguages: ['diagram'],
  }
  const content = () => ({
    type: 'group' as const,
    // Each fragment fits, and two fit the wire JSON/node limits, but XML escaping
    // makes their shared canonical representation exceed256KiB.
    children: Array.from({ length: 1200 }, () => ({ type: 'text' as const, text: '&'.repeat(30) })),
  })
  function fenceResult(request: DocumentPresentationRequest, large = true) {
    return {
      complete: true,
      fragments: request.blocks
        .filter((b) => b.kind === 'fence')
        .map((b) => ({
          from: b.from,
          to: b.to,
          layout: 'block' as const,
          accessibleText: 'diagram',
          content: large ? content() : { type: 'text' as const, text: 'small' },
        })),
    }
  }
  function threeFences() {
    return fixture('```diagram\none\n```\n\n```diagram\ntwo\n```\n\n```diagram\nthree\n```\n')
  }
  it('keeps an independently valid fence when the shared canonical budget is full', async () => {
    const f = threeFences()
    const render = vi.fn(async (_p: string, _r: string, request: DocumentPresentationRequest) =>
      fenceResult(request),
    )
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration],
      render,
    })
    const response = await service.provide(
      { ...f.window, visibleFrom: 0, visibleTo: 10 },
      { signal: new AbortController().signal },
    )
    expect(response.result.fragments).toHaveLength(1)
    expect(response.result.fragments[0]!.from).toBe(0)
    expect(response.result.complete).toBe(false)
    expect(render).toHaveBeenCalledTimes(2)
    expect(render.mock.calls.every((call) => call[2].blocks.length === 1)).toBe(true)
    expect(response.request.from).toBe(f.window.from)
    expect(response.request.to).toBe(f.window.to)
  })
  it('promotes a later visible fence without relying on selection or overscan changes', async () => {
    const f = threeFences(),
      third = f.window.source.lastIndexOf('```diagram')
    const render = vi.fn(async (_p: string, _r: string, request: DocumentPresentationRequest) =>
      fenceResult(request),
    )
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration],
      render,
    })
    const response = await service.provide(
      { ...f.window, visibleFrom: third, visibleTo: f.window.to },
      { signal: new AbortController().signal },
    )
    expect(response.result.fragments).toHaveLength(1)
    expect(response.result.fragments[0]!.from).toBe(third)
    expect(render.mock.calls[0]![2].from).toBe(third)
    expect(render.mock.calls[0]![2].selection).toEqual({ anchor: 0, head: 0 })
    expect(render.mock.calls[0]![2].completeStart).toBe(false)
    expect(render.mock.calls[0]![2].fromLine).toBe(9)
    expect(response.request.source).toBe(f.window.source)
  })
  it('keeps all competing providers in a fence conflict before budget admission', async () => {
    const f = threeFences()
    const render = vi.fn(async (_p: string, _r: string, request: DocumentPresentationRequest) =>
      fenceResult(request),
    )
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration, { ...fenceDeclaration, pluginId: 'competing' }],
      render,
    })
    const response = await service.provide(
      { ...f.window, visibleFrom: 0, visibleTo: 10 },
      { signal: new AbortController().signal },
    )
    expect(response.result.fragments).toEqual([])
    expect(response.result.complete).toBe(false)
    expect(render.mock.calls.some((call) => call[0] === 'competing')).toBe(true)
  })
  it('retains source ordering when later viewport fragments are admitted first', async () => {
    const f = threeFences(),
      third = f.window.source.lastIndexOf('```diagram')
    const render = vi.fn(async (_p: string, _r: string, request: DocumentPresentationRequest) =>
      fenceResult(request, false),
    )
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration],
      render,
    })
    const response = await service.provide(
      { ...f.window, visibleFrom: third, visibleTo: f.window.to },
      { signal: new AbortController().signal },
    )
    expect(render.mock.calls[0]![2].from).toBe(third)
    const offsets = response.result.fragments.map((f) => f.from)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
    expect(offsets).toContain(third)
  })
  it('settles a valid partial without starting another task inside the deadline reserve', async () => {
    const f = threeFences()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const render = vi.fn(async (_p: string, _r: string, request: DocumentPresentationRequest) => {
      clock.mockReturnValue(7901)
      return fenceResult(request, false)
    })
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration],
      render,
    })
    const response = await service.provide(f.window, {
      signal: new AbortController().signal,
      deadline: 10_000,
    })
    expect(render).toHaveBeenCalledTimes(1)
    expect(response.result.fragments).toHaveLength(1)
    expect(response.result.complete).toBe(false)
  })
  it.each([undefined, 8_000])(
    'shares one absolute preparation deadline across every fence (supplied: %s)',
    async (supplied) => {
      const f = threeFences()
      let now = 100
      vi.spyOn(performance, 'now').mockImplementation(() => now)
      const deadlines: number[] = []
      const signal = new AbortController().signal
      const service = createDesktopDocumentPresentationService({
        current: () => ({ source: f.source, identity: f.doc }),
        theme: () => 'light',
        renderers: () => [fenceDeclaration],
        async render(_plugin, _renderer, request, operation) {
          expect(operation.signal).toBe(signal)
          deadlines.push(operation.deadline)
          now += 1_000
          return fenceResult(request, false)
        },
      })
      const response = await service.provide(f.window, {
        signal,
        ...(supplied === undefined ? {} : { deadline: supplied }),
      })
      expect(response.result.complete).toBe(true)
      expect(deadlines).toEqual(Array(3).fill(supplied ?? 10_100))
    },
  )
  it('does not impose a fixed two-fence limit on fast small results', async () => {
    const f = threeFences()
    const render = vi.fn(async (_p: string, _r: string, request: DocumentPresentationRequest) =>
      fenceResult(request, false),
    )
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration],
      render,
    })
    const response = await service.provide(f.window, { signal: new AbortController().signal })
    expect(render).toHaveBeenCalledTimes(3)
    expect(response.result.fragments).toHaveLength(3)
    expect(response.result.complete).toBe(true)
  })
  it('rejects a malformed individual response without losing later valid fences', async () => {
    const f = threeFences()
    const render = vi.fn(async (_p: string, _r: string, request: DocumentPresentationRequest) => {
      const value = fenceResult(request, false)
      return request.from === 0 ? { ...value, unexpected: true } : value
    })
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration],
      render,
    })
    const response = await service.provide(f.window, { signal: new AbortController().signal })
    expect(response.result.fragments).toHaveLength(2)
    expect(response.result.fragments.every((fragment) => fragment.from > 0)).toBe(true)
    expect(response.result.complete).toBe(false)
  })
  it('does not let a mixed-context provider win a fence by hiding its competitor', async () => {
    const f = threeFences()
    const render = vi.fn(async (_p: string, _r: string, request: DocumentPresentationRequest) =>
      fenceResult(request, false),
    )
    const mixed = { ...fenceDeclaration, pluginId: 'mixed', contexts: ['text', 'fence'] as const }
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [mixed, fenceDeclaration],
      render,
    })
    const response = await service.provide(f.window, { signal: new AbortController().signal })
    expect(response.result.fragments).toEqual([])
    expect(response.result.complete).toBe(false)
    expect(render.mock.calls.filter((call) => call[0] === fenceDeclaration.pluginId)).toHaveLength(
      3,
    )
  })
  it('discards an aborted first fence and never starts a later task', async () => {
    const f = threeFences(),
      controller = new AbortController()
    const render = vi.fn(async (_p: string, _r: string, request: DocumentPresentationRequest) => {
      controller.abort()
      return fenceResult(request, false)
    })
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration],
      render,
    })
    await expect(service.provide(f.window, { signal: controller.signal })).rejects.toThrow()
    expect(render).toHaveBeenCalledTimes(1)
  })
  it('discards late output after renderer withdrawal and makes no subsequent renderer call', async () => {
    const f = threeFences()
    let enabled = true
    const render = vi.fn(async (_p: string, _r: string, request: DocumentPresentationRequest) => {
      enabled = false
      return fenceResult(request, false)
    })
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => (enabled ? [fenceDeclaration] : []),
      render,
    })
    const response = await service.provide(f.window, { signal: new AbortController().signal })
    expect(response.result.fragments).toEqual([])
    expect(response.result.complete).toBe(false)
    expect(render).toHaveBeenCalledTimes(1)
  })
  it('uses trusted prefix context when a mid-fence window locally invents opening markers', async () => {
    const text = '````outer\nbody\n```diagram\nfake\n```\n````\nplain\n```diagram\nreal\n```'
    const f = fixture(text)
    const local = await parseMarkdownWindow(f.source, { fromLine: 2, toLine: 10 })
    const fakeFrom = text.indexOf('```diagram')
    const closingFrom = text.indexOf('````', 1)
    const realFrom = text.lastIndexOf('```diagram')
    expect(local.window.from).toBeGreaterThan(0)
    expect(local.root.children).toContainEqual(
      expect.objectContaining({
        type: 'fencedCode',
        status: 'valid',
        from: fakeFrom,
      }),
    )
    expect(local.root.children).toContainEqual(
      expect.objectContaining({
        type: 'fencedCode',
        status: 'incomplete',
        from: closingFrom,
      }),
    )
    const render = vi.fn(async (_p: string, _r: string, request: DocumentPresentationRequest) =>
      fenceResult(request, false),
    )
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration],
      render,
    })
    const response = await service.provide(
      {
        ...f.window,
        source: local.window.text,
        from: local.window.from,
        to: local.window.to,
        fromLine: 2,
        toLine: 10,
        completeStart: false,
        visibleFrom: fakeFrom,
        visibleTo: local.window.to,
      },
      { signal: new AbortController().signal },
    )
    expect(response.request.contextKnown).toBe(true)
    expect(response.request.blocks).toContainEqual(
      expect.objectContaining({
        kind: 'fence',
        complete: false,
        from: local.window.from,
        to: closingFrom + 4,
      }),
    )
    expect(render).toHaveBeenCalledTimes(1)
    expect(render.mock.calls[0]![2].from).toBe(realFrom)
    expect(response.result.fragments).toHaveLength(1)
    expect(response.result.fragments[0]!.from).toBe(realFrom)
    expect(
      response.result.fragments.some(
        (fragment) => fragment.from === fakeFrom || fragment.from === closingFrom,
      ),
    ).toBe(false)
  })
})

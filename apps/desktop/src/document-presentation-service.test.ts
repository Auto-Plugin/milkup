import { afterEach, describe, expect, it, vi } from 'vitest'
import { deflateSync } from 'node:zlib'
import {
  MemoryDocumentSource,
  MemoryTextDocument,
  type DocumentPresentationRequest,
  type DocumentPresentationResult,
} from '@milkup/core'
import { createDesktopDocumentPresentationService } from './document-presentation-service'
import { parseMarkdownWindow } from '@milkup/markdown'
import {
  createDocumentPngImage,
  disposeDocumentPngImages,
  documentPngResourceStats,
} from '@milkup/core/internal/document-png-image'

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
const tinyPng = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
    'base64',
  ),
)
function squarePng(size: number): Uint8Array {
  const chunk = (type: string, data = Buffer.alloc(0)) => {
    const value = Buffer.alloc(data.length + 12)
    value.writeUInt32BE(data.length)
    value.write(type, 4, 'ascii')
    data.copy(value, 8)
    let crc = 0xffffffff
    for (const byte of value.subarray(4, value.length - 4)) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    value.writeUInt32BE((crc ^ 0xffffffff) >>> 0, value.length - 4)
    return value
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((size * 4 + 1) * size))),
    chunk('IEND'),
  ])
}
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
  it.each(['accepted', 'revoked', 'conflict'] as const)(
    'accounts private PNG ownership for %s provider results',
    async (mode) => {
      const { doc, source, window } = fixture('hello\n')
      const release = vi.fn()
      let generation = 1
      const service = createDesktopDocumentPresentationService({
        current: () => ({ source, identity: doc }),
        theme: () => 'light',
        rendererGeneration: () => generation,
        renderers: () =>
          mode === 'conflict' ? [declaration, { ...declaration, id: 'other' }] : [declaration],
        render: async () => {
          const content = createDocumentPngImage({ bytes: tinyPng, width: 1, height: 1, release })
          if (mode === 'revoked') generation++
          return {
            complete: true,
            fragments: [{ from: 0, to: 5, layout: 'block', accessibleText: 'diagram', content }],
          }
        },
      })
      const response = await service.provide(window, { signal: new AbortController().signal })
      if (mode === 'accepted') {
        expect(release).not.toHaveBeenCalled()
        expect(response.result.fragments).toHaveLength(1)
        disposeDocumentPngImages(response.result)
      } else expect(response.result.fragments).toHaveLength(0)
      expect(release).toHaveBeenCalledTimes(mode === 'conflict' ? 2 : 1)
      expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
    },
  )
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
  it('publishes completed native fences in bounded batches without spending the next task deadline', async () => {
    const f = threeFences()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const deadlines: number[] = []
    const release = vi.fn()
    const render = vi.fn(
      async (
        _p: string,
        _r: string,
        input: DocumentPresentationRequest,
        operation: { deadline: number },
      ) => {
        deadlines.push(operation.deadline)
        now += 8500
        return {
          complete: true,
          fragments: [
            {
              from: input.from,
              to: input.to,
              layout: 'block' as const,
              accessibleText: 'diagram',
              content: createDocumentPngImage({ bytes: tinyPng, width: 1, height: 1, release }),
            },
          ],
        }
      },
    )
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration],
      cacheableFence: () => true,
      render,
    })
    const responses = []
    try {
      for (let pass = 0; pass < 3; pass++) {
        const deadline = now + 10000
        const response = await service.provide(f.window, {
          signal: new AbortController().signal,
          deadline,
        })
        responses.push(response)
        expect(render).toHaveBeenCalledTimes(pass + 1)
        expect(response.result.fragments).toHaveLength(pass + 1)
        expect(response.continueAfterPaint === true).toBe(pass < 2)
        expect(response.result.complete).toBe(pass === 2)
        expect(deadlines[pass]).toBe(deadline)
      }
      expect(release).not.toHaveBeenCalled()
    } finally {
      for (const response of responses) disposeDocumentPngImages(response.result)
      service.clear()
    }
    expect(release).toHaveBeenCalledTimes(3)
    expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
  })
  it('finishes twelve distinct diagrams and reuses them across scrolls; evicted windows resume without churn', async () => {
    const f = fixture(
      Array.from({ length: 32 }, (_, i) => '```diagram\n' + i + '\n```\n').join('\n'),
    )
    const offsets = [...f.window.source.matchAll(/```diagram/g)].map((match) => match.index!)
    const windowFor = (start: number) => {
      const from = offsets[start]!,
        to = offsets[start + 12] ?? f.window.to
      const source = f.window.source.slice(from, to)
      return {
        ...f.window,
        from,
        to,
        source,
        fromLine: f.window.source.slice(0, from).split('\n').length,
        toLine: f.window.source.slice(0, to).split('\n').length,
        completeStart: from === 0,
        completeEnd: to === f.window.to,
      }
    }
    const release = vi.fn()
    const render = vi.fn(async (_p: string, _r: string, input: DocumentPresentationRequest) => ({
      complete: true,
      fragments: [
        {
          from: input.from,
          to: input.to,
          layout: 'block' as const,
          accessibleText: 'diagram',
          content: createDocumentPngImage({ bytes: tinyPng, width: 1, height: 1, release }),
        },
      ],
    }))
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration],
      cacheableFence: () => true,
      render,
    })
    const finish = async (
      window: ReturnType<typeof windowFor> & { visibleFrom?: number; visibleTo?: number },
    ) => {
      for (let pass = 0; pass < 12; pass++) {
        const before = render.mock.calls.length
        const response = await service.provide(window, { signal: new AbortController().signal })
        expect(render.mock.calls.length - before).toBeLessThanOrEqual(1)
        const count = response.result.fragments.length
        const complete = response.result.complete
        disposeDocumentPngImages(response.result)
        if (!response.continueAfterPaint) {
          expect(complete).toBe(true)
          expect(count).toBe(12)
          return
        }
      }
      throw new Error('Native window did not converge')
    }
    try {
      const first = windowFor(0)
      await finish(first)
      expect(render).toHaveBeenCalledTimes(12)
      await finish({ ...first, visibleFrom: offsets[11]!, visibleTo: first.to })
      await finish(first)
      expect(render).toHaveBeenCalledTimes(12)
      await finish(windowFor(20))
      expect(render).toHaveBeenCalledTimes(24)
      expect(documentPngResourceStats().images).toBe(20) // 12 active + 8 off-window.
      await finish(first)
      expect(render).toHaveBeenCalledTimes(28) // Only four actually evicted units.
      await finish(first)
      expect(render).toHaveBeenCalledTimes(28)
      expect(documentPngResourceStats().images).toBe(20)
    } finally {
      service.clear()
    }
    expect(release).toHaveBeenCalledTimes(28)
    expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
  })
  it('stops progressive work at the shared byte budget without evicting and rerendering active diagrams', async () => {
    const f = fixture(
      Array.from({ length: 5 }, (_, i) => '```diagram\n' + i + '\n```\n').join('\n'),
    )
    const bytes = squarePng(2048),
      release = vi.fn()
    const render = vi.fn(async (_p: string, _r: string, input: DocumentPresentationRequest) => ({
      complete: true,
      fragments: [
        {
          from: input.from,
          to: input.to,
          layout: 'block' as const,
          accessibleText: 'large',
          content: createDocumentPngImage({ bytes, width: 2048, height: 2048, release }),
        },
      ],
    }))
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration],
      cacheableFence: () => true,
      render,
    })
    try {
      for (let pass = 0; pass < 4; pass++) {
        const response = await service.provide(f.window, { signal: new AbortController().signal })
        expect(render).toHaveBeenCalledTimes(pass + 1)
        expect(response.continueAfterPaint === true).toBe(pass < 3)
        expect(response.resourceLimited === true).toBe(pass === 3)
        expect(response.result.complete).toBe(false)
        disposeDocumentPngImages(response.result)
      }
      expect(documentPngResourceStats().images).toBe(3)
      expect(release).toHaveBeenCalledTimes(1)
    } finally {
      service.clear()
    }
    expect(release).toHaveBeenCalledTimes(4)
    expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
  })
  it('runs every native competitor before rejecting overlap within a batch', async () => {
    const f = threeFences()
    const release = vi.fn()
    const render = vi.fn(async (_p: string, _r: string, input: DocumentPresentationRequest) => ({
      complete: true,
      fragments: [
        {
          from: input.from,
          to: input.to,
          layout: 'block' as const,
          accessibleText: 'diagram',
          content: createDocumentPngImage({ bytes: tinyPng, width: 1, height: 1, release }),
        },
      ],
    }))
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration, { ...fenceDeclaration, pluginId: 'competing' }],
      cacheableFence: () => true,
      render,
    })
    try {
      const response = await service.provide(f.window, { signal: new AbortController().signal })
      expect(render.mock.calls.map((call) => call[0])).toEqual(['generic-diagram', 'competing'])
      expect(response.result.fragments).toEqual([])
      expect(response.result.complete).toBe(false)
      disposeDocumentPngImages(response.result)
    } finally {
      service.clear()
    }
    expect(release).toHaveBeenCalledTimes(2)
  })
  it('does not make automatic native batches retry a renderer error', async () => {
    const f = threeFences()
    const render = vi.fn(async (_p: string, _r: string, input: DocumentPresentationRequest) => ({
      complete: true,
      fragments: [
        {
          from: input.from,
          to: input.to,
          layout: 'block' as const,
          accessibleText: 'diagram',
          status: 'error' as const,
          message: 'failed',
          content: { type: 'text' as const, text: 'source retained' },
        },
      ],
    }))
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [fenceDeclaration],
      cacheableFence: () => true,
      render,
    })
    const response = await service.provide(f.window, { signal: new AbortController().signal })
    expect(render).toHaveBeenCalledTimes(1)
    expect(response.result.complete).toBe(false)
    expect(response.continueAfterPaint).toBeUndefined()
    expect(response.result.fragments[0]?.status).toBe('error')
    service.clear()
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

describe('bounded completed fence reuse', () => {
  const renderer = {
    id: 'diagram',
    pluginId: 'reviewed-diagram',
    contexts: ['fence'] as const,
    fenceLanguages: ['diagram'],
  }
  const text = 'intro\n\n```diagram\nhello\n```\n\noutside\nmore\n'
  function setup(pure = false) {
    let f = fixture(text)
    let identity = {}
    let generation = 1
    let approved = pure
    const release = vi.fn()
    const render = vi.fn(
      async (
        _p: string,
        _r: string,
        input: DocumentPresentationRequest,
      ): Promise<DocumentPresentationResult> => ({
        complete: true,
        fragments: [
          {
            from: input.from,
            to: input.to,
            layout: 'block' as const,
            accessibleText: 'diagram',
            content: createDocumentPngImage({ bytes: tinyPng, width: 1, height: 1, release }),
          },
        ],
      }),
    )
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity }),
      theme: () => 'light',
      renderers: () => [renderer],
      rendererGeneration: () => generation,
      cacheableFence: () => approved,
      render,
    })
    const provide = (changes = {}) =>
      service.provide(
        { ...f.window, sourceIdentity: identity, ...changes },
        { signal: new AbortController().signal },
      )
    return {
      service,
      render,
      release,
      provide,
      generation: () => {
        generation++
      },
      revoke: () => {
        approved = false
      },
      replaceIdentity: () => {
        identity = {}
      },
      edit: () => {
        f = fixture('added before\n' + text)
        f.source = new MemoryDocumentSource({ documentId: 'doc', version: 2, document: f.doc })
        f.window.sourceVersion = 2
      },
    }
  }
  it('does not rerender the same fence when decoded geometry expands the source window', async () => {
    const f = setup()
    const short = text.slice(0, text.indexOf('outside'))
    const first = await f.provide({
      source: short,
      to: short.length,
      toLine: short.split('\n').length,
      completeEnd: false,
    })
    const second = await f.provide()
    expect(f.render).toHaveBeenCalledTimes(1)
    expect(second.result.fragments).toHaveLength(1)
    disposeDocumentPngImages(first.result)
    disposeDocumentPngImages(second.result)
    expect(f.release).not.toHaveBeenCalled()
    f.service.clear()
    expect(f.release).toHaveBeenCalledTimes(1)
    expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
  })
  it('keeps selection semantics for ordinary plugin providers', async () => {
    const f = setup()
    const first = await f.provide()
    const second = await f.provide({ selection: { anchor: 1, head: 1 } })
    expect(f.render).toHaveBeenCalledTimes(2)
    disposeDocumentPngImages(first.result)
    disposeDocumentPngImages(second.result)
    f.service.clear()
    expect(f.release).toHaveBeenCalledTimes(2)
  })
  it('rebinds only an attested inert PNG to newly verified fence offsets after an unrelated edit', async () => {
    const f = setup(true)
    const first = await f.provide()
    f.edit()
    const second = await f.provide({ selection: { anchor: 1, head: 1 } })
    expect(f.render).toHaveBeenCalledTimes(1)
    expect(second.result.fragments[0]!.from).toBe(first.result.fragments[0]!.from + 13)
    expect(second.request.version).toBe(2)
    disposeDocumentPngImages(first.result)
    disposeDocumentPngImages(second.result)
    f.service.clear()
    expect(f.release).toHaveBeenCalledTimes(1)
  })
  it.each(['generation', 'invalidate', 'attestation', 'width', 'identity'] as const)(
    'does not reuse revoked or incompatible %s output',
    async (change) => {
      const f = setup(true)
      const first = await f.provide()
      disposeDocumentPngImages(first.result)
      if (change === 'generation') f.generation()
      if (change === 'invalidate') f.service.invalidate()
      if (change === 'attestation') f.revoke()
      if (change === 'identity') f.replaceIdentity()
      const second = await f.provide(change === 'width' ? { width: 600 } : {})
      expect(f.render).toHaveBeenCalledTimes(2)
      disposeDocumentPngImages(second.result)
      f.service.clear()
      expect(f.release).toHaveBeenCalledTimes(2)
      expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
    },
  )
  it('evicts bounded entries while independent response owners remain valid', async () => {
    const f = setup(true)
    const responses = []
    for (let width = 700; width < 710; width++) responses.push(await f.provide({ width }))
    expect(f.render).toHaveBeenCalledTimes(10)
    // Eviction cannot release the independent response's ownership.
    expect(f.release).not.toHaveBeenCalled()
    f.service.clear()
    expect(f.release).not.toHaveBeenCalled()
    for (const response of responses) disposeDocumentPngImages(response.result)
    expect(f.release).toHaveBeenCalledTimes(10)
    expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
  })
  it('does not retain a valid PNG whose encoded bytes plus pixels exceed the cache budget', async () => {
    const f = setup(true)
    const bytes = squarePng(4096)
    f.render.mockImplementation(async (_p, _r, input) => ({
      complete: true,
      fragments: [
        {
          from: input.from,
          to: input.to,
          layout: 'block',
          accessibleText: 'large',
          content: createDocumentPngImage({ bytes, width: 4096, height: 4096, release: f.release }),
        },
      ],
    }))
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await f.provide()
      expect(response.result.fragments).toHaveLength(1)
      disposeDocumentPngImages(response.result)
      expect(f.release).toHaveBeenCalledTimes(attempt + 1)
    }
    expect(f.render).toHaveBeenCalledTimes(2)
    f.service.clear()
    expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
  })
  it('does not cache an error fragment or extend PNG attestation to arbitrary output', async () => {
    const f = setup(true)
    f.render.mockImplementation(async (_p, _r, input) => ({
      complete: true,
      fragments: [
        {
          from: input.from,
          to: input.to,
          layout: 'block',
          accessibleText: 'source',
          status: 'error',
          message: 'Unavailable',
          content: { type: 'text', text: 'source' },
        },
      ],
    }))
    await f.provide()
    await f.provide()
    expect(f.render).toHaveBeenCalledTimes(2)
    f.render.mockImplementation(async (_p, _r, input) => ({
      complete: true,
      fragments: [
        {
          from: input.from,
          to: input.to,
          layout: 'block',
          accessibleText: 'ordinary',
          content: { type: 'text', text: 'ordinary' },
        },
      ],
    }))
    await f.provide()
    await f.provide()
    expect(f.render).toHaveBeenCalledTimes(4)
    f.service.clear()
  })
  it('does not publish or retain a late PNG after invalidation', async () => {
    const f = setup(true)
    let finish!: () => void
    f.render.mockImplementationOnce(async (_p, _r, input) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return {
        complete: true,
        fragments: [
          {
            from: input.from,
            to: input.to,
            layout: 'block',
            accessibleText: 'late',
            content: createDocumentPngImage({
              bytes: tinyPng,
              width: 1,
              height: 1,
              release: f.release,
            }),
          },
        ],
      }
    })
    const pending = f.provide()
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 0))
    f.service.invalidate()
    finish()
    await expect(pending).rejects.toThrow('revoked')
    expect(f.release).toHaveBeenCalledTimes(1)
    const current = await f.provide()
    expect(f.render).toHaveBeenCalledTimes(2)
    disposeDocumentPngImages(current.result)
    f.service.clear()
    expect(f.release).toHaveBeenCalledTimes(2)
    expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
  })
})

describe('authenticated pending fences with selection-dependent providers', () => {
  const text = '$x$\n```mermaid\nflowchart LR\nA-->B\n```\noutside\n'
  const mermaid = {
    id: 'diagram',
    pluginId: 'host-diagrams',
    contexts: ['fence'] as const,
    fenceLanguages: ['mermaid'],
  }
  function pendingFixture() {
    const f = fixture(text)
    let finish!: () => void
    let rendererSignal!: AbortSignal
    let originalDeadline = 0
    let renders = 0
    const mathSelections: number[] = []
    const release = vi.fn()
    const service = createDesktopDocumentPresentationService({
      current: () => ({ source: f.source, identity: f.doc }),
      theme: () => 'light',
      renderers: () => [declaration, mermaid],
      cacheableFence: (plugin) => plugin === mermaid.pluginId,
      render: async (plugin, _id, request, operation) => {
        if (plugin === declaration.pluginId) {
          mathSelections.push(request.selection.head)
          return result(request)
        }
        renders++
        rendererSignal = operation.signal
        originalDeadline = operation.deadline
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return {
          complete: true,
          fragments: [
            {
              from: request.from,
              to: request.to,
              layout: 'block',
              accessibleText: 'diagram',
              content: createDocumentPngImage({ bytes: tinyPng, width: 1, height: 1, release }),
            },
          ],
        }
      },
    })
    return {
      f,
      service,
      finish: () => finish(),
      signal: () => rendererSignal,
      deadline: () => originalDeadline,
      renders: () => renders,
      mathSelections,
      release,
    }
  }
  it('keeps one bounded pending render while Math refreshes and an old selection consumer aborts', async () => {
    const x = pendingFixture(),
      first = new AbortController(),
      second = new AbortController()
    const deadline = performance.now() + 5000
    const stale = Promise.resolve(
      x.service.provide(x.f.window, { signal: first.signal, deadline }),
    ).catch((error) => error)
    await vi.waitFor(() => expect(x.renders()).toBe(1))
    first.abort()
    const latest = x.service.provide(
      { ...x.f.window, selection: { anchor: text.length, head: text.length } },
      { signal: second.signal, deadline: deadline + 1000 },
    )
    await vi.waitFor(() => expect(x.mathSelections).toEqual([0, text.length]))
    expect(x.signal().aborted).toBe(false)
    expect(x.deadline()).toBe(deadline)
    expect(x.renders()).toBe(1)
    x.finish()
    expect((await stale).code).toBe('aborted')
    const response = await latest
    expect(response.request.selection.head).toBe(text.length)
    expect(
      response.result.fragments.some((fragment) => fragment.content.type === 'host-png-image'),
    ).toBe(true)
    expect(x.renders()).toBe(1)
    disposeDocumentPngImages(response.result)
    x.service.clear()
    expect(x.release).toHaveBeenCalledTimes(1)
    expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
  })
  it('retains a completed authenticated fence for a later consumer after all selection waiters cancel', async () => {
    const x = pendingFixture(),
      controller = new AbortController()
    const cancelled = Promise.resolve(
      x.service.provide(x.f.window, { signal: controller.signal }),
    ).catch((error) => error)
    await vi.waitFor(() => expect(x.renders()).toBe(1))
    controller.abort()
    expect((await cancelled).code).toBe('aborted')
    x.finish()
    await vi.waitFor(() => expect(documentPngResourceStats().images).toBe(1))
    const response = await x.service.provide(
      { ...x.f.window, selection: { anchor: text.length, head: text.length } },
      { signal: new AbortController().signal },
    )
    expect(x.renders()).toBe(1)
    expect(
      response.result.fragments.some((fragment) => fragment.content.type === 'host-png-image'),
    ).toBe(true)
    disposeDocumentPngImages(response.result)
    x.service.clear()
    expect(x.release).toHaveBeenCalledTimes(1)
    expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
  })
  it.each(['invalidate', 'clear'] as const)(
    'revokes pending work on %s and releases late results',
    async (operation) => {
      const x = pendingFixture()
      const task = Promise.resolve(
        x.service.provide(x.f.window, { signal: new AbortController().signal }),
      ).catch((error) => error)
      await vi.waitFor(() => expect(x.renders()).toBe(1))
      x.service[operation]()
      expect(x.signal().aborted).toBe(true)
      x.finish()
      const response = await task
      expect(response.code).toBe('revoked')
      expect(x.release).toHaveBeenCalledTimes(1)
      expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
    },
  )
})

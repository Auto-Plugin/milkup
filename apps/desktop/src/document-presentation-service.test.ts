import { describe, expect, it } from 'vitest'
import {
  MemoryDocumentSource,
  MemoryTextDocument,
  type DocumentPresentationRequest,
} from '@milkup/core'
import { createDesktopDocumentPresentationService } from './document-presentation-service'

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

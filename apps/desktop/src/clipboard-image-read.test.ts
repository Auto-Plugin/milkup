import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesktopResourceService, readClipboardImageWithinLease } from './resource-service'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function item(mime = 'image/png', blob = new Blob(['image'], { type: mime })): ClipboardItem {
  return { types: [mime], getType: vi.fn(async () => blob) } as unknown as ClipboardItem
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('host async clipboard image lease', () => {
  it('starts read in the original call stack and accepts each supported image MIME', async () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      const reading = deferred<readonly ClipboardItem[]>()
      const read = vi.fn(() => reading.promise)
      const verify = vi.fn()
      const result = readClipboardImageWithinLease(read, verify, new AbortController().signal)
      expect(read).toHaveBeenCalledOnce()
      reading.resolve([item(mime)])
      const file = await result
      expect(file?.type).toBe(mime)
      expect(file?.size).toBe(5)
      expect(verify).toHaveBeenCalledTimes(3)
    }
  })
  it('cancels when document, selection, destination or editability changes while the browser reads', async () => {
    for (const reason of ['document', 'selection', 'save-location', 'readonly', 'disabled']) {
      let active = true
      const reading = deferred<readonly ClipboardItem[]>()
      const pending = readClipboardImageWithinLease(
        () => reading.promise,
        () => {
          if (!active) throw Error(reason)
        },
        new AbortController().signal,
      )
      active = false
      reading.resolve([item()])
      await expect(pending).rejects.toThrow(reason)
    }
  })
  it('rechecks the lease after asynchronous Blob acquisition', async () => {
    let active = true
    const blob = deferred<Blob>()
    const getType = vi.fn(() => blob.promise)
    const pending = readClipboardImageWithinLease(
      async () => [{ types: ['image/png'], getType } as unknown as ClipboardItem],
      () => {
        if (!active) throw Error('selection changed')
      },
      new AbortController().signal,
    )
    await vi.waitFor(() => expect(getType).toHaveBeenCalledOnce())
    active = false
    blob.resolve(new Blob(['x'], { type: 'image/png' }))
    await expect(pending).rejects.toThrow('selection changed')
  })
  it('abort ends a pending read immediately and ignores its late image', async () => {
    const controller = new AbortController()
    const reading = deferred<readonly ClipboardItem[]>()
    const pending = readClipboardImageWithinLease(
      () => reading.promise,
      () => {},
      controller.signal,
    )
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    const image = item()
    reading.resolve([image])
    await Promise.resolve()
    expect(image.getType).not.toHaveBeenCalled()
  })
  it('does not request unsupported clipboard payloads and rejects multiple images', async () => {
    const text = item('text/plain')
    const svg = item('image/svg+xml')
    expect(
      await readClipboardImageWithinLease(
        async () => [text, svg],
        () => {},
        new AbortController().signal,
      ),
    ).toBeUndefined()
    expect(text.getType).not.toHaveBeenCalled()
    expect(svg.getType).not.toHaveBeenCalled()
    await expect(
      readClipboardImageWithinLease(
        async () => [item(), item()],
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })
  it('rejects empty, excessive and mismatched blobs before producing a File', async () => {
    for (const blob of [
      new Blob([], { type: 'image/png' }),
      new Blob([new Uint8Array(16 * 1024 * 1024 + 1)], { type: 'image/png' }),
    ]) {
      await expect(
        readClipboardImageWithinLease(
          async () => [item('image/png', blob)],
          () => {},
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: 'too-large' })
    }
    await expect(
      readClipboardImageWithinLease(
        async () => [item('image/png', new Blob(['x'], { type: 'text/plain' }))],
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })
  it('bounds a browser clipboard read that never completes', async () => {
    vi.useFakeTimers()
    const pending = readClipboardImageWithinLease(
      () => new Promise(() => {}),
      () => {},
      new AbortController().signal,
    )
    const rejected = expect(pending).rejects.toMatchObject({ code: 'aborted' })
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })
  it('a synthetic paste cannot start a browser read or mint a grant', () => {
    const read = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { read } })
    const service = createDesktopResourceService({
      currentDocument: () => ({
        documentId: 'doc',
        version: 1,
        selectionRevision: 0,
        saveLocationGeneration: 0,
      }),
      ensureDocumentSaved: async () => true,
    })
    const event = new Event('paste')
    expect(() =>
      service.grantClipboardPaste(event, {
        signal: new AbortController().signal,
        pluginId: 'test.images',
      }),
    ).toThrow()
    expect(() =>
      service.grantClipboardPaste(event, {
        signal: new AbortController().signal,
        pluginId: 'test.images',
      }),
    ).toThrow()
    expect(read).not.toHaveBeenCalled()
  })
})

// These deterministic service-lifecycle tests provide platform accessor stubs.
// Real isTrusted/empty-WebKit payload is separately exercised by the native paste
// regression; the synthetic-event test above keeps the actual platform getters.
function platformPaste(
  read: () => Promise<readonly ClipboardItem[]>,
  payload: { types?: string[]; text?: string } = {},
) {
  class PlatformEvent {
    get type() {
      return 'paste'
    }
    get eventPhase() {
      return 2
    }
    get isTrusted() {
      return true
    }
  }
  class PlatformClipboardEvent extends PlatformEvent {
    get clipboardData() {
      return { types: payload.types ?? [], items: [], files: [], getData: () => payload.text ?? '' }
    }
  }
  vi.stubGlobal('Event', PlatformEvent)
  vi.stubGlobal('ClipboardEvent', PlatformClipboardEvent)
  vi.stubGlobal('navigator', { clipboard: { read } })
  return new PlatformClipboardEvent() as unknown as Event
}

describe('claimed paste lifecycle through the resource adapter', () => {
  function fixture() {
    let version = 1
    const ensureDocumentSaved = vi.fn(async () => true)
    const service = createDesktopResourceService({
      currentDocument: () => ({
        documentId: 'doc',
        version,
        selectionRevision: 0,
        saveLocationGeneration: 0,
        path: '/a.md',
      }),
      ensureDocumentSaved,
    })
    return {
      service,
      owner: service.adapterForPlugin('test.images'),
      ensureDocumentSaved,
      change: () => {
        version++
      },
    }
  }
  it('starts read synchronously, consumes the event once and saves only after the image arrives', async () => {
    const read = deferred<readonly ClipboardItem[]>()
    const reader = vi.fn(() => read.promise)
    const event = platformPaste(reader)
    const f = fixture()
    const pasteId = f.service.grantClipboardPaste(event, {
      signal: new AbortController().signal,
      pluginId: 'test.images',
    })
    expect(reader).toHaveBeenCalledOnce()
    expect(() =>
      f.service.grantClipboardPaste(event, {
        signal: new AbortController().signal,
        pluginId: 'test.images',
      }),
    ).toThrow()
    const pending = f.owner.adapter.prepareDocument({ pasteId })
    expect(f.ensureDocumentSaved).not.toHaveBeenCalled()
    read.resolve([item()])
    await expect(pending).resolves.toMatchObject({ status: 'ready' })
    expect(f.ensureDocumentSaved).toHaveBeenCalledOnce()
  })
  it('owner disposal and operation abort both stop a consumed, unresolved paste immediately', async () => {
    for (const mode of ['dispose', 'abort']) {
      const read = deferred<readonly ClipboardItem[]>()
      const event = platformPaste(() => read.promise)
      const f = fixture()
      const pasteId = f.service.grantClipboardPaste(event, {
        signal: new AbortController().signal,
        pluginId: 'test.images',
      })
      const operation = new AbortController()
      const pending = f.owner.adapter.prepareDocument({ pasteId }, { signal: operation.signal })
      if (mode === 'dispose') f.owner.dispose()
      else operation.abort()
      await expect(pending).rejects.toMatchObject({ code: 'aborted' })
      expect(f.ensureDocumentSaved).not.toHaveBeenCalled()
      read.resolve([item()])
    }
  })
  it('does not save an empty clipboard or a document changed during the read', async () => {
    for (const mode of ['empty', 'changed']) {
      const read = deferred<readonly ClipboardItem[]>()
      const event = platformPaste(() => read.promise)
      const f = fixture()
      const pasteId = f.service.grantClipboardPaste(event, {
        signal: new AbortController().signal,
        pluginId: 'test.images',
      })
      const pending = f.owner.adapter.prepareDocument({ pasteId })
      if (mode === 'changed') f.change()
      read.resolve(mode === 'empty' ? [] : [item()])
      if (mode === 'empty') await expect(pending).resolves.toEqual({ status: 'cancelled' })
      else await expect(pending).rejects.toMatchObject({ code: 'stale' })
      expect(f.ensureDocumentSaved).not.toHaveBeenCalled()
    }
  })
  it('disposal frees unconsumed grants and old grants cannot cross a re-enabled instance', async () => {
    const f = fixture()
    const ids: string[] = []
    for (let index = 0; index < 8; index++) {
      const event = platformPaste(() => new Promise(() => {}))
      ids.push(
        f.service.grantClipboardPaste(event, {
          signal: new AbortController().signal,
          pluginId: 'test.images',
        }),
      )
    }
    f.owner.dispose()
    const next = f.service.adapterForPlugin('test.images')
    const event = platformPaste(async () => [item()])
    const fresh = f.service.grantClipboardPaste(event, {
      signal: new AbortController().signal,
      pluginId: 'test.images',
    })
    await expect(next.adapter.prepareDocument({ pasteId: ids[0]! })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    await expect(next.adapter.prepareDocument({ pasteId: fresh })).resolves.toMatchObject({
      status: 'ready',
    })
  })
  it('another plugin instance cannot consume or abort the claimed paste', async () => {
    const f = fixture()
    const other = f.service.adapterForPlugin('other.images')
    const event = platformPaste(async () => [item()])
    const id = f.service.grantClipboardPaste(event, {
      signal: new AbortController().signal,
      pluginId: 'test.images',
    })
    await expect(other.adapter.prepareDocument({ pasteId: id })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    await other.adapter.abort(id)
    await expect(f.owner.adapter.prepareDocument({ pasteId: id })).resolves.toMatchObject({
      status: 'ready',
    })
  })
  it('delivery failure explicitly aborts an unconsumed grant without a later save', async () => {
    const f = fixture()
    const reading = deferred<readonly ClipboardItem[]>()
    const event = platformPaste(() => reading.promise)
    const id = f.service.grantClipboardPaste(event, {
      signal: new AbortController().signal,
      pluginId: 'test.images',
    })
    await f.service.abort(id)
    reading.resolve([item()])
    await expect(f.owner.adapter.prepareDocument({ pasteId: id })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    expect(f.ensureDocumentSaved).not.toHaveBeenCalled()
  })
  it('a valid first Save As can abort the old view signal after the image has been captured', async () => {
    const viewLifetime = new AbortController()
    let path: string | undefined
    let generation = 0
    const service = createDesktopResourceService({
      currentDocument: () => ({
        documentId: 'new',
        version: 0,
        selectionRevision: 0,
        saveLocationGeneration: generation,
        ...(path ? { path } : {}),
      }),
      ensureDocumentSaved: async () => {
        viewLifetime.abort()
        path = '/saved/new.md'
        generation++
        return true
      },
    })
    const owner = service.adapterForPlugin('test.images')
    const event = platformPaste(async () => [item()])
    const id = service.grantClipboardPaste(event, {
      signal: viewLifetime.signal,
      pluginId: 'test.images',
    })
    viewLifetime.signal.addEventListener(
      'abort',
      () => {
        void service.abort(id)
      },
      { once: true },
    )
    await expect(owner.adapter.prepareDocument({ pasteId: id })).resolves.toMatchObject({
      status: 'ready',
    })
    expect(path).toBe('/saved/new.md')
  })
  it('refuses nonempty text/HTML or advertised clipboard payload before reading', () => {
    for (const payload of [{ types: ['text/html'] }, { text: 'plain text' }]) {
      const reader = vi.fn(async () => [])
      const event = platformPaste(reader, payload)
      const f = fixture()
      expect(() =>
        f.service.grantClipboardPaste(event, {
          signal: new AbortController().signal,
          pluginId: 'test.images',
        }),
      ).toThrow()
      expect(reader).not.toHaveBeenCalled()
    }
  })
})

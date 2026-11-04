import { deflateSync } from 'node:zlib'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EditorState, MemoryDocumentSource, MemoryTextDocument, Selection } from '@milkup/core'
import {
  createDocumentPngImage,
  documentPngResourceStats,
} from '@milkup/core/internal/document-png-image'
import {
  EditorView,
  SourceDocumentView,
  type DocumentPresentationConfig,
  type DocumentPresentationResponse,
} from '../index'

function chunk(type: string, data = new Uint8Array()): Uint8Array {
  const result = new Uint8Array(data.length + 12)
  const view = new DataView(result.buffer)
  view.setUint32(0, data.length)
  result.set(new TextEncoder().encode(type), 4)
  result.set(data, 8)
  let crc = 0xffffffff
  for (const byte of result.subarray(4, result.length - 4)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0)
  return result
}
function png(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8
  header[9] = 6
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(new Uint8Array((width * 4 + 1) * height))),
    chunk('IEND'),
  ]
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}
const firstLine = 'diagram 原文😀'
const sourceText = `${firstLine}\r\nuntouched tail`
const views: Array<EditorView | SourceDocumentView> = []
interface DecodeCall {
  readonly image: HTMLImageElement
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}
let decodes: DecodeCall[]
let created: string[]
let revoked: string[]
let blobs: Blob[]
let releases: Array<ReturnType<typeof vi.fn>>
let savedDecode: PropertyDescriptor | undefined
let savedCreate: PropertyDescriptor | undefined
let savedRevoke: PropertyDescriptor | undefined
beforeEach(() => {
  decodes = []
  created = []
  revoked = []
  blobs = []
  releases = []
  savedDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode')
  savedCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  savedRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: function (this: HTMLImageElement): Promise<void> {
      return new Promise((resolve, reject) =>
        decodes.push({
          image: this,
          resolve: () => {
            Object.defineProperty(this, 'naturalWidth', { configurable: true, value: this.width })
            Object.defineProperty(this, 'naturalHeight', { configurable: true, value: this.height })
            resolve()
          },
          reject,
        }),
      )
    },
  })
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      blobs.push(blob)
      const url = `blob:private-png-${created.length}`
      created.push(url)
      return url
    }),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn((url: string) => revoked.push(url)),
  })
})
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
  for (const [owner, key, descriptor] of [
    [HTMLImageElement.prototype, 'decode', savedDecode],
    [URL, 'createObjectURL', savedCreate],
    [URL, 'revokeObjectURL', savedRevoke],
  ] as const) {
    if (descriptor) Object.defineProperty(owner, key, descriptor)
    else Reflect.deleteProperty(owner, key)
  }
  expect(new Set(revoked)).toEqual(new Set(created))
  expect(revoked).toHaveLength(created.length)
  for (const release of releases) expect(release).toHaveBeenCalledTimes(1)
  expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function resizeProbe() {
  const observed = new Map<Element, () => void>()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly targets = new Set<Element>()
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(element: Element) {
        this.targets.add(element)
        observed.set(element, () => this.callback([], this as unknown as ResizeObserver))
      }
      disconnect() {
        for (const target of this.targets) observed.delete(target)
        this.targets.clear()
      }
      unobserve(element: Element) {
        observed.delete(element)
        this.targets.delete(element)
      }
    },
  )
  return observed
}
async function settle() {
  for (let index = 0; index < 8; index++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
    else await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}
function provider(width = 160, height = 96): DocumentPresentationConfig {
  return {
    provide: ({
      sourceIdentity: _identity,
      sourceVersion: _version,
      documentVersion,
      visibleFrom: _visibleFrom,
      visibleTo: _visibleTo,
      ...window
    }) => {
      const release = vi.fn()
      releases.push(release)
      const image = createDocumentPngImage({
        bytes: png(width, height),
        width,
        height,
        title: 'Private diagram',
        release,
      })
      return {
        declarations: [{ id: 'private-image-test', contexts: ['text'] }],
        request: {
          ...window,
          documentId: 'image-test',
          version: documentVersion ?? 0,
          contextKnown: true,
          protectedRanges: [],
          blocks: [],
          theme: 'light',
          target: 'screen',
        },
        result: {
          complete: true,
          fragments: [
            {
              from: 0,
              to: firstLine.length,
              layout: 'block',
              accessibleText: 'Private diagram',
              content: image,
            },
          ],
        },
      }
    },
  }
}
async function make(windowed: boolean, config = provider()) {
  const parent = document.createElement('main')
  document.body.append(parent)
  const doc = new MemoryTextDocument(sourceText)
  const view = windowed
    ? new SourceDocumentView({
        parent,
        mode: 'live',
        source: new MemoryDocumentSource({ documentId: 'image-test', document: doc }),
        documentPresentation: config,
      })
    : new EditorView({
        parent,
        mode: 'live',
        state: new EditorState({ doc, selection: Selection.cursor(doc.length) }),
        documentPresentation: config,
      })
  views.push(view)
  if (view instanceof SourceDocumentView) {
    const revealed = view.revealSelection(2, Selection.cursor(doc.length))
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(100)
    await revealed
  }
  await settle()
  return view
}
function visibleSource(view: EditorView | SourceDocumentView) {
  const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="1"]')
  expect(line?.textContent).toContain(firstLine)
  expect(line?.style.display).not.toBe('none')
  expect(line?.dataset.presentationCollapsed).not.toBe('true')
}
async function unchanged(view: EditorView | SourceDocumentView) {
  if (view instanceof EditorView) expect(view.state.doc.text).toBe(sourceText)
  else {
    expect(view.source.version).toBe(0)
    expect((await view.source.readLineWindow(1, 2)).text).toBe(sourceText)
  }
}
function destroy(view: EditorView | SourceDocumentView) {
  view.destroy()
  views.splice(views.indexOf(view), 1)
}

for (const windowed of [false, true]) {
  it(`keeps source until PNG decode and fits wide pixels without changing intrinsic dimensions (${windowed})`, async () => {
    const view = await make(windowed, provider(2100, 2))
    const release = releases.at(-1)!
    visibleSource(view)
    expect(view.contentDOM.querySelector('img')).toBeNull()
    expect(decodes).toHaveLength(1)
    expect(release).not.toHaveBeenCalled()
    decodes[0]!.resolve()
    await settle()
    const image = view.contentDOM.querySelector<HTMLImageElement>(
      '[data-document-presentation] img',
    )
    expect(image).toBe(decodes[0]!.image)
    expect(image?.width).toBe(2100)
    expect(image?.height).toBe(2)
    expect(image?.style.width).toBe('100%')
    expect(image?.style.height).toBe('auto')
    expect(image?.style.maxWidth).toBe('100%')
    expect(image?.parentElement?.style.width).toBe('100%')
    expect(image?.parentElement?.style.maxWidth).toBe('100%')
    expect(image?.closest<HTMLElement>('[data-document-png-view]')?.style.width).toBe('2100px')
    expect(image?.closest<HTMLElement>('[data-document-presentation]')?.style.overflow).toBe('auto')
    expect(blobs[0]?.type).toBe('image/png')
    expect(view.contentDOM.querySelector('script, svg, foreignObject')).toBeNull()
    await unchanged(view)
    view.setDocumentPresentation(undefined)
    await settle()
    visibleSource(view)
    expect(release).toHaveBeenCalledTimes(1)
    expect(revoked).toEqual(created)
  })

  it(`wide PNG controls preserve the image, document, focus and provider while changing display geometry (${windowed})`, async () => {
    const observed = resizeProbe()
    const config = provider(2100, 126)
    const provide = vi.fn(config.provide)
    const view = await make(windowed, { provide })
    decodes[0]!.resolve()
    await settle()
    const outer = view.contentDOM.querySelector<HTMLElement>('[data-document-png-view]')!
    const viewport = outer.querySelector<HTMLElement>('[data-document-png-viewport]')!
    const button = outer.querySelector<HTMLButtonElement>('[data-document-png-scale]')!
    const controls = button.parentElement!
    const image = outer.querySelector('img')!
    const src = image.src
    const callCount = provide.mock.calls.length
    let width = 800
    vi.spyOn(outer, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, 100))
    expect(observed.has(outer)).toBe(true)
    observed.get(outer)!()
    await settle()
    expect(controls.hidden).toBe(false)
    expect(button.textContent).toBe('原始尺寸')
    expect(outer.dataset.documentPngView).toBe('fit')
    const pointer = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    expect(button.dispatchEvent(pointer)).toBe(true)
    button.focus()
    const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    expect(button.dispatchEvent(key)).toBe(true)
    button.click()
    await settle()
    expect(outer.dataset.documentPngView).toBe('natural')
    expect(button.textContent).toBe('适应宽度')
    expect(image.style.width).toBe('2100px')
    expect(image.style.height).toBe('auto')
    expect(image.style.maxWidth).toBe('none')
    expect(viewport.style.overflowX).toBe('auto')
    expect(viewport.tabIndex).toBe(0)
    expect(document.activeElement).toBe(button)
    // Scrollbar targeting and keyboard navigation remain native, not an edit.
    viewport.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    viewport.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    viewport.scrollLeft = 640
    button.click()
    await settle()
    expect(viewport.scrollLeft).toBe(0)
    expect(viewport.tabIndex).toBe(-1)
    expect(outer.dataset.documentPngView).toBe('fit')
    expect(image.style.width).toBe('100%')
    expect(image.src).toBe(src)
    expect(view.contentDOM.querySelector('img')).toBe(image)
    expect(provide).toHaveBeenCalledTimes(callCount)
    expect(decodes).toHaveLength(1)
    expect(created).toHaveLength(1)
    await unchanged(view)
    // A wider editor no longer needs a scale control; current focus stays in
    // the owned preview rather than being redirected into source editing.
    button.click()
    width = 2100
    observed.get(outer)!()
    await settle()
    expect(controls.hidden).toBe(true)
    expect(outer.dataset.documentPngView).toBe('fit')
    expect(document.activeElement).toBe(viewport)
    expect(provide).toHaveBeenCalledTimes(callCount)
    destroy(view)
    expect(observed.has(outer)).toBe(false)
    button.click()
    expect(outer.dataset.documentPngView).toBe('fit')
  })

  it(`a PNG already at natural width does not expose a scale control (${windowed})`, async () => {
    const observed = resizeProbe()
    const view = await make(windowed, provider(160, 96))
    decodes[0]!.resolve()
    await settle()
    const outer = view.contentDOM.querySelector<HTMLElement>('[data-document-png-view]')!
    vi.spyOn(outer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 160, 96))
    observed.get(outer)!()
    const button = outer.querySelector<HTMLButtonElement>('button')!
    expect(button.parentElement?.hidden).toBe(true)
    button.click()
    expect(outer.dataset.documentPngView).toBe('fit')
    expect(outer.querySelector('img')?.style.width).toBe('100%')
    await unchanged(view)
  })

  it(`pointer release toggles a wide PNG when WebView omits compatibility click (${windowed})`, async () => {
    const observed = resizeProbe()
    const view = await make(windowed, provider(2100, 126))
    decodes[0]!.resolve()
    await settle()
    const outer = view.contentDOM.querySelector<HTMLElement>('[data-document-png-view]')!
    const button = outer.querySelector<HTMLButtonElement>('[data-document-png-scale]')!
    vi.spyOn(outer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 100))
    observed.get(outer)!()
    await settle()

    button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
    await settle()
    expect(outer.dataset.documentPngView).toBe('natural')
    expect(button.textContent).toBe('适应宽度')

    // A normal browser emits click after pointerup; it must not toggle twice.
    button.click()
    await settle()
    expect(outer.dataset.documentPngView).toBe('natural')

    button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
    await settle()
    expect(outer.dataset.documentPngView).toBe('fit')
  })

  it(`decode failure keeps source and releases URL plus native lease (${windowed})`, async () => {
    const view = await make(windowed)
    const release = releases.at(-1)!
    decodes[0]!.reject(new Error('Controlled PNG decode failure'))
    await settle()
    visibleSource(view)
    expect(view.contentDOM.querySelector('img')).toBeNull()
    expect(view.dom.querySelector('[data-document-presentation-notice]')?.textContent).toBeTruthy()
    expect(revoked).toEqual(created)
    expect(release).toHaveBeenCalledTimes(1)
    expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
    await unchanged(view)
    // Later cache teardown must not release failed native output a second time.
    view.setDocumentPresentation(undefined)
    await settle()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it(`destroy while decoding releases all ownership and ignores late success (${windowed})`, async () => {
    const view = await make(windowed)
    const release = releases.at(-1)!
    const pending = decodes[0]!
    destroy(view)
    expect(release).toHaveBeenCalledTimes(1)
    expect(revoked).toEqual(created)
    pending.resolve()
    await settle()
    expect(view.contentDOM.querySelector('img')).toBeNull()
    expect(created).toHaveLength(1)
  })

  it(`decoded dimensions must match the accepted PNG header (${windowed})`, async () => {
    const view = await make(windowed)
    const release = releases.at(-1)!
    // The controlled decoder reports a raster different from the validated
    // IHDR. A successful decode promise alone must not hide the source.
    decodes[0]!.image.width++
    decodes[0]!.resolve()
    await settle()
    visibleSource(view)
    expect(view.contentDOM.querySelector('img')).toBeNull()
    expect(revoked).toEqual(created)
    expect(release).toHaveBeenCalledTimes(1)
    expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
    await unchanged(view)
  })

  it(`Blob URL creation failure releases the unpublished native image (${windowed})`, async () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      throw new Error('Controlled URL allocation failure')
    })
    const view = await make(windowed)
    visibleSource(view)
    expect(view.contentDOM.querySelector('img')).toBeNull()
    expect(created).toEqual([])
    expect(decodes).toEqual([])
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1)
    expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
  })

  it(`decode timeout releases native output and late success cannot revive it (${windowed})`, async () => {
    vi.useFakeTimers()
    try {
      const view = await make(windowed)
      const pending = decodes[0]!
      const release = releases.at(-1)!
      await vi.advanceTimersByTimeAsync(10_000)
      await settle()
      visibleSource(view)
      expect(view.contentDOM.querySelector('img')).toBeNull()
      expect(revoked).toEqual(created)
      expect(release).toHaveBeenCalledTimes(1)
      expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
      pending.resolve()
      await settle()
      expect(view.contentDOM.querySelector('img')).toBeNull()
      expect(decodes).toHaveLength(1)
      expect(release).toHaveBeenCalledTimes(1)
      await unchanged(view)
    } finally {
      vi.useRealTimers()
    }
  })

  it(`a provider response arriving after destruction is disposed without decoding (${windowed})`, async () => {
    const base = provider()
    const pending: Array<{
      response: DocumentPresentationResponse
      resolve: (response: DocumentPresentationResponse) => void
    }> = []
    const config: DocumentPresentationConfig = {
      provide: async (window, options) => {
        const response = await base.provide(window, options)
        return await new Promise<DocumentPresentationResponse>((resolve) =>
          pending.push({ response, resolve }),
        )
      },
    }
    const view = await make(windowed, config)
    expect(pending.length).toBeGreaterThan(0)
    expect(created).toEqual([])
    destroy(view)
    for (const item of pending) item.resolve(item.response)
    await settle()
    expect(created).toEqual([])
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1)
  })

  it(`replacement keeps the previous PNG until the new image decodes then releases it (${windowed})`, async () => {
    let width = 160
    const config: DocumentPresentationConfig = {
      provide: (window, options) => provider(width).provide(window, options),
    }
    const view = await make(windowed, config)
    const originalRelease = releases.at(-1)!
    decodes[0]!.resolve()
    await settle()
    const original = decodes[0]!.image
    width = 200
    view.refreshDocumentPresentation()
    await settle()
    const nextRelease = releases.at(-1)!
    expect(decodes).toHaveLength(2)
    expect(view.contentDOM.querySelector('img')).toBe(original)
    expect(originalRelease).not.toHaveBeenCalled()
    expect(documentPngResourceStats().decodedOwners).toBe(2)
    decodes[1]!.resolve()
    await settle()
    expect(view.contentDOM.querySelector('img')).toBe(decodes[1]!.image)
    expect(originalRelease).toHaveBeenCalledTimes(1)
    expect(nextRelease).not.toHaveBeenCalled()
    expect(documentPngResourceStats().decodedOwners).toBe(1)
    await unchanged(view)
  })
}

import type { EditingSelection } from './editing-context'

export interface ResolvedImageResource {
  readonly url: string
  readonly mimeType: string
  readonly width: number
  readonly height: number
  readonly dispose: () => void
}
export type ImageResolver = (
  relativeURL: string,
  context: { readonly signal: AbortSignal },
) => Promise<ResolvedImageResource | undefined>
export type ImagePasteHandler = (
  files: readonly File[],
  context: {
    readonly selection: EditingSelection
    readonly signal: AbortSignal
    readonly event: ClipboardEvent
  },
) => void | Promise<void>

export type EmptyPasteHandler = (context: {
  readonly selection: EditingSelection
  readonly signal: AbortSignal
  readonly event: ClipboardEvent
}) => boolean

export function managedImageURL(value: string): boolean {
  // Decode once solely to reject encoded separators/traversal. The resolver
  // receives the original URL and independently authorizes the resource.
  try {
    const path = decodeURIComponent(value)
    return (
      /^(?:assets|[^/\\:?#\u0000-\u001f]+\.assets)\/[^/\\:?#\u0000-\u001f]+\.(?:png|jpe?g|webp)$/i.test(
        path,
      ) && !path.split('/').some((part) => part === '.' || part === '..')
    )
  } catch {
    return false
  }
}

/** Host-owned paste grants are invalidated with the view's editing lifetime. */
export class ImagePasteSession {
  private readonly pending = new Set<AbortController>()
  constructor(
    private readonly handler: ImagePasteHandler | undefined,
    private readonly onError: (error: unknown) => void,
    private readonly emptyHandler?: EmptyPasteHandler,
  ) {}
  handle(event: ClipboardEvent, selection: EditingSelection): boolean {
    const data = event.clipboardData
    if (!data) return false
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
      /^image\/(?:png|jpeg|webp)$/.test(file.type),
    )
    if (!files.length) {
      if (
        !this.emptyHandler ||
        data.files.length ||
        data.items?.length ||
        data.types?.length ||
        data.getData('text/plain') ||
        data.getData('text/html')
      )
        return false
      this.abort()
      const controller = new AbortController()
      this.pending.add(controller)
      try {
        const claimed = this.emptyHandler({
          selection: Object.freeze({ anchor: selection.anchor, head: selection.head }),
          signal: controller.signal,
          event,
        })
        if (claimed) {
          event.preventDefault()
          return true
        }
      } catch (error) {
        this.onError(error)
      }
      controller.abort()
      this.pending.delete(controller)
      return false
    }
    if (!this.handler) return false
    event.preventDefault()
    this.abort()
    const controller = new AbortController()
    this.pending.add(controller)
    try {
      const result = this.handler(Object.freeze(files), {
        selection: Object.freeze({ anchor: selection.anchor, head: selection.head }),
        signal: controller.signal,
        event,
      })
      void Promise.resolve(result).catch((error) => {
        if (!controller.signal.aborted) this.onError(error)
      })
      // Keep the signal alive until invalidation even when a handler just queues
      // a host grant and returns synchronously.
    } catch (error) {
      if (!controller.signal.aborted) this.onError(error)
    }
    return true
  }
  abort(): void {
    for (const controller of this.pending) controller.abort()
    this.pending.clear()
  }
}

interface ImageEntry {
  readonly controller: AbortController
  resource?: ResolvedImageResource
  image?: HTMLImageElement
}

function imageAltText(source: string): string {
  return source.replace(/\\(.)/g, (match, character: string) => {
    const code = character.charCodeAt(0)
    return (code >= 33 && code <= 47) ||
      (code >= 58 && code <= 64) ||
      (code >= 91 && code <= 96) ||
      (code >= 123 && code <= 126)
      ? character
      : match
  })
}

/** Adds a noneditable image preview beside the existing mapped Markdown text. */
export class ImagePresentation {
  private readonly entries = new Map<HTMLElement, ImageEntry>()
  private readonly observer: MutationObserver | undefined
  private stopped = false
  constructor(
    private readonly content: HTMLElement,
    private readonly resolver: ImageResolver | undefined,
    private readonly onLayout: () => void,
  ) {
    if (!resolver) return
    this.observer = new MutationObserver(() => this.sync())
    this.observer.observe(content, { childList: true, subtree: true })
    this.sync()
  }
  private sync(): void {
    if (this.stopped || !this.resolver) return
    for (const [element, entry] of this.entries)
      if (!this.content.contains(element)) {
        entry.controller.abort()
        entry.resource?.dispose()
        this.entries.delete(element)
      }
    // A rendered viewport may contain adversarial image counts. Keep decoding,
    // blob lifetimes and layout bounded, with source-text fallback for the rest.
    const elements = this.content.querySelectorAll<HTMLElement>('[data-image-url]')
    for (const element of Array.from(elements)) {
      if (this.entries.has(element) || this.entries.size >= 32) continue
      const url = element.dataset.imageUrl!
      if (!managedImageURL(url)) continue
      const entry: ImageEntry = { controller: new AbortController() }
      this.entries.set(element, entry)
      void this.resolve(element, url, entry)
    }
  }
  private async resolve(element: HTMLElement, url: string, entry: ImageEntry): Promise<void> {
    try {
      const resource = await this.resolver!(url, { signal: entry.controller.signal })
      if (!resource) return
      if (entry.controller.signal.aborted || this.stopped || !this.content.contains(element)) {
        resource.dispose()
        return
      }
      if (
        !/^blob:/.test(resource.url) ||
        !/^image\/(?:png|jpeg|webp)$/.test(resource.mimeType) ||
        !Number.isFinite(resource.width) ||
        !Number.isFinite(resource.height) ||
        resource.width <= 0 ||
        resource.height <= 0 ||
        resource.width > 16384 ||
        resource.height > 16384 ||
        resource.width * resource.height > 40_000_000
      ) {
        resource.dispose()
        return
      }
      entry.resource = resource
      const image = element.ownerDocument.createElement('img')
      image.className = 'milkup-image-preview'
      image.alt = imageAltText(element.dataset.imageAlt ?? '')
      image.draggable = false
      image.decoding = 'async'
      image.style.display = 'block'
      image.style.maxWidth = '100%'
      image.style.maxHeight = '480px'
      image.style.width = 'auto'
      image.style.height = 'auto'
      image.style.objectFit = 'contain'
      image.width = resource.width
      image.height = resource.height
      image.addEventListener('load', () => {
        if (!entry.controller.signal.aborted) this.onLayout()
      })
      image.addEventListener(
        'error',
        () => {
          image.remove()
          if (!entry.controller.signal.aborted) this.onLayout()
        },
        { once: true },
      )
      entry.image = image
      image.src = resource.url
      element.prepend(image)
      this.onLayout()
    } catch {
      /* Unavailable resources leave the original mapped Markdown intact. */
    }
  }
  private clear(): void {
    for (const entry of this.entries.values()) {
      entry.controller.abort()
      entry.image?.remove()
      entry.resource?.dispose()
    }
    this.entries.clear()
  }
  refresh(): void {
    if (this.stopped) return
    this.clear()
    this.sync()
    this.onLayout()
  }
  destroy(): void {
    this.stopped = true
    this.observer?.disconnect()
    this.clear()
  }
}

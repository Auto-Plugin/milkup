import { serializeDocumentPresentationNode, type DocumentSvgImage } from '@milkup/core'

// Image decoding starts after plugin execution has settled. This independent
// bound does not extend either the native renderer or host preparation deadline.
export const imageDecodeDeadlineMs = 10_000

export interface OwnedDocumentSvgImage {
  readonly element: HTMLElement
  readonly state: 'pending' | 'decoded' | 'failed' | 'disposed'
  dispose(): void
}

/** Private view ownership: only canonical host XML becomes an image Blob URL. */
export function createOwnedDocumentSvgImage(
  document: Document,
  value: DocumentSvgImage,
  changed: () => void,
): OwnedDocumentSvgImage {
  // Core owns the canonical integer outer viewport and unchanged inner SVG.
  const canonical = serializeDocumentPresentationNode(value)
  const [x, y, width, height] = value.rasterBounds
  const left = Math.floor(x)
  const top = Math.floor(y)
  const right = Math.ceil(x + width)
  const bottom = Math.ceil(y + height)
  const insetLeft = Math.max(0, -left)
  const insetTop = Math.max(0, -top)
  // Integer raster rounding alone must not enlarge document layout. Real ink
  // beyond the original viewport does need room in the ancestor scrollport.
  const insetRight = x + width > value.width ? right - value.width : 0
  const insetBottom = y + height > value.height ? bottom - value.height : 0
  const element = document.createElement('span')
  element.style.display = 'inline-block'
  element.style.position = 'relative'
  element.style.width = `${value.width + insetLeft + insetRight}px`
  element.style.height = `${value.height + insetTop + insetBottom}px`
  element.style.maxWidth = 'none'
  element.style.overflow = 'visible'
  element.style.verticalAlign = 'middle'
  element.contentEditable = 'false'
  // Keep the original coordinate space and fractional footprint explicit. Its
  // bounds-derived inset moves negative ink into nonnegative scroll positions;
  // the outer box also reserves actual overflow so adjacent text cannot overlap.
  const slot = document.createElement('span')
  slot.style.display = 'block'
  slot.style.position = 'absolute'
  slot.style.left = `${insetLeft}px`
  slot.style.top = `${insetTop}px`
  slot.style.width = `${value.width}px`
  slot.style.height = `${value.height}px`
  slot.style.overflow = 'visible'
  element.append(slot)
  const image = document.createElement('img')
  image.alt = value.title ?? ''
  image.draggable = false
  image.width = right - left
  image.height = bottom - top
  image.style.position = 'absolute'
  image.style.left = `${left}px`
  image.style.top = `${top}px`
  image.style.display = 'block'
  image.style.width = `${right - left}px`
  image.style.height = `${bottom - top}px`
  image.style.maxWidth = 'none'
  image.style.maxHeight = 'none'
  slot.append(image)
  const url = URL.createObjectURL(new Blob([canonical], { type: 'image/svg+xml' }))
  let state: OwnedDocumentSvgImage['state'] = 'pending'
  let timer: ReturnType<typeof setTimeout> | undefined
  const notify = () =>
    queueMicrotask(() => {
      if (state !== 'disposed') changed()
    })
  const failed = () => {
    if (state === 'disposed' || state === 'failed') return
    state = 'failed'
    clearTimeout(timer)
    notify()
  }
  image.addEventListener('error', failed)
  timer = setTimeout(failed, imageDecodeDeadlineMs)
  try {
    image.src = url
    void image.decode().then(() => {
      if (state !== 'pending') return
      clearTimeout(timer)
      state = 'decoded'
      notify()
    }, failed)
  } catch {
    failed()
  }
  return {
    element,
    get state() {
      return state
    },
    dispose() {
      if (state === 'disposed') return
      state = 'disposed'
      clearTimeout(timer)
      image.removeEventListener('error', failed)
      image.removeAttribute('src')
      URL.revokeObjectURL(url)
    },
  }
}

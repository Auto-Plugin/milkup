import {
  acquireDocumentPngImage,
  type DocumentPngImage,
} from '@milkup/core/internal/document-png-image'
import { imageDecodeDeadlineMs, type OwnedDocumentSvgImage } from './document-svg-image'

/** Host-private inert PNG: it never accepts a URL, HTML or a plugin object. */
export function createOwnedDocumentPngImage(
  document: Document,
  value: DocumentPngImage,
  changed: () => void,
): OwnedDocumentSvgImage {
  const lease = acquireDocumentPngImage(value)
  const element = document.createElement('span')
  element.style.display = 'inline-block'
  element.style.width = `${value.width}px`
  element.style.height = 'auto'
  element.style.maxWidth = '100%'
  element.style.verticalAlign = 'middle'
  element.contentEditable = 'false'
  const image = document.createElement('img')
  image.alt = value.title
  image.draggable = false
  image.width = value.width
  image.height = value.height
  image.style.display = 'block'
  // Preserve intrinsic pixels for validation and export, but display wide
  // diagrams at the editor's CSS width without enlarging smaller diagrams.
  image.style.width = '100%'
  image.style.height = 'auto'
  image.style.maxWidth = '100%'
  image.style.maxHeight = 'none'
  element.append(image)
  let state: OwnedDocumentSvgImage['state'] = 'pending'
  let url: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let released = false
  const cleanup = () => {
    if (released) return
    released = true
    clearTimeout(timer)
    image.removeEventListener('error', failed)
    image.removeAttribute('src')
    if (url !== undefined) URL.revokeObjectURL(url)
    lease.dispose()
  }
  const notify = () =>
    queueMicrotask(() => {
      if (state !== 'disposed') changed()
    })
  const failed = () => {
    if (state !== 'pending' && state !== 'decoded') return
    state = 'failed'
    cleanup()
    notify()
  }
  image.addEventListener('error', failed)
  timer = setTimeout(failed, imageDecodeDeadlineMs)
  try {
    url = URL.createObjectURL(
      new Blob([lease.bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
    )
    image.src = url
    void image.decode().then(() => {
      if (state !== 'pending') return
      // IHDR is checked before allocation; decoding must agree with that header.
      if (image.naturalWidth !== value.width || image.naturalHeight !== value.height) {
        failed()
        return
      }
      state = 'decoded'
      clearTimeout(timer)
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
      cleanup()
    },
  }
}

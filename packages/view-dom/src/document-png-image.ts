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
  layoutChanged: () => void = () => {},
): OwnedDocumentSvgImage {
  const lease = acquireDocumentPngImage(value)
  const element = document.createElement('span')
  element.style.display = 'inline-block'
  element.style.width = `${value.width}px`
  element.style.height = 'auto'
  element.style.maxWidth = '100%'
  element.style.verticalAlign = 'middle'
  element.contentEditable = 'false'
  element.dataset.documentPngView = 'fit'
  const controls = document.createElement('span')
  controls.className = 'milkup-document-png-controls'
  // Keep the live control in a document-level host. WebView2 can suppress
  // native pointer targeting for controls nested in the non-editable preview.
  controls.style.position = 'fixed'
  controls.style.zIndex = '1000'
  controls.style.pointerEvents = 'auto'
  controls.hidden = true
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.documentPngScale = ''
  button.className = 'milkup-document-png-scale'
  button.style.pointerEvents = 'auto'
  button.title = '按原始尺寸查看，可横向滚动'
  const buttonLabel = document.createTextNode('原始尺寸')
  button.append(buttonLabel)
  controls.append(button)
  ;(document.body ?? document.documentElement).append(controls)
  const viewport = document.createElement('span')
  viewport.dataset.documentPngViewport = ''
  viewport.className = 'milkup-document-png-viewport'
  viewport.style.display = 'block'
  viewport.style.width = '100%'
  viewport.style.maxWidth = '100%'
  viewport.style.overflowX = 'auto'
  viewport.style.overflowY = 'hidden'
  viewport.tabIndex = -1
  viewport.setAttribute('role', 'group')
  viewport.setAttribute('aria-label', value.title ?? '图表')
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
  viewport.append(image)
  element.append(viewport)
  let state: OwnedDocumentSvgImage['state'] = 'pending'
  const attachControls = () => {
    const host = document.querySelector<HTMLElement>('#app')
    if (host) {
      if (controls.parentElement !== host) host.append(controls)
      return
    }
    if (!controls.isConnected) (document.body ?? document.documentElement).append(controls)
  }
  let url: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let released = false
  let natural = false
  let resize: ResizeObserver | undefined
  let layoutFrame: number | undefined
  const ownerWindow = document.defaultView
  const controlHeight = 28
  const syncControls = () => {
    attachControls()
    if (!element.isConnected || !controls.isConnected) return
    const rect = element.getBoundingClientRect()
    controls.style.left = `${rect.left}px`
    controls.style.top = `${rect.top}px`
  }
  const syncOnScroll = () => syncControls()
  ownerWindow?.addEventListener('scroll', syncOnScroll, true)
  const notifyLayout = () => {
    if (state !== 'decoded' || layoutFrame !== undefined || !ownerWindow) return
    layoutFrame = ownerWindow.requestAnimationFrame(() => {
      layoutFrame = undefined
      if (state === 'decoded' && element.isConnected) layoutChanged()
    })
  }
  const setNatural = (next: boolean) => {
    natural = next
    element.dataset.documentPngView = natural ? 'natural' : 'fit'
    image.style.width = natural ? `${value.width}px` : '100%'
    image.style.maxWidth = natural ? 'none' : '100%'
    viewport.tabIndex = natural ? 0 : -1
    viewport.setAttribute(
      'aria-label',
      natural ? `${value.title ?? '图表'}，原始尺寸，可横向滚动` : (value.title ?? '图表'),
    )
    button.title = natural ? '缩小图表以适应编辑区宽度' : '按原始尺寸查看，可横向滚动'
    // Update the existing text node: preview observers watch child replacement,
    // while this control changes only the current owned image's display.
    buttonLabel.data = natural ? '适应宽度' : '原始尺寸'
    if (!natural) viewport.scrollLeft = 0
    notifyLayout()
  }
  const measure = () => {
    if (state !== 'decoded' || !element.isConnected) return
    const width = element.getBoundingClientRect().width
    if (!Number.isFinite(width) || width <= 0) return
    const narrow = width + 0.5 < value.width
    if (!narrow && natural) setNatural(false)
    element.style.paddingTop = narrow ? `${controlHeight}px` : '0'
    if (controls.hidden === narrow) {
      if (!narrow && document.activeElement === button) viewport.focus({ preventScroll: true })
      controls.hidden = !narrow
    }
    syncControls()
    notifyLayout()
  }
  const stopControlEvent = (event: Event) => event.stopPropagation()
  const toggle = (event: Event) => {
    event.stopPropagation()
    if (state !== 'decoded' || controls.hidden) return
    setNatural(!natural)
  }
  // Some WebView2/WebDriver pointer sequences deliver pointerup/mouseup but
  // omit the compatibility click for a button nested in a contentEditable=false
  // preview. Treat the primary pointer release as activation and suppress the
  // duplicate click when the browser does provide one. Keyboard activation
  // still goes through the native click event.
  let pointerActivation = false
  let pointerActivationTimer: ReturnType<typeof setTimeout> | undefined
  const togglePointer = (event: Event) => {
    const eventButton = 'button' in event ? Number((event as { button?: number }).button) : 0
    if ((Number.isFinite(eventButton) && eventButton > 0) || pointerActivation) return
    pointerActivation = true
    clearTimeout(pointerActivationTimer)
    pointerActivationTimer = setTimeout(() => {
      pointerActivation = false
      pointerActivationTimer = undefined
    }, 1000)
    toggle(event)
  }
  const toggleClick = (event: Event) => {
    if (pointerActivation) {
      pointerActivation = false
      clearTimeout(pointerActivationTimer)
      pointerActivationTimer = undefined
      event.stopPropagation()
      return
    }
    toggle(event)
  }
  const toggleDocumentPointer = (event: Event) => {
    const target = event.target
    const directTarget = target instanceof Node && (target === button || button.contains(target))
    const point = event as MouseEvent
    const rect = button.getBoundingClientRect()
    const coordinateTarget =
      Number.isFinite(point.clientX) &&
      Number.isFinite(point.clientY) &&
      point.clientX >= rect.left &&
      point.clientX <= rect.right &&
      point.clientY >= rect.top &&
      point.clientY <= rect.bottom
    if (!directTarget && !coordinateTarget) return
    const eventButton = 'button' in event ? Number((event as { button?: number }).button) : 0
    if (Number.isFinite(eventButton) && eventButton > 0) return
    togglePointer(event)
  }
  // WebView2 can deliver the W3C sequence to the document capture path while
  // skipping the detached button's target listeners. Keep the host independent
  // from the preview hit tree and activate from that document-level path too.
  ownerWindow?.document.addEventListener('pointerdown', toggleDocumentPointer, true)
  ownerWindow?.document.addEventListener('pointerup', toggleDocumentPointer, true)
  ownerWindow?.document.addEventListener('mouseup', toggleDocumentPointer, true)
  // Preserve native focus, keyboard activation and scrollbar operation. These
  // controls must not select the Markdown source through the preview wrapper.
  const keepViewportEvent = (event: Event) => {
    if (event.target === viewport) event.stopPropagation()
  }
  for (const name of ['mousedown', 'pointerdown', 'pointerup', 'mouseup', 'keydown', 'keyup'])
    button.addEventListener(name, stopControlEvent)
  button.addEventListener('pointerup', togglePointer)
  button.addEventListener('mouseup', togglePointer)
  button.addEventListener('click', toggleClick)
  for (const name of ['mousedown', 'pointerdown', 'click'])
    viewport.addEventListener(name, keepViewportEvent)
  const cleanup = () => {
    if (released) return
    released = true
    clearTimeout(timer)
    clearTimeout(pointerActivationTimer)
    pointerActivation = false
    resize?.disconnect()
    ownerWindow?.removeEventListener('scroll', syncOnScroll, true)
    ownerWindow?.document.removeEventListener('pointerdown', toggleDocumentPointer, true)
    ownerWindow?.document.removeEventListener('pointerup', toggleDocumentPointer, true)
    ownerWindow?.document.removeEventListener('mouseup', toggleDocumentPointer, true)
    controls.remove()
    if (layoutFrame !== undefined) ownerWindow?.cancelAnimationFrame(layoutFrame)
    for (const name of ['mousedown', 'pointerdown', 'pointerup', 'mouseup', 'keydown', 'keyup'])
      button.removeEventListener(name, stopControlEvent)
    button.removeEventListener('pointerup', togglePointer)
    button.removeEventListener('mouseup', togglePointer)
    button.removeEventListener('click', toggleClick)
    for (const name of ['mousedown', 'pointerdown', 'click'])
      viewport.removeEventListener(name, keepViewportEvent)
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
      const Observer = ownerWindow?.ResizeObserver
      if (Observer) {
        resize = new Observer(measure)
        resize.observe(element)
      }
      measure()
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

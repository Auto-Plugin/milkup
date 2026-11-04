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
  controls.hidden = true
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.documentPngScale = ''
  button.className = 'milkup-document-png-scale'
  button.title = '按原始尺寸查看，可横向滚动'
  const buttonLabel = document.createTextNode('原始尺寸')
  button.append(buttonLabel)
  controls.append(button)
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
  element.append(controls, viewport)
  let state: OwnedDocumentSvgImage['state'] = 'pending'
  let url: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let released = false
  let natural = false
  // A natural-size toggle changes the observed geometry. Ignore the first
  // ResizeObserver pass caused by that style change; only later external
  // resizes may collapse natural mode back to fit.
  let ignoreNaturalMeasure = false
  let resize: ResizeObserver | undefined
  let layoutFrame: number | undefined
  const ownerWindow = document.defaultView
  const notifyLayout = () => {
    if (state !== 'decoded' || layoutFrame !== undefined || !ownerWindow) return
    layoutFrame = ownerWindow.requestAnimationFrame(() => {
      layoutFrame = undefined
      if (state === 'decoded' && element.isConnected) layoutChanged()
    })
  }
  const debugEvent = (name: string) => {
    const current = button.dataset.documentPngDebug ? button.dataset.documentPngDebug.split(',') : []
    current.push(name)
    button.dataset.documentPngDebug = current.slice(-12).join(',')
  }
  const setNatural = (next: boolean) => {
    debugEvent(`set:${next ? 'natural' : 'fit'}`)
    natural = next
    if (next) ignoreNaturalMeasure = true
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
    debugEvent('measure')
    if (state !== 'decoded' || !element.isConnected) return
    const width = element.getBoundingClientRect().width
    if (!Number.isFinite(width) || width <= 0) return
    const narrow = width + 0.5 < value.width
    const ignoreNaturalReset = ignoreNaturalMeasure
    ignoreNaturalMeasure = false
    if (!narrow && natural && !ignoreNaturalReset) setNatural(false)
    if (controls.hidden === narrow) {
      if (!narrow && document.activeElement === button) viewport.focus({ preventScroll: true })
      controls.hidden = !narrow
    }
    notifyLayout()
  }
  const stopControlEvent = (event: Event) => event.stopPropagation()
  const toggle = (event: Event) => {
    debugEvent('toggle')
    event.stopPropagation()
    if (state !== 'decoded' || controls.hidden) return
    setNatural(!natural)
  }
  // Some WebView2/WebDriver pointer sequences deliver pointer/mouse down or
  // release events but omit the compatibility click for a button nested in a
  // contentEditable=false preview. Treat the first primary mouse event as
  // activation and suppress the duplicate release/click when the browser does
  // provide them. Keyboard activation still goes through the native click event.
  let pointerActivation = false
  let pointerActivationTimer: ReturnType<typeof setTimeout> | undefined
  const togglePointer = (event: Event) => {
    const button = 'button' in event ? Number((event as { button?: number }).button) : 0
    if (button !== 0 || pointerActivation) return
    pointerActivation = true
    clearTimeout(pointerActivationTimer)
    pointerActivationTimer = setTimeout(() => {
      pointerActivation = false
      pointerActivationTimer = undefined
    }, 1000)
    toggle(event)
  }
  const handlePointer = (event: Event) => {
    debugEvent(`pointer:${event.type}`)
    event.stopPropagation()
    togglePointer(event)
  }
  const isButtonEvent = (event: Event) => event.composedPath().includes(button)
  const capturePointer = (event: Event) => {
    if (isButtonEvent(event)) handlePointer(event)
  }
  const captureClick = (event: Event) => {
    debugEvent(`capture-click:${event.type}`)
    if (isButtonEvent(event)) {
      toggleClick(event)
      event.stopPropagation()
    }
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
  // Preserve native focus, keyboard activation and scrollbar operation. These
  // controls must not select the Markdown source through the preview wrapper.
  const keepViewportEvent = (event: Event) => {
    if (event.target === viewport) event.stopPropagation()
  }
  for (const name of ['keydown', 'keyup']) button.addEventListener(name, stopControlEvent)
  for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    button.addEventListener(name, handlePointer)
    document.addEventListener(name, capturePointer, true)
  }
  button.addEventListener('click', toggleClick)
  document.addEventListener('click', captureClick, true)
  for (const name of ['mousedown', 'pointerdown', 'click'])
    viewport.addEventListener(name, keepViewportEvent)
  const cleanup = () => {
    if (released) return
    released = true
    clearTimeout(timer)
    clearTimeout(pointerActivationTimer)
    pointerActivation = false
    resize?.disconnect()
    if (layoutFrame !== undefined) ownerWindow?.cancelAnimationFrame(layoutFrame)
    for (const name of ['keydown', 'keyup']) button.removeEventListener(name, stopControlEvent)
    for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      button.removeEventListener(name, handlePointer)
      document.removeEventListener(name, capturePointer, true)
    }
    button.removeEventListener('click', toggleClick)
    document.removeEventListener('click', captureClick, true)
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

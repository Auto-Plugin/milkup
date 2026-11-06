import {
  acquireDocumentPngImage,
  type DocumentPngImage,
} from '@milkup/core/internal/document-png-image'
import { imageDecodeDeadlineMs, type OwnedDocumentSvgImage } from './document-svg-image'

let pngInstanceSequence = 0
const pngTraces = new WeakMap<Document, object[]>()

/** Host-private inert PNG: it never accepts a URL, HTML or a plugin object. */
export function createOwnedDocumentPngImage(
  document: Document,
  value: DocumentPngImage,
  changed: () => void,
  layoutChanged: () => void = () => {},
): OwnedDocumentSvgImage {
  const instance = ++pngInstanceSequence
  const trace = (kind: string, detail: object = {}) => {
    const rows = pngTraces.get(document) ?? []
    rows.push({ at: document.defaultView?.performance.now(), instance, kind, ...detail })
    if (rows.length > 100) rows.shift()
    pngTraces.set(document, rows)
    document.documentElement.dataset.documentPngTrace = JSON.stringify(rows)
  }
  trace('create')
  const lease = acquireDocumentPngImage(value)
  const element = document.createElement('span')
  element.style.display = 'inline-block'
  element.style.width = `${value.width}px`
  element.style.height = 'auto'
  element.style.maxWidth = '100%'
  element.style.verticalAlign = 'middle'
  element.contentEditable = 'false'
  element.dataset.documentPngView = 'fit'
  element.dataset.documentPngInstance = String(instance)
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
  button.dataset.documentPngClickCount = '0'
  button.dataset.documentPngToggleCount = '0'
  button.dataset.documentPngLastEvent = 'init'
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
  let savedScrollLeft = 0
  let measuredWidth: number | undefined
  let resize: ResizeObserver | undefined
  let layoutFrame: number | undefined
  const ownerWindow = document.defaultView
  const controlHeight = 28
  const syncControls = () => {
    attachControls()
    if (!element.isConnected || !controls.isConnected) {
      controls.hidden = true
      return
    }
    controls.hidden =
      state !== 'decoded' || element.getBoundingClientRect().width >= value.width - 1
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
    trace('setNatural', { before: natural, next })
    natural = next
    button.dataset.documentPngToggleCount = String(
      Number(button.dataset.documentPngToggleCount ?? 0) + 1,
    )
    button.dataset.documentPngLastEvent = next ? 'natural' : 'fit'
    element.dataset.documentPngView = natural ? 'natural' : 'fit'
    // Keep the layout box constrained while the raster itself uses intrinsic
    // pixels. Otherwise the box can briefly expand to the raster width and
    // the ResizeObserver below interprets the explicit toggle as a resize
    // back to fit mode.
    element.style.width = natural ? '100%' : `${value.width}px`
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
    if (!natural) {
      savedScrollLeft = 0
      viewport.scrollLeft = 0
    }
    notifyLayout()
  }
  const measure = () => {
    if (state !== 'decoded' || !element.isConnected) return
    const width = element.getBoundingClientRect().width
    if (!Number.isFinite(width) || width <= 0) return
    const narrow = width + 0.5 < value.width
    trace('measure', { width, previousWidth: measuredWidth, narrow, natural })
    const resized = measuredWidth !== undefined && Math.abs(width - measuredWidth) > 0.5
    // A natural toggle may itself trigger one resize callback. Only collapse
    // back to fit after a later real container resize, which changes the
    // measured outer width again.
    if (!narrow && natural && resized) setNatural(false)
    measuredWidth = width
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
    trace('toggle', { event: event.type, state, hidden: controls.hidden, natural })
    if (state !== 'decoded' || controls.hidden) return
    setNatural(!natural)
  }
  // Keep pointer activation from moving editor focus and invalidating the
  // decoded preview owner before click. Keyboard activation remains native.
  const preservePointerFocus = (event: MouseEvent) => {
    if (event.button === 0) event.preventDefault()
    event.stopPropagation()
  }
  const toggleClick = (event: Event) => {
    button.dataset.documentPngClickCount = String(
      Number(button.dataset.documentPngClickCount ?? 0) + 1,
    )
    toggle(event)
  }
  button.addEventListener('mousedown', preservePointerFocus)
  // Preserve native focus, keyboard activation and scrollbar operation. These
  // controls must not select the Markdown source through the preview wrapper.
  const keepViewportEvent = (event: Event) => {
    if (event.target === viewport) event.stopPropagation()
  }
  for (const name of ['mousedown', 'pointerdown', 'pointerup', 'mouseup', 'keydown', 'keyup'])
    button.addEventListener(name, stopControlEvent)
  button.addEventListener('click', toggleClick)
  for (const name of ['mousedown', 'pointerdown', 'click'])
    viewport.addEventListener(name, keepViewportEvent)
  const traceInput = (event: Event) => {
    const point = event as MouseEvent
    const rect = button.getBoundingClientRect()
    if (!element.isConnected || controls.hidden) return
    const describe = (target: EventTarget | null) =>
      target instanceof Element
        ? `${target.tagName}.${target.className}`.slice(0, 160)
        : String(target)
    trace('input', {
      type: event.type,
      phase: event.currentTarget === ownerWindow ? 'window' : 'document',
      target: describe(event.target),
      path: event.composedPath().slice(0, 8).map(describe),
      x: point.clientX,
      y: point.clientY,
      isTrusted: event.isTrusted,
      defaultPrevented: event.defaultPrevented,
      buttonRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    })
  }
  const inputEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']
  for (const name of inputEvents) {
    ownerWindow?.addEventListener(name, traceInput, true)
    document.addEventListener(name, traceInput, true)
  }
  const cleanup = () => {
    if (released) return
    trace('cleanup', { state, natural })
    for (const name of inputEvents) {
      ownerWindow?.removeEventListener(name, traceInput, true)
      document.removeEventListener(name, traceInput, true)
    }
    released = true
    clearTimeout(timer)
    resize?.disconnect()
    ownerWindow?.removeEventListener('scroll', syncOnScroll, true)
    controls.remove()
    if (layoutFrame !== undefined) ownerWindow?.cancelAnimationFrame(layoutFrame)
    for (const name of ['mousedown', 'pointerdown', 'pointerup', 'mouseup', 'keydown', 'keyup'])
      button.removeEventListener(name, stopControlEvent)
    button.removeEventListener('click', toggleClick)
    button.removeEventListener('mousedown', preservePointerFocus)
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
      const timing = ownerWindow?.performance
      if (timing?.mark && !timing.getEntriesByName('milkup:preview:first-decoded').length)
        timing.mark('milkup:preview:first-decoded')
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
    captureViewState() {
      if (element.isConnected) savedScrollLeft = viewport.scrollLeft
    },
    syncVisibility() {
      syncControls()
      // Native DOM removal resets scrolling even when the decoded image survives.
      // Restore only after the owner has its final parent and measurable viewport.
      if (element.isConnected) viewport.scrollLeft = savedScrollLeft
    },
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

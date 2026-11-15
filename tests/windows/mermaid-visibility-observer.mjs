// Read-only rAF evidence. This is layout visibility, not compositor/physical paint.
// Self-contained so the exact function runs in both WebDriver and the local probe.
export function observeMermaidVisibility({
  from,
  to,
  scenario,
  expectedDocument,
  maxMs = 60000,
  maxFrames = 3600,
}) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from)
    throw Error('Exact fence range required')
  if (!['document-open', 'cold-entry', 'prefetch-ready'].includes(scenario))
    throw Error('Explicit scenario required')
  if (!(maxMs > 0 && maxMs <= 60000 && maxFrames > 0 && maxFrames <= 3600))
    throw Error('Bounded observation required')
  if (
    expectedDocument !== undefined &&
    (typeof expectedDocument !== 'string' ||
      !expectedDocument.length ||
      expectedDocument.length > 32768)
  )
    throw Error('Bounded expected document path required')
  const normalizePath = (value) => value?.replaceAll('\\', '/').toLowerCase()
  const begun = performance.now()
  const report = {
    version: 1,
    scenario,
    from,
    to,
    timeOrigin: performance.timeOrigin,
    begun,
    expectedDocument: expectedDocument ?? null,
    documentMatchedAt: null,
    waitingDocumentFrames: 0,
    firstVisible: null,
    decoded: null,
    decodedAtFirstSample: false,
    sourceFirstVisible: null,
    sourceLastVisible: null,
    sourceVisibleFrames: 0,
    pendingVisibleFrames: 0,
    pendingFirstVisible: null,
    pendingLastVisible: null,
    samples: 0,
    maxSampleGapMs: 0,
    transitions: [],
    overflow: false,
    complete: false,
    stopReason: null,
    limitation: 'rAF layout samples; not exact paint; overlays and sub-frame flashes not proven',
  }
  let previousAt = begun,
    previousState,
    frame,
    timer
  // Clip against every scrolling/hidden ancestor, not only the desktop viewport.
  // Hidden source lines keep geometry in some browser layouts; inspect styles too.
  const visible = (element, rects = element?.getClientRects()) => {
    if (!element?.isConnected || document.visibilityState !== 'visible') return false
    let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (
        style.display === 'none' ||
        ['hidden', 'collapse'].includes(style.visibility) ||
        Number(style.opacity) === 0 ||
        style.contentVisibility === 'hidden' ||
        ancestor.hidden
      )
        return false
      if (ancestor === element) continue
      const box = ancestor.getBoundingClientRect()
      const left = box.left + ancestor.clientLeft,
        top = box.top + ancestor.clientTop
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, left)
        clip.right = Math.min(clip.right, left + ancestor.clientWidth)
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, top)
        clip.bottom = Math.min(clip.bottom, top + ancestor.clientHeight)
      }
    }
    return [...rects].some(
      (box) =>
        Math.min(box.right, clip.right) > Math.max(box.left, clip.left) &&
        Math.min(box.bottom, clip.bottom) > Math.max(box.top, clip.top),
    )
  }
  const stop = (reason) => {
    if (report.stopReason) return report
    report.stopReason = reason
    report.ended = performance.now()
    report.complete = reason === 'decoded' && !report.overflow
    cancelAnimationFrame(frame)
    clearTimeout(timer)
    return report
  }
  // Milkup mounts a preview INSIDE the first source-line host. The host's
  // rectangle cannot distinguish actual source from its replacement diagram.
  const sourceTextVisible = (line) => {
    let visited = 0
    const walk = (node) => {
      if (++visited > 4096) {
        report.overflow = true
        return false
      }
      if (node.nodeType === 3) {
        if (!node.textContent.trim()) return false
        const range = document.createRange()
        range.selectNodeContents(node)
        return visible(node.parentElement, range.getClientRects())
      }
      if (node.nodeType !== 1 || node.matches('[data-document-presentation],.milkup-marker-hidden'))
        return false
      return [...node.childNodes].some(walk)
    }
    return walk(line)
  }
  const sample = () => {
    if (report.stopReason) return
    const now = performance.now()
    if (expectedDocument !== undefined) {
      const text = (selector) => document.querySelector(selector)?.textContent ?? null
      const currentPath =
        text('[data-stat="path"]') ?? text('[data-title-path]') + '/' + text('[data-title]') + '.md'
      if (
        document.querySelector('#app')?.dataset.loading !== 'ready' ||
        normalizePath(currentPath) !== normalizePath(expectedDocument)
      ) {
        report.waitingDocumentFrames++
        if (report.documentMatchedAt !== null) return stop('document-changed')
        if (report.waitingDocumentFrames >= maxFrames) return stop('frame-budget')
        if (now - begun >= maxMs) return stop('deadline')
        previousAt = now
        frame = requestAnimationFrame(sample)
        return
      }
    }
    report.documentMatchedAt ??= now
    report.maxSampleGapMs = Math.max(report.maxSampleGapMs, now - previousAt)
    previousAt = now
    report.samples++
    const editor = document.querySelector('.milkup-editor')
    const block = editor?.querySelector('[data-presentation-from="' + from + '"]')
    const image = block?.querySelector('img')
    const lines = editor ? [...editor.querySelectorAll('.milkup-line[data-from][data-to]')] : []
    const source = lines.some(
      (line) =>
        Number(line.dataset.from) < to &&
        Number(line.dataset.to) > from &&
        !line.classList.contains('milkup-marker-hidden') &&
        sourceTextVisible(line),
    )
    const pending = block?.dataset?.presentationPending === 'true' && visible(block)
    if (pending) {
      report.pendingVisibleFrames++
      report.pendingFirstVisible ??= now
      report.pendingLastVisible = now
    }
    const imageVisible = visible(image)
    const decoded =
      imageVisible && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
    const inView = source || visible(block) || imageVisible
    if (inView && report.firstVisible === null) report.firstVisible = now
    if (source) {
      report.sourceFirstVisible ??= now
      report.sourceLastVisible = now
      report.sourceVisibleFrames++
    }
    const state = [source, pending, inView, decoded, document.visibilityState].join(':')
    if (state !== previousState) {
      previousState = state
      if (report.transitions.length === 64) report.overflow = true
      else
        report.transitions.push({
          at: now,
          source,
          pending,
          inView,
          decoded,
          documentVisibility: document.visibilityState,
        })
    }
    if (decoded && document.visibilityState === 'visible') {
      report.decodedAtFirstSample = report.samples === 1
      report.decoded = now
      stop('decoded')
    } else if (report.samples + report.waitingDocumentFrames >= maxFrames) stop('frame-budget')
    else if (now - begun >= maxMs) stop('deadline')
    else frame = requestAnimationFrame(sample)
  }
  timer = setTimeout(() => stop('deadline'), maxMs)
  frame = requestAnimationFrame(sample)
  return { report, stop: () => stop('stopped') }
}

export const mermaidVisibilityScript = `
const key=arguments[0].scenario === 'document-open' ? '__mermaidInitialVisibilityProbe' : '__mermaidVisibilityProbe';
window[key]?.stop();
window[key]=(${observeMermaidVisibility.toString()})(arguments[0]);
return window[key].report;`

import {
  copyDocumentPresentationRequest,
  copyDocumentPresentationAggregate,
  type DocumentRendererDeclaration,
  copyDocumentPresentationNode,
  DOCUMENT_PRESENTATION_LIMITS,
  type DocumentPresentationRequest,
  type DocumentPresentationResult,
  type DocumentPresentationNode,
  type DocumentPresentationFragment,
  type DocumentMathNode,
} from '@milkup/core'

export interface DocumentPresentationWindow {
  readonly sourceIdentity: object
  readonly sourceVersion: number
  /** Actual store revision, separate from the view's optimistic render generation. */
  readonly documentVersion?: number
  readonly source: string
  readonly from: number
  readonly to: number
  readonly fromLine: number
  readonly toLine: number
  readonly completeStart: boolean
  readonly completeEnd: boolean
  readonly selection: { readonly anchor: number; readonly head: number }
  readonly width: number
}
export interface DocumentPresentationResponse {
  readonly request: DocumentPresentationRequest
  readonly declarations: readonly DocumentRendererDeclaration[]
  readonly result: DocumentPresentationResult
}
export type DocumentPresentationTarget = Extract<
  DocumentPresentationNode,
  { type: 'reference' }
>['target']
export interface DocumentPresentationConfig {
  readonly provide: (
    window: DocumentPresentationWindow,
    options: { readonly signal: AbortSignal },
  ) => Promise<DocumentPresentationResponse> | DocumentPresentationResponse
  readonly onNavigate?: (target: DocumentPresentationTarget) => void | Promise<void>
}
export interface PresentationSnapshot {
  readonly mode: 'live' | 'source'
  readonly sourceIdentity: object
  readonly sourceVersion: number
  readonly documentVersion?: number
  readonly selection: { readonly anchor: number; readonly head: number }
  readonly lineCount: number
  readonly read: (from: number, to: number) => string | undefined
}

const mathNS = 'http://www.w3.org/1998/Math/MathML'
const svgNS = 'http://www.w3.org/2000/svg'
const referenceTargets = new WeakMap<HTMLElement, DocumentPresentationTarget>()
// Includes trusted window/context I/O. Plugin execution has its own 2s worker watchdog.
const hostPreparationDeadlineMs = 10_000
const tones = {
  foreground: 'currentColor',
  muted: 'var(--milkup-presentation-muted, currentColor)',
  accent: 'var(--milkup-presentation-accent, currentColor)',
  background: 'var(--milkup-presentation-background, transparent)',
  border: 'var(--milkup-presentation-border, currentColor)',
  none: 'none',
}

/** Validate first; never parse plugin HTML, SVG strings, CSS, URLs or DOM. */
export function createDocumentPresentationNode(
  document: Document,
  value: DocumentPresentationNode,
  navigate?: (target: DocumentPresentationTarget) => void,
): Node {
  const root = copyDocumentPresentationNode(value)
  function math(node: DocumentMathNode): Element {
    const element = document.createElementNS(mathNS, node.tag)
    if (node.text !== undefined) element.textContent = node.text
    const names: Record<string, string> = {
      display: 'display',
      mathvariant: 'mathvariant',
      stretchy: 'stretchy',
      fence: 'fence',
      separator: 'separator',
      accent: 'accent',
      scriptLevel: 'scriptlevel',
      displayStyle: 'displaystyle',
      rowSpacingEm: 'rowspacing',
      columnSpacingEm: 'columnspacing',
      columnAlign: 'columnalign',
      widthEm: 'width',
      lspaceEm: 'lspace',
      rspaceEm: 'rspace',
    }
    for (const [key, value] of Object.entries(node.attributes ?? {})) {
      const name = names[key]
      if (!name) throw new Error('Unsupported MathML attribute')
      element.setAttribute(
        name,
        Array.isArray(value)
          ? value.map((item) => `${item}${key.endsWith('Em') ? 'em' : ''}`).join(' ')
          : `${value}${key.endsWith('Em') ? 'em' : ''}`,
      )
    }
    for (const child of node.children ?? []) element.append(math(child))
    return element
  }
  function build(node: DocumentPresentationNode): Node {
    if (node.type === 'text') return document.createTextNode(node.text)
    if (node.type === 'math') return math(node.tree)
    if (node.type === 'reference') {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'milkup-document-reference'
      button.textContent = node.label
      referenceTargets.set(button, node.target)
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        navigate?.(node.target)
      })
      return button
    }
    if (node.type === 'vector') {
      const svg = document.createElementNS(svgNS, 'svg')
      svg.setAttribute('viewBox', `0 0 ${node.width} ${node.height}`)
      svg.setAttribute('width', String(node.width))
      svg.setAttribute('height', String(node.height))
      svg.style.maxWidth = 'none'
      svg.style.display = 'block'
      for (const primitive of node.children) {
        const element = document.createElementNS(svgNS, primitive.type)
        for (const [key, value] of Object.entries(primitive)) {
          if (key === 'type') continue
          if (key === 'text') element.textContent = String(value)
          else if (key === 'points')
            element.setAttribute(
              'points',
              (value as readonly { x: number; y: number }[])
                .map((point) => `${point.x},${point.y}`)
                .join(' '),
            )
          else if (key === 'stroke' || key === 'fill' || key === 'tone')
            element.setAttribute(key === 'tone' ? 'fill' : key, tones[value as keyof typeof tones])
          else
            element.setAttribute(
              (
                {
                  radius: 'rx',
                  strokeWidth: 'stroke-width',
                  fontSize: 'font-size',
                  anchor: 'text-anchor',
                } as Record<string, string>
              )[key] ?? key,
              String(value),
            )
        }
        if (primitive.type !== 'text' && !('fill' in primitive))
          element.setAttribute('fill', 'none')
        svg.append(element)
      }
      return svg
    }
    const element = document.createElement(
      ({ group: 'span', emphasis: 'em', code: 'code', sup: 'sup', sub: 'sub' } as const)[node.type],
    )
    for (const child of node.children) element.append(build(child))
    return element
  }
  return build(root)
}

interface SavedLine {
  readonly nodes: readonly Node[]
  readonly display: string
  readonly minHeight: string
}
interface Job {
  readonly key: string
  readonly identity: object
  readonly controller: AbortController
  readonly epoch: number
  readonly selection: { readonly anchor: number; readonly head: number }
  preparationTimedOut?: boolean
}

/** One manager for both views. Source DOM is retained, never edited as document data. */
export class DocumentPresentation {
  private config: DocumentPresentationConfig | undefined
  private epoch = 0
  private stopped = false
  private painting = false
  private scheduled = false
  private job: Job | undefined
  private cache:
    { key: string; identity: object; response: DocumentPresentationResponse } | undefined
  private painted:
    | { response: DocumentPresentationResponse; selection: string; lines: readonly Element[] }
    | undefined
  private failedKey: string | undefined
  private retryAfter = 0
  private preparationRetry:
    { timer: ReturnType<typeof setTimeout>; matches: () => boolean } | undefined
  private observedIdentity: object | undefined
  private observedVersion: number | undefined
  private notice: HTMLDivElement | undefined
  private blocks: readonly { fromLine: number; toLine: number }[] = []
  private blocksIdentity: object | undefined
  private blocksVersion: number | undefined
  private readonly saved = new Map<HTMLElement, SavedLine>()
  private readonly observer: MutationObserver
  private readonly resize: ResizeObserver | undefined
  private readonly scroll = () => this.schedule()
  private tabOrigin: { event: KeyboardEvent; element: HTMLElement } | undefined
  private tabOriginTimer: ReturnType<typeof setTimeout> | undefined
  private proxyNavigation: { element: HTMLElement; snapshot: PresentationSnapshot } | undefined
  private readonly clearProxyNavigation = () => {
    this.tabOrigin = undefined
    this.proxyNavigation = undefined
    clearTimeout(this.tabOriginTimer)
    this.tabOriginTimer = undefined
  }
  private readonly navigationKeyDown = (event: KeyboardEvent) => {
    const tab = event.key === 'Tab' || (event.key === 'Unidentified' && event.code === 'Tab')
    // Shift itself precedes native Shift+Tab; it does not end keyboard navigation.
    if (event.key === 'Shift' && !event.altKey && !event.ctrlKey && !event.metaKey) return
    if (
      tab &&
      event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.target === this.root.querySelector('.milkup-input-proxy')
    )
      return
    this.clearProxyNavigation()
    if (
      tab &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.target instanceof HTMLElement &&
      event.target.closest('[data-document-presentation]') &&
      this.content.contains(event.target)
    ) {
      this.tabOrigin = { event, element: event.target }
      // Only the native focus move belonging to this key event may establish it.
      this.tabOriginTimer = setTimeout(() => {
        this.tabOrigin = undefined
      }, 0)
    }
  }
  private readonly navigationFocusIn = (event: FocusEvent) => {
    const origin = this.tabOrigin
    this.clearProxyNavigation()
    if (
      origin &&
      !origin.event.defaultPrevented &&
      origin.element.isConnected &&
      event.relatedTarget === origin.element &&
      event.target === this.root.querySelector('.milkup-input-proxy')
    )
      this.proxyNavigation = { element: origin.element, snapshot: this.snapshot() }
  }
  private readonly navigationFocusOut = (event: FocusEvent) => {
    if (event.target === this.root.querySelector('.milkup-input-proxy')) this.clearProxyNavigation()
  }

  constructor(
    private readonly root: HTMLElement,
    private readonly content: HTMLElement,
    config: DocumentPresentationConfig | undefined,
    private readonly snapshot: () => PresentationSnapshot,
    private readonly layout: () => void,
    private readonly reveal: (from: number, to: number) => void,
  ) {
    this.config = config
    this.observer = new MutationObserver(() => this.schedule())
    this.observe()
    this.resize =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            if (!this.stopped) {
              this.layout()
              this.schedule()
            }
          })
    this.resize?.observe(root)
    this.root.addEventListener('scroll', this.scroll)
    this.root.addEventListener('keydown', this.navigationKeyDown, true)
    this.root.addEventListener('focusin', this.navigationFocusIn)
    this.root.addEventListener('focusout', this.navigationFocusOut)
    for (const name of ['pointerdown', 'beforeinput', 'input', 'compositionstart'])
      this.root.addEventListener(name, this.clearProxyNavigation, true)
  }
  /** Let the browser reverse the immediately preceding preview-to-proxy Tab. */
  returnToPreviewWithTab(event: KeyboardEvent): boolean {
    if (event.key !== 'Tab' && !(event.key === 'Unidentified' && event.code === 'Tab')) return false
    const navigation = this.proxyNavigation
    if (!navigation) return false
    this.clearProxyNavigation()
    const current = this.snapshot(),
      before = navigation.snapshot
    return (
      (event.key === 'Tab' || (event.key === 'Unidentified' && event.code === 'Tab')) &&
      event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.isComposing &&
      event.target === this.root.querySelector('.milkup-input-proxy') &&
      this.content.contains(navigation.element) &&
      current.mode === 'live' &&
      current.sourceIdentity === before.sourceIdentity &&
      current.sourceVersion === before.sourceVersion &&
      sameSelection(current.selection, before.selection)
    )
  }
  private observe(): void {
    this.observer.observe(this.content, { childList: true, subtree: true })
  }
  setConfig(config: DocumentPresentationConfig | undefined): void {
    this.config = config
    this.invalidate()
  }
  expandLineWindow(fromLine: number, toLine: number): { fromLine: number; toLine: number } {
    const snapshot = this.snapshot()
    if (
      snapshot.sourceIdentity !== this.blocksIdentity ||
      snapshot.sourceVersion !== this.blocksVersion
    )
      return { fromLine, toLine }
    for (const block of this.blocks)
      if (fromLine <= block.toLine && toLine >= block.fromLine) {
        fromLine = Math.min(fromLine, block.fromLine)
        toLine = Math.max(toLine, block.toLine)
      }
    return { fromLine, toLine }
  }
  /** Refresh provider data without withdrawing an unchanged, validated presentation. */
  refresh(): void {
    this.cancelPreparationRetry()
    const current = this.snapshot()
    if (
      !this.config ||
      current.mode !== 'live' ||
      !this.cache ||
      this.cache.identity !== current.sourceIdentity ||
      !this.cache.key.startsWith(`${current.sourceVersion}:`) ||
      !sameSelection(this.cache.response.request.selection, current.selection)
    ) {
      this.invalidate()
      return
    }
    this.epoch++
    this.job?.controller.abort()
    this.job = undefined
    this.failedKey = undefined
    this.schedule()
  }
  invalidate(): void {
    this.cancelPreparationRetry()
    this.epoch++
    this.job?.controller.abort()
    this.job = undefined
    this.cache = undefined
    this.failedKey = undefined
    this.blocks = []
    this.restore()
    this.layout()
    this.schedule()
  }
  destroy(): void {
    this.cancelPreparationRetry()
    this.clearProxyNavigation()
    this.stopped = true
    this.job?.controller.abort()
    this.observer.disconnect()
    this.resize?.disconnect()
    this.root.removeEventListener('scroll', this.scroll)
    this.root.removeEventListener('keydown', this.navigationKeyDown, true)
    this.root.removeEventListener('focusin', this.navigationFocusIn)
    this.root.removeEventListener('focusout', this.navigationFocusOut)
    for (const name of ['pointerdown', 'beforeinput', 'input', 'compositionstart'])
      this.root.removeEventListener(name, this.clearProxyNavigation, true)
    this.restore()
    this.cache = undefined
  }
  schedule(): void {
    if (this.stopped || this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (!this.stopped) this.sync()
    })
  }
  /** Called before cursor/selection geometry, including optimistic edits. */
  selectionChanged(): void {
    if (this.painting || this.stopped) return
    if (!this.config && !this.saved.size && !this.job) return
    const current = this.snapshot()
    if (this.preparationRetry && !this.preparationRetry.matches()) this.cancelPreparationRetry()
    if (this.job && !sameSelection(this.job.selection, current.selection)) {
      this.job.controller.abort()
      this.job = undefined
    }
    if (
      current.mode !== 'live' ||
      !this.config ||
      (this.cache &&
        (this.cache.identity !== current.sourceIdentity ||
          !this.cache.key.startsWith(`${current.sourceVersion}:`) ||
          !sameSelection(this.cache.response.request.selection, current.selection)))
    ) {
      this.restore()
      this.schedule()
      return
    }
    if (this.cache) this.paint(this.cache.response)
    this.schedule()
  }
  private window(current: PresentationSnapshot): DocumentPresentationWindow | undefined {
    const children = this.content.children
    if (!children.length) return undefined
    const rect = this.root.getBoundingClientRect()
    let low = 0,
      high = children.length - 1
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      const candidate = children[mid] as HTMLElement
      const measured = candidate.dataset.presentationOwner
        ? (this.content.querySelector<HTMLElement>(
            `.milkup-line[data-line="${candidate.dataset.presentationOwner}"]`,
          ) ?? candidate)
        : candidate
      if (measured.getBoundingClientRect().bottom < rect.top) low = mid + 1
      else high = mid
    }
    const lines: HTMLElement[] = []
    for (
      let index = Math.max(0, low - 12);
      index < children.length && lines.length < DOCUMENT_PRESENTATION_LIMITS.inputLines;
      index++
    ) {
      const line = children[index] as HTMLElement
      if (!line.classList.contains('milkup-line')) continue
      if (lines.length > 24 && line.getBoundingClientRect().top > rect.bottom + 600) break
      if (
        Number(line.dataset.to) - Number(lines[0]?.dataset.from ?? line.dataset.from) >
        DOCUMENT_PRESENTATION_LIMITS.inputUtf16
      )
        break
      lines.push(line)
    }
    const first = lines[0],
      last = lines.at(-1)
    if (!first || !last) return undefined
    const from = Number(first.dataset.from),
      to = Number(last.dataset.to)
    const source = current.read(from, to)
    if (
      source === undefined ||
      source.length !== to - from ||
      source.length > DOCUMENT_PRESENTATION_LIMITS.inputUtf16
    )
      return undefined
    return {
      sourceIdentity: current.sourceIdentity,
      sourceVersion: current.sourceVersion,
      ...(current.documentVersion === undefined
        ? {}
        : { documentVersion: current.documentVersion }),
      source,
      from,
      to,
      fromLine: Number(first.dataset.line),
      toLine: Number(last.dataset.line),
      completeStart: from === 0,
      completeEnd: Number(last.dataset.line) === current.lineCount,
      selection: { anchor: current.selection.anchor, head: current.selection.head },
      width: Math.min(8192, Math.max(1, this.content.clientWidth || this.root.clientWidth || 800)),
    }
  }
  private sync(): void {
    const current = this.snapshot()
    if (this.preparationRetry && !this.preparationRetry.matches()) this.cancelPreparationRetry()
    if (
      this.observedIdentity !== current.sourceIdentity ||
      this.observedVersion !== current.sourceVersion
    ) {
      this.observedIdentity = current.sourceIdentity
      this.observedVersion = current.sourceVersion
      this.failedKey = undefined
      this.cache = undefined
    }
    if (!this.config || current.mode !== 'live') {
      this.job?.controller.abort()
      this.job = undefined
      if (this.saved.size || this.painted || this.notice) this.restore()
      return
    }
    const window = this.window(current)
    if (!window) {
      if (this.saved.size || this.painted) this.restore()
      this.fallback('当前源码范围超出预览预算，保留 Markdown 源码。')
      return
    }
    const key = `${current.sourceVersion}:${window.from}:${window.to}:${window.width}:${this.epoch}:${window.selection.anchor}:${window.selection.head}`
    if (this.cache?.key === key && this.cache.identity === current.sourceIdentity) {
      this.paint(this.cache.response)
      return
    }
    if (this.failedKey === key && Date.now() < this.retryAfter) return
    if (
      this.job?.key === key &&
      this.job.identity === current.sourceIdentity &&
      (!this.job.controller.signal.aborted || this.job.preparationTimedOut)
    )
      return
    this.cancelPreparationRetry()
    this.job?.controller.abort()
    // A viewport refresh does not invalidate already validated source or navigation.
    // Keep those nodes usable while the replacement window is prepared.
    if (
      !this.cache ||
      this.cache.identity !== current.sourceIdentity ||
      !this.cache.key.startsWith(`${current.sourceVersion}:`) ||
      !sameSelection(this.cache.response.request.selection, current.selection)
    ) {
      this.restore()
      this.cache = undefined
    }
    const job: Job = {
      key,
      identity: current.sourceIdentity,
      controller: new AbortController(),
      epoch: this.epoch,
      selection: window.selection,
    }
    this.job = job
    const timeout = setTimeout(() => {
      if (this.valid(job)) {
        job.preparationTimedOut = true
        this.failedKey = key
        this.retryAfter = Date.now() + 1000
        job.controller.abort()
        this.cache = undefined
        this.restore()
        this.layout()
        this.fallback('预览超时，保留 Markdown 源码。')
      }
    }, hostPreparationDeadlineMs)
    job.controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true })
    const config = this.config
    void Promise.resolve()
      .then(() => config.provide(window, { signal: job.controller.signal }))
      .then((response) => {
        if (!this.valid(job)) return
        const request = copyDocumentPresentationRequest(response.request)
        if (
          request.from !== window.from ||
          request.to !== window.to ||
          request.source !== window.source ||
          !sameSelection(request.selection, window.selection)
        )
          throw new Error('Presentation source changed')
        const result = copyDocumentPresentationAggregate(
          response.result,
          request,
          response.declarations,
        )
        this.cache = {
          key,
          identity: current.sourceIdentity,
          response: { request, result, declarations: response.declarations },
        }
        this.paint(this.cache.response)
      })
      .catch(() => {
        if (this.valid(job)) {
          this.failedKey = key
          this.retryAfter = Date.now() + 1000
          this.cache = undefined
          this.restore()
          this.layout()
          this.fallback('预览不可用，保留 Markdown 源码。')
        }
      })
      .finally(() => {
        clearTimeout(timeout)
        if (this.job !== job) return
        this.job = undefined
        if (!job.preparationTimedOut) return
        const matches = () => {
          const latest = this.snapshot()
          if (
            this.stopped ||
            this.job ||
            this.config !== config ||
            this.epoch !== job.epoch ||
            latest.mode !== 'live' ||
            latest.sourceIdentity !== job.identity ||
            latest.sourceVersion !== current.sourceVersion ||
            latest.documentVersion !== current.documentVersion ||
            !sameSelection(latest.selection, job.selection)
          )
            return false
          const candidate = this.window(latest)
          return (
            candidate !== undefined &&
            candidate.from === window.from &&
            candidate.to === window.to &&
            candidate.fromLine === window.fromLine &&
            candidate.toLine === window.toLine &&
            candidate.width === window.width &&
            candidate.source === window.source
          )
        }
        if (!matches()) return
        // Native reads have no abort parameter. Resume only after provide has
        // really settled, preserving its checkpoints and the existing backoff.
        this.cancelPreparationRetry()
        const retry = {
          matches,
          timer: setTimeout(
            () => {
              if (this.preparationRetry !== retry) return
              this.preparationRetry = undefined
              if (matches()) this.schedule()
            },
            Math.max(0, this.retryAfter - Date.now()),
          ),
        }
        this.preparationRetry = retry
      })
  }
  private cancelPreparationRetry(): void {
    clearTimeout(this.preparationRetry?.timer)
    this.preparationRetry = undefined
  }
  private valid(job: Job): boolean {
    const current = this.snapshot()
    return (
      !this.stopped &&
      !job.controller.signal.aborted &&
      this.job === job &&
      job.epoch === this.epoch &&
      current.sourceIdentity === job.identity &&
      current.mode === 'live' &&
      this.config !== undefined &&
      sameSelection(job.selection, current.selection) &&
      String(current.sourceVersion) === job.key.split(':')[0]
    )
  }
  private fallback(message: string): void {
    const before = this.snapshot(),
      config = this.config,
      epoch = this.epoch
    // A notice participates in normal flow even before any preview is cached.
    // Preserve reading position around its complete layout change; browsers that
    // already anchor the insertion need no additional scroll correction.
    const anchor =
      !this.painting && !this.stopped && before.mode === 'live'
        ? this.captureScrollAnchor(before.selection)
        : undefined
    this.content.dataset.documentPresentationStatus = 'fallback'
    this.content.setAttribute('aria-description', message)
    const created = !this.notice
    if (!this.notice) {
      this.notice = this.root.ownerDocument.createElement('div')
      this.notice.className = 'milkup-document-presentation-notice'
      this.notice.dataset.documentPresentationNotice = ''
      this.notice.setAttribute('role', 'status')
      for (const name of ['mousedown', 'pointerdown', 'click'])
        this.notice.addEventListener(name, (event) => event.stopPropagation())
      this.root.insertBefore(this.notice, this.content)
    }
    const changed = this.notice.textContent !== message
    if (changed) this.notice.textContent = message
    if ((created || changed) && !this.painting && !this.stopped) {
      this.painting = true
      try {
        this.layout()
        const current = this.snapshot()
        if (
          !this.stopped &&
          this.config === config &&
          this.epoch === epoch &&
          current.mode === before.mode &&
          current.sourceIdentity === before.sourceIdentity &&
          current.sourceVersion === before.sourceVersion &&
          current.documentVersion === before.documentVersion &&
          sameSelection(current.selection, before.selection)
        )
          this.restoreScrollAnchor(anchor)
      } finally {
        this.painting = false
      }
    }
  }
  /** The view invokes this around a synchronous source-DOM replacement. */
  updateContent(update: () => void): boolean {
    const before = this.snapshot()
    const cache = this.cache
    const config = this.config
    const epoch = this.epoch
    const eligible = config !== undefined && before.mode === 'live' && !this.stopped
    const reusable =
      cache !== undefined &&
      config !== undefined &&
      before.mode === 'live' &&
      cache.identity === before.sourceIdentity &&
      cache.key.startsWith(`${before.sourceVersion}:`) &&
      sameSelection(cache.response.request.selection, before.selection)
    // Source DOM replacement temporarily removes measured preview height. Capture
    // the reading position before that shrink, while the visible line is known.
    const anchor = eligible ? this.captureScrollAnchor(before.selection) : undefined
    const anchorSource = anchor && {
      from: anchor.line.dataset.from,
      to: anchor.line.dataset.to,
      line: anchor.line.dataset.line,
    }
    const focus = this.captureFocus()
    update()
    const current = () => {
      const latest = this.snapshot()
      return (
        eligible &&
        !this.stopped &&
        this.config === config &&
        this.epoch === epoch &&
        latest.mode === before.mode &&
        latest.sourceIdentity === before.sourceIdentity &&
        latest.sourceVersion === before.sourceVersion &&
        latest.documentVersion === before.documentVersion &&
        sameSelection(latest.selection, before.selection)
      )
    }
    let measured = false
    if (current()) {
      if (reusable && this.cache === cache) {
        // Reinstall before measuring replacement lines, without widening cache scope.
        const painted = this.painted
        this.paint(cache.response)
        measured = this.painted !== painted
      } else if (anchor && !this.painting) {
        // Previously measured offscreen previews can become literal rows in a
        // new window while its provider is pending. Update spacers before anchoring.
        this.painting = true
        try {
          this.layout()
          measured = true
        } finally {
          this.painting = false
        }
      }
      if (current() && anchor && anchorSource) {
        const replacement = Array.from(this.content.children).find(
          (line): line is HTMLElement =>
            line instanceof HTMLElement &&
            line.classList.contains('milkup-line') &&
            line.dataset.from === anchorSource.from &&
            line.dataset.to === anchorSource.to &&
            line.dataset.line === anchorSource.line,
        )
        if (replacement) this.restoreScrollAnchor({ line: replacement, top: anchor.top })
      }
      if (current() && reusable && this.cache === cache) this.restoreFocus(focus)
    }
    return measured
  }
  private captureFocus():
    | {
        focused: HTMLElement
        focusedPreview: HTMLElement
        focusedReference: DocumentPresentationTarget | undefined
      }
    | undefined {
    const focused = this.content.ownerDocument.activeElement
    const focusedPreview =
      focused instanceof HTMLElement && this.content.contains(focused)
        ? focused.closest<HTMLElement>('[data-document-presentation]')
        : null
    const focusedReference =
      focused instanceof HTMLElement ? referenceTargets.get(focused) : undefined
    return focused instanceof HTMLElement && focusedPreview
      ? { focused, focusedPreview, focusedReference }
      : undefined
  }
  private restoreFocus(focus: ReturnType<DocumentPresentation['captureFocus']>): void {
    if (!focus) return
    const { focused, focusedPreview, focusedReference } = focus
    // Replacement is synchronous. Restore only the still-current semantic control,
    // never an earlier focus captured before awaiting the provider.
    if (
      focusedPreview &&
      (this.content.ownerDocument.activeElement === this.content.ownerDocument.body ||
        this.content.ownerDocument.activeElement === focused)
    ) {
      const replacement = Array.from(
        this.content.querySelectorAll<HTMLElement>('[data-document-presentation]'),
      ).find(
        (element) =>
          element.dataset.presentationFrom === focusedPreview.dataset.presentationFrom &&
          element.dataset.presentationTo === focusedPreview.dataset.presentationTo,
      )
      if (focused === focusedPreview && replacement && replacement.tabIndex >= 0)
        replacement.focus({ preventScroll: true })
      else if (focusedReference && replacement) {
        const reference = Array.from(
          replacement.querySelectorAll<HTMLElement>('.milkup-document-reference'),
        ).find((element) => {
          const target = referenceTargets.get(element)
          return (
            target &&
            target.documentId === focusedReference.documentId &&
            target.version === focusedReference.version &&
            target.from === focusedReference.from &&
            target.to === focusedReference.to &&
            element.textContent === focused?.textContent
          )
        })
        reference?.focus({ preventScroll: true })
      }
    }
  }
  private captureScrollAnchor(
    selection = this.snapshot().selection,
  ): { line: HTMLElement; top: number } | undefined {
    const viewport = this.root.getBoundingClientRect()
    // A search/navigation target can be below several asynchronously growing blocks.
    // Keep its visible endpoint in place; otherwise preserve the reader's viewport.
    const sourceLines = Array.from(this.content.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.classList.contains('milkup-line'),
    )
    const selectedAnchor = [selection.head, selection.anchor]
      .map((position) =>
        sourceLines.find((line) => {
          if (Number(line.dataset.from) > position || Number(line.dataset.to) < position)
            return false
          const rect = line.getBoundingClientRect()
          return rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom
        }),
      )
      .find((line) => line !== undefined)
    const anchor =
      selectedAnchor ??
      sourceLines.find((child) => child.getBoundingClientRect().bottom >= viewport.top)
    return anchor ? { line: anchor, top: anchor.getBoundingClientRect().top } : undefined
  }
  private restoreScrollAnchor(anchor: { line: HTMLElement; top: number } | undefined): void {
    if (
      anchor &&
      this.content.contains(anchor.line) &&
      anchor.line.dataset.presentationCollapsed !== 'true'
    )
      this.root.scrollTop += anchor.line.getBoundingClientRect().top - anchor.top
  }
  private restore(): void {
    // A new window job first restores source, before its eventual replacement paint.
    // Preserve the same visible anchor across that intermediate shrinking layout too.
    const anchor =
      !this.painting && !this.stopped && (this.saved.size || this.notice)
        ? this.captureScrollAnchor()
        : undefined
    this.notice?.remove()
    this.notice = undefined
    if (!this.saved.size && !this.painted) {
      if (this.content.dataset.documentPresentationStatus) {
        delete this.content.dataset.documentPresentationStatus
        this.content.removeAttribute('aria-description')
      }
      this.restoreScrollAnchor(anchor)
      return
    }
    this.observer.disconnect()
    this.painted = undefined
    for (const element of Array.from(this.content.querySelectorAll('[data-document-presentation]')))
      this.resize?.unobserve(element)
    for (const [line, saved] of this.saved) {
      if (this.content.contains(line)) {
        line.replaceChildren(...saved.nodes)
        line.style.display = saved.display
        line.style.minHeight = saved.minHeight
        delete line.dataset.presentationCollapsed
        delete line.dataset.presentationOwner
      }
    }
    this.saved.clear()
    delete this.content.dataset.documentPresentationStatus
    this.content.removeAttribute('aria-description')
    this.restoreScrollAnchor(anchor)
    if (!this.stopped) this.observe()
  }
  private paint(response: DocumentPresentationResponse): void {
    if (this.painting) return
    const currentSelection = this.snapshot().selection
    const selectionKey = `${currentSelection.anchor}:${currentSelection.head}`
    const childLines = Array.from(this.content.children)
    if (
      this.painted?.response === response &&
      this.painted.selection === selectionKey &&
      childLines.length === this.painted.lines.length &&
      childLines.every((line, index) => line === this.painted!.lines[index])
    )
      return
    this.painting = true
    this.observer.disconnect()
    const anchor = this.captureScrollAnchor(currentSelection)
    const focus = this.captureFocus()
    this.restore()
    this.observer.disconnect()
    try {
      const { anchor: selectionAnchor, head } = this.snapshot().selection
      const start = Math.min(selectionAnchor, head),
        end = Math.max(selectionAnchor, head)
      const candidates = response.result.fragments.filter(
        (fragment) => !(start <= fragment.to && end >= fragment.from),
      )
      const fragments: DocumentPresentationFragment[] = []
      const blocks: { fromLine: number; toLine: number }[] = []
      const allLines = this.content.querySelectorAll<HTMLElement>('.milkup-line')
      for (const fragment of candidates) {
        if (fragment.status === 'error') {
          this.fallback(fragment.message ?? '预览不可用，保留 Markdown 源码。')
          continue
        }
        const lines = Array.from(allLines).filter(
          (line) =>
            Number(line.dataset.from) < fragment.to && Number(line.dataset.to) >= fragment.from,
        )
        if (
          !lines.length ||
          Number(lines[0]!.dataset.from) > fragment.from ||
          Number(lines.at(-1)!.dataset.to) < fragment.to
        ) {
          this.fallback('预览范围尚未完整加载，保留 Markdown 源码。')
          continue
        }
        if (fragment.layout === 'inline' && lines.length !== 1) continue
        fragments.push(fragment)
        if (fragment.layout === 'block')
          blocks.push({
            fromLine: Number(lines[0]!.dataset.line),
            toLine: Number(lines.at(-1)!.dataset.line),
          })
        for (const line of lines)
          if (!this.saved.has(line))
            this.saved.set(line, {
              nodes: Array.from(line.childNodes),
              display: line.style.display,
              minHeight: line.style.minHeight,
            })
      }
      // Compose all fragments on a line together, preserving unrelated Markdown DOM.
      for (const [line, saved] of this.saved) {
        const from = Number(line.dataset.from),
          to = Number(line.dataset.to)
        const relevant = fragments.filter(
          (fragment) =>
            fragment.status !== 'error' &&
            fragment.from < to &&
            fragment.to > from &&
            (fragment.layout === 'block' || (fragment.from >= from && fragment.to <= to)),
        )
        const original = line.cloneNode(false) as HTMLElement
        original.append(...saved.nodes.map((node) => node.cloneNode(true)))
        const nodes: Node[] = []
        let cursor = from
        for (const fragment of relevant) {
          if (cursor < fragment.from)
            nodes.push(cloneMappedSlice(original, cursor, Math.min(fragment.from, to)))
          if (fragment.from >= from) nodes.push(this.preview(fragment, response.request))
          cursor = Math.max(cursor, Math.min(fragment.to, to))
        }
        if (cursor < to) nodes.push(cloneMappedSlice(original, cursor, to))
        line.replaceChildren(...nodes)
        if (!nodes.length) {
          line.style.display = 'none'
          line.dataset.presentationCollapsed = 'true'
          const owner = blocks.find(
            (block) =>
              Number(line.dataset.line) >= block.fromLine &&
              Number(line.dataset.line) <= block.toLine,
          )
          if (owner) line.dataset.presentationOwner = String(owner.fromLine)
        } else line.style.minHeight = '1em'
      }
      if (!response.result.complete)
        this.fallback('部分预览上下文尚未加载，保留对应 Markdown 源码。')
      const snapshot = this.snapshot()
      const previousBlocks =
        this.blocksIdentity === snapshot.sourceIdentity &&
        this.blocksVersion === snapshot.sourceVersion
          ? this.blocks
          : []
      this.blocks = [
        ...previousBlocks.filter(
          (previous) => !blocks.some((block) => block.fromLine === previous.fromLine),
        ),
        ...blocks,
      ].slice(-128)
      this.blocksIdentity = snapshot.sourceIdentity
      this.blocksVersion = snapshot.sourceVersion
      for (const node of Array.from(this.content.querySelectorAll('[data-document-presentation]')))
        this.resize?.observe(node)
      this.layout()
      this.restoreScrollAnchor(anchor)
      this.restoreFocus(focus)
      this.painted = { response, selection: selectionKey, lines: childLines }
    } finally {
      this.painting = false
      this.observe()
    }
  }
  private preview(
    fragment: DocumentPresentationFragment,
    request: DocumentPresentationRequest,
  ): HTMLElement {
    const element = this.content.ownerDocument.createElement('span')
    element.dataset.documentPresentation = fragment.layout
    element.dataset.presentationFrom = String(fragment.from)
    element.dataset.presentationTo = String(fragment.to)
    element.className = 'milkup-document-presentation'
    element.setAttribute('aria-label', fragment.accessibleText)
    element.style.display = fragment.layout === 'block' ? 'block' : 'inline-block'
    element.style.maxWidth = '100%'
    element.style.overflow = 'auto'
    element.style.verticalAlign = 'middle'
    element.style.maxHeight = 'min(480px, 65vh)'
    element.setAttribute('role', 'group')
    if (fragment.layout === 'block') element.tabIndex = 0
    element.append(
      createDocumentPresentationNode(this.content.ownerDocument, fragment.content, (target) => {
        if (this.cache?.response.request !== request || !this.content.contains(element)) return
        const failed = () => {
          if (!this.stopped && this.cache?.response.request === request)
            this.fallback('导航目标已失效。')
        }
        try {
          void Promise.resolve(this.config?.onNavigate?.(target)).catch(failed)
        } catch {
          failed()
        }
      }),
    )
    element.addEventListener('mousedown', (event) => {
      event.stopPropagation()
      if (!(event.target instanceof Element && event.target.closest('button')))
        event.preventDefault()
    })
    element.addEventListener('pointerdown', (event) => event.stopPropagation())
    element.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.target === element && event.key === 'Enter') {
        event.preventDefault()
        this.reveal(fragment.from, fragment.to)
      }
    })
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      if (!(event.target instanceof Element && event.target.closest('button')))
        this.reveal(fragment.from, fragment.to)
    })
    return element
  }
}

function sameSelection(
  left: { readonly anchor: number; readonly head: number },
  right: { readonly anchor: number; readonly head: number },
): boolean {
  return left.anchor === right.anchor && left.head === right.head
}

/** Slice mapped DOM, retaining formatting outside previews and absolute UTF-16 offsets. */
function cloneMappedSlice(line: HTMLElement, from: number, to: number): HTMLElement {
  const wrapper = line.ownerDocument.createElement('span')
  wrapper.dataset.from = String(from)
  wrapper.dataset.to = String(to)
  function copy(node: Node, position: number): { node?: Node; end: number } {
    if (node instanceof Text) {
      const end = position + node.length
      const text = node.data.slice(
        Math.max(0, from - position),
        Math.max(0, Math.min(node.length, to - position)),
      )
      return {
        ...(end > from && position < to && text
          ? { node: node.ownerDocument.createTextNode(text) }
          : {}),
        end,
      }
    }
    if (!(node instanceof HTMLElement)) return { end: position }
    if (node.dataset.documentPresentation !== undefined) return { end: position }
    const start = node.dataset.from !== undefined ? Number(node.dataset.from) : position
    let cursor = start
    const clone = node.cloneNode(false) as HTMLElement
    for (const child of Array.from(node.childNodes)) {
      const result = copy(child, cursor)
      cursor = result.end
      if (result.node) clone.append(result.node)
    }
    const end = node.dataset.to !== undefined ? Number(node.dataset.to) : cursor
    if (node.dataset.from !== undefined) {
      clone.dataset.from = String(Math.max(from, start))
      clone.dataset.to = String(Math.min(to, end))
    }
    return {
      ...((clone.childNodes.length || node.matches('button, input, br, [data-from][data-to]')) &&
      end > from &&
      start < to
        ? { node: clone }
        : {}),
      end,
    }
  }
  let cursor = Number(line.dataset.from)
  for (const child of Array.from(line.childNodes)) {
    const result = copy(child, cursor)
    cursor = result.end
    if (result.node) wrapper.append(result.node)
  }
  return wrapper
}

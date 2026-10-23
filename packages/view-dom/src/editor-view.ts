import {
  codeBlockForLine,
  codeFenceArrowTarget,
  isPresentedCodeFence,
  renderCodeLine,
  codeLanguagePicker,
  codeLanguageEdit,
} from './code-presentation'
import { DocumentPresentation, type DocumentPresentationConfig } from './document-presentation'
import { mapLineSourceRanges } from './source-range-mapping'
import { createControlledRendererNodes } from './controlled-renderer'
import { ImagePasteSession, ImagePresentation } from './image-presentation'
import {
  editingContextFromState,
  type EditingSelection,
  type EditingContext,
} from './editing-context'
import {
  applyPresentation,
  validatePresentation,
  samePresentationLayout,
  indentationText,
  presentationOutdent,
  type EditorPresentation,
} from './presentation'
import {
  applyTableAlignments,
  createTaskMarker,
  syncTaskAvailability,
  taskMarkerEdit,
  taskMarkerFromEvent,
} from './live-controls'
import {
  tableContext,
  tableArrowSelection,
  tableCommand,
  tableCellText,
  type TableCommand,
  type TableContext,
} from './table-editing'
import { createMarkdownImage, isImageAsset } from '@milkup/assets'
import type { AssetProvider } from '@milkup/assets'
import { ChangeSet, Selection, transactionChangesDocument } from '@milkup/core'
import type { EditorState, Transaction } from '@milkup/core'
import {
  nextGraphemePosition,
  previousGraphemePosition,
  snapGraphemePosition,
} from './grapheme-navigation'
import { collectClipboardPayload, normalizePaste } from '@milkup/input'
import {
  createMarkdownParseCache,
  parseInline,
  parseMarkdown,
  parseMarkdownIncremental,
} from '@milkup/markdown'
import type {
  IncrementalMarkdownParseResult,
  MarkdownParseCache,
  ParseChange,
  SyntaxNode,
} from '@milkup/markdown'

import type {
  CursorVisibilityOptions,
  ControlledRenderer,
  ControlledMarkdownSyntax,
  EditorViewConfig,
  EditorViewDispatch,
  PositionLineOffset,
  SearchHighlight,
  ViewCoordinate,
  ViewMetrics,
  ViewRect,
  ViewMode,
  ViewUpdate,
  VirtualViewportConfig,
} from './types'
import {
  domRectForLineSourcePosition,
  domRectForLineVisualOffset,
  domRectsForLineSourceRange,
  domRectsForLineVisualRange,
  isHorizontalScrollbarDragStart,
  isEditorScrollbarDragStart,
  scrollCodePositionIntoView,
  scrollSourcePositionIntoView,
  isCodePositionClipped,
  lineElementFromEvent,
  sourcePositionFromPoint,
} from './source-position-mapping'

const defaultViewMetrics: ViewMetrics = Object.freeze({
  charWidth: 8,
  lineHeight: 20,
})

/** Read browser-computed root metrics, never source text or editor state.
 * Numeric unitless line-height is useful for DOM test hosts; browsers resolve it
 * to px. Unresolved/detached styles retain the host's explicit base metrics. */
export function readEditorLayoutMetrics(dom: HTMLElement, fallback: ViewMetrics): ViewMetrics {
  const style = dom.ownerDocument.defaultView?.getComputedStyle(dom)
  const fontSize = Number.parseFloat(style?.fontSize ?? '')
  const line = style?.lineHeight.trim() ?? ''
  const numeric = Number.parseFloat(line)
  const lineHeight = /^[0-9.]+$/.test(line) ? numeric * fontSize : /px$/.test(line) ? numeric : NaN
  return {
    lineHeight: Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : fallback.lineHeight,
    charWidth:
      Number.isFinite(fontSize) && fontSize > 0
        ? (defaultViewMetrics.charWidth * fontSize) / 14
        : fallback.charWidth,
  }
}

const defaultEditorContentInset = Object.freeze({
  left: 26,
  top: 24,
})

interface PastedAssetInput {
  readonly name: string
  readonly type: string
  readonly file?: File
}

interface VirtualViewportState {
  readonly config: VirtualViewportConfig
  readonly lineHeight: number
  readonly overscanLines: number
  readonly viewportHeight?: number
}

interface VisibleLineWindow {
  readonly fromLine: number
  readonly toLine: number
  readonly topSpacerHeight: number
  readonly bottomSpacerHeight: number
}

export class EditorView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  readonly searchLayerDOM: HTMLElement
  readonly selectionLayerDOM: HTMLElement
  readonly cursorLayerDOM: HTMLElement
  readonly inputDOM: HTMLTextAreaElement

  private currentState: EditorState
  private markdownParseState: EditorMarkdownParseState
  private readonly ownerDocument: Document
  private readonly assetProvider: AssetProvider | undefined
  private readonly controlledRenderers: readonly ControlledRenderer[]
  private readonly markdownSyntax: readonly ControlledMarkdownSyntax[]
  private readonly externalDispatch: EditorViewDispatch | undefined
  private selectionGeneration = 0
  private composing = false
  private compositionText = ''
  private dragAnchor: number | undefined
  private isDraggingSelection = false
  private hasDraggedSelection = false
  private suppressNextClick = false
  private mode: ViewMode
  private editable: boolean
  private destroyed = false
  private asyncInputGeneration = 0
  private readonly imagePaste: ImagePasteSession
  private readonly images: ImagePresentation
  private readonly documentPresentation: DocumentPresentation
  private readonly virtualViewport: VirtualViewportState | undefined
  private presentation: EditorPresentation | undefined
  private layoutMetrics: ViewMetrics | undefined
  private searchHighlights: readonly SearchHighlight[] = Object.freeze([])
  private activeSearchHighlightIndex = -1
  private readonly handleInputEvent = (): void => {
    this.readInputProxy()
  }
  private readonly handleScrollEvent = (): void => {
    this.renderVirtualViewportOnScroll()
  }
  private readonly handlePasteEvent = (event: ClipboardEvent): void => {
    void this.handlePaste(event).catch((error: unknown) => {
      if (!this.destroyed) {
        this.dom.dispatchEvent(new CustomEvent('milkup-input-error', { detail: error }))
      }
    })
  }
  private readonly handleCodeLanguageEvent = (event: Event): void => {
    const picker = codeLanguagePicker(event, this.contentDOM)
    if (!picker || !this.editable || this.composing || this.mode !== 'live') return
    const from = Number(picker.dataset.codeFrom)
    if (!Number.isInteger(from) || from < 0 || from > this.currentState.doc.length) return
    const line = this.currentState.doc.lineAt(from)
    const edit = codeLanguageEdit(picker, from, line.text)
    if (!edit || line.from !== from) return
    this.applyBlockChanges(ChangeSet.replace(edit.from, edit.to, edit.insert), 'view.code.language')
    this.inputDOM.focus({ preventScroll: true })
  }
  private readonly handleTaskKeyDownEvent = (event: KeyboardEvent): void => {
    const task = taskMarkerFromEvent(event, this.contentDOM)
    if (!task || (event.key !== ' ' && event.key !== 'Enter')) return
    event.preventDefault()
    if (!event.repeat) this.toggleTask(task)
  }
  private readonly handleInnerScrollEvent = (event: Event): void => {
    if (event.target instanceof HTMLElement && event.target.classList.contains('milkup-block-code'))
      this.renderSelectionAndCursor()
  }
  private readonly handleKeyDownEvent = (event: KeyboardEvent): void => {
    if (this.documentPresentation.returnToPreviewWithTab(event)) return
    if (this.handleEditingKey(event)) {
      event.preventDefault()
    }
  }
  private readonly handleClickEvent = (event: MouseEvent): void => {
    const task = taskMarkerFromEvent(event, this.contentDOM)
    if (task) {
      event.preventDefault()
      this.toggleTask(task)
      return
    }
    this.placeCursorFromClick(event)
  }
  private readonly handleMouseDownEvent = (event: MouseEvent): void => {
    const task = taskMarkerFromEvent(event, this.contentDOM)
    if (task) {
      event.preventDefault()
      task.focus({ preventScroll: true })
      return
    }
    this.startSelectionDrag(event)
  }
  private readonly handleMouseMoveEvent = (event: MouseEvent): void => {
    this.updateSelectionDrag(event)
  }
  private readonly handleMouseUpEvent = (event: MouseEvent): void => {
    this.finishSelectionDrag(event)
  }
  private readonly handleCompositionStartEvent = (): void => {
    this.composing = true
    this.compositionText = ''
  }
  private readonly handleCompositionUpdateEvent = (event: CompositionEvent): void => {
    this.composing = true
    this.compositionText = event.data
  }
  private readonly handleCompositionEndEvent = (event: CompositionEvent): void => {
    this.commitComposition(event.data)
  }

  constructor(config: EditorViewConfig) {
    this.ownerDocument = config.document ?? config.parent.ownerDocument
    this.currentState = config.state
    this.markdownSyntax = Object.freeze([...(config.markdownSyntax ?? [])])
    this.markdownParseState = createEditorMarkdownParseState(
      this.currentState.doc.text,
      this.markdownSyntax,
    )
    this.assetProvider = config.assetProvider
    this.controlledRenderers = Object.freeze([...(config.controlledRenderers ?? [])])
    this.externalDispatch = config.dispatch
    this.mode = config.mode ?? 'source'
    this.editable = config.editable ?? true
    this.virtualViewport = resolveVirtualViewportState(config.virtualViewport)
    this.dom = this.ownerDocument.createElement('div')
    this.dom.className = 'milkup-editor'
    this.dom.dataset.mode = this.mode
    this.dom.dataset.editable = String(this.editable)
    this.contentDOM = this.ownerDocument.createElement('div')
    this.contentDOM.className = 'milkup-editor-content'
    this.contentDOM.setAttribute('role', 'textbox')
    this.contentDOM.setAttribute('aria-multiline', 'true')
    this.contentDOM.setAttribute('contenteditable', 'false')
    this.searchLayerDOM = this.ownerDocument.createElement('div')
    this.searchLayerDOM.className = 'milkup-search-layer'
    this.selectionLayerDOM = this.ownerDocument.createElement('div')
    this.selectionLayerDOM.className = 'milkup-selection-layer'
    this.cursorLayerDOM = this.ownerDocument.createElement('div')
    this.cursorLayerDOM.className = 'milkup-cursor-layer'
    this.inputDOM = createInputProxy(this.ownerDocument)
    this.dom.append(this.contentDOM)
    this.dom.append(this.searchLayerDOM)
    this.dom.append(this.selectionLayerDOM)
    this.dom.append(this.cursorLayerDOM)
    this.dom.append(this.inputDOM)
    this.inputDOM.addEventListener('input', this.handleInputEvent)
    this.inputDOM.addEventListener('paste', this.handlePasteEvent)
    this.inputDOM.addEventListener('keydown', this.handleKeyDownEvent)
    this.inputDOM.addEventListener('compositionstart', this.handleCompositionStartEvent)
    this.inputDOM.addEventListener('compositionupdate', this.handleCompositionUpdateEvent)
    this.inputDOM.addEventListener('compositionend', this.handleCompositionEndEvent)
    this.dom.addEventListener('scroll', this.handleScrollEvent)
    this.contentDOM.addEventListener('scroll', this.handleInnerScrollEvent, true)
    this.contentDOM.addEventListener('keydown', this.handleTaskKeyDownEvent)
    this.contentDOM.addEventListener('change', this.handleCodeLanguageEvent)
    this.dom.addEventListener('click', this.handleClickEvent)
    this.dom.addEventListener('mousedown', this.handleMouseDownEvent)
    this.dom.addEventListener('mousemove', this.handleMouseMoveEvent)
    this.ownerDocument.addEventListener('mouseup', this.handleMouseUpEvent)
    config.parent.append(this.dom)
    this.imagePaste = new ImagePasteSession(
      config.onImagePaste,
      (error) => {
        if (!this.destroyed)
          this.dom.dispatchEvent(new CustomEvent('milkup-input-error', { detail: error }))
      },
      config.onEmptyPaste,
    )
    this.images = new ImagePresentation(this.contentDOM, config.imageResolver, () => {
      if (!this.destroyed) this.renderSelectionAndCursor()
    })
    this.documentPresentation = new DocumentPresentation(
      this.dom,
      this.contentDOM,
      config.documentPresentation,
      () => ({
        mode: this.mode,
        sourceIdentity: this.currentState.doc,
        sourceVersion: this.markdownParseState.version,
        selection: this.currentState.selection.main,
        lineCount: this.currentState.doc.lineCount,
        read: (from, to) => this.currentState.doc.slice(from, to),
      }),
      () => {
        if (!this.destroyed) this.renderSelectionAndCursor()
      },
      (from, to) => {
        this.dispatch({ selection: Selection.range(from, to), addToHistory: false })
        this.inputDOM.focus({ preventScroll: true })
      },
    )
    if (config.presentation) {
      this.presentation = validatePresentation(config.presentation)
      applyPresentation(this.dom, this.presentation)
    }
    this.readLayoutMetrics()
    this.render()
  }

  get isComposing(): boolean {
    return this.composing
  }

  setDocumentPresentation(config: DocumentPresentationConfig | undefined): void {
    this.documentPresentation.setConfig(config)
  }
  invalidateDocumentPresentation(): void {
    this.documentPresentation.invalidate()
  }
  refreshDocumentPresentation(): void {
    this.documentPresentation.refresh()
  }

  refreshResourceImages(): void {
    this.images.refresh()
  }

  get selectionRevision(): number {
    return this.selectionGeneration
  }

  get lineHeight(): number {
    return (
      this.layoutMetrics?.lineHeight ??
      (this.presentation
        ? this.presentation.fontSize * this.presentation.lineHeight
        : (this.virtualViewport?.lineHeight ?? defaultViewMetrics.lineHeight))
    )
  }

  setPresentation(value: EditorPresentation): void {
    if (this.destroyed) return
    const next = validatePresentation(value)
    if (samePresentationLayout(this.presentation, next)) {
      this.presentation = next
      return
    }
    this.presentation = next
    applyPresentation(this.dom, next)
    this.refreshLayout()
  }

  /** Remeasure already-applied root typography without replacing the input,
   * document, selection or history. Hosts must keep source rows at one uniform
   * root line-height; arbitrary per-row vertical CSS is not supported. */
  refreshLayout(): void {
    if (this.destroyed) return
    const scrollLine = this.dom.scrollTop / this.lineHeight
    const scrollLeft = this.dom.scrollLeft
    const codeScroll = new Map(
      Array.from(this.contentDOM.querySelectorAll<HTMLElement>('.milkup-block-code'), (line) => [
        line.dataset.line,
        line.scrollLeft,
      ]),
    )
    this.readLayoutMetrics()
    const scrollTop = scrollLine * this.lineHeight
    this.render()
    // Install the new extent before assigning an offset that the old extent
    // could clamp. The input proxy and its in-progress IME value stay attached.
    this.dom.scrollTop = scrollTop
    this.dom.scrollLeft = scrollLeft
    if (this.shouldUseVirtualViewport()) this.renderVirtualViewport()
    this.contentDOM.querySelectorAll<HTMLElement>('.milkup-block-code').forEach((line) => {
      line.scrollLeft = codeScroll.get(line.dataset.line) ?? 0
    })
    this.renderSelectionAndCursor()
  }

  private readLayoutMetrics(): void {
    this.layoutMetrics = readEditorLayoutMetrics(this.dom, {
      lineHeight: this.presentation
        ? this.presentation.fontSize * this.presentation.lineHeight
        : (this.virtualViewport?.lineHeight ?? defaultViewMetrics.lineHeight),
      charWidth: (defaultViewMetrics.charWidth * (this.presentation?.fontSize ?? 14)) / 14,
    })
    // Scope the row minimum to content. Rewriting the root variable could feed
    // a root calc()/var() line-height back into itself, or survive theme removal.
    this.contentDOM.style.setProperty('--milkup-line-height', `${this.lineHeight}px`)
  }

  private presentationMetrics(metrics?: Partial<ViewMetrics>): Partial<ViewMetrics> {
    return { ...this.layoutMetrics, lineHeight: this.lineHeight, ...metrics }
  }

  get state(): EditorState {
    return this.currentState
  }

  get viewMode(): ViewMode {
    return this.mode
  }

  get markdownParse(): EditorMarkdownParseState {
    return this.markdownParseState
  }

  get activeTable(): TableContext | undefined {
    return this.mode === 'live'
      ? tableContext(this.currentState, this.markdownParseState.cache.root)
      : undefined
  }

  runTableCommand(command: TableCommand): boolean {
    if (!this.editable || this.composing) return false
    const context = tableContext(this.currentState, this.markdownParseState.cache.root)
    if (!context) return false
    const transaction = tableCommand(this.currentState, context, command)
    if (!transaction) return false
    this.dispatch(transaction)
    return true
  }

  async readEditingContext(
    selection: EditingSelection = this.currentState.selection.main,
    signal?: AbortSignal,
  ): Promise<EditingContext> {
    signal?.throwIfAborted()
    const state = this.currentState.applyTransaction({
      selection: Selection.range(selection.anchor, selection.head),
      addToHistory: false,
    })
    return editingContextFromState(state, this.markdownParseState.cache.root)
  }

  setSearchHighlights(highlights: readonly SearchHighlight[], activeIndex = -1): void {
    this.searchHighlights = Object.freeze([...highlights])
    this.activeSearchHighlightIndex = activeIndex
    this.renderSearchHighlights()
  }

  updateState(state: EditorState, transactions: readonly Transaction[] = []): ViewUpdate {
    const previousState = this.currentState
    if (state.doc !== previousState.doc) {
      this.asyncInputGeneration += 1
      this.imagePaste.abort()
    }
    if (
      state.selection.main.anchor !== previousState.selection.main.anchor ||
      state.selection.main.head !== previousState.selection.main.head
    )
      this.selectionGeneration++
    this.currentState = state
    const documentChanged = transactions.some(transactionChangesDocument)

    if (documentChanged || previousState.doc.text !== state.doc.text) {
      const previousRoot = this.markdownParseState.cache.root
      this.markdownParseState = updateEditorMarkdownParseState(
        this.markdownParseState,
        previousState,
        state,
        transactions,
        this.markdownSyntax,
      )
      if (!this.renderChangedDocumentLines(previousState, state, transactions, previousRoot)) {
        this.render()
      }
    } else if (selectionChanged(previousState, state) && this.mode !== 'source') {
      this.renderSelectionChangedLines(previousState, state)
      this.renderSelectionAndCursor()
    } else if (selectionChanged(previousState, state)) {
      this.renderSelectionAndCursor()
    }

    if (selectionChanged(previousState, state) && shouldScrollSelectionIntoView(transactions)) {
      this.ensureCursorVisible()
    }

    return {
      view: this,
      previousState,
      state,
      transactions,
    }
  }

  setMode(mode: ViewMode): void {
    if (this.mode === mode) {
      return
    }

    const scrollTop = this.dom.scrollTop
    this.mode = mode
    this.dom.dataset.mode = mode
    this.render()
    this.dom.scrollTop = scrollTop

    if (this.dom.clientHeight > 0) {
      this.ensureCursorVisible()
    }
  }

  setEditable(editable: boolean): void {
    if (!editable) this.imagePaste.abort()
    if (this.editable === editable) {
      return
    }

    if (!editable) this.asyncInputGeneration += 1
    this.editable = editable
    this.dom.dataset.editable = String(editable)
    this.inputDOM.readOnly = !editable
    syncTaskAvailability(this.contentDOM, editable)
  }

  positionToRect(pos: number, metrics?: Partial<ViewMetrics>): ViewRect {
    return positionToRectForMode(
      this.currentState,
      this.mode,
      pos,
      this.presentationMetrics(metrics),
      this.markdownParseState.cache.root,
    )
  }

  coordinateToPosition(coordinate: ViewCoordinate, metrics?: Partial<ViewMetrics>): number {
    return coordinateToPositionForMode(
      this.currentState,
      this.mode,
      coordinate,
      this.presentationMetrics(metrics),
      this.markdownParseState.cache.root,
    )
  }

  ensureCursorVisible(options?: CursorVisibilityOptions): number {
    const position = this.currentState.selection.main.head
    const line = this.contentDOM.querySelector<HTMLElement>(
      `.milkup-line[data-line="${this.currentState.doc.lineAt(position).number}"]`,
    )
    if (
      line &&
      (this.mode === 'source'
        ? scrollSourcePositionIntoView(this.dom, line, position)
        : scrollCodePositionIntoView(line, position))
    )
      this.renderSelectionAndCursor()

    const measuredRect = domRectForSourcePosition(
      this.ownerDocument,
      this.contentDOM,
      this.dom,
      this.currentState,
      this.mode,
      this.currentState.selection.main.head,
      this.markdownParseState.cache.root,
    )

    if (measuredRect) {
      const nextScrollTop = scrollMeasuredRectIntoView({
        currentScrollTop: this.dom.scrollTop,
        rect: measuredRect,
        viewportHeight: options?.viewportHeight ?? this.dom.clientHeight,
        ...(options?.scrollPadding === undefined ? {} : { scrollPadding: options.scrollPadding }),
      })

      this.dom.scrollTop = nextScrollTop
      return nextScrollTop
    }

    const nextScrollTop = scrollPositionIntoViewForMode({
      currentScrollTop: this.dom.scrollTop,
      mode: this.mode,
      position: this.currentState.selection.main.head,
      state: this.currentState,
      viewportHeight: options?.viewportHeight ?? this.dom.clientHeight,
      ...(options?.scrollPadding === undefined ? {} : { scrollPadding: options.scrollPadding }),
      metrics: this.presentationMetrics(options?.metrics),
      root: this.markdownParseState.cache.root,
    })

    this.dom.scrollTop = nextScrollTop
    if (this.shouldUseVirtualViewport()) {
      this.renderVirtualViewport()
    }
    return nextScrollTop
  }

  destroy(): void {
    this.imagePaste.abort()
    this.images.destroy()
    this.documentPresentation.destroy()
    this.destroyed = true
    this.asyncInputGeneration += 1
    this.inputDOM.removeEventListener('input', this.handleInputEvent)
    this.inputDOM.removeEventListener('paste', this.handlePasteEvent)
    this.inputDOM.removeEventListener('keydown', this.handleKeyDownEvent)
    this.inputDOM.removeEventListener('compositionstart', this.handleCompositionStartEvent)
    this.inputDOM.removeEventListener('compositionupdate', this.handleCompositionUpdateEvent)
    this.inputDOM.removeEventListener('compositionend', this.handleCompositionEndEvent)
    this.dom.removeEventListener('scroll', this.handleScrollEvent)
    this.contentDOM.removeEventListener('scroll', this.handleInnerScrollEvent, true)
    this.contentDOM.removeEventListener('keydown', this.handleTaskKeyDownEvent)
    this.contentDOM.removeEventListener('change', this.handleCodeLanguageEvent)
    this.dom.removeEventListener('click', this.handleClickEvent)
    this.dom.removeEventListener('mousedown', this.handleMouseDownEvent)
    this.dom.removeEventListener('mousemove', this.handleMouseMoveEvent)
    this.ownerDocument.removeEventListener('mouseup', this.handleMouseUpEvent)
    this.dom.remove()
  }

  private render(): void {
    if (this.shouldUseVirtualViewport()) {
      this.renderVirtualViewport()
      return
    }

    delete this.contentDOM.dataset.virtualized
    delete this.contentDOM.dataset.fromLine
    delete this.contentDOM.dataset.toLine
    this.documentPresentation.updateContent(() => {
      this.contentDOM.replaceChildren(
        ...(this.mode === 'source'
          ? renderPlainTextLines(this.ownerDocument, this.currentState)
          : renderMarkdownLines(this.ownerDocument, this.currentState, this.mode, {
              root: this.markdownParseState.cache.root,
              controlledRenderers: this.controlledRenderers,
            })),
      )
    })
    this.selectionLayerDOM.replaceChildren(
      ...renderSelectionOverlay(this.ownerDocument, this.currentState, this.mode, {
        root: this.markdownParseState.cache.root,
        metrics: this.presentationMetrics(),
      }),
    )
    this.cursorLayerDOM.replaceChildren(
      ...renderCursorOverlay(this.ownerDocument, this.currentState, this.mode, {
        root: this.markdownParseState.cache.root,
        metrics: this.presentationMetrics(),
      }),
    )
    this.alignSelectionOverlayToDOM()
    this.alignCursorOverlayToDOM()
    this.renderSearchHighlights()
    this.syncInputProxyToCursor()
  }

  private renderSelectionAndCursor(): void {
    this.documentPresentation?.selectionChanged()
    this.selectionLayerDOM.replaceChildren(
      ...renderSelectionOverlay(this.ownerDocument, this.currentState, this.mode, {
        root: this.markdownParseState.cache.root,
        metrics: this.presentationMetrics(),
      }),
    )
    this.cursorLayerDOM.replaceChildren(
      ...renderCursorOverlay(this.ownerDocument, this.currentState, this.mode, {
        root: this.markdownParseState.cache.root,
        metrics: this.presentationMetrics(),
      }),
    )
    this.alignSelectionOverlayToDOM()
    this.alignCursorOverlayToDOM()
    this.renderSearchHighlights()
    this.syncInputProxyToCursor()
  }

  private renderSearchHighlights(): void {
    const rendered: HTMLElement[] = []

    for (const [index, highlight] of this.searchHighlights.entries()) {
      const element = this.ownerDocument.createElement('div')
      element.className =
        index === this.activeSearchHighlightIndex
          ? 'milkup-search-highlight is-active'
          : 'milkup-search-highlight'
      element.dataset.index = String(index)
      element.dataset.from = String(highlight.from)
      element.dataset.to = String(highlight.to)
      element.dataset.line = String(highlight.line)
      const rects = domRectsForSourceRange(
        this.ownerDocument,
        this.contentDOM,
        this.searchLayerDOM,
        this.currentState,
        this.mode,
        highlight.from,
        highlight.to,
        this.markdownParseState.cache.root,
      )

      if (rects.length === 0) {
        const line = this.contentDOM.querySelector<HTMLElement>(
          `.milkup-line[data-line="${highlight.line}"]`,
        )

        if (!line) {
          continue
        }

        const lineFrom = Number(line.dataset.from)
        element.style.left = `${Math.max(0, highlight.from - lineFrom) * defaultViewMetrics.charWidth}px`
        element.style.top = `${line.offsetTop}px`
        element.style.width = `${Math.max(1, highlight.to - highlight.from) * defaultViewMetrics.charWidth}px`
        element.style.height = `${this.lineHeight}px`
        rendered.push(element)
        continue
      }

      for (const [rectIndex, rect] of rects.entries()) {
        const measured = element.cloneNode(false) as HTMLElement
        measured.dataset.rectIndex = String(rectIndex)
        measured.style.left = `${rect.left}px`
        measured.style.top = `${rect.top}px`
        measured.style.width = `${Math.max(1, rect.width)}px`
        measured.style.visibility = rect.width <= 0 ? 'hidden' : ''
        measured.style.height = `${rect.height}px`
        rendered.push(measured)
      }
    }

    this.searchLayerDOM.replaceChildren(...rendered)
  }

  private renderSelectionChangedLines(previousState: EditorState, state: EditorState): void {
    if (this.mode === 'source') {
      this.renderSelectionAndCursor()
      return
    }

    const lineNumbers = changedSelectionLineNumbers(previousState, state)

    for (const lineNumber of lineNumbers) {
      const line = state.doc.line(lineNumber)
      const previousLineDOM = this.contentDOM.querySelector<HTMLElement>(
        `.milkup-line[data-line="${line.number}"]`,
      )

      if (!previousLineDOM) {
        this.render()
        return
      }

      const nextLineDOM = renderMarkdownLine(
        this.ownerDocument,
        state,
        this.mode,
        this.markdownParseState.cache.root.children ?? [],
        line.number,
        { controlledRenderers: this.controlledRenderers },
      )
      const scrollLeft = previousLineDOM.scrollLeft
      previousLineDOM.replaceWith(nextLineDOM)
      nextLineDOM.scrollLeft = scrollLeft
    }
  }

  private renderChangedDocumentLines(
    previousState: EditorState,
    state: EditorState,
    transactions: readonly Transaction[],
    previousRoot: SyntaxNode,
  ): boolean {
    if (this.mode === 'source') {
      return this.renderChangedSourceLine(previousState, state, transactions)
    }

    let lineNumbers = changedDocumentLineNumbers(previousState, state, transactions)
    if (!lineNumbers) return false

    // Restore cached source children before remapping them. A later selection
    // refresh must not reinstall preview-owned nodes with old source offsets.
    this.documentPresentation.selectionChanged()
    const changedNumber = lineNumbers[0]!
    const oldLine = previousState.doc.line(changedNumber)
    const nextLine = state.doc.line(changedNumber)
    const oldDOM = this.contentDOM.querySelector<HTMLElement>(
      `.milkup-line[data-line="${changedNumber}"]`,
    )
    let codeInfoChanged = false
    // The opening fence's info string is a rendering dependency of every body
    // line. Ordinary single-line typing keeps its existing one-row fast path.
    if (
      oldDOM?.classList.contains('milkup-code-opening') ||
      /^ {0,3}(?:`{3,}|~{3,})/u.test(nextLine.text)
    ) {
      const previousCode = codeBlockForLine(previousRoot.children ?? [], oldLine.from, oldLine.to)
      const nextCode = codeBlockForLine(
        this.markdownParseState.cache.root.children ?? [],
        nextLine.from,
        nextLine.to,
      )
      codeInfoChanged =
        (previousCode?.from === oldLine.from || nextCode?.from === nextLine.from) &&
        previousCode?.data?.info !== nextCode?.data?.info
      if (codeInfoChanged) {
        const last = Math.max(
          previousCode
            ? previousState.doc.lineAt(Math.max(previousCode.from, previousCode.to - 1)).number
            : changedNumber,
          nextCode
            ? state.doc.lineAt(Math.max(nextCode.from, nextCode.to - 1)).number
            : changedNumber,
        )
        lineNumbers = Array.from(
          { length: last - changedNumber + 1 },
          (_, index) => changedNumber + index,
        )
      }
    }

    const replacements: { previous: HTMLElement; next: HTMLElement; scrollLeft: number }[] = []
    for (const lineNumber of lineNumbers) {
      const previous = this.contentDOM.querySelector<HTMLElement>(
        `.milkup-line[data-line="${lineNumber}"]`,
      )
      if (!previous) return false
      replacements.push({
        previous,
        next: renderMarkdownLine(
          this.ownerDocument,
          state,
          this.mode,
          this.markdownParseState.cache.root.children ?? [],
          lineNumber,
          { controlledRenderers: this.controlledRenderers },
        ),
        scrollLeft: previous.scrollLeft,
      })
    }
    const replace = () => {
      if (state.doc.length !== previousState.doc.length) {
        for (const line of Array.from(
          this.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'),
        )) {
          mapLineSourceRanges(line, transactions[0]!.changes!)
        }
      }
      for (const { previous, next, scrollLeft } of replacements) {
        previous.replaceWith(next)
        next.scrollLeft = scrollLeft
      }
    }
    if (codeInfoChanged) this.documentPresentation.updateContent(replace)
    else replace()
    this.renderSelectionAndCursor()
    return true
  }

  private renderChangedSourceLine(
    previousState: EditorState,
    state: EditorState,
    transactions: readonly Transaction[],
  ): boolean {
    if (this.shouldUseVirtualViewport()) return false
    const number = changedDocumentLineNumbers(previousState, state, transactions)?.[0]
    const change = transactions[0]?.changes?.changes[0]
    if (
      number === undefined ||
      !change ||
      /[\r\n]/u.test(change.insert) ||
      /[\r\n]/u.test(previousState.doc.slice(change.from, change.to))
    )
      return false

    // Validate the entire old source DOM before mutating any node. Missing or
    // stale rows must take the existing full-render path, not leave a half patch.
    const children = Array.from(this.contentDOM.children)
    if (children.length !== previousState.doc.lineCount) return false
    const lines: HTMLElement[] = []
    for (const [index, child] of children.entries()) {
      const line = previousState.doc.line(index + 1)
      if (
        !(child instanceof HTMLElement) ||
        !child.classList.contains('milkup-line') ||
        child.dataset.line !== String(line.number) ||
        child.dataset.from !== String(line.from) ||
        child.dataset.to !== String(line.to)
      )
        return false
      lines.push(child)
    }
    const previousLineDOM = lines[number - 1]!
    const nextLineDOM = renderPlainTextLineWindow(this.ownerDocument, state, number, number)[0]!
    const scrollTop = this.dom.scrollTop
    const scrollLeft = this.dom.scrollLeft
    const lineScrollLeft = previousLineDOM.scrollLeft
    this.documentPresentation.updateContent(() => {
      previousLineDOM.replaceWith(nextLineDOM)
      // Source rows have no nested range attributes. Their text and line numbers
      // stay unchanged, but all later absolute UTF-16 offsets may have shifted.
      for (let index = number; index < lines.length; index++) {
        const line = state.doc.line(index + 1)
        lines[index]!.dataset.from = String(line.from)
        lines[index]!.dataset.to = String(line.to)
      }
    })
    // Presentation anchoring is Live-only; preserve Source scroll explicitly.
    nextLineDOM.scrollLeft = lineScrollLeft
    this.dom.scrollTop = scrollTop
    this.dom.scrollLeft = scrollLeft
    this.renderSelectionAndCursor()
    return true
  }

  private shouldUseVirtualViewport(): boolean {
    return this.virtualViewport !== undefined && this.mode === 'source'
  }

  private renderVirtualViewportOnScroll(): void {
    if (!this.shouldUseVirtualViewport()) {
      return
    }

    this.renderVirtualViewport()
  }

  private renderVirtualViewport(): void {
    const viewportHeight =
      this.virtualViewport?.viewportHeight ??
      (this.dom.clientHeight > 0 ? this.dom.clientHeight : undefined)
    const window = getVisibleLineWindow({
      lineCount: this.currentState.doc.lineCount,
      scrollTop: this.dom.scrollTop,
      lineHeight: this.lineHeight,
      overscanLines: this.virtualViewport?.overscanLines ?? 0,
      ...(viewportHeight === undefined ? {} : { viewportHeight }),
    })

    this.contentDOM.replaceChildren(
      renderVirtualSpacer(this.ownerDocument, 'top', window.topSpacerHeight),
      ...renderPlainTextLineWindow(
        this.ownerDocument,
        this.currentState,
        window.fromLine,
        window.toLine,
      ),
      renderVirtualSpacer(this.ownerDocument, 'bottom', window.bottomSpacerHeight),
    )
    this.contentDOM.dataset.virtualized = 'true'
    this.contentDOM.dataset.fromLine = String(window.fromLine)
    this.contentDOM.dataset.toLine = String(window.toLine)
    this.renderSelectionAndCursor()
  }

  private alignSelectionOverlayToDOM(): void {
    const measuredSelections: HTMLElement[] = []

    for (const selection of Array.from(
      this.selectionLayerDOM.querySelectorAll<HTMLElement>('.milkup-selection'),
    )) {
      const from = Number(selection.dataset.from)
      const to = Number(selection.dataset.to)
      const index = selection.dataset.index ?? '0'

      if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) {
        continue
      }

      const rects = domRectsForSourceRange(
        this.ownerDocument,
        this.contentDOM,
        this.selectionLayerDOM,
        this.currentState,
        this.mode,
        from,
        to,
        this.markdownParseState.cache.root,
      )

      if (rects.length === 0) {
        measuredSelections.push(selection)
        continue
      }

      for (const [rectIndex, rect] of rects.entries()) {
        const measured = this.ownerDocument.createElement('div')
        measured.className = 'milkup-selection'
        measured.dataset.index = index
        measured.dataset.rectIndex = String(rectIndex)
        measured.dataset.from = String(from)
        measured.dataset.to = String(to)
        measured.style.left = `${rect.left}px`
        measured.style.top = `${rect.top}px`
        measured.style.width = `${Math.max(1, rect.width)}px`
        measured.style.visibility = rect.width <= 0 ? 'hidden' : ''
        measured.style.height = `${rect.height}px`
        measuredSelections.push(measured)
      }
    }

    if (measuredSelections.length > 0) {
      this.selectionLayerDOM.replaceChildren(...measuredSelections)
    }
  }

  private alignCursorOverlayToDOM(): void {
    syncTaskAvailability(this.contentDOM, this.editable)
    for (const cursor of Array.from(
      this.cursorLayerDOM.querySelectorAll<HTMLElement>('.milkup-cursor'),
    )) {
      const position = Number(cursor.dataset.position)

      if (!Number.isInteger(position)) {
        continue
      }

      const rect = domRectForSourcePosition(
        this.ownerDocument,
        this.contentDOM,
        this.cursorLayerDOM,
        this.currentState,
        this.mode,
        position,
        this.markdownParseState.cache.root,
      )

      if (!rect) {
        continue
      }

      const line = this.contentDOM.querySelector<HTMLElement>(
        `.milkup-line[data-line="${this.currentState.doc.lineAt(position).number}"]`,
      )
      cursor.style.visibility =
        line && isCodePositionClipped(line, this.cursorLayerDOM, rect) ? 'hidden' : ''
      cursor.style.left = `${rect.left}px`
      cursor.style.top = `${rect.top}px`
      cursor.style.height = `${rect.height}px`
    }
  }

  private syncInputProxyToCursor(): void {
    const cursor = this.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')

    if (!cursor) {
      return
    }

    const left = Number.parseFloat(cursor.style.left)
    const top = Number.parseFloat(cursor.style.top)
    const height = Number.parseFloat(cursor.style.height)

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return
    }

    const layerLeft = this.cursorLayerDOM.offsetLeft || defaultEditorContentInset.left
    const layerTop = this.cursorLayerDOM.offsetTop || defaultEditorContentInset.top

    this.inputDOM.style.left = `${Math.max(0, layerLeft + left)}px`
    this.inputDOM.style.top = `${Math.max(0, layerTop + top)}px`

    if (Number.isFinite(height) && height > 0) {
      this.inputDOM.style.height = `${height}px`
    }
  }

  private toggleTask(task: HTMLButtonElement): void {
    if (!this.editable || this.composing || this.destroyed || this.mode !== 'live') return
    const from = Number(task.dataset.from),
      to = Number(task.dataset.to)
    if (!Number.isInteger(from) || !Number.isInteger(to)) return
    const edit = taskMarkerEdit(from, this.currentState.doc.text.slice(from, to))
    if (!edit) return
    const focused = this.ownerDocument.activeElement === task
    this.dispatch({
      changes: ChangeSet.replace(edit.from, edit.to, edit.insert),
      selection: this.currentState.selection,
      historyGroup: 'isolate',
      origin: { type: 'command', id: 'task.toggle' },
    })
    if (focused)
      this.contentDOM
        .querySelector<HTMLButtonElement>(`.milkup-task-marker[data-from="${from}"]`)
        ?.focus({ preventScroll: true })
  }

  private dispatch(transaction: Transaction): void {
    if (this.externalDispatch) {
      this.externalDispatch(transaction, this)
      return
    }

    this.updateState(this.currentState.applyTransaction(transaction), [transaction])
  }

  private readInputProxy(): void {
    if (!this.editable) {
      this.inputDOM.value = ''
      return
    }

    if (this.composing) {
      return
    }

    const text = this.inputDOM.value

    if (text.length === 0) {
      return
    }

    this.inputDOM.value = ''
    this.insertText(text)
  }

  private commitComposition(data: string): void {
    // Empty final data is cancellation, never the last uncommitted candidate.
    const text = data

    this.composing = false
    this.compositionText = ''
    this.inputDOM.value = ''

    if (!this.editable) {
      return
    }

    if (text.length > 0) {
      this.insertText(text, 'input.composition')
    }
  }

  private async handlePaste(event: ClipboardEvent): Promise<void> {
    if (!this.editable) {
      event.preventDefault()
      return
    }

    if (event.defaultPrevented || this.composing) return
    if (this.imagePaste.handle(event, this.currentState.selection.main)) return

    const payload = collectClipboardPayload(event)
    const paste = normalizePaste(payload, {
      inCodeBlock: isPositionInsideCodeBlock(
        this.currentState,
        this.currentState.selection.main.head,
        this.markdownParseState.cache.root,
      ),
    })

    if (!paste.handled && paste.strategy === 'files-deferred') {
      if (!this.assetProvider || !payload.files?.some(isImageAsset)) {
        return
      }

      event.preventDefault()
      const generation = this.asyncInputGeneration
      const range = this.currentState.selection.main
      const imported = await this.importPastedImages(payload.files ?? [], generation)

      if (imported.length === 0 || !this.isImageImportCurrent(generation)) {
        return
      }

      const text = imported.join('\n')
      this.dispatch({
        changes: ChangeSet.replace(range.from, range.to, text),
        selection: Selection.cursor(range.from + text.length),
        origin: { type: 'input.type', id: 'input.paste' },
        historyGroup: 'isolate',
      })
      this.dom.dispatchEvent(new Event('milkup-image-imported'))
      return
    }

    if (!paste.handled) {
      return
    }

    event.preventDefault()
    this.insertText(paste.text, 'input.paste')
  }

  private async importPastedImages(
    files: readonly PastedAssetInput[],
    generation: number,
  ): Promise<readonly string[]> {
    if (!this.assetProvider) {
      return []
    }

    const images = files.filter(isImageAsset)
    const imported: string[] = []

    for (const image of images) {
      const asset = await this.assetProvider.importAsset({
        name: image.name,
        type: image.type,
        data: image.file,
      })
      if (!this.isImageImportCurrent(generation)) return []
      imported.push(createMarkdownImage(asset))
    }

    return Object.freeze(imported)
  }

  private isImageImportCurrent(generation: number): boolean {
    if (this.destroyed) return false
    if (generation !== this.asyncInputGeneration || !this.editable) {
      throw new Error('图片导入已取消：文档内容或编辑状态已改变，请重新粘贴。')
    }
    return true
  }

  private handleEditingKey(event: KeyboardEvent): boolean {
    if (isCompositionKeyEvent(event)) {
      return false
    }

    // WebKitGTK may report the native ISO_Left_Tab keysym as Unidentified.
    const isTab = event.key === 'Tab' || (event.key === 'Unidentified' && event.code === 'Tab')
    if (!this.editable) {
      // A read-only editor must remain escapable through ordinary Tab navigation.
      return !isTab && isTextEditingKey(event)
    }

    if (
      !event.altKey &&
      (event.ctrlKey || event.metaKey) &&
      (event.key === 'Home' || event.key === 'End')
    ) {
      const range = this.currentState.selection.main
      const head = event.key === 'Home' ? 0 : this.currentState.doc.length
      this.dispatch({
        selection: Selection.range(event.shiftKey ? range.anchor : head, head),
        origin: {
          type: 'command',
          id: event.key === 'Home' ? 'view.documentStart' : 'view.documentEnd',
        },
        addToHistory: false,
      })
      return true
    }

    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false
    }

    const table = this.activeTable
    if (table?.withinCell) {
      if (isTab) return this.runTableCommand(event.shiftKey ? 'previous' : 'next')
      if (event.key === 'Enter')
        return event.shiftKey
          ? this.insertText('<br>', 'table.break')
          : this.runTableCommand('down')
      if (event.key === 'Escape') return this.runTableCommand('exit')
      const range = this.currentState.selection.main
      if (
        range.empty &&
        ((event.key === 'Backspace' && range.head === table.cell.from) ||
          (event.key === 'Delete' && range.head === table.cell.to))
      )
        return true
      if (range.empty && (event.key === 'Backspace' || event.key === 'Delete')) {
        const before = this.currentState.doc.slice(table.cell.from, range.head)
        const after = this.currentState.doc.slice(range.head, table.cell.to)
        const tag =
          event.key === 'Backspace'
            ? /<br[ \t]*\/?>$/i.exec(before)?.[0]
            : /^<br[ \t]*\/?>/i.exec(after)?.[0]
        if (tag) {
          const from = event.key === 'Backspace' ? range.head - tag.length : range.head
          this.dispatch({
            changes: ChangeSet.delete(from, from + tag.length),
            selection: Selection.cursor(from),
            origin: { type: 'command', id: 'table.delete-break' },
            historyGroup: 'isolate',
          })
          return true
        }
      }
    } else if (table && (isTab || event.key === 'Enter')) {
      // A linear selection across cells is not a rectangular cell selection.
      // Keep structure commands from replacing its delimiters accidentally.
      return true
    }

    if (event.key.length === 1) {
      if (this.composing) {
        return false
      }

      return this.insertText(event.key)
    }

    switch (isTab ? 'Tab' : event.key) {
      case 'Enter':
        return this.handleBlockEnter()
      case 'Tab':
        return this.indentBlockLines(event.shiftKey)
      case 'Backspace':
        return this.deleteBackward()
      case 'Delete':
        return this.deleteForward()
      case 'Home':
      case 'End':
        return this.moveToLineBoundary(event.key === 'End', event.shiftKey)
      case 'ArrowLeft':
        return this.moveCursor('left', event.shiftKey)
      case 'ArrowRight':
        return this.moveCursor('right', event.shiftKey)
      case 'ArrowUp':
        return this.moveCursor('up', event.shiftKey)
      case 'ArrowDown':
        return this.moveCursor('down', event.shiftKey)
      default:
        return false
    }
  }

  private insertText(text: string, originId?: string): boolean {
    const range = this.currentState.selection.main
    if (this.activeTable?.withinCell && originId !== 'table.break')
      text = tableCellText(
        text,
        this.currentState.doc.slice(this.activeTable.cell.from, range.from),
      )
    const insertAt = range.from
    const origin =
      originId === undefined
        ? { type: 'input.type' as const }
        : { type: 'input.type' as const, id: originId }

    this.dispatch({
      changes: ChangeSet.replace(range.from, range.to, text),
      selection: Selection.cursor(insertAt + text.length),
      origin,
      historyGroup: originId === undefined ? 'merge' : 'isolate',
    })
    return true
  }

  private deleteBackward(): boolean {
    const range = this.currentState.selection.main

    if (!range.empty) {
      this.dispatch({
        changes: ChangeSet.delete(range.from, range.to),
        selection: Selection.cursor(range.from),
        origin: { type: 'input.delete' },
      })
      return true
    }

    if (range.head === 0) {
      return false
    }

    const line = this.currentState.doc.lineAt(range.head)
    const offset = range.head - line.from
    const prefix = listEditingPrefix(line.text)
    if (!this.codeBlockAt(range.head) && prefix && offset === prefix[0].length) {
      const remove = prefix[1] ? indentRemovalLength(prefix[1]) : prefix[0].length
      return this.applyBlockChanges(
        ChangeSet.delete(line.from, line.from + remove),
        'view.list.backspace',
      )
    }
    const before = line.text.slice(0, offset)
    if (/^[ \t]+$/u.test(before)) {
      const remove = before.endsWith('\t')
        ? 1
        : Math.min(offset % 2 || 2, / *$/u.exec(before)![0].length)
      return this.applyBlockChanges(
        ChangeSet.delete(range.head - remove, range.head),
        'view.indent.backspace',
      )
    }

    const from = previousGraphemePosition(this.currentState.doc, range.head)
    const to = snapGraphemePosition(this.currentState.doc, range.head, 'forward')

    this.dispatch({
      changes: ChangeSet.delete(from, to),
      selection: Selection.cursor(from),
      origin: { type: 'input.delete' },
    })
    return true
  }

  private deleteForward(): boolean {
    const range = this.currentState.selection.main

    if (!range.empty) {
      this.dispatch({
        changes: ChangeSet.delete(range.from, range.to),
        selection: Selection.cursor(range.from),
        origin: { type: 'input.delete' },
      })
      return true
    }

    if (range.head >= this.currentState.doc.length) {
      return false
    }

    const from = snapGraphemePosition(this.currentState.doc, range.head)
    const to = nextGraphemePosition(this.currentState.doc, range.head)

    this.dispatch({
      changes: ChangeSet.delete(from, to),
      selection: Selection.cursor(from),
      origin: { type: 'input.delete' },
    })
    return true
  }

  private moveToLineBoundary(end: boolean, extend: boolean): boolean {
    const range = this.currentState.selection.main
    const table = this.activeTable
    const bounds = table?.withinCell ? table.cell : this.currentState.doc.lineAt(range.head)
    const next = end ? bounds.to : bounds.from
    this.dispatch({
      selection: extend ? Selection.range(range.anchor, next) : Selection.cursor(next),
      origin: { type: 'command', id: end ? 'view.lineEnd' : 'view.lineStart' },
      addToHistory: false,
    })
    return true
  }

  private moveCursor(direction: 'left' | 'right' | 'up' | 'down', extend: boolean): boolean {
    const table = this.activeTable
    if (table?.withinCell) return this.moveTableCursor(table, direction, extend)
    const range = this.currentState.selection.main
    const current = range.head
    let next = current

    if (!extend && !range.empty) {
      next = direction === 'right' || direction === 'down' ? range.to : range.from
    } else if (direction === 'left') {
      next = previousGraphemePosition(this.currentState.doc, current)
    } else if (direction === 'right') {
      next = nextGraphemePosition(this.currentState.doc, current)
    } else {
      next = this.moveCursorVertically(current, direction)
    }

    if (this.mode !== 'source') {
      const forward = direction === 'right' || direction === 'down'
      const visited = new Set<number>()
      while (!visited.has(next)) {
        visited.add(next)
        const line = this.currentState.doc.lineAt(next)
        const block = codeBlockForLine(
          this.markdownParseState.cache.root.children ?? [],
          line.from,
          line.to,
        )
        const target =
          block &&
          codeFenceArrowTarget(block, line.from, line.to, forward, this.currentState.doc.length)
        if (target === undefined) break
        const clamped = Math.min(target, this.currentState.doc.length)
        next = Math.min(clamped, this.currentState.doc.lineAt(clamped).to)
      }
    }

    if (next === current && (extend || range.empty)) {
      return false
    }

    this.dispatch({
      selection: extend ? Selection.range(range.anchor, next) : Selection.cursor(next),
      origin: { type: 'command', id: `view.moveCursor.${direction}` },
      addToHistory: false,
    })
    return true
  }

  private moveTableCursor(
    table: TableContext,
    direction: 'left' | 'right' | 'up' | 'down',
    extend: boolean,
  ): boolean {
    this.dispatch({
      selection: tableArrowSelection(this.currentState, table, direction, extend),
      origin: { type: 'command', id: `table.arrow.${direction}` },
      addToHistory: false,
    })
    return true
  }

  private moveCursorVertically(pos: number, direction: 'up' | 'down'): number {
    const { line, offset } = positionToLineOffset(this.currentState, pos)
    const targetLineNumber = direction === 'up' ? line.number - 1 : line.number + 1

    if (targetLineNumber < 1 || targetLineNumber > this.currentState.doc.lineCount) {
      return pos
    }

    const targetLine = this.currentState.doc.line(targetLineNumber)
    return snapGraphemePosition(
      this.currentState.doc,
      targetLine.from + Math.min(offset, targetLine.to - targetLine.from),
    )
  }

  private placeCursorFromClick(event: MouseEvent): void {
    if (isEditorScrollbarDragStart(event, this.dom)) return
    if (this.suppressNextClick) {
      this.suppressNextClick = false
      event.preventDefault()
      return
    }

    const pos = this.positionFromLineEvent(event)

    if (pos === undefined) {
      return
    }

    this.dispatch({
      selection: Selection.cursor(pos),
      origin: { type: 'command', id: 'view.pointer.clickSelection' },
      addToHistory: false,
    })
    this.inputDOM.focus({ preventScroll: true })
  }

  private startSelectionDrag(event: MouseEvent): void {
    if (event.button !== 0) {
      return
    }

    if (isHorizontalScrollbarDragStart(event) || isEditorScrollbarDragStart(event, this.dom)) {
      return
    }

    const pos = this.positionFromLineEvent(event)

    if (pos === undefined) {
      return
    }

    this.dragAnchor = pos
    this.isDraggingSelection = true
    this.hasDraggedSelection = false
    this.suppressNextClick = true
    this.dispatch({
      selection: Selection.cursor(pos),
      origin: { type: 'command', id: 'view.pointer.dragSelection.start' },
      addToHistory: false,
    })
    this.inputDOM.focus({ preventScroll: true })
    event.preventDefault()
  }

  private updateSelectionDrag(event: MouseEvent): void {
    if (!this.isDraggingSelection || this.dragAnchor === undefined) {
      return
    }

    const pos = this.positionFromLineEvent(event)

    if (pos === undefined) {
      return
    }

    if (pos === this.dragAnchor && !this.hasDraggedSelection) {
      event.preventDefault()
      return
    }

    this.hasDraggedSelection = true
    this.suppressNextClick = true
    this.dispatch({
      selection:
        pos === this.dragAnchor ? Selection.cursor(pos) : Selection.range(this.dragAnchor, pos),
      origin: { type: 'command', id: 'view.pointer.dragSelection.update' },
      addToHistory: false,
    })
    event.preventDefault()
  }

  private finishSelectionDrag(event: MouseEvent): void {
    if (!this.isDraggingSelection) {
      return
    }

    if (this.hasDraggedSelection) {
      this.updateSelectionDrag(event)
    }

    this.isDraggingSelection = false
    this.hasDraggedSelection = false
    this.dragAnchor = undefined
    event.preventDefault()
  }

  private positionFromLineEvent(event: MouseEvent): number | undefined {
    // The editor owns its blank gutters, while embedded controls keep their own
    // focus and pointer behavior (task markers are handled before this method).
    if (
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, button')
    ) {
      return undefined
    }
    const target = lineElementFromEvent(event, this.contentDOM, this.inputDOM)

    if (!target) {
      return this.positionFromEditorEvent(event)
    }

    const from = Number(target.dataset.from)
    const to = Number(target.dataset.to)

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return undefined
    }

    const caretPosition = sourcePositionFromPoint(target, event, this.inputDOM, {
      allowGeometryFallback: true,
    })

    if (caretPosition !== undefined) {
      return this.normalizeRenderedClickPosition(clamp(caretPosition, from, to))
    }

    return from === to ? from : this.positionFromEditorEvent(event)
  }

  private positionFromEditorEvent(event: MouseEvent): number | undefined {
    const target = event.target

    if (!(target instanceof Node) || !this.dom.contains(target)) {
      return undefined
    }

    // Live lines may wrap or have block-specific heights. A click beside the
    // centered body must use the nearest rendered line, not a fixed row height.
    let nearest: { line: HTMLElement; distance: number } | undefined
    for (const line of Array.from(this.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))) {
      const rect = line.getBoundingClientRect()
      if (rect.height <= 0) continue
      const distance = Math.max(rect.top - event.clientY, event.clientY - rect.bottom, 0)
      if (!nearest || distance < nearest.distance) nearest = { line, distance }
      if (distance === 0) break
    }
    if (nearest) {
      const line = nearest.line
      const rect = line.getBoundingClientRect()
      const from = Number(line.dataset.from),
        to = Number(line.dataset.to)
      const position =
        event.clientX <= rect.left
          ? from
          : event.clientX >= rect.right
            ? to
            : sourcePositionFromPoint(line, event, this.inputDOM, { allowGeometryFallback: true })
      if (position !== undefined && Number.isInteger(from) && Number.isInteger(to)) {
        return this.normalizeRenderedClickPosition(clamp(position, from, to))
      }
    }

    const rect = this.contentDOM.getBoundingClientRect()
    const view = this.ownerDocument.defaultView
    const style = view ? view.getComputedStyle(this.contentDOM) : undefined
    const paddingLeft = Number.parseFloat(style?.paddingLeft ?? '0') || 0
    const paddingTop = Number.parseFloat(style?.paddingTop ?? '0') || 0
    const x = Math.max(0, event.clientX - rect.left - paddingLeft)
    const y = Math.max(0, event.clientY - rect.top - paddingTop)

    return this.coordinateToPosition({ x, y })
  }

  private normalizeRenderedClickPosition(position: number): number {
    if (this.mode === 'source') {
      return position
    }

    const line = this.currentState.doc.lineAt(position)
    const blocks = this.markdownParseState.cache.root.children ?? []
    const listItem =
      findListItemForLine(blocks, line.from, line.to) ??
      fallbackListItemForLine(this.currentState.doc.text, line.from, line.to, blocks)

    if (!listItem) {
      return position
    }

    return normalizeListSyntaxPosition(
      this.currentState.doc.text,
      listItem,
      line.from,
      line.to,
      position,
    )
  }

  private codeBlockAt(position: number): SyntaxNode | undefined {
    for (const block of walkSyntaxNodes(this.markdownParseState.cache.root.children ?? [])) {
      if (
        (block.type === 'fencedCode' || block.type === 'indentedCode') &&
        position >= block.from &&
        (position < block.to ||
          (position === block.to && block.to === this.currentState.doc.length))
      )
        return block
    }
    return undefined
  }

  private applyBlockChanges(changes: ChangeSet, id: string): boolean {
    if (changes.empty) return true
    this.dispatch({
      changes,
      selection: this.currentState.selection.map(changes),
      origin: { type: 'command', id },
      historyGroup: 'isolate',
    })
    return true
  }

  private handleBlockEnter(): boolean {
    const range = this.currentState.selection.main
    const line = this.currentState.doc.lineAt(range.from)
    const code = this.codeBlockAt(range.from)
    if (code) {
      const closing =
        code.type === 'fencedCode' && code.status === 'valid'
          ? code.markerRanges?.at(-1)
          : undefined
      const atClosingFence =
        closing !== undefined && closing.from >= line.from && closing.to <= line.to
      const indent = atClosingFence
        ? ''
        : (/^[ \t]*/u.exec(line.text.slice(0, range.from - line.from))?.[0] ?? '')
      return this.insertText(`\n${indent}`, 'input.enter')
    }
    const prefix = listEditingPrefix(line.text)
    if (prefix && range.from >= line.from + prefix[0].length) {
      if (range.empty && line.text.slice(prefix[0].length).trim() === '') {
        const remove = prefix[1] ? indentRemovalLength(prefix[1]) : line.text.length
        return this.applyBlockChanges(
          ChangeSet.delete(line.from, line.from + remove),
          'view.list.exit',
        )
      }
      if (range.to <= line.to)
        return this.insertText(`\n${listContinuationPrefix(line.text) ?? ''}`, 'input.enter')
    }
    return this.insertText('\n', 'input.enter')
  }

  private indentBlockLines(outdent: boolean): boolean {
    const range = this.currentState.selection.main
    const doc = this.currentState.doc
    const first = doc.lineAt(range.from)
    const last = doc.lineAt(range.empty ? range.to : Math.max(range.from, range.to - 1))
    const code = this.codeBlockAt(range.from)
    const list = !code && listEditingPrefix(first.text)
    if (!code && !list && first.number === last.number && !/^[ \t]+/u.test(first.text)) return false
    if (
      !outdent &&
      code &&
      range.empty &&
      /[^ \t]/u.test(first.text.slice(0, range.from - first.from))
    ) {
      return this.insertText(indentationText(this.presentation), 'input.indent')
    }
    const edits = []
    for (let number = first.number; number <= last.number; number++) {
      const line = doc.line(number)
      const remove = outdent ? presentationOutdent(line.text, this.presentation) : 0
      if (outdent && remove === 0) continue
      edits.push({
        from: line.from,
        to: line.from + remove,
        insert: outdent ? '' : indentationText(this.presentation),
      })
    }
    return this.applyBlockChanges(ChangeSet.of(edits), outdent ? 'view.outdent' : 'view.indent')
  }
}

function isTextEditingKey(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return false
  }

  if (event.key.length === 1) {
    return true
  }

  return ['Enter', 'Backspace', 'Delete', 'Tab'].includes(event.key)
}

function isCompositionKeyEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.key === 'Process'
}

export interface EditorMarkdownParseState {
  readonly cache: MarkdownParseCache
  readonly invalidatedRange?: {
    readonly from: number
    readonly to: number
  }
  readonly reusedPreviousTree: boolean
  readonly version: number
}

function createEditorMarkdownParseState(
  source: string,
  syntaxExtensions: readonly ControlledMarkdownSyntax[] = [],
): EditorMarkdownParseState {
  const parsed = parseMarkdown(source, { syntaxExtensions })

  return Object.freeze({
    cache: createMarkdownParseCache(parsed),
    reusedPreviousTree: false,
    version: 0,
  })
}

function updateEditorMarkdownParseState(
  previousParse: EditorMarkdownParseState,
  previousState: EditorState,
  state: EditorState,
  transactions: readonly Transaction[],
  syntaxExtensions: readonly ControlledMarkdownSyntax[] = [],
): EditorMarkdownParseState {
  if (previousState.doc === state.doc) {
    return previousParse
  }

  const change = getSingleTransactionParseChange(transactions)
  const parsed = parseMarkdownIncremental(state.doc.text, {
    previous: previousParse.cache,
    ...(change ? { change } : {}),
    syntaxExtensions,
  })

  return createEditorMarkdownParseStateFromResult(parsed, previousParse.version + 1)
}

function getSingleTransactionParseChange(
  transactions: readonly Transaction[],
): ParseChange | undefined {
  if (transactions.length !== 1) {
    return undefined
  }

  const changes = transactions[0]?.changes?.changes

  if (!changes || changes.length !== 1) {
    return undefined
  }

  const [change] = changes

  if (!change) {
    return undefined
  }

  return {
    from: change.from,
    to: change.to,
    insertedLength: change.insert.length,
  }
}

function createEditorMarkdownParseStateFromResult(
  result: IncrementalMarkdownParseResult,
  version: number,
): EditorMarkdownParseState {
  return Object.freeze({
    cache: result.cache,
    ...(result.invalidatedRange ? { invalidatedRange: result.invalidatedRange } : {}),
    reusedPreviousTree: result.reusedPreviousTree,
    version,
  })
}

export function renderPlainTextLines(
  document: Document,
  state: EditorState,
): readonly HTMLElement[] {
  return renderPlainTextLineWindow(document, state, 1, state.doc.lineCount)
}

export function renderPlainTextLineWindow(
  document: Document,
  state: EditorState,
  fromLine: number,
  toLine: number,
): readonly HTMLElement[] {
  const lines: HTMLElement[] = []
  const startLine = clamp(Math.floor(fromLine), 1, state.doc.lineCount)
  const endLine = clamp(Math.floor(toLine), startLine, state.doc.lineCount)

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const line = state.doc.line(lineNumber)
    const lineDOM = document.createElement('div')
    lineDOM.className = 'milkup-line'
    lineDOM.dataset.line = String(line.number)
    lineDOM.dataset.from = String(line.from)
    lineDOM.dataset.to = String(line.to)
    lineDOM.textContent = line.text.length > 0 ? line.text : '\u200b'
    lines.push(lineDOM)
  }

  return Object.freeze(lines)
}

export interface VisibleLineWindowConfig {
  readonly lineCount: number
  readonly scrollTop: number
  readonly viewportHeight?: number
  readonly lineHeight?: number
  readonly overscanLines?: number
}

export function getVisibleLineWindow(config: VisibleLineWindowConfig): VisibleLineWindow {
  const lineCount = Math.max(1, Math.floor(config.lineCount))
  const lineHeight = Math.max(1, config.lineHeight ?? defaultViewMetrics.lineHeight)
  const viewportHeight = Math.max(lineHeight, config.viewportHeight ?? lineHeight * 24)
  const overscanLines = Math.max(0, Math.floor(config.overscanLines ?? 4))
  const firstVisibleLine = clamp(
    Math.floor(Math.max(0, config.scrollTop) / lineHeight) + 1,
    1,
    lineCount,
  )
  const visibleLineCount = Math.max(1, Math.ceil(viewportHeight / lineHeight))
  const fromLine = clamp(firstVisibleLine - overscanLines, 1, lineCount)
  const toLine = clamp(firstVisibleLine + visibleLineCount + overscanLines - 1, fromLine, lineCount)

  return Object.freeze({
    fromLine,
    toLine,
    topSpacerHeight: (fromLine - 1) * lineHeight,
    bottomSpacerHeight: (lineCount - toLine) * lineHeight,
  })
}

function renderVirtualSpacer(
  document: Document,
  position: 'top' | 'bottom',
  height: number,
): HTMLElement {
  const spacer = document.createElement('div')
  spacer.className = 'milkup-virtual-spacer'
  spacer.dataset.spacer = position
  spacer.style.height = `${Math.max(0, height)}px`
  return spacer
}

export interface RenderMarkdownLinesOptions {
  readonly root?: SyntaxNode
  readonly controlledRenderers?: readonly ControlledRenderer[]
  readonly markdownSyntax?: readonly ControlledMarkdownSyntax[]
}

export function renderMarkdownLines(
  document: Document,
  state: EditorState,
  mode: Exclude<ViewMode, 'source'> = 'live',
  options: RenderMarkdownLinesOptions = {},
): readonly HTMLElement[] {
  const blocks =
    (
      options.root ??
      parseMarkdown(state.doc.text, {
        ...(options.markdownSyntax ? { syntaxExtensions: options.markdownSyntax } : {}),
      }).root
    ).children ?? []
  const lines: HTMLElement[] = []

  for (let lineNumber = 1; lineNumber <= state.doc.lineCount; lineNumber += 1) {
    lines.push(renderMarkdownLine(document, state, mode, blocks, lineNumber, options))
  }

  return Object.freeze(lines)
}

function renderMarkdownLine(
  document: Document,
  state: EditorState,
  mode: Exclude<ViewMode, 'source'>,
  blocks: readonly SyntaxNode[],
  lineNumber: number,
  options: RenderMarkdownLinesOptions = {},
): HTMLElement {
  const line = state.doc.line(lineNumber)
  const lineDOM = createLineElement(document, line.number, line.from, line.to)
  lineDOM.classList.add(`milkup-line-${mode}`)
  applyBlockDecorations(lineDOM, blocks, line.from, line.to)
  const renderedPluginLine = renderControlledRendererLine(
    document,
    state,
    lineDOM,
    blocks,
    line.from,
    line.to,
    options.controlledRenderers ?? [],
  )

  if (renderedPluginLine) {
    return renderedPluginLine
  }

  const listItem =
    findListItemForLine(blocks, line.from, line.to) ??
    fallbackListItemForLine(state.doc.text, line.from, line.to, blocks)
  const heading = findBlockForLine(blocks, 'heading', line.from, line.to)
  const blockquoteLine = findNestedBlockForLine(
    blocks,
    'blockquote',
    'blockquoteLine',
    line.from,
    line.to,
  )
  const tableRow = findNestedBlockForLine(blocks, 'table', 'tableRow', line.from, line.to)
  const table = findBlockForLine(blocks, 'table', line.from, line.to)

  if (!shouldRenderInlineDecorations(blocks, line.from, line.to)) {
    const code = codeBlockForLine(blocks, line.from, line.to)
    if (code) renderCodeLine(lineDOM, line.text, line.from, code)
    else lineDOM.textContent = line.text || '\u200b'
  } else if (heading) {
    lineDOM.replaceChildren(
      ...renderBlockLineDecorations(
        document,
        state.doc.text,
        state.selection,
        heading,
        line.from,
        line.to,
        {
          contentClassName: 'milkup-heading-content',
          markerClassName: 'milkup-heading-marker',
        },
      ),
    )
  } else if (blockquoteLine) {
    lineDOM.replaceChildren(
      ...renderBlockLineDecorations(
        document,
        state.doc.text,
        state.selection,
        blockquoteLine,
        line.from,
        line.to,
        {
          contentClassName: 'milkup-blockquote-content',
          markerClassName: 'milkup-blockquote-marker',
          hideValidMarkers: true,
        },
      ),
    )
  } else if (tableRow) {
    lineDOM.replaceChildren(
      ...renderTableRowDecorations(
        document,
        state.doc.text,
        state.selection,
        tableRow,
        line.from,
        line.to,
      ),
    )
  } else if (table) {
    lineDOM.classList.add('milkup-table-delimiter')
    lineDOM.replaceChildren(
      ...renderHiddenBlockMarkerLine(
        document,
        state.doc.text,
        state.selection,
        line.from,
        line.to,
        { hidden: true },
      ),
    )
  } else if (listItem) {
    lineDOM.classList.add('milkup-block-list')
    lineDOM.replaceChildren(
      ...renderListItemLineDecorations(
        document,
        state.doc.text,
        state.selection,
        listItem,
        line.from,
        line.to,
      ),
    )
  } else {
    lineDOM.replaceChildren(
      ...renderInlineDecorations(document, state.doc.text, state.selection, line.from, line.to),
    )
  }

  applyTableAlignments(lineDOM, table)
  return lineDOM
}

function renderControlledRendererLine(
  document: Document,
  state: EditorState,
  lineDOM: HTMLElement,
  blocks: readonly SyntaxNode[],
  lineFrom: number,
  lineTo: number,
  renderers: readonly ControlledRenderer[],
): HTMLElement | undefined {
  const match = findControlledRendererMatch(blocks, lineFrom, lineTo, renderers)

  if (!match) {
    return undefined
  }

  const { node, renderer } = match
  const slot = document.createElement('span')
  slot.className = 'milkup-plugin-renderer-slot'
  slot.dataset.pluginRenderer = renderer.id
  slot.dataset.nodeType = node.type
  slot.textContent = state.doc.slice(lineFrom, lineTo) || '\u200b'
  lineDOM.classList.add('milkup-block-plugin-renderer')
  lineDOM.replaceChildren(slot)

  const context = Object.freeze({
    nodeType: node.type,
    source: state.doc.slice(node.from, node.to),
    node,
  })

  Promise.resolve()
    .then(() => renderer.render(context))
    .then((value) => {
      slot.replaceChildren(...createControlledRendererNodes(document, renderer.id, value))
      slot.dataset.rendererState = 'ready'
    })
    .catch((error: unknown) => {
      slot.dataset.rendererState = 'failed'
      slot.textContent = state.doc.slice(lineFrom, lineTo) || '\u200b'
      slot.title = error instanceof Error ? error.message : String(error)
    })

  return lineDOM
}

function findControlledRendererMatch(
  blocks: readonly SyntaxNode[],
  lineFrom: number,
  lineTo: number,
  renderers: readonly ControlledRenderer[],
): { readonly renderer: ControlledRenderer; readonly node: SyntaxNode } | undefined {
  if (renderers.length === 0) {
    return undefined
  }

  for (const node of walkSyntaxNodes(blocks)) {
    if (!nodeContainsLineStart(node, lineFrom, lineTo)) {
      continue
    }

    const renderer = renderers.find((candidate) => candidate.nodeType === node.type)

    if (renderer) {
      return { renderer, node }
    }
  }

  return undefined
}

function createLineElement(
  document: Document,
  lineNumber: number,
  from: number,
  to: number,
): HTMLElement {
  const lineDOM = document.createElement('div')
  lineDOM.className = 'milkup-line'
  lineDOM.dataset.line = String(lineNumber)
  lineDOM.dataset.from = String(from)
  lineDOM.dataset.to = String(to)
  return lineDOM
}

function applyBlockDecorations(
  lineDOM: HTMLElement,
  blocks: readonly SyntaxNode[],
  lineFrom: number,
  lineTo: number,
): void {
  for (const block of blocks) {
    if (!rangeContainsLine(block, lineFrom, lineTo)) {
      continue
    }

    if (block.type === 'heading') {
      lineDOM.classList.add('milkup-block-heading')
      const level = block.data?.level

      if (typeof level === 'number') {
        lineDOM.classList.add(`milkup-heading-level-${level}`)
      }
    }

    if (block.type === 'blockquote') {
      lineDOM.classList.add('milkup-block-blockquote')
    }

    if (
      (block.type === 'unorderedList' || block.type === 'orderedList') &&
      findListItemForLine([block], lineFrom, lineTo)
    ) {
      lineDOM.classList.add('milkup-block-list')
    }

    if (block.type === 'fencedCode' || block.type === 'indentedCode') {
      lineDOM.classList.add('milkup-block-code')
      const closing = block.markerRanges?.at(-1)
      if (
        block.type === 'fencedCode' &&
        block.status === 'valid' &&
        closing &&
        (block.markerRanges?.length ?? 0) >= 2
      ) {
        lineDOM.dataset.presentationBlockFrom = String(block.from)
        lineDOM.dataset.presentationBlockTo = String(closing.to)
      }
    }

    if (block.type === 'table') {
      lineDOM.classList.add('milkup-block-table')
    }
  }
}

function shouldRenderInlineDecorations(
  blocks: readonly SyntaxNode[],
  lineFrom: number,
  lineTo: number,
): boolean {
  return !blocks.some(
    (block) =>
      (block.type === 'fencedCode' || block.type === 'indentedCode') &&
      rangeIntersectsLine(block, lineFrom, lineTo),
  )
}

function isPositionInsideCodeBlock(
  state: EditorState,
  position: number,
  root?: SyntaxNode,
): boolean {
  const blocks = (root ?? parseMarkdown(state.doc.text).root).children ?? []

  return blocks.some(
    (block) =>
      (block.type === 'fencedCode' || block.type === 'indentedCode') &&
      position >= block.from &&
      position <= block.to,
  )
}

function findListItemForLine(
  blocks: readonly SyntaxNode[],
  lineFrom: number,
  lineTo: number,
): SyntaxNode | undefined {
  let containingItem: SyntaxNode | undefined

  for (const block of walkSyntaxNodes(blocks)) {
    if (block.type !== 'listItem' || !nodeContainsLineStart(block, lineFrom, lineTo)) {
      continue
    }

    if (
      (block.markerRanges ?? []).some((range) =>
        rangesIntersect(range.from, range.to, lineFrom, Math.max(lineFrom + 1, lineTo)),
      )
    ) {
      return block
    }

    if (!containingItem || block.to - block.from < containingItem.to - containingItem.from) {
      containingItem = block
    }
  }

  return containingItem
}

function fallbackListItemForLine(
  source: string,
  lineFrom: number,
  lineTo: number,
  blocks: readonly SyntaxNode[],
): SyntaxNode | undefined {
  const lineText = source.slice(lineFrom, lineTo)
  const match = /^(\s*)(?:([-+*])|(\d{1,9})([.)]))(?:[ \t]+|$)/u.exec(lineText)

  if (!match) {
    return undefined
  }

  if (
    [...walkSyntaxNodes(blocks)].some(
      (block) =>
        (block.type === 'fencedCode' || block.type === 'indentedCode') &&
        rangeIntersectsLine(block, lineFrom, lineTo),
    )
  ) {
    return undefined
  }

  const indentationLength = match[1]?.length ?? 0
  const markerLength = (match[2] ?? '').length + (match[3] ?? '').length + (match[4] ?? '').length
  const markerFrom = lineFrom + indentationLength
  const markerTo = markerFrom + markerLength

  return {
    type: 'listItem',
    from: lineFrom,
    to: lineTo,
    status: 'valid',
    markerRanges: [{ from: markerFrom, to: markerTo }],
    contentRanges: [{ from: lineFrom + match[0].length, to: lineTo }],
  }
}

function* walkSyntaxNodes(nodes: readonly SyntaxNode[]): Generator<SyntaxNode> {
  for (const node of nodes) {
    yield node

    if (node.children) {
      yield* walkSyntaxNodes(node.children)
    }
  }
}

function findBlockForLine(
  blocks: readonly SyntaxNode[],
  type: string,
  lineFrom: number,
  lineTo: number,
): SyntaxNode | undefined {
  return blocks.find((block) => block.type === type && rangeContainsLine(block, lineFrom, lineTo))
}

function findNestedBlockForLine(
  blocks: readonly SyntaxNode[],
  parentType: string,
  childType: string,
  lineFrom: number,
  lineTo: number,
): SyntaxNode | undefined {
  for (const block of blocks) {
    if (block.type !== parentType || !rangeContainsLine(block, lineFrom, lineTo)) {
      continue
    }

    const child = (block.children ?? []).find(
      (node) => node.type === childType && rangeContainsLine(node, lineFrom, lineTo),
    )

    if (child) {
      return child
    }
  }

  return undefined
}

function renderBlockLineDecorations(
  document: Document,
  source: string,
  selection: Selection,
  block: SyntaxNode,
  from: number,
  to: number,
  classNames: {
    readonly markerClassName: string
    readonly contentClassName: string
    readonly hideValidMarkers?: boolean
  },
): readonly Node[] {
  return renderRangedLineDecorations(document, source, selection, block, from, to, classNames)
}

function renderTableRowDecorations(
  document: Document,
  source: string,
  selection: Selection,
  tableRow: SyntaxNode,
  from: number,
  to: number,
): readonly Node[] {
  return renderRangedLineDecorations(document, source, selection, tableRow, from, to, {
    markerClassName: 'milkup-table-marker',
    contentClassName: 'milkup-table-cell',
    hideValidMarkers: true,
    preserveEmptyContentRanges: true,
  })
}

function renderRangedLineDecorations(
  document: Document,
  source: string,
  selection: Selection,
  node: SyntaxNode,
  from: number,
  to: number,
  classNames: {
    readonly markerClassName: string
    readonly contentClassName: string
    readonly hideValidMarkers?: boolean
    readonly preserveEmptyContentRanges?: boolean
  },
): readonly Node[] {
  const pieces = collectContentLinePieces(
    node,
    from,
    to,
    classNames.preserveEmptyContentRanges === true ? { preserveEmptyContentRanges: true } : {},
  )

  if (pieces.length === 0) {
    return renderInlineDecorations(document, source, selection, from, to)
  }

  const showSyntax = classNames.hideValidMarkers ? false : shouldShowBlockSyntax(node, selection)
  const rendered: Node[] = []

  for (const piece of pieces) {
    const span = document.createElement('span')
    span.className =
      piece.kind === 'content'
        ? classNames.contentClassName
        : `milkup-block-marker ${classNames.markerClassName}`
    span.dataset.from = String(piece.from)
    span.dataset.to = String(piece.to)

    if (piece.kind === 'content') {
      if (piece.to > piece.from) {
        span.replaceChildren(
          ...renderInlineDecorations(document, source, selection, piece.from, piece.to),
        )
      }
    } else {
      span.textContent = source.slice(piece.from, piece.to)

      if (!showSyntax) {
        span.classList.add('milkup-marker-hidden')
      }
    }

    rendered.push(span)
  }

  return Object.freeze(rendered)
}

function renderHiddenBlockMarkerLine(
  document: Document,
  source: string,
  selection: Selection,
  from: number,
  to: number,
  options: { readonly hidden?: boolean } = {},
): readonly Node[] {
  if (to <= from) {
    return [document.createTextNode('\u200b')]
  }

  const marker = document.createElement('span')
  marker.className = 'milkup-block-marker milkup-table-marker'
  marker.dataset.from = String(from)
  marker.dataset.to = String(to)
  marker.textContent = source.slice(from, to)

  if (options.hidden ?? !shouldShowLineSyntax(selection, from, to)) {
    marker.classList.add('milkup-marker-hidden')
  }

  return [marker]
}

function renderListItemLineDecorations(
  document: Document,
  source: string,
  selection: Selection,
  listItem: SyntaxNode,
  from: number,
  to: number,
): readonly Node[] {
  const pieces = collectListItemLinePieces(source, listItem, from, to)

  if (pieces.length === 0) {
    return renderInlineDecorations(document, source, selection, from, to)
  }

  const rendered: Node[] = []
  let pos = from

  for (const piece of pieces) {
    if (piece.from > pos) {
      rendered.push(createMappedTextNode(document, source, pos, piece.from))
    }

    if (piece.kind === 'marker') {
      const marker = document.createElement('span')
      marker.className = 'milkup-list-marker'
      marker.dataset.from = String(piece.from)
      marker.dataset.to = String(piece.to)
      marker.textContent = formatListMarker(source.slice(piece.from, piece.to))
      if (pieces.some((piece) => piece.kind === 'taskMarker'))
        marker.classList.add('milkup-marker-hidden')
      rendered.push(marker)
    } else if (piece.kind === 'taskMarker') {
      const task = createTaskMarker(
        document,
        piece.from,
        piece.to,
        source.slice(piece.from, piece.to),
      )
      rendered.push(task)
    } else {
      const content = document.createElement('span')
      content.className = 'milkup-list-content'
      content.dataset.from = String(piece.from)
      content.dataset.to = String(piece.to)
      content.replaceChildren(
        ...renderInlineDecorations(document, source, selection, piece.from, piece.to),
      )
      rendered.push(content)
    }

    pos = piece.to
  }

  if (pos < to) {
    rendered.push(createMappedTextNode(document, source, pos, to))
  }

  return Object.freeze(rendered)
}

function collectListItemLinePieces(
  source: string,
  listItem: SyntaxNode,
  from: number,
  to: number,
): readonly InlinePiece[] {
  const pieces: InlinePiece[] = []

  for (const range of listItem.markerRanges ?? []) {
    if (rangesIntersect(range.from, range.to, from, to)) {
      pieces.push({
        from: clamp(range.from, from, to),
        to: clamp(range.to, from, to),
        kind: 'marker',
      })
    }
  }

  for (const range of listItem.contentRanges ?? []) {
    if (rangesIntersect(range.from, range.to, from, to)) {
      const taskMarker = taskMarkerRange(source, range.from, range.to)

      if (taskMarker && rangesIntersect(taskMarker.from, taskMarker.to, from, to)) {
        pieces.push({
          from: clamp(taskMarker.from, from, to),
          to: clamp(taskMarker.to, from, to),
          kind: 'taskMarker',
        })
      }

      const contentFrom = taskMarker ? taskMarker.to : range.from

      const pieceFrom = clamp(contentFrom, from, to)
      const pieceTo = clamp(range.to, from, to)

      if (pieceTo > pieceFrom) {
        pieces.push({
          from: pieceFrom,
          to: pieceTo,
          kind: 'content',
        })
      }
    }
  }

  return Object.freeze(pieces.sort((left, right) => left.from - right.from || left.to - right.to))
}

function collectContentLinePieces(
  node: SyntaxNode,
  from: number,
  to: number,
  options: { readonly preserveEmptyContentRanges?: boolean } = {},
): readonly InlinePiece[] {
  const contentPieces = (node.contentRanges ?? [])
    .filter((range) => rangesIntersect(range.from, range.to, from, to))
    .map((range) => ({
      from: clamp(range.from, from, to),
      to: clamp(range.to, from, to),
      kind: 'content' as const,
    }))
    .filter(
      (piece) =>
        piece.to > piece.from ||
        (options.preserveEmptyContentRanges === true && piece.to === piece.from),
    )
    .sort((left, right) => left.from - right.from || left.to - right.to)

  const pieces: InlinePiece[] = []
  let pos = from

  for (const piece of contentPieces) {
    if (piece.from > pos) {
      pieces.push({ from: pos, to: piece.from, kind: 'marker' })
    }

    pieces.push(piece)
    pos = piece.to
  }

  if (pos < to) {
    pieces.push({ from: pos, to, kind: 'marker' })
  }

  if (pieces.length === 0 && to > from) {
    pieces.push({ from, to, kind: 'marker' })
  }

  return Object.freeze(pieces)
}

function renderInlineDecorations(
  document: Document,
  source: string,
  selection: Selection,
  from: number,
  to: number,
): readonly Node[] {
  if (to <= from) {
    return [document.createTextNode('\u200b')]
  }

  const nodes = parseInline(source, from, to)
  const fragments: Node[] = []
  let pos = from

  for (const node of nodes) {
    if (node.from > pos) {
      fragments.push(createMappedTextNode(document, source, pos, node.from))
    }

    fragments.push(renderInlineNode(document, source, selection, node))
    pos = node.to
  }

  if (pos < to) {
    fragments.push(createMappedTextNode(document, source, pos, to))
  }

  return Object.freeze(fragments)
}

function renderInlineNode(
  document: Document,
  source: string,
  selection: Selection,
  node: SyntaxNode,
): Node {
  const span = document.createElement('span')
  span.className = `milkup-inline milkup-inline-${node.type}`
  span.dataset.from = String(node.from)
  span.dataset.to = String(node.to)
  span.dataset.status = node.status
  span.dataset.syntaxVisible = String(shouldShowInlineSyntax(node, selection))
  span.replaceChildren(...renderInlineNodePieces(document, source, selection, node))
  if (
    node.type === 'image' &&
    node.status === 'valid' &&
    typeof node.data?.destination === 'string'
  ) {
    span.dataset.imageUrl = node.data.destination
    span.dataset.imageAlt = typeof node.data.label === 'string' ? node.data.label : ''
  }
  if (node.type === 'strikethrough') span.style.textDecoration = 'line-through'
  if (node.type === 'hardBreak' && node.data?.kind === 'html')
    span.append(document.createElement('br'))
  return span
}

function createMappedTextNode(
  document: Document,
  source: string,
  from: number,
  to: number,
): HTMLElement {
  const span = document.createElement('span')
  span.dataset.from = String(from)
  span.dataset.to = String(to)
  span.textContent = source.slice(from, to)
  return span
}

type InlinePieceKind = 'content' | 'marker' | 'syntax' | 'taskMarker'

interface InlinePiece {
  readonly from: number
  readonly to: number
  readonly kind: InlinePieceKind
}

function formatListMarker(marker: string): string {
  const trimmed = marker.trim()

  if (trimmed === '-' || trimmed === '*' || trimmed === '+') {
    return '•'
  }

  return trimmed
}

function taskMarkerRange(
  source: string,
  from: number,
  to: number,
): { readonly from: number; readonly to: number } | undefined {
  const text = source.slice(from, to)
  const match = /^(\s*\[[ xX]\]\s*)/u.exec(text)

  if (!match) {
    return undefined
  }

  return { from, to: from + (match[1]?.length ?? 0) }
}

function normalizeListSyntaxPosition(
  source: string,
  listItem: SyntaxNode,
  lineFrom: number,
  lineTo: number,
  position: number,
): number {
  const contentRange = (listItem.contentRanges ?? []).find((range) =>
    rangesIntersect(range.from, range.to, lineFrom, lineTo),
  )

  if (!contentRange) {
    return position
  }

  const taskMarker = taskMarkerRange(source, contentRange.from, contentRange.to)
  const contentStart = taskMarker ? taskMarker.to : contentRange.from

  if (position < contentStart) {
    return clamp(contentStart, lineFrom, lineTo)
  }

  if (taskMarker && position >= taskMarker.from && position <= taskMarker.to) {
    return clamp(taskMarker.to, lineFrom, lineTo)
  }

  return position
}

function listEditingPrefix(line: string): RegExpExecArray | null {
  return /^([ \t]*)(?:[-+*]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/u.exec(line)
}

function indentRemovalLength(text: string): number {
  return /^(?:\t| {1,2})/u.exec(text)?.[0].length ?? 0
}

function listContinuationPrefix(lineText: string): string | undefined {
  const unordered = /^(\s*)([-+*])([ \t]+)(?:\[[ xX]\]([ \t]+))?/u.exec(lineText)

  if (unordered) {
    return `${unordered[1] ?? ''}${unordered[2] ?? '-'}${unordered[3] ?? ' '}${
      unordered[4] === undefined ? '' : `[ ]${unordered[4]}`
    }`
  }

  const ordered = /^(\s*)(\d{1,9})([.)])([ \t]+)(?:\[[ xX]\]([ \t]+))?/u.exec(lineText)

  if (!ordered) {
    return undefined
  }

  const numberText = ordered[2] ?? '1'
  const nextNumber = String(Number.parseInt(numberText, 10) + 1).padStart(numberText.length, '0')

  return `${ordered[1] ?? ''}${nextNumber}${ordered[3] ?? '.'}${ordered[4] ?? ' '}${
    ordered[5] === undefined ? '' : `[ ]${ordered[5]}`
  }`
}

function renderInlineNodePieces(
  document: Document,
  source: string,
  selection: Selection,
  node: SyntaxNode,
): readonly Node[] {
  const pieces = collectInlinePieces(node)

  if (pieces.length === 0) {
    return [createMappedTextNode(document, source, node.from, node.to)]
  }

  const showSyntax = shouldShowInlineSyntax(node, selection)
  const rendered: Node[] = []
  let pos = node.from

  for (const piece of pieces) {
    if (piece.from > pos) {
      rendered.push(createMappedTextNode(document, source, pos, piece.from))
    }

    const span = document.createElement('span')
    span.className = `milkup-inline-${piece.kind}`
    span.dataset.from = String(piece.from)
    span.dataset.to = String(piece.to)

    if (piece.kind !== 'content' && !showSyntax) {
      span.classList.add('milkup-marker-hidden')
    }

    if (piece.kind === 'content' && node.children?.some((child) => child.type !== 'text')) {
      span.replaceChildren(
        ...renderInlineDecorations(document, source, selection, piece.from, piece.to),
      )
    } else span.textContent = source.slice(piece.from, piece.to)
    rendered.push(span)
    pos = piece.to
  }

  if (pos < node.to) {
    rendered.push(createMappedTextNode(document, source, pos, node.to))
  }

  return Object.freeze(rendered)
}

function collectInlinePieces(node: SyntaxNode): readonly InlinePiece[] {
  const pieces: InlinePiece[] = []

  for (const range of node.markerRanges ?? []) {
    pieces.push({ ...range, kind: 'marker' })
  }

  for (const [index, range] of (node.contentRanges ?? []).entries()) {
    pieces.push({
      ...range,
      kind: node.type === 'link' && index > 0 ? 'syntax' : 'content',
    })
  }

  return Object.freeze(pieces.sort((left, right) => left.from - right.from || left.to - right.to))
}

function shouldShowInlineSyntax(node: SyntaxNode, selection: Selection): boolean {
  if (node.status !== 'valid') {
    return true
  }

  return selection.ranges.some((range) =>
    range.empty
      ? range.head >= node.from && range.head <= node.to
      : range.from < node.to && range.to > node.from,
  )
}

function shouldShowBlockSyntax(node: SyntaxNode, selection: Selection): boolean {
  if (node.status !== 'valid') {
    return true
  }

  return shouldShowLineSyntax(selection, node.from, node.to)
}

function shouldShowLineSyntax(selection: Selection, from: number, to: number): boolean {
  return selection.ranges.some((range) =>
    range.empty ? range.head >= from && range.head <= to : range.from < to && range.to > from,
  )
}

export type ProjectionSegmentKind = InlinePieceKind | 'text'

export interface LineProjectionSegment {
  readonly sourceFrom: number
  readonly sourceTo: number
  readonly visualFrom: number
  readonly visualTo: number
  readonly hidden: boolean
  readonly kind: ProjectionSegmentKind
}

export interface LineProjection {
  readonly sourceFrom: number
  readonly sourceTo: number
  readonly visualLength: number
  readonly segments: readonly LineProjectionSegment[]
}

export function buildLineProjection(
  source: string,
  selection: Selection,
  from: number,
  to: number,
): LineProjection {
  const segments: LineProjectionSegment[] = []
  let sourcePos = from
  let visualPos = 0

  const appendSegment = (
    sourceFrom: number,
    sourceTo: number,
    kind: ProjectionSegmentKind,
    hidden: boolean,
  ): void => {
    if (sourceTo <= sourceFrom) {
      return
    }

    const visualFrom = visualPos
    const visualTo = hidden ? visualFrom : visualFrom + sourceTo - sourceFrom
    segments.push({
      sourceFrom,
      sourceTo,
      visualFrom,
      visualTo,
      hidden,
      kind,
    })
    visualPos = visualTo
  }

  for (const node of parseInline(source, from, to)) {
    if (node.from > sourcePos) {
      appendSegment(sourcePos, node.from, 'text', false)
    }

    if (node.type === 'text') {
      appendSegment(node.from, node.to, 'text', false)
      sourcePos = node.to
      continue
    }

    const pieces = collectInlinePieces(node)
    const showSyntax = shouldShowInlineSyntax(node, selection)
    let nodePos = node.from

    if (pieces.length === 0) {
      appendSegment(node.from, node.to, 'text', false)
      sourcePos = node.to
      continue
    }

    for (const piece of pieces) {
      if (piece.from > nodePos) {
        appendSegment(nodePos, piece.from, 'text', false)
      }

      if (piece.kind === 'content' && node.children?.some((child) => child.type !== 'text')) {
        for (const segment of buildLineProjection(source, selection, piece.from, piece.to)
          .segments) {
          appendSegment(segment.sourceFrom, segment.sourceTo, segment.kind, segment.hidden)
        }
      } else
        appendSegment(piece.from, piece.to, piece.kind, piece.kind !== 'content' && !showSyntax)
      nodePos = piece.to
    }

    if (nodePos < node.to) {
      appendSegment(nodePos, node.to, 'text', false)
    }

    sourcePos = node.to
  }

  if (sourcePos < to) {
    appendSegment(sourcePos, to, 'text', false)
  }

  return Object.freeze({
    sourceFrom: from,
    sourceTo: to,
    visualLength: visualPos,
    segments: Object.freeze(segments),
  })
}

function buildRangedLineProjection(
  source: string,
  selection: Selection,
  node: SyntaxNode,
  from: number,
  to: number,
  options: { readonly hideValidMarkers?: boolean } = {},
): LineProjection {
  const segments: LineProjectionSegment[] = []
  let visualPos = 0
  const showSyntax = options.hideValidMarkers ? false : shouldShowBlockSyntax(node, selection)

  const appendSegment = (
    sourceFrom: number,
    sourceTo: number,
    kind: ProjectionSegmentKind,
    hidden: boolean,
  ): void => {
    if (sourceTo <= sourceFrom) {
      return
    }

    const visualFrom = visualPos
    const visualTo = hidden ? visualFrom : visualFrom + sourceTo - sourceFrom
    segments.push({
      sourceFrom,
      sourceTo,
      visualFrom,
      visualTo,
      hidden,
      kind,
    })
    visualPos = visualTo
  }

  for (const piece of collectContentLinePieces(node, from, to)) {
    if (piece.kind === 'marker') {
      appendSegment(piece.from, piece.to, 'marker', !showSyntax)
      continue
    }

    const contentProjection = buildLineProjection(source, selection, piece.from, piece.to)

    for (const segment of contentProjection.segments) {
      appendSegment(segment.sourceFrom, segment.sourceTo, segment.kind, segment.hidden)
    }
  }

  return Object.freeze({
    sourceFrom: from,
    sourceTo: to,
    visualLength: visualPos,
    segments: Object.freeze(segments),
  })
}

function buildListItemLineProjection(
  source: string,
  selection: Selection,
  listItem: SyntaxNode,
  from: number,
  to: number,
): LineProjection {
  const segments: LineProjectionSegment[] = []
  let visualPos = 0

  const appendSegment = (
    sourceFrom: number,
    sourceTo: number,
    kind: ProjectionSegmentKind,
    hidden: boolean,
  ): void => {
    if (sourceTo <= sourceFrom) {
      return
    }

    const visualFrom = visualPos
    const visualTo = hidden ? visualFrom : visualFrom + sourceTo - sourceFrom
    segments.push({
      sourceFrom,
      sourceTo,
      visualFrom,
      visualTo,
      hidden,
      kind,
    })
    visualPos = visualTo
  }

  for (const piece of collectListItemLinePieces(source, listItem, from, to)) {
    if (piece.kind === 'content') {
      const contentProjection = buildLineProjection(source, selection, piece.from, piece.to)

      for (const segment of contentProjection.segments) {
        appendSegment(segment.sourceFrom, segment.sourceTo, segment.kind, segment.hidden)
      }
      continue
    }

    appendSegment(piece.from, piece.to, piece.kind, true)
  }

  return Object.freeze({
    sourceFrom: from,
    sourceTo: to,
    visualLength: visualPos,
    segments: Object.freeze(segments),
  })
}

function buildMarkerLineProjection(
  from: number,
  to: number,
  options: { readonly hidden?: boolean } = {},
): LineProjection {
  const hidden = options.hidden ?? true

  return Object.freeze({
    sourceFrom: from,
    sourceTo: to,
    visualLength: hidden ? 0 : Math.max(0, to - from),
    segments: Object.freeze([
      {
        sourceFrom: from,
        sourceTo: to,
        visualFrom: 0,
        visualTo: hidden ? 0 : Math.max(0, to - from),
        hidden,
        kind: 'marker' as const,
      },
    ]),
  })
}

export function sourcePositionToVisualOffset(
  projection: LineProjection,
  sourcePos: number,
): number {
  const clampedSourcePos = clamp(sourcePos, projection.sourceFrom, projection.sourceTo)

  for (const segment of projection.segments) {
    if (clampedSourcePos < segment.sourceFrom) {
      return segment.visualFrom
    }

    if (clampedSourcePos > segment.sourceTo) {
      continue
    }

    if (segment.hidden) {
      return segment.visualFrom
    }

    return segment.visualFrom + clampedSourcePos - segment.sourceFrom
  }

  return projection.visualLength
}

export function visualOffsetToSourcePosition(
  projection: LineProjection,
  visualOffset: number,
  affinity: -1 | 1 = 1,
): number {
  const clampedVisualOffset = clamp(visualOffset, 0, projection.visualLength)
  const segments = affinity > 0 ? [...projection.segments].reverse() : [...projection.segments]

  for (const segment of segments) {
    if (segment.hidden) {
      if (clampedVisualOffset === segment.visualFrom) {
        return affinity > 0 ? segment.sourceTo : segment.sourceFrom
      }

      continue
    }

    if (clampedVisualOffset >= segment.visualFrom && clampedVisualOffset <= segment.visualTo) {
      return segment.sourceFrom + clampedVisualOffset - segment.visualFrom
    }
  }

  return affinity > 0 ? projection.sourceTo : projection.sourceFrom
}

function rangeIntersectsLine(node: SyntaxNode, lineFrom: number, lineTo: number): boolean {
  const normalizedLineTo = Math.max(lineFrom, lineTo)
  return node.from <= normalizedLineTo && node.to >= lineFrom
}

function rangeContainsLine(node: SyntaxNode, lineFrom: number, lineTo: number): boolean {
  const normalizedLineTo = Math.max(lineFrom, lineTo)

  if (lineFrom === normalizedLineTo) {
    return node.from <= lineFrom && node.to > lineFrom
  }

  return node.from <= lineFrom && node.to >= normalizedLineTo
}

function nodeContainsLineStart(node: SyntaxNode, lineFrom: number, lineTo: number): boolean {
  const normalizedLineTo = Math.max(lineFrom, lineTo)

  if (lineFrom === normalizedLineTo) {
    return node.from <= lineFrom && node.to > lineFrom
  }

  return node.from <= lineFrom && node.to > lineFrom
}

function rangesIntersect(
  leftFrom: number,
  leftTo: number,
  rightFrom: number,
  rightTo: number,
): boolean {
  return leftFrom < rightTo && leftTo > rightFrom
}

export function positionToLineOffset(state: EditorState, pos: number): PositionLineOffset {
  const line = state.doc.lineAt(pos)

  return Object.freeze({
    line,
    offset: pos - line.from,
  })
}

function positionToVisualLineOffset(
  state: EditorState,
  mode: ViewMode,
  pos: number,
  root?: SyntaxNode,
): PositionLineOffset {
  const line = state.doc.lineAt(pos)
  const projection = buildRenderedLineProjection(state, mode, line.from, line.to, root)

  return Object.freeze({
    line,
    offset:
      projection === undefined ? pos - line.from : sourcePositionToVisualOffset(projection, pos),
  })
}

function visualLineLength(
  state: EditorState,
  mode: ViewMode,
  from: number,
  to: number,
  root?: SyntaxNode,
): number {
  const projection = buildRenderedLineProjection(state, mode, from, to, root)

  return projection === undefined ? Math.max(0, to - from) : projection.visualLength
}

function lineVisualOffsetToSourcePosition(
  state: EditorState,
  mode: ViewMode,
  from: number,
  to: number,
  visualOffset: number,
  root?: SyntaxNode,
): number {
  const lineLength = Math.max(0, to - from)

  if (!Number.isFinite(visualOffset)) {
    return to
  }

  const projection = buildRenderedLineProjection(state, mode, from, to, root)

  if (projection === undefined) {
    return from + clamp(visualOffset, 0, lineLength)
  }

  return visualOffsetToSourcePosition(projection, visualOffset)
}

function buildRenderedLineProjection(
  state: EditorState,
  mode: ViewMode,
  from: number,
  to: number,
  root?: SyntaxNode,
): LineProjection | undefined {
  if (mode === 'source' || to <= from) {
    return undefined
  }

  const blocks = (root ?? parseMarkdown(state.doc.text).root).children ?? []

  if (!shouldRenderInlineDecorations(blocks, from, to)) {
    const code = codeBlockForLine(blocks, from, to)
    return code && isPresentedCodeFence(code, from, to)
      ? buildMarkerLineProjection(from, to)
      : undefined
  }

  const heading = findBlockForLine(blocks, 'heading', from, to)
  const blockquoteLine = findNestedBlockForLine(blocks, 'blockquote', 'blockquoteLine', from, to)
  const tableRow = findNestedBlockForLine(blocks, 'table', 'tableRow', from, to)
  const table = findBlockForLine(blocks, 'table', from, to)
  const listItem =
    findListItemForLine(blocks, from, to) ??
    fallbackListItemForLine(state.doc.text, from, to, blocks)

  if (heading) {
    return buildRangedLineProjection(state.doc.text, state.selection, heading, from, to)
  }

  if (blockquoteLine) {
    return buildRangedLineProjection(state.doc.text, state.selection, blockquoteLine, from, to, {
      hideValidMarkers: true,
    })
  }

  if (tableRow) {
    return buildRangedLineProjection(state.doc.text, state.selection, tableRow, from, to, {
      hideValidMarkers: true,
    })
  }

  if (table) {
    return buildMarkerLineProjection(from, to, { hidden: true })
  }

  if (listItem) {
    return buildListItemLineProjection(state.doc.text, state.selection, listItem, from, to)
  }

  return buildLineProjection(state.doc.text, state.selection, from, to)
}

export function positionToRect(
  state: EditorState,
  pos: number,
  metrics?: Partial<ViewMetrics>,
): ViewRect {
  return positionToRectForMode(state, 'source', pos, metrics)
}

function positionToRectForMode(
  state: EditorState,
  mode: ViewMode,
  pos: number,
  metrics?: Partial<ViewMetrics>,
  root?: SyntaxNode,
): ViewRect {
  const resolvedMetrics = resolveViewMetrics(metrics)
  const { line, offset } = positionToVisualLineOffset(state, mode, pos, root)
  const left = offset * resolvedMetrics.charWidth
  const top = (line.number - 1) * resolvedMetrics.lineHeight

  return Object.freeze({
    left,
    top,
    right: left,
    bottom: top + resolvedMetrics.lineHeight,
    width: 0,
    height: resolvedMetrics.lineHeight,
  })
}

export function coordinateToPosition(
  state: EditorState,
  coordinate: ViewCoordinate,
  metrics?: Partial<ViewMetrics>,
): number {
  return coordinateToPositionForMode(state, 'source', coordinate, metrics)
}

function coordinateToPositionForMode(
  state: EditorState,
  mode: ViewMode,
  coordinate: ViewCoordinate,
  metrics?: Partial<ViewMetrics>,
  root?: SyntaxNode,
): number {
  const resolvedMetrics = resolveViewMetrics(metrics)
  const lineNumber = clamp(
    Math.floor(coordinate.y / resolvedMetrics.lineHeight) + 1,
    1,
    state.doc.lineCount,
  )
  const line = state.doc.line(lineNumber)
  const lineLength = visualLineLength(state, mode, line.from, line.to, root)
  const offset = clamp(Math.round(coordinate.x / resolvedMetrics.charWidth), 0, lineLength)

  if (mode === 'source') {
    return line.from + offset
  }

  return lineVisualOffsetToSourcePosition(state, mode, line.from, line.to, offset, root)
}

function resolveViewMetrics(metrics?: Partial<ViewMetrics>): ViewMetrics {
  return {
    charWidth: metrics?.charWidth ?? defaultViewMetrics.charWidth,
    lineHeight: metrics?.lineHeight ?? defaultViewMetrics.lineHeight,
  }
}

function resolveVirtualViewportState(
  config: VirtualViewportConfig | undefined,
): VirtualViewportState | undefined {
  if (!config?.enabled) {
    return undefined
  }

  const lineHeight = Math.max(1, config.lineHeight ?? defaultViewMetrics.lineHeight)

  return Object.freeze({
    config,
    lineHeight,
    overscanLines: Math.max(0, Math.floor(config.overscanLines ?? 4)),
    ...(config.viewportHeight === undefined
      ? {}
      : { viewportHeight: Math.max(lineHeight, config.viewportHeight) }),
  })
}

function domRectForSourcePosition(
  document: Document,
  contentDOM: HTMLElement,
  referenceDOM: HTMLElement,
  state: EditorState,
  mode: ViewMode,
  position: number,
  root?: SyntaxNode,
): ViewRect | undefined {
  const { line, offset } = positionToVisualLineOffset(state, mode, position, root)
  const lineDOM = contentDOM.querySelector<HTMLElement>(`.milkup-line[data-line="${line.number}"]`)

  if (!lineDOM) {
    return undefined
  }

  return (
    domRectForLineSourcePosition(document, lineDOM, referenceDOM, position, {
      fallbackLineHeight:
        Number.parseFloat(
          contentDOM.parentElement?.style.getPropertyValue('--milkup-line-height') ?? '',
        ) || defaultViewMetrics.lineHeight,
    }) ??
    domRectForLineVisualOffset(document, lineDOM, referenceDOM, offset, {
      fallbackLineHeight:
        Number.parseFloat(
          contentDOM.parentElement?.style.getPropertyValue('--milkup-line-height') ?? '',
        ) || defaultViewMetrics.lineHeight,
    })
  )
}

function domRectsForSourceRange(
  document: Document,
  contentDOM: HTMLElement,
  layerDOM: HTMLElement,
  state: EditorState,
  mode: ViewMode,
  from: number,
  to: number,
  root?: SyntaxNode,
): readonly ViewRect[] {
  const rects: ViewRect[] = []
  const rangeFrom = clamp(from, 0, state.doc.length)
  const rangeTo = clamp(to, rangeFrom, state.doc.length)
  const fromLine = state.doc.lineAt(rangeFrom)
  const toLine = state.doc.lineAt(rangeTo)

  for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber += 1) {
    const line = state.doc.line(lineNumber)
    const lineDOM = contentDOM.querySelector<HTMLElement>(`.milkup-line[data-line="${lineNumber}"]`)

    if (!lineDOM) {
      continue
    }

    const lineFrom = Math.max(rangeFrom, line.from)
    const lineTo = Math.min(rangeTo, line.to)

    if (lineTo < lineFrom) {
      continue
    }

    const sourceRects = domRectsForLineSourceRange(document, lineDOM, layerDOM, lineFrom, lineTo)

    if (sourceRects.length > 0) {
      rects.push(...sourceRects)
      continue
    }

    const startOffset = positionToVisualLineOffset(state, mode, lineFrom, root).offset
    const endOffset = positionToVisualLineOffset(state, mode, lineTo, root).offset
    rects.push(...domRectsForLineVisualRange(document, lineDOM, layerDOM, startOffset, endOffset))
  }

  return Object.freeze(rects)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

export interface ScrollPositionIntoViewConfig {
  readonly state: EditorState
  readonly position: number
  readonly currentScrollTop: number
  readonly viewportHeight?: number
  readonly scrollPadding?: number
  readonly metrics?: Partial<ViewMetrics>
}

export function scrollPositionIntoView(config: ScrollPositionIntoViewConfig): number {
  return scrollPositionIntoViewForMode({ ...config, mode: 'source' })
}

function scrollPositionIntoViewForMode(
  config: ScrollPositionIntoViewConfig & { readonly mode: ViewMode; readonly root?: SyntaxNode },
): number {
  const viewportHeight =
    config.viewportHeight && config.viewportHeight > 0 ? config.viewportHeight : 200
  const scrollPadding = config.scrollPadding ?? 20
  const rect = positionToRectForMode(
    config.state,
    config.mode,
    config.position,
    config.metrics,
    config.root,
  )
  const visibleTop = config.currentScrollTop + scrollPadding
  const visibleBottom = config.currentScrollTop + viewportHeight - scrollPadding

  if (rect.top < visibleTop) {
    return Math.max(0, rect.top - scrollPadding)
  }

  if (rect.bottom > visibleBottom) {
    return Math.max(0, rect.bottom - viewportHeight + scrollPadding)
  }

  return Math.max(0, config.currentScrollTop)
}

function scrollMeasuredRectIntoView(config: {
  readonly currentScrollTop: number
  readonly rect: ViewRect
  readonly viewportHeight?: number
  readonly scrollPadding?: number
}): number {
  const viewportHeight =
    config.viewportHeight && config.viewportHeight > 0 ? config.viewportHeight : 200
  const scrollPadding = config.scrollPadding ?? 20
  const visibleTop = scrollPadding
  const visibleBottom = viewportHeight - scrollPadding

  if (config.rect.top < visibleTop) {
    return Math.max(0, config.currentScrollTop + config.rect.top - scrollPadding)
  }

  if (config.rect.bottom > visibleBottom) {
    return Math.max(
      0,
      config.currentScrollTop + config.rect.bottom - viewportHeight + scrollPadding,
    )
  }

  return Math.max(0, config.currentScrollTop)
}

function selectionChanged(previousState: EditorState, state: EditorState): boolean {
  return (
    previousState.selection.main.anchor !== state.selection.main.anchor ||
    previousState.selection.main.head !== state.selection.main.head
  )
}

function changedSelectionLineNumbers(
  previousState: EditorState,
  state: EditorState,
): readonly number[] {
  const lineNumbers = new Set<number>()
  collectSelectionBoundaryLineNumbers(previousState, previousState.selection.main, lineNumbers)
  collectSelectionBoundaryLineNumbers(state, state.selection.main, lineNumbers)

  return Object.freeze([...lineNumbers].sort((left, right) => left - right))
}

function changedDocumentLineNumbers(
  previousState: EditorState,
  state: EditorState,
  transactions: readonly Transaction[],
): readonly number[] | undefined {
  if (previousState.doc.lineCount !== state.doc.lineCount || transactions.length !== 1) {
    return undefined
  }

  const change = transactions[0]?.changes?.changes[0]

  if (!change || transactions[0]?.changes?.changes.length !== 1 || change.insert.includes('\n')) {
    return undefined
  }

  const previousLine = previousState.doc.lineAt(change.from)
  const previousChangeEndLine = previousState.doc.lineAt(change.to)
  const nextLine = state.doc.lineAt(change.from + change.insert.length)

  if (
    previousLine.number !== previousChangeEndLine.number ||
    previousLine.number !== nextLine.number
  ) {
    return undefined
  }

  return Object.freeze([nextLine.number])
}

function collectSelectionBoundaryLineNumbers(
  state: EditorState,
  range: Selection['main'],
  lineNumbers: Set<number>,
): void {
  const fromLine = state.doc.lineAt(range.from)
  const toLine = state.doc.lineAt(range.to)

  lineNumbers.add(fromLine.number)
  lineNumbers.add(toLine.number)
}

function shouldScrollSelectionIntoView(transactions: readonly Transaction[]): boolean {
  if (transactions.length === 0) {
    return true
  }

  return !transactions.some((transaction) => transaction.origin?.id?.startsWith('view.pointer.'))
}

export interface RenderOverlayOptions {
  readonly metrics?: Partial<ViewMetrics>
  readonly root?: SyntaxNode
}

export function renderCursorOverlay(
  document: Document,
  state: EditorState,
  mode: ViewMode = 'source',
  options: RenderOverlayOptions = {},
): readonly HTMLElement[] {
  return Object.freeze(
    state.selection.ranges.map((range, index) => {
      const position = range.head
      const { line, offset } = positionToVisualLineOffset(state, mode, position, options.root)
      const cursor = document.createElement('div')
      cursor.className = 'milkup-cursor'
      cursor.dataset.index = String(index)
      cursor.dataset.position = String(position)
      cursor.dataset.line = String(line.number)
      cursor.dataset.offset = String(offset)
      cursor.dataset.empty = String(range.empty)
      cursor.style.left = `${offset * (options.metrics?.charWidth ?? defaultViewMetrics.charWidth)}px`
      cursor.style.top = `${(line.number - 1) * (options.metrics?.lineHeight ?? defaultViewMetrics.lineHeight)}px`
      cursor.style.height = `${options.metrics?.lineHeight ?? defaultViewMetrics.lineHeight}px`
      return cursor
    }),
  )
}

export function renderSelectionOverlay(
  document: Document,
  state: EditorState,
  mode: ViewMode = 'source',
  options: RenderOverlayOptions = {},
): readonly HTMLElement[] {
  return Object.freeze(
    state.selection.ranges
      .filter((range) => !range.empty)
      .map((range, index) => {
        const from = positionToVisualLineOffset(state, mode, range.from, options.root)
        const to = positionToVisualLineOffset(state, mode, range.to, options.root)
        const selection = document.createElement('div')
        selection.className = 'milkup-selection'
        selection.dataset.index = String(index)
        selection.dataset.from = String(range.from)
        selection.dataset.to = String(range.to)
        selection.dataset.fromLine = String(from.line.number)
        selection.dataset.fromOffset = String(from.offset)
        selection.dataset.toLine = String(to.line.number)
        selection.dataset.toOffset = String(to.offset)
        selection.style.left = `${from.offset * (options.metrics?.charWidth ?? defaultViewMetrics.charWidth)}px`
        selection.style.top = `${(from.line.number - 1) * (options.metrics?.lineHeight ?? defaultViewMetrics.lineHeight)}px`
        selection.style.height = `${options.metrics?.lineHeight ?? defaultViewMetrics.lineHeight}px`
        selection.style.width = `${Math.max(1, to.offset - from.offset) * (options.metrics?.charWidth ?? defaultViewMetrics.charWidth)}px`
        return selection
      }),
  )
}

export function createInputProxy(document: Document): HTMLTextAreaElement {
  const input = document.createElement('textarea')
  input.className = 'milkup-input-proxy'
  input.setAttribute('aria-label', 'Markdown 编辑器')
  input.autocomplete = 'off'
  input.spellcheck = false
  input.tabIndex = 0
  input.value = ''
  return input
}

import {
  codeBlockForLine,
  codeFenceArrowTarget,
  renderCodeLine,
  codeLanguagePicker,
  codeLanguageEdit,
} from './code-presentation'
import { DocumentPresentation, type DocumentPresentationConfig } from './document-presentation'
import { mapLineSourceRanges } from './source-range-mapping'
import { renderCompositionOverlay } from './composition-overlay'
import { isUnfinishedBulletMarker, presentedTaskMarkerLength } from './list-presentation'
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
import { MeasuredLineHeights } from './measured-line-heights'
import {
  ImagePasteSession,
  ImagePresentation,
  type ImagePasteHandler,
  type EmptyPasteHandler,
  type ImageResolver,
} from './image-presentation'
import {
  editingContextFromState,
  editingContextLimits,
  type EditingContext,
  type EditingSelection,
} from './editing-context'
import { WindowedTableReader, boundedTableState, pipeLine } from './windowed-table'
import {
  tableCommand,
  tableArrowSelection,
  tableCellText,
  type TableCommand,
} from './table-editing'
import type { Transaction } from '@milkup/core'
import { ChangeSet, Selection, EditorState } from '@milkup/core'
import {
  MemoryTextDocument,
  type DocumentLineWindow,
  type EditorDocumentSource,
} from '@milkup/core'
import {
  parseInline,
  parseMarkdown,
  parseMarkdownWindow,
  type MarkdownWindowParseResult,
  type SyntaxNode,
} from '@milkup/markdown'

import { createInputProxy, getVisibleLineWindow, readEditorLayoutMetrics } from './editor-view'
import { boundedScrollGeometry, maxVirtualContentHeight } from './bounded-scroll'
import {
  nextGraphemeOffset,
  previousGraphemeOffset,
  snapGraphemeOffset,
} from './grapheme-navigation'
import {
  domRectForLineSourcePosition,
  domRectsForLineSourceRange,
  isHorizontalScrollbarDragStart,
  scrollCodePositionIntoView,
  scrollSourcePositionIntoView,
  isCodePositionClipped,
  isEditorScrollbarDragStart,
  lineElementFromEvent,
  sourcePositionFromPoint,
  sourcePositionToVisualOffsetInLine,
} from './source-position-mapping'
import type { SearchHighlight, ViewMode, VirtualViewportConfig } from './types'

export interface SourceDocumentViewConfig {
  readonly documentPresentation?: DocumentPresentationConfig
  readonly onImagePaste?: ImagePasteHandler
  readonly onEmptyPaste?: EmptyPasteHandler
  readonly imageResolver?: ImageResolver
  readonly presentation?: EditorPresentation
  readonly parent: HTMLElement
  readonly source: EditorDocumentSource
  readonly mode?: ViewMode
  readonly editable?: boolean
  readonly onEdit?: SourceDocumentEditHandler
  /** Resolve plain-paragraph Tab through the host's focus order after bounded context reads.
   * With a handler, only the input proxy is a sequential Tab stop; the root remains
   * programmatically focusable. Omit to retain standalone focus/indentation behavior. */
  readonly onFocusNavigation?: (request: { readonly backward: boolean }) => void
  /** Notify the host after a current Ctrl/Meta+Home/End reveal has completed.
   * Omission preserves navigation without a host notification; not a plugin SDK hook. */
  readonly onDocumentNavigation?: (edge: 'start' | 'end') => void
  readonly markdownContextLines?: number
  readonly markdownCacheSize?: number
  readonly backgroundMarkdownWarmup?: boolean
  readonly markdownWarmupWindows?: number
  readonly markdownWarmupDelayMs?: number
  readonly virtualViewport?: VirtualViewportConfig
  readonly document?: Document
}

export interface SourceDocumentEdit {
  readonly from: number
  readonly to: number
  readonly insert: string
  readonly deletedText: string
  /** Keep paste, finalized IME input and structural edits separate from typing batches. */
  readonly historyGroup?: 'isolate'
  readonly selectionBefore?: Selection | undefined
  readonly selectionAfter?: Selection | undefined
}

export type SourceDocumentEditHandler = (edit: SourceDocumentEdit) => Promise<void> | void

interface RenderRequest {
  readonly id: number
  readonly fromLine: number
  readonly toLine: number
  readonly spacers?: { readonly top: number; readonly bottom: number }
}

interface RenderedSourceWindow {
  readonly lines: readonly HTMLElement[]
  readonly sourceWindow: DocumentLineWindow
  readonly tableStarts?: readonly number[]
  readonly presentationRange?: { readonly fromLine: number; readonly toLine: number }
}

interface QueuedEditResolution {
  resolve(): void
  reject(error: unknown): void
}

const defaultLineHeight = 21
const defaultOverscanLines = 12
const defaultMarkdownContextLines = 24
const defaultMarkdownCacheSize = 16
const defaultMarkdownWarmupWindows = 1
const defaultMarkdownWarmupDelayMs = 25
const defaultEditCommitDelayMs = 24

export class SourceDocumentView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  readonly searchLayerDOM: HTMLElement
  readonly selectionLayerDOM: HTMLElement
  readonly cursorLayerDOM: HTMLElement
  readonly inputDOM: HTMLTextAreaElement

  private readonly ownerDocument: Document
  private readonly virtualViewport: Required<Pick<VirtualViewportConfig, 'enabled'>> &
    Omit<VirtualViewportConfig, 'enabled'>
  private presentation: EditorPresentation | undefined
  private layoutLineHeight: number | undefined
  private presentationLayoutRevision = 0
  private currentSource: EditorDocumentSource
  private readonly measuredHeights = new MeasuredLineHeights()
  private readonly tableReader = new WindowedTableReader()
  private editingContextCache:
    | {
        readonly source: EditorDocumentSource
        readonly version: number
        readonly window: DocumentLineWindow
        readonly state: EditorState
        readonly root: SyntaxNode
      }
    | undefined
  private readonly imagePaste: ImagePasteSession
  private readonly images: ImagePresentation
  private readonly documentPresentation: DocumentPresentation
  private documentPresentationEnabled = false
  private presentationReadRevision = 0
  private readonly presentationFenceReads = new Map<
    string,
    Promise<MarkdownWindowParseResult | undefined>
  >()
  private tableStarts: readonly number[] = []
  private mode: ViewMode
  private editable: boolean
  private taskTogglePending = false
  private navigationRevision = 0
  private destroyed = false
  private fenceContextKey = ''
  private readonly fenceCheckpoints = new Map<number, string | undefined>()
  private selectionGeneration = 0
  private storedCursorPosition = 0
  private get cursorPosition(): number {
    return this.storedCursorPosition
  }
  private set cursorPosition(value: number) {
    if (value !== this.storedCursorPosition) this.selectionGeneration++
    this.storedCursorPosition = value
  }
  private storedSelectionAnchor = 0
  private get selectionAnchor(): number {
    return this.storedSelectionAnchor
  }
  private set selectionAnchor(value: number) {
    if (value !== this.storedSelectionAnchor) this.selectionGeneration++
    this.storedSelectionAnchor = value
  }
  private readonly onEdit: SourceDocumentEditHandler | undefined
  private readonly onFocusNavigation: SourceDocumentViewConfig['onFocusNavigation']
  private readonly onDocumentNavigation: SourceDocumentViewConfig['onDocumentNavigation']
  private documentNavigationRequestRevision = 0
  private readonly markdownContextLines: number
  private readonly markdownCacheSize: number
  private readonly backgroundMarkdownWarmup: boolean
  private readonly markdownWarmupWindows: number
  private readonly markdownWarmupDelayMs: number
  private readonly markdownCache = new Map<string, Promise<MarkdownWindowParseResult>>()
  private markdownWarmupTimer: ReturnType<typeof setTimeout> | undefined
  private composing = false
  private compositionText = ''
  private documentGeneration = 0
  private compositionGeneration: number | undefined
  private compositionCommitQueue: Promise<void> = Promise.resolve()
  private compositionCommitError: unknown
  private visibleEditQueue: Promise<void> = Promise.resolve()
  private editCommitQueue: Promise<void> = Promise.resolve()
  private readonly activeVisibleEditTasks = new Set<Promise<void>>()
  private visibleEditPreparationError: unknown
  private editCommitTimer: ReturnType<typeof setTimeout> | undefined
  private pendingVisibleEdit: SourceDocumentEdit | undefined
  private pendingVisibleEditResolutions: QueuedEditResolution[] = []
  private editRevision = 0
  private dragAnchor: number | undefined
  private isDraggingSelection = false
  private hasDraggedSelection = false
  private nextRequestId = 1
  private latestAppliedRequestId = 0
  private deferredPresentationRender: { request: RenderRequest; promise: Promise<void> } | undefined
  private renderedSourceWindow: DocumentLineWindow | undefined
  private renderedDocumentVersion: number | undefined
  private sourceWindowCacheKey = ''
  private sourceWindowCacheLength = 0
  private readonly sourceWindowCache = new Map<string, DocumentLineWindow>()
  private searchHighlights: readonly SearchHighlight[] = Object.freeze([])
  private activeSearchHighlightIndex = -1
  private scrollAnchor: { readonly scrollTop: number } | undefined
  private handledScroll:
    | {
        top: number
        left: number
        width: number
        height: number
        source: EditorDocumentSource
        version: number
        mode: ViewMode
        editRevision: number
      }
    | undefined
  private readonly handleScrollEvent = (): void => {
    const anchor = this.scrollAnchor
    const position = {
      top: this.dom.scrollTop,
      left: this.dom.scrollLeft,
      width: this.dom.clientWidth,
      height: this.dom.clientHeight,
      source: this.currentSource,
      version: this.currentSource.version,
      mode: this.mode,
      editRevision: this.editRevision,
    }

    if (anchor && Math.abs(this.dom.scrollTop - anchor.scrollTop) <= 1) {
      this.scrollAnchor = undefined
      // The navigation owner can still fail its read. Do not mark its pending
      // position as handled: a later scroll must remain able to retry it.
      this.handledScroll = undefined
      // scrollToLine already owns the target render, even if its read is still
      // pending. Rebuilding it here duplicates DOM/layout work. A changed
      // scroll position below still renders a real user scroll normally.
      return
    }

    this.scrollAnchor = undefined
    const previous = this.handledScroll
    if (
      previous &&
      previous.top === position.top &&
      previous.left === position.left &&
      previous.width === position.width &&
      previous.height === position.height &&
      previous.source === position.source &&
      previous.version === position.version &&
      previous.mode === position.mode &&
      previous.editRevision === position.editRevision
    )
      return
    // Layout can emit another outer scroll at the same position while restoring
    // preview height. Suppress it before the asynchronous window read begins.
    this.handledScroll = position
    void this.renderVisibleWindow().catch((error: unknown) => {
      if (this.handledScroll === position) this.handledScroll = undefined
      throw error
    })
  }
  private readonly handleCodeLanguageEvent = (event: Event): void => {
    const picker = codeLanguagePicker(event, this.contentDOM)
    if (
      !picker ||
      !this.editable ||
      !this.onEdit ||
      this.composing ||
      this.destroyed ||
      this.mode !== 'live' ||
      this.taskTogglePending ||
      this.pendingVisibleEdit ||
      this.activeVisibleEditTasks.size > 0
    )
      return
    const source = this.currentSource,
      version = source.version,
      revision = this.editRevision
    const from = Number(picker.dataset.codeFrom)
    const line = this.renderedSourceWindow?.lines.find((line) => line.from === from)
    if (!line) return
    const edit = codeLanguageEdit(picker, from, line.text)
    if (!edit) return
    this.taskTogglePending = true
    syncTaskAvailability(this.contentDOM, false)
    void this.trackVisibleEditTask(async () => {
      try {
        await this.editCommitQueue
        if (
          !this.editable ||
          this.destroyed ||
          this.mode !== 'live' ||
          this.composing ||
          source !== this.currentSource ||
          version !== source.version ||
          revision !== this.editRevision
        )
          return
        const changes = ChangeSet.replace(edit.from, edit.to, edit.insert)
        await this.applyVisibleEdit(
          edit.from,
          edit.to,
          edit.insert,
          'isolate',
          this.currentSelection().map(changes),
        )
        await this.flushPendingVisibleEdit()
        await this.renderVisibleWindow()
      } finally {
        this.taskTogglePending = false
        syncTaskAvailability(this.contentDOM, this.editable && !!this.onEdit)
        if (!this.destroyed && this.currentSource.documentId === source.documentId)
          this.inputDOM.focus({ preventScroll: true })
      }
    })
  }
  private readonly handleInputEvent = (): void => {
    void this.trackVisibleEditTask(() => this.readInputProxy())
  }
  private readonly handleCompositionStartEvent = (): void => {
    this.compositionGeneration = this.documentGeneration
    this.composing = true
    this.compositionText = ''
    this.renderCompositionText()
  }
  private readonly handleCompositionUpdateEvent = (event: CompositionEvent): void => {
    if (this.compositionGeneration !== this.documentGeneration) return
    this.composing = true
    this.compositionText = event.data
    this.renderCompositionText()
  }
  private readonly handleCompositionEndEvent = (event: CompositionEvent): void => {
    // compositionend.data is authoritative, including cancellation's empty string.
    const text = event.data
    const generation = this.compositionGeneration
    this.compositionGeneration = undefined
    // Clear this synchronously so the next Enter/Delete is handled as an editor key,
    // even while the finalized IME text waits for an earlier native edit to finish.
    this.composing = false
    this.compositionText = ''
    this.inputDOM.value = ''
    this.renderCompositionText()
    this.compositionCommitError = undefined
    this.compositionCommitQueue = this.enqueueVisibleEdit(async () => {
      // A finalized composition belongs to the document where preedit started.
      // Unlike a key, its final event may arrive after updateSource or destroy.
      if (!this.destroyed && generation === this.documentGeneration)
        await this.commitComposition(text)
    }).catch((error: unknown) => {
      this.compositionCommitError = error
    })
  }
  private readonly handlePasteEvent = (event: ClipboardEvent): void => {
    if (event.defaultPrevented) {
      return
    }

    if (!this.editable) {
      event.preventDefault()
      return
    }

    if (this.composing) return
    if (this.imagePaste.handle(event, this.currentSelection().main)) return

    const text = event.clipboardData?.getData('text/plain') ?? ''

    if (text.length === 0) {
      return
    }

    event.preventDefault()
    void this.trackVisibleEditTask(() => {
      const range = this.getSelectedRange()
      return this.applyTextInput(range.from, range.to, text, 'isolate')
    })
  }
  private readonly handleCopyEvent = (event: ClipboardEvent): void => {
    if (event.defaultPrevented || !event.clipboardData) {
      return
    }

    const text = this.readRenderedSelectionText()

    if (text === undefined) {
      return
    }

    event.clipboardData.setData('text/plain', text)
    event.preventDefault()
  }
  private readonly handleCutEvent = (event: ClipboardEvent): void => {
    if (!this.editable) {
      event.preventDefault()
      return
    }

    const text = this.readRenderedSelectionText()

    if (text === undefined || !event.clipboardData) {
      return
    }

    event.clipboardData.setData('text/plain', text)
    event.preventDefault()
    void this.trackVisibleEditTask(() => {
      const range = this.getSelectedRange()
      return this.applyVisibleEdit(range.from, range.to, '')
    })
  }
  private readonly handleTaskClickEvent = (event: MouseEvent): void => {
    const task = taskMarkerFromEvent(event, this.contentDOM)
    if (task) {
      event.preventDefault()
      this.toggleTask(task)
    }
  }
  private readonly handleInnerScrollEvent = (event: Event): void => {
    if (
      event.target instanceof HTMLElement &&
      event.target.classList.contains('milkup-block-code')
    ) {
      this.renderSelection()
      this.renderSearchHighlights()
      this.renderCursor()
    }
  }
  private readonly handleKeyDownEvent = (event: KeyboardEvent): void => {
    if (this.documentPresentation.returnToPreviewWithTab(event)) return
    const task = taskMarkerFromEvent(event, this.contentDOM)
    if (task) {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        if (!event.repeat) this.toggleTask(task)
      }
      return
    }

    if (event.defaultPrevented) {
      return
    }

    if (event.currentTarget === this.dom && event.target === this.inputDOM) {
      return
    }

    if (this.handleEditingKey(event)) {
      event.preventDefault()
    }
  }
  private readonly handlePointerDownEvent = (event: MouseEvent): void => {
    const task = taskMarkerFromEvent(event, this.contentDOM)
    if (task) {
      event.preventDefault()
      task.focus({ preventScroll: true })
      return
    }
    this.startSelectionDrag(event)
  }
  private readonly handlePointerMoveEvent = (event: PointerEvent): void => {
    void this.updateSelectionDrag(event)
  }
  private readonly handlePointerUpEvent = (event: PointerEvent): void => {
    void this.finishSelectionDrag(event)
  }
  private readonly handlePointerCancelEvent = (): void => {
    this.clearSelectionDrag()
  }

  constructor(config: SourceDocumentViewConfig) {
    this.ownerDocument = config.document ?? config.parent.ownerDocument
    this.currentSource = config.source
    this.mode = config.mode ?? 'source'
    this.editable = config.editable ?? false
    this.onEdit = config.onEdit
    this.onFocusNavigation = config.onFocusNavigation
    this.onDocumentNavigation = config.onDocumentNavigation
    this.markdownContextLines = Math.max(
      0,
      Math.floor(config.markdownContextLines ?? defaultMarkdownContextLines),
    )
    this.markdownCacheSize = Math.max(
      1,
      Math.floor(config.markdownCacheSize ?? defaultMarkdownCacheSize),
    )
    this.backgroundMarkdownWarmup = config.backgroundMarkdownWarmup ?? false
    this.markdownWarmupWindows = Math.max(
      0,
      Math.floor(config.markdownWarmupWindows ?? defaultMarkdownWarmupWindows),
    )
    this.markdownWarmupDelayMs = Math.max(
      0,
      Math.floor(config.markdownWarmupDelayMs ?? defaultMarkdownWarmupDelayMs),
    )
    this.virtualViewport = {
      enabled: true,
      ...(config.virtualViewport ?? {}),
    }
    this.dom = this.ownerDocument.createElement('div')
    this.dom.className = 'milkup-editor milkup-source-document-view'
    this.dom.dataset.mode = this.mode
    this.dom.dataset.editable = String(this.editable)
    this.dom.tabIndex = config.onFocusNavigation ? -1 : 0
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
    this.contentDOM.addEventListener('scroll', this.handleInnerScrollEvent, true)
    this.contentDOM.addEventListener('click', this.handleTaskClickEvent)
    this.contentDOM.addEventListener('change', this.handleCodeLanguageEvent)
    this.dom.addEventListener('scroll', this.handleScrollEvent)
    this.dom.addEventListener('keydown', this.handleKeyDownEvent)
    this.dom.addEventListener('copy', this.handleCopyEvent)
    this.dom.addEventListener('cut', this.handleCutEvent)
    this.dom.addEventListener('paste', this.handlePasteEvent)
    this.dom.addEventListener('pointerdown', this.handlePointerDownEvent)
    this.dom.addEventListener('pointermove', this.handlePointerMoveEvent)
    this.ownerDocument.addEventListener('pointerup', this.handlePointerUpEvent)
    this.ownerDocument.addEventListener('pointercancel', this.handlePointerCancelEvent)
    this.inputDOM.addEventListener('input', this.handleInputEvent)
    this.inputDOM.addEventListener('keydown', this.handleKeyDownEvent)
    this.inputDOM.addEventListener('compositionstart', this.handleCompositionStartEvent)
    this.inputDOM.addEventListener('compositionupdate', this.handleCompositionUpdateEvent)
    this.inputDOM.addEventListener('compositionend', this.handleCompositionEndEvent)
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
      if (!this.destroyed) {
        this.measureTableRows()
        this.renderSelection()
        this.renderCursor()
      }
    })
    this.documentPresentationEnabled = config.documentPresentation !== undefined
    this.documentPresentation = new DocumentPresentation(
      this.dom,
      this.contentDOM,
      config.documentPresentation,
      () => ({
        mode: this.mode,
        sourceIdentity: this.currentSource,
        sourceVersion: this.currentSource.version + this.editRevision,
        documentVersion: this.currentSource.version,
        selection: this.currentSelection().main,
        lineCount: this.currentSource.lineCount,
        read: (from, to) => {
          const window = this.renderedSourceWindow
          return window &&
            this.renderedDocumentVersion === this.currentSource.version &&
            from >= window.from &&
            to <= window.to
            ? window.text.slice(from - window.from, to - window.from)
            : undefined
        },
      }),
      () => {
        if (!this.destroyed) {
          this.measureTableRows()
          this.renderSelection()
          this.renderCursor()
          this.renderSearchHighlights()
        }
      },
      (from, to) => {
        const line =
          this.contentDOM.querySelector<HTMLElement>(`.milkup-line[data-from="${from}"]`) ??
          Array.from(this.contentDOM.querySelectorAll<HTMLElement>('.milkup-line')).find(
            (line) => Number(line.dataset.from) <= from && Number(line.dataset.to) >= from,
          )
        if (line)
          void this.revealSelection(Number(line.dataset.line), Selection.range(from, to)).then(() =>
            this.inputDOM.focus({ preventScroll: true }),
          )
      },
    )
    if (config.presentation) {
      this.presentation = validatePresentation(config.presentation)
      applyPresentation(this.dom, this.presentation)
    }
    this.readLayoutMetrics()
    void this.renderVisibleWindow()
  }

  get isComposing(): boolean {
    return this.composing
  }

  setDocumentPresentation(config: DocumentPresentationConfig | undefined): void {
    this.presentationReadRevision += 1
    this.presentationFenceReads.clear()
    this.documentPresentationEnabled = config !== undefined
    this.documentPresentation.setConfig(config)
    void this.renderVisibleWindow()
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
    return this.getLineHeight()
  }

  async setPresentation(value: EditorPresentation): Promise<void> {
    if (this.destroyed) return
    const next = validatePresentation(value)
    if (samePresentationLayout(this.presentation, next)) {
      this.presentation = next
      return
    }
    this.presentation = next
    applyPresentation(this.dom, next)
    await this.refreshLayout()
  }

  /** Remeasure current root CSS on this view. This does not commit, cancel or
   * replace active input. Source rows require uniform root line-height; Live
   * remeasures only the bounded rendered rows, not arbitrary offscreen CSS. */
  async refreshLayout(): Promise<void> {
    if (this.destroyed) return
    const firstLine = this.visibleLineRange.fromLine
    const oldGeometry = this.scrollGeometry()
    const oldTop = oldGeometry.compressed
      ? Math.max(0, oldGeometry.toLogical(this.dom.scrollTop) - this.contentPadding().top)
      : this.dom.scrollTop
    const fraction = Math.max(
      0,
      Math.min(
        1,
        (oldTop - this.lineTop(firstLine)) /
          Math.max(1, this.lineTop(firstLine + 1) - this.lineTop(firstLine)),
      ),
    )
    const layoutRevision = ++this.presentationLayoutRevision
    this.readLayoutMetrics()
    this.measuredHeights.clear()
    this.handledScroll = undefined
    // Invalidate old-layout requests before any asynchronous source read.
    this.latestAppliedRequestId = this.nextRequestId++
    const anchoredTop = () => {
      const geometry = this.scrollGeometry()
      const top =
        this.lineTop(firstLine) +
        fraction * Math.max(1, this.lineTop(firstLine + 1) - this.lineTop(firstLine))
      return geometry.compressed ? geometry.toPhysical(top + this.contentPadding().top) : top
    }
    this.dom.scrollTop = anchoredTop()
    this.scrollAnchor = Object.freeze({ scrollTop: this.dom.scrollTop })
    const expectedScroll = this.dom.scrollTop
    const source = this.currentSource
    const request = this.createRenderRequestForLine(firstLine)
    await this.renderVisibleWindow(request)
    if (
      layoutRevision === this.presentationLayoutRevision &&
      this.latestAppliedRequestId === request.id &&
      source === this.currentSource &&
      !this.destroyed
    ) {
      // Keep the fraction within a measured Live row, but do not undo a user
      // scroll which happened while this layout's read was pending.
      if (Math.abs(this.dom.scrollTop - expectedScroll) <= 1) {
        this.dom.scrollTop = anchoredTop()
        this.scrollAnchor = Object.freeze({ scrollTop: this.dom.scrollTop })
      }
    }
  }

  private readLayoutMetrics(): void {
    this.layoutLineHeight = readEditorLayoutMetrics(this.dom, {
      lineHeight: this.presentation
        ? this.presentation.fontSize * this.presentation.lineHeight
        : Math.max(1, this.virtualViewport.lineHeight ?? defaultLineHeight),
      charWidth: 8,
    }).lineHeight
    this.contentDOM.style.setProperty('--milkup-line-height', `${this.layoutLineHeight}px`)
  }

  get source(): EditorDocumentSource {
    return this.currentSource
  }

  get visibleLineRange(): { readonly fromLine: number; readonly toLine: number } {
    const geometry = this.scrollGeometry()
    const scrollTop = geometry.compressed
      ? Math.max(0, geometry.toLogical(this.dom.scrollTop) - this.contentPadding().top)
      : this.dom.scrollTop
    const window = getVisibleLineWindow({
      lineCount: this.currentSource.lineCount,
      scrollTop: (this.lineAtTop(scrollTop) - 1) * this.getLineHeight(),
      lineHeight: this.getLineHeight(),
      viewportHeight: this.getViewportHeight() ?? this.getLineHeight() * 24,
      overscanLines: 0,
    })
    return Object.freeze({ fromLine: window.fromLine, toLine: window.toLine })
  }

  updateSource(source: EditorDocumentSource): void {
    this.presentationReadRevision += 1
    this.presentationFenceReads.clear()
    this.imagePaste.abort()
    this.navigationRevision += 1
    const documentChanged = source.documentId !== this.currentSource.documentId

    this.measuredHeights.clear()
    this.currentSource = source
    this.editingContextCache = undefined
    this.sourceWindowCache.clear()
    this.sourceWindowCacheLength = 0
    this.renderedSourceWindow = undefined
    this.tableStarts = []
    this.cancelMarkdownWarmup()
    this.markdownCache.clear()
    this.cursorPosition = clamp(
      this.cursorPosition,
      0,
      this.currentSource.length ?? this.cursorPosition,
    )
    this.selectionAnchor = clamp(
      this.selectionAnchor,
      0,
      this.currentSource.length ?? this.selectionAnchor,
    )
    if (documentChanged) {
      this.documentGeneration += 1
      this.compositionGeneration = undefined
      this.composing = false
      this.compositionText = ''
      this.inputDOM.value = ''
      this.cursorPosition = 0
      this.selectionAnchor = 0
      this.dom.scrollTop = 0
    }
    void this.renderVisibleWindow()
  }

  setEditable(editable: boolean): void {
    if (!editable) this.imagePaste.abort()
    if (this.editable === editable) {
      return
    }

    this.editable = editable
    this.dom.dataset.editable = String(editable)
    this.inputDOM.readOnly = !editable
    // Saving can rerender the window while editing is locked. Restore the
    // existing caret on unlock even when no text or selection changes follow.
    this.renderCursor()
    if (this.mode === 'live')
      void this.renderLiveSyntaxAroundPositions(this.cursorPosition, this.cursorPosition).then(
        () => {
          if (this.destroyed) return
          this.renderSelection()
          this.renderCursor()
        },
        (error: unknown) => {
          if (!this.destroyed)
            this.dom.dispatchEvent(new CustomEvent('milkup-input-error', { detail: error }))
        },
      )
  }

  setMode(mode: ViewMode): void {
    if (this.mode === mode) {
      return
    }

    this.presentationReadRevision += 1
    this.presentationFenceReads.clear()
    this.mode = mode
    this.measuredHeights.clear()
    this.dom.dataset.mode = mode
    void this.renderVisibleWindow()
  }

  setSearchHighlights(highlights: readonly SearchHighlight[], activeIndex = -1): void {
    this.searchHighlights = Object.freeze([...highlights])
    this.activeSearchHighlightIndex = activeIndex
    this.renderSearchHighlights()
  }

  get selection(): Selection {
    return this.currentSelection()
  }

  /** Commit a host-validated selection without scrolling or entering the edit
   * queue. Hosts must wait for pending edits and revalidate their snapshot first.
   * Readonly documents permit selection; unknown native lengths stay the host's
   * responsibility and must never be inferred from a byte-size snapshot. */
  setSelection(selection: Selection): void {
    if (this.destroyed) throw new Error('Cannot set selection on a destroyed source view')
    if (this.composing) throw new Error('Cannot set selection during composition')
    if (selection.ranges.length !== 1)
      throw new RangeError('Source view supports exactly one selection range')
    const target = selection.main
    if (
      !Number.isSafeInteger(target.anchor) ||
      !Number.isSafeInteger(target.head) ||
      (this.currentSource.length !== undefined && target.to > this.currentSource.length)
    )
      throw new RangeError('Selection exceeds the source document length')

    const navigation = ++this.navigationRevision
    this.documentNavigationRequestRevision++
    const previousPosition = this.cursorPosition
    // The setters already advance selectionGeneration for changed endpoints.
    this.cursorPosition = target.head
    this.selectionAnchor = target.anchor
    this.renderSelection()
    this.renderCursor(false)
    // renderCursor normally skips this notification for readonly/offscreen
    // carets. A host selection must notify exactly once in all of those cases.
    this.dom.dispatchEvent(new Event('milkup-selection-change'))

    if (this.mode === 'live') {
      const source = this.currentSource,
        version = source.version,
        selectionRevision = this.selectionGeneration
      const current = () =>
        !this.destroyed &&
        this.currentSource === source &&
        source.version === version &&
        this.navigationRevision === navigation &&
        this.selectionGeneration === selectionRevision
      // Only already rendered endpoint lines are refreshed. The selection is
      // committed synchronously; late syntax work cannot move it or scroll.
      void this.renderLiveSyntaxAroundPositions(previousPosition, target.head).then(
        () => {
          if (!current()) return
          this.renderSelection()
          this.renderCursor(false)
        },
        (error: unknown) => {
          if (current())
            this.dom.dispatchEvent(new CustomEvent('milkup-input-error', { detail: error }))
        },
      )
    }
  }

  async revealSelection(
    lineNumber: number,
    selection?: Selection,
    options: { readonly signal?: AbortSignal; readonly assertCurrent?: () => void } = {},
  ): Promise<void> {
    options.signal?.throwIfAborted()
    options.assertCurrent?.()
    const revision = ++this.navigationRevision
    const source = this.currentSource
    const documentId = source.documentId
    const version = source.version
    const assertCurrent = () => {
      options.signal?.throwIfAborted()
      options.assertCurrent?.()
      if (options.assertCurrent || options.signal) {
        if (
          this.destroyed ||
          revision !== this.navigationRevision ||
          source !== this.currentSource ||
          version !== source.version
        )
          throw new DOMException('Navigation invalidated', 'AbortError')
      }
    }
    await this.scrollToLine(lineNumber, { assertCurrent })
    assertCurrent()
    if (
      this.destroyed ||
      source !== this.currentSource ||
      revision !== this.navigationRevision ||
      documentId !== this.currentSource.documentId ||
      version !== this.currentSource.version
    )
      return
    const line = this.contentDOM.querySelector<HTMLElement>(
      `.milkup-line[data-line="${lineNumber}"]`,
    )
    if (!line) {
      // A newer scroll window may supersede this navigation without changing the document.
      if (options.signal || options.assertCurrent)
        throw new DOMException('Navigation target window superseded', 'AbortError')
      return
    }
    const from = Number(line.dataset.from)
    const target = selection ?? Selection.cursor(from)
    const previousPosition = this.cursorPosition
    this.cursorPosition = clamp(target.main.head, 0, this.currentSource.length ?? target.main.head)
    this.selectionAnchor = clamp(
      target.main.anchor,
      0,
      this.currentSource.length ?? target.main.anchor,
    )
    if (this.mode === 'live')
      await this.renderLiveSyntaxAroundPositions(previousPosition, this.cursorPosition)
    assertCurrent()
    if (
      this.destroyed ||
      source !== this.currentSource ||
      version !== source.version ||
      revision !== this.navigationRevision
    )
      return
    this.revealHorizontalCursor()
    this.renderSelection()
    this.renderCursor()
  }

  async scrollToLine(
    lineNumber: number,
    options: { readonly signal?: AbortSignal; readonly assertCurrent?: () => void } = {},
  ): Promise<void> {
    const source = this.currentSource,
      version = source.version
    const check = () => {
      options.signal?.throwIfAborted()
      options.assertCurrent?.()
      return !this.destroyed && source === this.currentSource && version === source.version
    }
    if (!check()) return
    if (
      !Number.isInteger(lineNumber) ||
      lineNumber < 1 ||
      lineNumber > this.currentSource.lineCount
    ) {
      throw new RangeError(`Invalid line number: ${lineNumber}`)
    }

    const geometry = this.scrollGeometry()
    this.dom.scrollTop = geometry.compressed
      ? geometry.toPhysical(this.lineTop(lineNumber) + this.contentPadding().top)
      : this.lineTop(lineNumber)
    this.scrollAnchor = Object.freeze({ scrollTop: this.dom.scrollTop })
    await this.renderVisibleWindow(this.createRenderRequestForLine(lineNumber))
    if (!check()) return
    const target = this.contentDOM.querySelector<HTMLElement>(
      `.milkup-line[data-line="${lineNumber}"]`,
    )

    if (target && target.offsetTop > 0 && Math.abs(this.dom.scrollTop - target.offsetTop) > 1) {
      this.dom.scrollTop = target.offsetTop
      this.scrollAnchor = Object.freeze({ scrollTop: this.dom.scrollTop })
    }
  }

  async renderVisibleWindow(request: RenderRequest = this.createRenderRequest()): Promise<void> {
    this.documentPresentation.hasReferencePointer()
    const editRevision = this.editRevision
    const source = this.currentSource
    const version = source.version
    // A scroll may arrive after optimistic input but before its source commit.
    // Failed commits are reported by the edit queue; rollback must still render.
    // Observe the normal batch timer; scrolling must not split typing history.
    await (
      this.pendingVisibleEdit
        ? new Promise<void>((resolve, reject) => {
            this.pendingVisibleEditResolutions.push({ resolve, reject })
          })
        : this.editCommitQueue
    ).catch(() => undefined)
    if (this.destroyed || source !== this.currentSource || editRevision !== this.editRevision)
      return
    if (version !== source.version) request = this.createRenderRequest()
    const renderVersion = source.version
    const renderMode = this.mode
    const presentationReadRevision = this.presentationReadRevision
    const rendered =
      this.mode === 'live'
        ? await this.renderLiveLineWindow(request)
        : await this.renderSourceLineWindow(request)

    if (
      this.destroyed ||
      source !== this.currentSource ||
      renderVersion !== source.version ||
      renderMode !== this.mode ||
      presentationReadRevision !== this.presentationReadRevision ||
      request.id < this.latestAppliedRequestId ||
      editRevision !== this.editRevision
    ) {
      return
    }

    if (this.documentPresentation.hasReferencePointer()) {
      const pending = this.deferredPresentationRender
      if (pending) {
        if (request.id > pending.request.id) pending.request = request
        return pending.promise
      }
      // Coalesce to one request, not a queue of rendered windows held by a pointer.
      const deferred = { request, promise: Promise.resolve() }
      this.deferredPresentationRender = deferred
      deferred.promise = this.documentPresentation.waitForReferencePointer()!.then(async () => {
        if (this.deferredPresentationRender !== deferred) return
        this.deferredPresentationRender = undefined
        if (
          this.destroyed ||
          source !== this.currentSource ||
          renderVersion !== source.version ||
          editRevision !== this.editRevision ||
          deferred.request.id < this.latestAppliedRequestId
        )
          return
        await this.renderVisibleWindow(deferred.request)
      })
      return deferred.promise
    }
    if (rendered.presentationRange) {
      const { fromLine, toLine } = rendered.presentationRange
      request = {
        ...request,
        fromLine,
        toLine,
        ...(request.spacers
          ? { spacers: this.lineSpacers(fromLine, toLine, this.dom.scrollTop) }
          : {}),
      }
    }
    this.latestAppliedRequestId = request.id
    this.renderedSourceWindow = rendered.sourceWindow
    this.renderedDocumentVersion = renderVersion
    this.tableStarts = rendered.tableStarts ?? []
    const lineHeight = this.getLineHeight()
    const focusedTask =
      this.ownerDocument.activeElement instanceof HTMLElement &&
      this.contentDOM.contains(this.ownerDocument.activeElement) &&
      this.ownerDocument.activeElement.classList.contains('milkup-task-marker')
        ? this.ownerDocument.activeElement.dataset.from
        : undefined
    const codeScroll = new Map(
      Array.from(this.contentDOM.querySelectorAll<HTMLElement>('.milkup-block-code'), (line) => [
        line.dataset.line,
        line.scrollLeft,
      ]),
    )
    const presentationMeasured = this.documentPresentation.updateContent(() => {
      this.contentDOM.replaceChildren(
        renderSpacer(
          this.ownerDocument,
          'top',
          request.spacers?.top ?? this.lineTop(request.fromLine),
        ),
        ...rendered.lines,
        renderSpacer(
          this.ownerDocument,
          'bottom',
          request.spacers?.bottom ??
            this.lineTop(this.currentSource.lineCount + 1) - this.lineTop(request.toLine + 1),
        ),
      )
      this.contentDOM.dataset.virtualized = 'true'
      this.contentDOM.dataset.fromLine = String(request.fromLine)
      this.contentDOM.dataset.toLine = String(request.toLine)
      this.contentDOM.dataset.renderMode = this.mode
    })
    this.contentDOM.querySelectorAll<HTMLElement>('.milkup-block-code').forEach((line) => {
      line.scrollLeft = codeScroll.get(line.dataset.line) ?? 0
    })
    if (!presentationMeasured) this.measureTableRows()
    this.renderSearchHighlights()
    this.renderSelection()
    this.renderCursor()
    if (focusedTask !== undefined)
      this.contentDOM
        .querySelector<HTMLButtonElement>(`.milkup-task-marker[data-from="${focusedTask}"]`)
        ?.focus({ preventScroll: true })
    this.scheduleMarkdownWarmup(request)
  }

  // History must share the key queue: optimistic text can be visible before its
  // transaction exists, and following keys must wait for the history operation.
  runAfterPendingEdits(action: () => Promise<void> | void): Promise<void> {
    const queued = this.enqueueVisibleEdit(async () => {
      await this.flushPendingVisibleEdit()
      await action()
    })
    this.activeVisibleEditTasks.add(queued)
    void queued.then(
      () => this.activeVisibleEditTasks.delete(queued),
      () => this.activeVisibleEditTasks.delete(queued),
    )
    return queued
  }

  async flushPendingEdits(): Promise<void> {
    await this.compositionCommitQueue

    if (this.compositionCommitError !== undefined) {
      const error = this.compositionCommitError
      this.compositionCommitError = undefined
      throw error
    }

    while (this.activeVisibleEditTasks.size > 0) {
      await Promise.all([...this.activeVisibleEditTasks])
    }

    if (this.visibleEditPreparationError !== undefined) {
      const error = this.visibleEditPreparationError
      this.visibleEditPreparationError = undefined
      throw error
    }

    await this.flushPendingVisibleEdit()
  }

  destroy(): void {
    this.presentationReadRevision += 1
    this.presentationFenceReads.clear()
    this.imagePaste.abort()
    this.images.destroy()
    this.documentPresentation.destroy()
    this.destroyed = true
    this.navigationRevision += 1
    this.cancelMarkdownWarmup()
    if (this.editCommitTimer !== undefined) {
      clearTimeout(this.editCommitTimer)
      this.editCommitTimer = undefined
    }
    this.contentDOM.removeEventListener('scroll', this.handleInnerScrollEvent, true)
    this.contentDOM.removeEventListener('click', this.handleTaskClickEvent)
    this.contentDOM.removeEventListener('change', this.handleCodeLanguageEvent)
    this.dom.removeEventListener('scroll', this.handleScrollEvent)
    this.dom.removeEventListener('keydown', this.handleKeyDownEvent)
    this.dom.removeEventListener('copy', this.handleCopyEvent)
    this.dom.removeEventListener('cut', this.handleCutEvent)
    this.dom.removeEventListener('paste', this.handlePasteEvent)
    this.dom.removeEventListener('pointerdown', this.handlePointerDownEvent)
    this.dom.removeEventListener('pointermove', this.handlePointerMoveEvent)
    this.ownerDocument.removeEventListener('pointerup', this.handlePointerUpEvent)
    this.ownerDocument.removeEventListener('pointercancel', this.handlePointerCancelEvent)
    this.inputDOM.removeEventListener('input', this.handleInputEvent)
    this.inputDOM.removeEventListener('keydown', this.handleKeyDownEvent)
    this.inputDOM.removeEventListener('compositionstart', this.handleCompositionStartEvent)
    this.inputDOM.removeEventListener('compositionupdate', this.handleCompositionUpdateEvent)
    this.inputDOM.removeEventListener('compositionend', this.handleCompositionEndEvent)
    this.dom.remove()
  }

  private contentPadding(): { top: number; bottom: number } {
    const style = this.ownerDocument.defaultView?.getComputedStyle(this.contentDOM)
    return {
      top: Number.parseFloat(style?.paddingTop ?? '') || 0,
      bottom: Number.parseFloat(style?.paddingBottom ?? '') || 0,
    }
  }

  private lineTop(line: number): number {
    return this.measuredHeights.top(line, this.getLineHeight())
  }
  private lineAtTop(top: number): number {
    return this.measuredHeights.lineAt(top, this.currentSource.lineCount, this.getLineHeight())
  }
  private lineSpacers(fromLine: number, toLine: number, scrollTop = this.dom.scrollTop) {
    const geometry = this.scrollGeometry()
    const top = Math.max(
      0,
      (geometry.compressed ? scrollTop - geometry.toLogical(scrollTop) : 0) +
        this.lineTop(fromLine),
    )
    return {
      top,
      bottom: Math.max(
        0,
        geometry.physicalHeight - top - (this.lineTop(toLine + 1) - this.lineTop(fromLine)),
      ),
    }
  }
  private measureTableRows(): void {
    if (this.mode !== 'live') return
    for (const row of Array.from(this.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))) {
      const height = row.getBoundingClientRect().height
      if (
        height > 0 ||
        row.classList.contains('milkup-table-delimiter') ||
        row.classList.contains('milkup-code-closing') ||
        row.dataset.presentationCollapsed === 'true'
      )
        this.measuredHeights.set(Number(row.dataset.line), height)
    }
    const from = Number(this.contentDOM.dataset.fromLine),
      to = Number(this.contentDOM.dataset.toLine)
    if (!from || !to) return
    const spacers = this.lineSpacers(from, to)
    for (const side of ['top', 'bottom'] as const) {
      const spacer = this.contentDOM.querySelector<HTMLElement>(`[data-spacer="${side}"]`)
      if (spacer) spacer.style.height = `${spacers[side]}px`
    }
  }

  private scrollGeometry(lineCount = this.currentSource.lineCount) {
    const padding =
      lineCount * this.getLineHeight() > maxVirtualContentHeight
        ? this.contentPadding()
        : { top: 0, bottom: 0 }
    return boundedScrollGeometry(
      lineCount,
      this.lineTop(lineCount + 1) / Math.max(1, lineCount),
      this.getViewportHeight() ?? this.getLineHeight() * 24,
      padding.top + padding.bottom,
    )
  }

  private createRenderRequest(scrollTop = this.dom.scrollTop): RenderRequest {
    const geometry = this.scrollGeometry()
    const logicalTop = geometry.compressed ? geometry.toLogical(scrollTop) : scrollTop
    const viewportHeight = this.getViewportHeight()
    const lineWindow = getVisibleLineWindow({
      lineCount: this.currentSource.lineCount,
      scrollTop:
        (this.lineAtTop(
          geometry.compressed ? Math.max(0, logicalTop - this.contentPadding().top) : scrollTop,
        ) -
          1) *
        this.getLineHeight(),
      lineHeight: this.getLineHeight(),
      overscanLines: this.getOverscanLines(),
      ...(viewportHeight === undefined ? {} : { viewportHeight }),
    })
    // Near the start there may be less physical space than a full overscan.
    // Trim only that offscreen margin, so the top spacer stays nonnegative.
    const fromLine = geometry.compressed
      ? Math.max(
          lineWindow.fromLine,
          this.lineAtTop(logicalTop - scrollTop) +
            (this.lineTop(this.lineAtTop(logicalTop - scrollTop)) < logicalTop - scrollTop ? 1 : 0),
        )
      : lineWindow.fromLine
    const expanded = this.documentPresentation?.expandLineWindow(fromLine, lineWindow.toLine) ?? {
      fromLine,
      toLine: lineWindow.toLine,
    }
    const id = this.nextRequestId++
    return Object.freeze({
      id,
      fromLine: expanded.fromLine,
      toLine: expanded.toLine,
      ...(geometry.compressed
        ? { spacers: this.lineSpacers(expanded.fromLine, expanded.toLine, scrollTop) }
        : {}),
    })
  }

  private createRenderRequestForLine(lineNumber: number): RenderRequest {
    const geometry = this.scrollGeometry()
    if (geometry.compressed)
      return this.createRenderRequest(
        geometry.toPhysical(this.lineTop(lineNumber) + this.contentPadding().top),
      )
    const lineHeight = this.getLineHeight()
    const visibleLines = Math.max(
      1,
      Math.ceil((this.getViewportHeight() ?? lineHeight) / lineHeight),
    )
    const overscan = this.getOverscanLines()
    const fromLine = Math.max(1, lineNumber - overscan)
    const toLine = Math.min(
      this.currentSource.lineCount,
      Math.max(lineNumber, fromLine + visibleLines + overscan * 2 - 1),
    )
    const id = this.nextRequestId
    this.nextRequestId += 1

    return Object.freeze({
      id,
      ...(this.documentPresentation?.expandLineWindow(fromLine, toLine) ?? { fromLine, toLine }),
    })
  }

  private getOverscanLines(): number {
    const configured = this.virtualViewport.overscanLines ?? defaultOverscanLines
    const window = this.renderedSourceWindow
    const averageLength = window
      ? window.text.length / Math.max(1, window.lines.length)
      : (this.currentSource.length ?? 0) / Math.max(1, this.currentSource.lineCount)
    // Bound offscreen work by text volume without reducing the visible viewport.
    return Math.min(configured, Math.max(2, Math.floor(16_384 / Math.max(1, averageLength))))
  }

  private getLineHeight(): number {
    return (
      this.layoutLineHeight ??
      (this.presentation
        ? this.presentation.fontSize * this.presentation.lineHeight
        : Math.max(1, this.virtualViewport.lineHeight ?? defaultLineHeight))
    )
  }

  private getViewportHeight(): number | undefined {
    return (
      this.virtualViewport.viewportHeight ??
      (this.dom.clientHeight > 0 ? this.dom.clientHeight : undefined)
    )
  }

  private async renderSourceLineWindow(request: RenderRequest): Promise<RenderedSourceWindow> {
    const source = this.currentSource
    const version = source.version
    const versionKey = `${source.documentId}:${version}`
    if (this.sourceWindowCacheKey !== versionKey) {
      this.sourceWindowCache.clear()
      this.sourceWindowCacheLength = 0
      this.sourceWindowCacheKey = versionKey
    }
    const key = `${request.fromLine}:${request.toLine}`
    let window = this.sourceWindowCache.get(key)
    if (window) {
      this.sourceWindowCache.delete(key)
      this.sourceWindowCache.set(key, window)
    } else {
      window = await source.readLineWindow(request.fromLine, request.toLine)
      // Cache only completed windows from the current revision, with finite
      // text and entry budgets. Edits never reuse an earlier source revision.
      if (
        source === this.currentSource &&
        version === source.version &&
        versionKey === this.sourceWindowCacheKey &&
        window.text.length <= 524_288
      ) {
        const previous = this.sourceWindowCache.get(key)
        this.sourceWindowCacheLength += window.text.length - (previous?.text.length ?? 0)
        this.sourceWindowCache.set(key, window)
        while (this.sourceWindowCache.size > 16 || this.sourceWindowCacheLength > 524_288) {
          const oldest = this.sourceWindowCache.keys().next().value!
          this.sourceWindowCacheLength -= this.sourceWindowCache.get(oldest)!.text.length
          this.sourceWindowCache.delete(oldest)
        }
      }
    }
    return Object.freeze({
      lines: Object.freeze(window.lines.map((line) => renderSourceLine(this.ownerDocument, line))),
      sourceWindow: window,
    })
  }

  private async renderLiveLineWindow(request: RenderRequest): Promise<RenderedSourceWindow> {
    const source = this.currentSource,
      version = source.version
    const revision = this.presentationReadRevision
    const fromLine = Math.max(1, request.fromLine - this.markdownContextLines)
    const toLine = Math.min(
      this.currentSource.lineCount,
      request.toLine + this.markdownContextLines,
    )
    let parsed = await this.parseLiveWindow(fromLine, toLine)
    const current = () =>
      !this.destroyed &&
      this.mode === 'live' &&
      source === this.currentSource &&
      version === source.version &&
      revision === this.presentationReadRevision
    if (current() && this.documentPresentationEnabled)
      parsed = await this.readPresentationFenceWindow(parsed, request, source, version, revision)
    const blocks = parsed.root.children ?? []
    let renderedFrom = request.fromLine,
      renderedTo = request.toLine
    if (current() && this.documentPresentationEnabled) {
      for (const block of blocks) {
        if (block.type !== 'fencedCode' || block.status !== 'valid') continue
        const closing = block.markerRanges?.at(-1)
        if (!closing || (block.markerRanges?.length ?? 0) < 2) continue
        const start = parsed.window.lines.find((line) => line.from === block.from)
        const end = parsed.window.lines.find(
          (line) => line.from <= closing.to && line.to >= closing.to,
        )
        if (!start || !end || start.number > request.toLine || end.number < request.fromLine)
          continue
        const first = parsed.window.lines.find(
          (line) => line.number === Math.min(renderedFrom, start.number),
        )
        const last = parsed.window.lines.find(
          (line) => line.number === Math.max(renderedTo, end.number),
        )
        if (
          !first ||
          !last ||
          last.number - first.number + 1 > 256 ||
          last.to - first.from > 65_536
        )
          continue
        renderedFrom = first.number
        renderedTo = last.number
      }
    }

    return Object.freeze({
      lines: Object.freeze(
        parsed.window.lines
          .filter((line) => line.number >= renderedFrom && line.number <= renderedTo)
          .map((line) =>
            renderLiveLine(this.ownerDocument, line, blocks, {
              cursorPosition: this.cursorPosition,
              selection: this.currentSelection(),
              editable: this.editable,
            }),
          ),
      ),
      sourceWindow: parsed.window,
      tableStarts: blocks.filter((node) => node.type === 'table').map((node) => node.from),
      ...(renderedFrom !== request.fromLine || renderedTo !== request.toLine
        ? { presentationRange: { fromLine: renderedFrom, toLine: renderedTo } }
        : {}),
    })
  }

  private async readPresentationFenceWindow(
    base: MarkdownWindowParseResult,
    request: RenderRequest,
    source: EditorDocumentSource,
    version: number,
    revision: number,
  ): Promise<MarkdownWindowParseResult> {
    const candidate = base.root.children?.find(
      (block) => block.type === 'fencedCode' && block.status === 'incomplete',
    )
    const opening = candidate && base.window.lines.find((line) => line.from === candidate.from)
    if (!candidate || !opening || opening.number > request.toLine) return base
    const first = Math.min(request.fromLine, opening.number)
    const last = Math.min(source.lineCount, first + 255)
    if (last <= base.window.toLine || base.window.text.length > 65_536) return base
    const key = `${source.documentId}:${version}:${revision}:${first}:${last}:${candidate.from}`
    let pending = this.presentationFenceReads.get(key)
    if (!pending) {
      // A local incomplete fence is only a bounded read hint. The desktop
      // context reader must independently prove it before any source replacement.
      pending = (async () => {
        try {
          const parsed = await parseMarkdownWindow(
            {
              documentId: source.documentId,
              version,
              readLineWindow: (from, to) => source.readLineWindow(from, to, 65_536),
            },
            { fromLine: first, toLine: last },
          )
          if (parsed.window.text.length > 65_536 || parsed.window.lines.length > 256)
            return undefined
          const closed = parsed.root.children?.some(
            (block) =>
              block.type === 'fencedCode' &&
              block.status === 'valid' &&
              block.from === candidate.from,
          )
          return closed ? parsed : undefined
        } catch {
          return undefined
        }
      })()
      // Cache even an unclosed/over-budget hint so scroll/layout cannot loop reads.
      this.presentationFenceReads.set(key, pending)
      while (this.presentationFenceReads.size > this.markdownCacheSize) {
        const oldest = this.presentationFenceReads.keys().next().value
        if (oldest === undefined) break
        this.presentationFenceReads.delete(oldest)
      }
    }
    const parsed = await pending
    return parsed &&
      !this.destroyed &&
      this.mode === 'live' &&
      source === this.currentSource &&
      version === source.version &&
      revision === this.presentationReadRevision &&
      this.documentPresentationEnabled &&
      parsed.window.fromLine <= request.fromLine &&
      parsed.window.toLine >= request.toLine
      ? parsed
      : base
  }

  private async parseLiveWindow(
    fromLine: number,
    toLine: number,
  ): Promise<MarkdownWindowParseResult> {
    const key = [this.currentSource.documentId, this.currentSource.version, fromLine, toLine].join(
      ':',
    )
    const cached = this.markdownCache.get(key)

    if (cached) {
      return cached
    }

    const parsed = this.parseCompleteTableWindow(fromLine, toLine)
    this.markdownCache.set(key, parsed)
    this.trimMarkdownCache()

    try {
      return await parsed
    } catch (error) {
      this.markdownCache.delete(key)
      throw error
    }
  }

  private async parseCompleteTableWindow(
    fromLine: number,
    toLine: number,
  ): Promise<MarkdownWindowParseResult> {
    const source = this.currentSource,
      version = source.version
    const base = await parseMarkdownWindow(source, { fromLine, toLine })
    const starts: number[] = []
    let first = fromLine,
      last = toLine,
      previousPipe = false
    for (const line of base.window.lines) {
      const pipe = pipeLine(line.text)
      if (pipe && !previousPipe) {
        const window = await this.tableReader.read(source, line.number)
        if (source !== this.currentSource || source.version !== version) return base
        if (window) {
          const context = await this.blockContext(line.from, 262_144, false).catch((error) => {
            if (String(error).includes('text budget')) return undefined
            throw error
          })
          if (context && !context.code) {
            const parsed = await parseMarkdownWindow(
              { documentId: source.documentId, version, readLineWindow: async () => window },
              { fromLine: window.fromLine, toLine: window.toLine },
            )
            starts.push(
              ...(parsed.root.children ?? []).filter((n) => n.type === 'table').map((n) => n.from),
            )
            first = Math.min(first, window.fromLine)
            last = Math.max(last, window.toLine)
          }
        }
      }
      previousPipe = pipe
    }
    const parsed =
      first === fromLine && last === toLine
        ? base
        : await parseMarkdownWindow(
            {
              documentId: source.documentId,
              version,
              readLineWindow: (from, to) =>
                source.readLineWindow(from, to, base.window.text.length + 1_048_576),
            },
            { fromLine: first, toLine: last },
          )
    // An unverified or over-budget table stays literal; never hide its delimiter.
    return {
      ...parsed,
      root: {
        ...parsed.root,
        children: (parsed.root.children ?? []).filter(
          (node) => node.type !== 'table' || starts.includes(node.from),
        ),
      },
    }
  }

  private localTable() {
    const window = this.renderedSourceWindow
    const range = this.currentSelection().main
    if (
      this.mode !== 'live' ||
      !window ||
      range.from < window.from ||
      range.to > window.to ||
      !this.tableStarts.length
    )
      return
    const table = boundedTableState(window, this.currentSelection())
    return table && this.tableStarts.includes(table.context.table.from + table.offset)
      ? table
      : undefined
  }

  get activeTable() {
    return this.localTable()?.context
  }

  runTableCommand(command: TableCommand): Promise<void> {
    return this.trackVisibleEditTask(async () => {
      if (this.mode === 'live') return this.applyTableCommand(command)
      if (!this.editable || this.composing) return
      const revision = this.selectionRevision
      const context = await this.readEditingContext()
      if (!context.table || !this.editable || this.composing || this.selectionRevision !== revision)
        return
      const table = context.table
      const text = table.text + (this.editingContextCache?.window.text.slice(table.to) ?? '')
      const state = new EditorState({
        doc: new MemoryTextDocument(text),
        selection: Selection.range(
          table.selection.anchor - table.from,
          table.selection.head - table.from,
        ),
      })
      const local = boundedTableState(
        {
          from: table.from,
          to: table.from + text.length,
          fromLine: 1,
          toLine: state.doc.lineCount,
          text,
          lines: [],
        },
        this.currentSelection(),
      )
      if (!local) return
      const transaction = tableCommand(local.state, local.context, command)
      if (transaction) await this.applyLocalTableTransaction(transaction, table.from)
    })
  }

  /** No edit queue is entered here: a host may call this inside runAfterPendingEdits. */
  async readEditingContext(
    selection: EditingSelection = this.currentSelection().main,
    signal?: AbortSignal,
  ): Promise<EditingContext> {
    signal?.throwIfAborted()
    const source = this.currentSource,
      version = source.version
    const unknown: EditingContext = { kind: 'unknown', complete: false }
    const current = () =>
      !this.destroyed && this.currentSource === source && source.version === version
    try {
      // Parse from a proven document boundary. Existing distant top-level fence
      // checkpoints cannot prove nested-container context, so those remain unknown.
      let cached = this.editingContextCache
      if (!cached || cached.source !== source || cached.version !== version) {
        const window = await source.readLineWindow(
          1,
          Math.min(source.lineCount, editingContextLimits.lines),
          editingContextLimits.text,
        )
        signal?.throwIfAborted()
        if (!current()) return unknown
        const state = new EditorState({ doc: new MemoryTextDocument(window.text) })
        cached = { source, version, window, state, root: parseMarkdown(window.text).root }
        this.editingContextCache = cached
      }
      const { window } = cached
      signal?.throwIfAborted()
      if (!current() || Math.max(selection.anchor, selection.head) > window.to) return unknown
      const state = cached.state.applyTransaction({
        selection: Selection.range(selection.anchor, selection.head),
        addToHistory: false,
      })
      const context = editingContextFromState(state, cached.root)
      if (context.table && window.toLine < source.lineCount && context.table.to >= window.to)
        return { kind: 'table', complete: false }
      return context
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof RangeError && String(error).includes('text budget')) return unknown
      throw error
    }
  }

  private async applyTableCommand(command: TableCommand): Promise<void> {
    const table = this.localTable()
    if (!table || !this.editable || this.composing) return
    const transaction = tableCommand(table.state, table.context, command)
    if (transaction) await this.applyLocalTableTransaction(transaction, table.offset)
  }

  private async applyLocalTableTransaction(
    transaction: Transaction,
    offset: number,
  ): Promise<void> {
    const selected = transaction.selection
    const selection = selected
      ? Selection.range(offset + selected.main.anchor, offset + selected.main.head)
      : this.currentSelection()
    const changes = transaction.changes?.changes ?? []
    if (changes.length) {
      // Current shared table commands emit one bounded replacement/insertion.
      if (changes.length !== 1) throw new Error('Table command requires one atomic edit')
      const change = changes[0]!
      await this.applyVisibleEdit(
        offset + change.from,
        offset + change.to,
        change.insert,
        'isolate',
        selection,
      )
    } else {
      this.cursorPosition = selection.main.head
      this.selectionAnchor = selection.main.anchor
      await this.ensureCursorRendered()
      this.renderSelection()
      this.renderCursor()
    }
  }

  private async applyTextInput(
    from: number,
    to: number,
    text: string,
    historyGroup?: 'isolate',
    focusInput = true,
  ): Promise<void> {
    const table = this.localTable()
    await this.applyVisibleEdit(
      from,
      to,
      table?.context.withinCell
        ? tableCellText(
            text,
            table.state.doc.slice(table.context.cell.from, table.state.selection.main.from),
          )
        : text,
      historyGroup,
      undefined,
      focusInput,
    )
  }

  private async deleteTableText(direction: -1 | 1): Promise<boolean> {
    const table = this.localTable()
    if (!table?.context.withinCell || !table.state.selection.main.empty) return false
    const position = table.state.selection.main.head,
      cell = table.context.cell
    if (position === (direction < 0 ? cell.from : cell.to)) return true
    const text = table.state.doc.slice(
      direction < 0 ? cell.from : position,
      direction < 0 ? position : cell.to,
    )
    const atom =
      direction < 0
        ? /(?:<br[ \t]*\/?>|\\\|)$/i.exec(text)?.[0]
        : /^(?:<br[ \t]*\/?>|\\\|)/i.exec(text)?.[0]
    if (!atom) return false
    const from = table.offset + position - (direction < 0 ? atom.length : 0)
    await this.applyVisibleEdit(from, from + atom.length, '', 'isolate')
    return true
  }

  private trimMarkdownCache(): void {
    while (this.markdownCache.size > this.markdownCacheSize) {
      const oldest = this.markdownCache.keys().next().value

      if (typeof oldest !== 'string') {
        return
      }

      this.markdownCache.delete(oldest)
    }
  }

  async warmMarkdownCacheAroundVisibleWindow(): Promise<readonly string[]> {
    const request = this.createRenderRequest()
    const ranges = this.createMarkdownWarmupRanges(request)
    const warmed: string[] = []

    for (const range of ranges) {
      await this.parseLiveWindow(range.fromLine, range.toLine)
      warmed.push(`${range.fromLine}-${range.toLine}`)
    }

    return Object.freeze(warmed)
  }

  private scheduleMarkdownWarmup(request: RenderRequest): void {
    this.cancelMarkdownWarmup()
    if (
      !this.backgroundMarkdownWarmup ||
      this.mode !== 'live' ||
      (this.renderedSourceWindow?.text.length ?? 0) > 65_536
    ) {
      return
    }

    this.markdownWarmupTimer = setTimeout(() => {
      this.markdownWarmupTimer = undefined
      void this.warmMarkdownCacheForRequest(request).catch(() => undefined)
    }, this.markdownWarmupDelayMs)
  }

  private async warmMarkdownCacheForRequest(request: RenderRequest): Promise<void> {
    for (const range of this.createMarkdownWarmupRanges(request)) {
      await this.parseLiveWindow(range.fromLine, range.toLine)
    }
  }

  private createMarkdownWarmupRanges(
    request: Pick<RenderRequest, 'fromLine' | 'toLine'>,
  ): ReadonlyArray<{ readonly fromLine: number; readonly toLine: number }> {
    const visibleWindowSize = Math.max(1, request.toLine - request.fromLine + 1)
    const ranges: Array<{ readonly fromLine: number; readonly toLine: number }> = []

    for (let index = -this.markdownWarmupWindows; index <= this.markdownWarmupWindows; index += 1) {
      const rawFromLine = request.fromLine + index * visibleWindowSize
      const rawToLine = request.toLine + index * visibleWindowSize
      const fromLine = Math.max(1, rawFromLine - this.markdownContextLines)
      const toLine = Math.min(this.currentSource.lineCount, rawToLine + this.markdownContextLines)

      if (toLine < 1 || fromLine > this.currentSource.lineCount || toLine < fromLine) {
        continue
      }

      const key = `${fromLine}-${toLine}`

      if (!ranges.some((range) => `${range.fromLine}-${range.toLine}` === key)) {
        ranges.push(Object.freeze({ fromLine, toLine }))
      }
    }

    return Object.freeze(ranges)
  }

  private cancelMarkdownWarmup(): void {
    if (this.markdownWarmupTimer === undefined) {
      return
    }

    clearTimeout(this.markdownWarmupTimer)
    this.markdownWarmupTimer = undefined
  }

  private async readInputProxy(): Promise<void> {
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
    const range = this.getSelectedRange()
    await this.applyTextInput(range.from, range.to, text)
  }

  private async commitComposition(data: string): Promise<void> {
    if (!this.editable || data.length === 0) {
      return
    }

    const range = this.getSelectedRange()
    // The native input survives rendering. Finalizing an IME after blur must
    // retain the user's new focus, including while this async edit is queued.
    await this.applyTextInput(range.from, range.to, data, 'isolate', false)
  }

  private handleEditingKey(event: KeyboardEvent): boolean {
    if (isCompositionKeyEvent(event)) {
      return false
    }

    if (!this.editable) {
      return false
    }

    if (
      !event.altKey &&
      (event.ctrlKey || event.metaKey) &&
      (event.key === 'Home' || event.key === 'End')
    ) {
      const generation = this.documentGeneration
      const requestRevision = ++this.documentNavigationRequestRevision
      const edge = event.key === 'Home' ? 'start' : 'end'
      const requestCurrent = () =>
        !this.destroyed &&
        generation === this.documentGeneration &&
        requestRevision === this.documentNavigationRequestRevision
      void this.trackVisibleEditTask(async () => {
        if (!requestCurrent()) return
        await this.flushPendingVisibleEdit()
        if (!requestCurrent()) return
        // A preceding queued edit may replace the source or advance its version.
        // Snapshot it only once that edit has committed.
        const source = this.currentSource
        const documentId = source.documentId
        const version = source.version
        const current = () =>
          requestCurrent() &&
          source === this.currentSource &&
          documentId === source.documentId &&
          version === source.version
        const number = edge === 'start' ? 1 : source.lineCount
        let line: SourceLine
        try {
          line = await this.readSourceLine(number)
        } catch (error) {
          if (!current()) return
          throw error
        }
        if (!current()) return
        const head = edge === 'start' ? line.from : line.to
        const anchor = event.shiftKey ? this.selectionAnchor : head
        try {
          await this.revealSelection(number, Selection.range(anchor, head), {
            assertCurrent: () => {
              if (!current())
                throw new DOMException('Document navigation invalidated', 'AbortError')
            },
          })
        } catch (error) {
          if (!current() || (error instanceof DOMException && error.name === 'AbortError')) return
          throw error
        }
        if (current() && this.selectionAnchor === anchor && this.cursorPosition === head)
          this.onDocumentNavigation?.(edge)
      })
      return true
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      void this.trackVisibleEditTask(() =>
        this.movePage(event.key === 'PageUp' ? -1 : 1, event.shiftKey),
      )
      return true
    }

    if (event.key.length === 1) {
      if (this.composing) {
        return false
      }

      void this.trackVisibleEditTask(() => {
        const range = this.getSelectedRange()
        return this.applyTextInput(range.from, range.to, event.key)
      })
      return true
    }

    if (event.key === 'Escape' && this.activeTable) {
      void this.runTableCommand('exit')
      return true
    }

    if (event.key === 'Enter') {
      void this.trackVisibleEditTask(async () => {
        const table = this.localTable()
        if (table) {
          if (table.context.withinCell && event.shiftKey) {
            const range = this.getSelectedRange()
            await this.applyVisibleEdit(range.from, range.to, '<br>', 'isolate')
          } else await this.applyTableCommand('down')
        } else await this.enterBlock()
      })
      return true
    }

    if (event.key === 'Tab' || (event.key === 'Unidentified' && event.code === 'Tab')) {
      const generation = this.documentGeneration
      const selectionRevision = this.selectionGeneration
      const focused = this.ownerDocument.activeElement
      const navigate = () => {
        if (
          !this.destroyed &&
          !this.composing &&
          generation === this.documentGeneration &&
          selectionRevision === this.selectionGeneration &&
          this.ownerDocument.activeElement === focused &&
          (focused === this.inputDOM || focused === this.dom)
        )
          this.onFocusNavigation?.({ backward: event.shiftKey })
      }
      void this.trackVisibleEditTask(() =>
        this.localTable()
          ? this.applyTableCommand(event.shiftKey ? 'previous' : 'next')
          : this.indentBlock(event.shiftKey, navigate),
      )
      return true
    }

    if (event.key === 'Backspace') {
      void this.trackVisibleEditTask(() => this.backspaceBlock())
      return true
    }

    if (event.key === 'Delete') {
      void this.trackVisibleEditTask(() => this.deleteAroundCursor(1))
      return true
    }

    switch (event.key) {
      case 'Home':
      case 'End':
        void this.trackVisibleEditTask(async () => {
          await this.flushPendingVisibleEdit()
          const documentId = this.currentSource.documentId
          const line =
            this.findRenderedSourceLineAtPosition(this.cursorPosition) ??
            (await this.currentSource.lineAtPosition(this.cursorPosition))
          if (this.destroyed || documentId !== this.currentSource.documentId) return
          const previousPosition = this.cursorPosition
          const table = this.localTable()
          this.cursorPosition = table?.context.withinCell
            ? table.offset + (event.key === 'End' ? table.context.cell.to : table.context.cell.from)
            : event.key === 'End'
              ? line.to
              : line.from
          if (!event.shiftKey) this.selectionAnchor = this.cursorPosition
          await this.ensureCursorRendered(line.number)
          await this.renderLiveSyntaxAroundPositions(previousPosition, this.cursorPosition)
          this.renderSelection()
          this.renderCursor()
        })
        return true
      case 'ArrowLeft':
        void this.trackVisibleEditTask(() => this.moveCursor('left', event.shiftKey))
        return true
      case 'ArrowRight':
        void this.trackVisibleEditTask(() => this.moveCursor('right', event.shiftKey))
        return true
      case 'ArrowUp':
        void this.trackVisibleEditTask(() => this.moveCursor('up', event.shiftKey))
        return true
      case 'ArrowDown':
        void this.trackVisibleEditTask(() => this.moveCursor('down', event.shiftKey))
        return true
      default:
        return false
    }
  }

  private async movePage(direction: -1 | 1, extend: boolean): Promise<void> {
    await this.flushPendingVisibleEdit()
    const current =
      this.findRenderedSourceLineAtPosition(this.cursorPosition) ??
      (await this.currentSource.lineAtPosition(this.cursorPosition))
    const height = this.getLineHeight()
    const delta =
      direction * Math.max(1, Math.floor((this.getViewportHeight() ?? height * 24) / height) - 1)
    const target = await this.readSourceLine(
      clamp(current.number + delta, 1, this.currentSource.lineCount),
    )
    const geometry = this.scrollGeometry()
    const logicalTop = geometry.compressed
      ? geometry.toLogical(this.dom.scrollTop) - this.contentPadding().top
      : this.dom.scrollTop
    const first = this.lineAtTop(logicalTop)
    this.cursorPosition =
      target.from + snapGraphemeOffset(target.text, this.cursorPosition - current.from)
    if (!extend) this.selectionAnchor = this.cursorPosition
    await this.scrollToLine(clamp(first + delta, 1, this.currentSource.lineCount))
    this.renderSelection()
    this.renderCursor()
  }

  private async moveCursor(
    direction: 'left' | 'right' | 'up' | 'down',
    extend: boolean,
  ): Promise<void> {
    const table = this.localTable()
    if (table?.context.withinCell) {
      await this.applyLocalTableTransaction(
        {
          selection: tableArrowSelection(table.state, table.context, direction, extend),
          addToHistory: false,
        },
        table.offset,
      )
      return
    }
    const range = this.getSelectedRange()
    const current = this.cursorPosition
    const previous = current
    let next = current
    let targetLineNumber: number | undefined

    if (!extend && range.from !== range.to) {
      next = direction === 'right' || direction === 'down' ? range.to : range.from
    } else if (direction === 'left' || direction === 'right') {
      const move = await this.horizontalCursorTarget(current, direction === 'left' ? -1 : 1)
      next = move.position
      targetLineNumber = move.lineNumber
    } else {
      const verticalMove = await this.moveCursorVertically(current, direction)
      next = verticalMove.position
      targetLineNumber = verticalMove.lineNumber
    }

    if (this.mode === 'live') {
      const forward = direction === 'right' || direction === 'down'
      const visited = new Set<number>()
      while (!visited.has(next)) {
        visited.add(next)
        const line =
          targetLineNumber !== undefined
            ? await this.readSourceLine(targetLineNumber)
            : this.findRenderedSourceLineAtPosition(next)
        if (!line) break
        if (!/^ {0,3}(?:`{3,}|~{3,})/u.test(line.text)) break
        const parsed = await this.parseLiveWindow(
          Math.max(1, line.number - this.markdownContextLines),
          Math.min(this.currentSource.lineCount, line.number + this.markdownContextLines),
        )
        const block = codeBlockForLine(parsed.root.children ?? [], line.from, line.to)
        const length =
          this.currentSource.length ?? (await this.readSourceLine(this.currentSource.lineCount)).to
        const target = block && codeFenceArrowTarget(block, line.from, line.to, forward, length)
        if (target === undefined) break
        const clamped = Math.min(target, length)
        const targetLine = [...parsed.window.lines]
          .reverse()
          .find((candidate) => candidate.from <= clamped)
        if (!targetLine) break
        next = Math.min(clamped, targetLine.to)
        targetLineNumber = targetLine.number
      }
    }

    if (next === current && (extend || range.from === range.to)) {
      return
    }

    this.cursorPosition = next

    if (!extend) {
      this.selectionAnchor = next
    }

    await this.ensureCursorRendered(targetLineNumber)
    await this.renderLiveSyntaxAroundPositions(previous, next)
    this.renderSelection()
    this.renderCursor()
    this.inputDOM.focus({ preventScroll: true })
  }

  private async moveCursorVertically(
    pos: number,
    direction: 'up' | 'down',
  ): Promise<{ readonly position: number; readonly lineNumber?: number }> {
    const line =
      this.findRenderedSourceLineAtPosition(pos) ??
      (await this.currentSource.lineAtPosition(pos).catch(() => undefined))

    if (!line) {
      return { position: pos }
    }

    const targetLineNumber = direction === 'up' ? line.number - 1 : line.number + 1

    if (targetLineNumber < 1 || targetLineNumber > this.currentSource.lineCount) {
      return { position: pos, lineNumber: line.number }
    }

    const target = await this.readSourceLine(targetLineNumber)
    return {
      position: target.from + snapGraphemeOffset(target.text, pos - line.from),
      lineNumber: targetLineNumber,
    }
  }

  private async readSourceLine(number: number): Promise<SourceLine> {
    const cached = this.renderedSourceWindow?.lines.find((line) => line.number === number)
    if (cached) return cached
    // The source must include optimistic edits before an offscreen IPC read.
    await this.flushPendingVisibleEdit()
    const window = await this.currentSource.readLineWindow(number, number)
    const line = window.lines[0]
    if (!line) throw new RangeError(`Missing source line: ${number}`)
    return line
  }

  private async horizontalCursorTarget(
    position: number,
    direction: -1 | 1,
  ): Promise<{ readonly position: number; readonly lineNumber?: number }> {
    const line =
      this.findRenderedSourceLineAtPosition(position) ??
      (await this.currentSource.lineAtPosition(position).catch(() => undefined))
    if (!line) return { position }
    const offset = position - line.from
    if (direction < 0 && offset > 0) {
      return {
        position: line.from + previousGraphemeOffset(line.text, offset),
        lineNumber: line.number,
      }
    }
    if (direction > 0 && position < line.to) {
      return {
        position: line.from + nextGraphemeOffset(line.text, offset),
        lineNumber: line.number,
      }
    }
    const adjacentNumber = line.number + direction
    if (adjacentNumber < 1 || adjacentNumber > this.currentSource.lineCount) {
      return { position, lineNumber: line.number }
    }
    const adjacent = await this.readSourceLine(adjacentNumber)
    return { position: direction < 0 ? adjacent.to : adjacent.from, lineNumber: adjacent.number }
  }

  private revealHorizontalCursor(): void {
    const line = Array.from(this.contentDOM.querySelectorAll<HTMLElement>('.milkup-line')).find(
      (line) =>
        this.cursorPosition >= Number(line.dataset.from) &&
        this.cursorPosition <= Number(line.dataset.to),
    )
    if (
      line &&
      (this.mode === 'source'
        ? scrollSourcePositionIntoView(this.dom, line, this.cursorPosition)
        : scrollCodePositionIntoView(line, this.cursorPosition))
    ) {
      this.renderSelection()
      this.renderSearchHighlights()
      this.renderCursor()
    }
  }

  private async ensureCursorRendered(targetLineNumber?: number): Promise<void> {
    this.revealHorizontalCursor()
    const line =
      this.findRenderedLineAtPosition(this.cursorPosition) ??
      (await this.currentSource.lineAtPosition(this.cursorPosition).catch(() => undefined))
    const lineNumber = line?.number ?? targetLineNumber

    if (lineNumber === undefined) {
      return
    }

    const fromLine = Number(this.contentDOM.dataset.fromLine)
    const toLine = Number(this.contentDOM.dataset.toLine)

    if (
      Number.isInteger(fromLine) &&
      Number.isInteger(toLine) &&
      lineNumber >= fromLine &&
      lineNumber <= toLine
    ) {
      const element = this.contentDOM.querySelector<HTMLElement>(
        `.milkup-line[data-line="${lineNumber}"]`,
      )
      const bounds = element?.getBoundingClientRect()
      const viewport = this.dom.getBoundingClientRect()
      // A line in overscan is rendered but may still be outside the viewport.
      // Preserve the no-layout fallback used by non-browser consumers.
      if (
        !bounds ||
        viewport.height === 0 ||
        (bounds.top >= viewport.top && bounds.bottom <= viewport.bottom)
      )
        return
    }

    const lineHeight = this.getLineHeight()
    const viewportHeight = this.getViewportHeight() ?? lineHeight
    const visibleLines = Math.max(1, Math.floor(viewportHeight / lineHeight))
    const nextFirstLine = clamp(
      lineNumber - Math.floor(visibleLines / 2),
      1,
      this.currentSource.lineCount,
    )
    await this.scrollToLine(nextFirstLine)
    const target = this.contentDOM.querySelector<HTMLElement>(
      `.milkup-line[data-line="${lineNumber}"]`,
    )
    if (target && this.dom.clientHeight > 0) {
      const bounds = target.getBoundingClientRect(),
        viewport = this.dom.getBoundingClientRect()
      if (bounds.top < viewport.top || bounds.bottom > viewport.bottom)
        await this.scrollToLine(lineNumber)
    }
    this.revealHorizontalCursor()
  }

  private findRenderedLineAtPosition(position: number): SourceLine | undefined {
    for (const lineDOM of Array.from(
      this.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'),
    )) {
      const number = Number(lineDOM.dataset.line)
      const from = Number(lineDOM.dataset.from)
      const to = Number(lineDOM.dataset.to)

      if (
        !Number.isInteger(number) ||
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        position < from ||
        position > to
      ) {
        continue
      }

      return Object.freeze({
        number,
        from,
        to,
        text: lineDOM.textContent?.replace(/\u200b/g, '') ?? '',
      })
    }

    return undefined
  }

  private async deleteAroundCursor(direction: -1 | 1): Promise<void> {
    if (await this.deleteTableText(direction)) return
    const range = this.getSelectedRange()

    if (range.from !== range.to) {
      await this.applyVisibleEdit(range.from, range.to, '')
      return
    }

    const position = this.cursorPosition
    const target = await this.horizontalCursorTarget(position, direction)
    const from = Math.min(position, target.position)
    const to = Math.max(position, target.position)

    if (from === to) {
      return
    }

    await this.applyVisibleEdit(from, to, '')
  }

  private toggleTask(task: HTMLButtonElement): void {
    // A stale DOM marker must never address text moved by an unfinished edit.
    if (
      !this.editable ||
      !this.onEdit ||
      this.composing ||
      this.destroyed ||
      this.mode !== 'live' ||
      this.taskTogglePending ||
      this.pendingVisibleEdit ||
      this.activeVisibleEditTasks.size > 0
    )
      return
    const source = this.currentSource,
      version = source.version,
      revision = this.editRevision
    const from = Number(task.dataset.from),
      to = Number(task.dataset.to)
    const window = this.renderedSourceWindow
    if (
      !window ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < window.from ||
      to > window.to
    )
      return
    const edit = taskMarkerEdit(from, readLineWindowRangeText(window, from, to))
    if (!edit) return
    const focused = this.ownerDocument.activeElement === task
    this.taskTogglePending = true
    syncTaskAvailability(this.contentDOM, false)
    void this.trackVisibleEditTask(async () => {
      try {
        await this.editCommitQueue
        if (
          !this.editable ||
          this.destroyed ||
          this.mode !== 'live' ||
          source !== this.currentSource ||
          version !== source.version ||
          revision !== this.editRevision
        )
          return
        await this.applyVisibleEdit(
          edit.from,
          edit.to,
          edit.insert,
          'isolate',
          this.currentSelection(),
        )
        await this.flushPendingVisibleEdit()
        await this.renderVisibleWindow()
      } finally {
        this.taskTogglePending = false
        syncTaskAvailability(this.contentDOM, this.editable && !!this.onEdit)
        if (focused && !this.destroyed && this.currentSource.documentId === source.documentId)
          this.contentDOM
            .querySelector<HTMLButtonElement>(`.milkup-task-marker[data-from="${from}"]`)
            ?.focus({ preventScroll: true })
      }
    })
  }

  private async applyVisibleEdit(
    from: number,
    to: number,
    insert: string,
    historyGroup?: 'isolate',
    selectionAfter = Selection.cursor(from + insert.length),
    focusInput = true,
  ): Promise<void> {
    if (!this.onEdit) {
      return
    }

    const editedLine = this.findRenderedLineAtPosition(from)
    const liveTableEdit = !!this.localTable()
    const structuralEdit = insert.includes('\n') || editedLine === undefined || to > editedLine.to
    if (structuralEdit) this.measuredHeights.clear()
    const delta = insert.length - (to - from)
    this.tableStarts = this.tableStarts.map((start) =>
      start < from ? start : start >= to ? start + delta : from,
    )
    this.editRevision += 1
    const editRevision = this.editRevision
    const selectionBefore = this.currentSelection()
    this.cursorPosition = selectionAfter.main.head
    this.selectionAnchor = selectionAfter.main.anchor
    // Return preview-owned source nodes before changing their text or ranges.
    this.documentPresentation.selectionChanged()
    const { text: deletedText, lineNumber } = await this.readVisibleEditRange(from, to)
    const edit: SourceDocumentEdit = {
      from,
      to,
      insert,
      deletedText,
      selectionBefore,
      selectionAfter,
      ...(historyGroup ? { historyGroup } : {}),
    }
    this.cancelMarkdownWarmup()

    if (structuralEdit) {
      const optimistic = this.updateOptimisticSourceWindow(from, to, insert)

      if (optimistic) {
        await this.renderOptimisticSourceWindow(optimistic.window, optimistic.lineCount)
        const commit = this.queueVisibleEditCommit(edit)
        void commit.then(
          () => this.refreshAfterOptimisticCommit(editRevision),
          (error: unknown) => this.rollbackOptimisticEdit(editRevision, error),
        )
      } else {
        await this.queueVisibleEditCommit(edit, { immediate: true })
        await this.refreshAfterOptimisticCommit(editRevision)
      }
      await this.ensureCursorRendered(lineNumber)
      this.renderCursor()
    } else {
      const optimistic = this.updateOptimisticSourceWindow(from, to, insert)
      if (liveTableEdit && optimistic) {
        // Keep existing <br>/escape nodes during rapid typing. Replacing a mapped
        // cell's textContent flattens its visual line breaks until native parsing.
        const parsed = await parseMarkdownWindow(
          {
            documentId: this.currentSource.documentId,
            version: this.currentSource.version,
            readLineWindow: async () => optimistic.window,
          },
          { fromLine: optimistic.window.fromLine, toLine: optimistic.window.toLine },
        )
        const line = optimistic.window.lines.find((line) => line.number === editedLine.number)!
        this.contentDOM
          .querySelector(`.milkup-line[data-line="${editedLine.number}"]`)
          ?.replaceWith(
            renderLiveLine(this.ownerDocument, line, parsed.root.children ?? [], {
              selection: this.currentSelection(),
              editable: this.editable,
            }),
          )
      } else this.applyOptimisticRenderedLineEdit(editedLine, from, to, insert)
      if (delta !== 0)
        this.mapRenderedLinePositions(editedLine.number, ChangeSet.replace(from, to, insert))
      if (liveTableEdit) this.measureTableRows()
      this.revealHorizontalCursor()
      this.renderSelection()
      this.renderCursor()
      const commit = this.queueVisibleEditCommit(edit)
      if (this.mode === 'live') {
        void commit
          .then(async () => {
            if (editRevision !== this.editRevision) {
              return
            }

            this.markdownCache.clear()
            await this.renderRenderedLine(editedLine.number)
            this.measureTableRows()
            this.renderSelection()
            this.renderCursor()
          })
          .catch((error: unknown) => this.rollbackOptimisticEdit(editRevision, error))
      }
    }

    if (focusInput) this.inputDOM.focus({ preventScroll: true })
  }

  private updateOptimisticSourceWindow(
    from: number,
    to: number,
    insert: string,
  ):
    | {
        readonly window: DocumentLineWindow
        readonly lineCount: number
      }
    | undefined {
    const current = this.renderedSourceWindow

    if (!current || from < current.from || to > current.to) {
      return undefined
    }

    const text =
      current.text.slice(0, from - current.from) + insert + current.text.slice(to - current.from)
    const document = new MemoryTextDocument(text)
    const lines = Array.from({ length: document.lineCount }, (_, index) => {
      const line = document.line(index + 1)
      return Object.freeze({
        number: current.fromLine + index,
        from: current.from + line.from,
        to: current.from + line.to,
        text: line.text,
      })
    })
    const lineDelta = lines.length - current.lines.length
    const last = lines.at(-1)
    const window = Object.freeze({
      fromLine: current.fromLine,
      toLine: current.fromLine + lines.length - 1,
      from: current.from,
      to: last?.to ?? current.from,
      text,
      lines: Object.freeze(lines),
    })

    this.renderedSourceWindow = window
    // Optimistic text is editable immediately, but cannot be submitted as a committed snapshot.
    this.renderedDocumentVersion = undefined
    return Object.freeze({
      window,
      lineCount: this.currentSource.lineCount + lineDelta,
    })
  }

  private async renderOptimisticSourceWindow(
    window: DocumentLineWindow,
    lineCount: number,
  ): Promise<void> {
    let lines: readonly HTMLElement[]

    if (this.mode === 'live') {
      const parsed = await parseMarkdownWindow(
        {
          documentId: `${this.currentSource.documentId}:optimistic`,
          version: this.currentSource.version + this.editRevision,
          readLineWindow: async () => window,
        },
        { fromLine: window.fromLine, toLine: window.toLine },
      )
      const blocks = (parsed.root.children ?? []).filter(
        (node) => node.type !== 'table' || this.tableStarts.includes(node.from),
      )
      lines = parsed.window.lines.map((line) =>
        renderLiveLine(this.ownerDocument, line, blocks, {
          cursorPosition: this.cursorPosition,
          selection: this.currentSelection(),
          editable: this.editable,
        }),
      )
    } else {
      lines = window.lines.map((line) => renderSourceLine(this.ownerDocument, line))
    }
    const lineHeight = this.getLineHeight()

    const geometry = this.scrollGeometry(lineCount)
    const spacers = geometry.compressed
      ? geometry.spacers(window.fromLine, window.toLine, this.dom.scrollTop)
      : undefined
    this.latestAppliedRequestId = this.nextRequestId
    this.nextRequestId += 1
    this.contentDOM.replaceChildren(
      renderSpacer(this.ownerDocument, 'top', spacers?.top ?? (window.fromLine - 1) * lineHeight),
      ...lines,
      renderSpacer(
        this.ownerDocument,
        'bottom',
        spacers?.bottom ?? (lineCount - window.toLine) * lineHeight,
      ),
    )
    this.contentDOM.dataset.virtualized = 'true'
    this.contentDOM.dataset.fromLine = String(window.fromLine)
    this.contentDOM.dataset.toLine = String(window.toLine)
    this.contentDOM.dataset.renderMode = this.mode
    this.measureTableRows()
    this.renderSearchHighlights()
    this.renderSelection()
    this.renderCursor()
  }

  private async refreshAfterOptimisticCommit(editRevision: number): Promise<void> {
    if (editRevision !== this.editRevision) {
      return
    }

    this.markdownCache.clear()
    this.sourceWindowCache.clear()
    this.sourceWindowCacheLength = 0
    try {
      await this.renderVisibleWindow()
    } catch {
      // A following render (scroll, focus, or edit) retries the visible window.
    }
  }

  private async rollbackOptimisticEdit(editRevision: number, error: unknown): Promise<void> {
    this.visibleEditPreparationError = error

    if (editRevision !== this.editRevision) {
      return
    }

    this.markdownCache.clear()
    this.renderedSourceWindow = undefined
    await this.renderVisibleWindow().catch(() => undefined)
  }

  private enqueueVisibleEdit(task: () => Promise<void>): Promise<void> {
    const queued = this.visibleEditQueue.then(task)
    this.visibleEditQueue = queued.catch(() => undefined)
    return queued
  }

  private trackVisibleEditTask(task: () => Promise<void>): Promise<void> {
    const documentId = this.currentSource.documentId
    const tracked = this.enqueueVisibleEdit(async () => {
      if (!this.destroyed && documentId === this.currentSource.documentId) await task()
    }).catch((error: unknown) => {
      this.visibleEditPreparationError = error
    })
    this.activeVisibleEditTasks.add(tracked)
    void tracked.then(() => this.activeVisibleEditTasks.delete(tracked))
    return tracked
  }

  private queueVisibleEditCommit(
    edit: SourceDocumentEdit,
    options: { readonly immediate?: boolean } = {},
  ): Promise<void> {
    if (options.immediate) {
      return this.flushPendingVisibleEdit().then(() => this.commitVisibleEdit(edit))
    }

    const mergedEdit = this.pendingVisibleEdit
      ? mergeSourceDocumentEdits(this.pendingVisibleEdit, edit)
      : edit

    if (this.pendingVisibleEdit && !mergedEdit) {
      // Register the next batch synchronously. Native commits already serialize through
      // editCommitQueue; deferring registration lets flushPendingEdits miss this batch.
      void this.flushPendingVisibleEdit()
      return this.queueVisibleEditCommit(edit)
    }

    this.pendingVisibleEdit = mergedEdit

    const queued = new Promise<void>((resolve, reject) => {
      this.pendingVisibleEditResolutions.push({ resolve, reject })
    })

    this.schedulePendingVisibleEditCommit()
    return queued
  }

  private schedulePendingVisibleEditCommit(): void {
    if (this.editCommitTimer !== undefined) {
      clearTimeout(this.editCommitTimer)
    }

    this.editCommitTimer = setTimeout(() => {
      this.editCommitTimer = undefined
      void this.flushPendingVisibleEdit()
    }, defaultEditCommitDelayMs)
  }

  private flushPendingVisibleEdit(): Promise<void> {
    if (this.editCommitTimer !== undefined) {
      clearTimeout(this.editCommitTimer)
      this.editCommitTimer = undefined
    }

    const edit = this.pendingVisibleEdit
    const resolutions = this.pendingVisibleEditResolutions.splice(
      0,
      this.pendingVisibleEditResolutions.length,
    )
    this.pendingVisibleEdit = undefined

    if (!edit) {
      return this.editCommitQueue
    }

    const commit = this.commitVisibleEdit(edit)

    commit.then(
      () => resolutions.forEach((resolution) => resolution.resolve()),
      (error: unknown) => resolutions.forEach((resolution) => resolution.reject(error)),
    )

    return commit
  }

  private commitVisibleEdit(edit: SourceDocumentEdit): Promise<void> {
    this.editCommitQueue = this.editCommitQueue
      .catch(() => undefined)
      .then(async () => {
        if (!this.onEdit) {
          return
        }

        await this.onEdit(edit)
      })

    return this.editCommitQueue
  }

  private async readVisibleEditRange(
    from: number,
    to: number,
  ): Promise<{ readonly text: string; readonly lineNumber: number | undefined }> {
    if (from === to) {
      return { text: '', lineNumber: this.findRenderedSourceLineAtPosition(from)?.number }
    }
    const readWindow = (window: DocumentLineWindow) => ({
      text: readLineWindowRangeText(window, from, to),
      lineNumber: window.lines.find((line) => from >= line.from && from <= line.to)?.number,
    })

    const rendered = this.renderedSourceWindow

    if (rendered && from >= rendered.from && to <= rendered.to) {
      return readWindow(rendered)
    }

    const fromLine = await this.currentSource.lineAtPosition(from).catch(() => undefined)
    const toLine = await this.currentSource.lineAtPosition(to).catch(() => undefined)

    if (fromLine && toLine) {
      const window = await this.currentSource.readLineWindow(fromLine.number, toLine.number)
      return readWindow(window)
    }

    const renderedFromLine = Number(this.contentDOM.dataset.fromLine)
    const renderedToLine = Number(this.contentDOM.dataset.toLine)

    if (!Number.isInteger(renderedFromLine) || !Number.isInteger(renderedToLine)) {
      throw new RangeError('Visible edit range is outside the rendered document window')
    }

    await this.flushPendingVisibleEdit()
    // A keyboard boundary edit may include the separator immediately outside the
    // viewport. Native sources have no global position lookup; read one neighbour.
    const window = await this.currentSource.readLineWindow(
      Math.max(1, renderedFromLine - (rendered && from < rendered.from ? 1 : 0)),
      Math.min(
        this.currentSource.lineCount,
        renderedToLine + (rendered && to > rendered.to ? 1 : 0),
      ),
    )

    if (from < window.from || to > window.to) {
      throw new RangeError('Visible edit range is outside the rendered document window')
    }

    return readWindow(window)
  }

  private startSelectionDrag(event: MouseEvent): void {
    if (event.button !== 0) {
      return
    }

    if (isHorizontalScrollbarDragStart(event) || isEditorScrollbarDragStart(event, this.dom)) {
      return
    }

    const position = this.positionFromLineEvent(event)

    if (position === undefined) {
      return
    }

    const previousPosition = this.cursorPosition
    this.dragAnchor = position
    this.isDraggingSelection = true
    this.hasDraggedSelection = false
    this.cursorPosition = position
    this.selectionAnchor = event.shiftKey ? this.selectionAnchor : position

    if (this.mode === 'live') {
      void this.renderLiveSyntaxAroundPositions(previousPosition, this.cursorPosition)
    }

    this.renderSelection()
    this.renderCursor()
    this.inputDOM.focus({ preventScroll: true })
    event.preventDefault()
  }

  private async updateSelectionDrag(event: MouseEvent): Promise<void> {
    if (!this.isDraggingSelection || this.dragAnchor === undefined) {
      return
    }

    if (event.buttons !== undefined && (event.buttons & 1) === 0) {
      this.clearSelectionDrag()
      return
    }

    const position = this.positionFromLineEvent(event)

    if (position === undefined) {
      return
    }

    if (position === this.dragAnchor && !this.hasDraggedSelection) {
      event.preventDefault()
      return
    }

    const previousPosition = this.cursorPosition
    this.hasDraggedSelection = true
    this.selectionAnchor = this.dragAnchor
    this.cursorPosition = position

    if (this.mode === 'live') {
      await this.renderLiveSyntaxAroundPositions(previousPosition, this.cursorPosition)
    }

    this.renderSelection()
    this.renderCursor()
    event.preventDefault()
  }

  private async finishSelectionDrag(event: MouseEvent): Promise<void> {
    if (!this.isDraggingSelection) {
      return
    }

    this.clearSelectionDrag()
    event.preventDefault()
  }

  private clearSelectionDrag(): void {
    this.isDraggingSelection = false
    this.hasDraggedSelection = false
    this.dragAnchor = undefined
  }

  private positionFromLineEvent(event: MouseEvent): number | undefined {
    if (
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, button')
    ) {
      return undefined
    }
    const target = lineElementFromEvent(event, this.contentDOM, this.inputDOM)

    if (!target) {
      return this.positionFromRenderedWindowEvent(event)
    }

    const from = Number(target.dataset.from)
    const to = Number(target.dataset.to)

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return undefined
    }

    const position =
      sourcePositionFromPoint(target, event, this.inputDOM, { allowGeometryFallback: true }) ?? from

    return this.normalizeRenderedClickPosition(clamp(position, from, to))
  }

  private async moveCursorFromPointer(event: MouseEvent): Promise<void> {
    const position = this.positionFromLineEvent(event)

    if (position === undefined) {
      return
    }

    const previousPosition = this.cursorPosition
    this.cursorPosition = position
    if (!event.shiftKey) {
      this.selectionAnchor = this.cursorPosition
    }

    if (this.mode === 'live') {
      await this.renderLiveSyntaxAroundPositions(previousPosition, this.cursorPosition)
    }
    this.renderSelection()
    this.renderCursor()
    this.inputDOM.focus({ preventScroll: true })
    event.preventDefault()
  }

  private positionFromRenderedWindowEvent(event: MouseEvent): number | undefined {
    const target = event.target

    if (!(target instanceof Node) || !this.dom.contains(target)) {
      return undefined
    }

    const lines = Array.from(this.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

    if (lines.length === 0) {
      return undefined
    }

    let nearest:
      | {
          readonly line: HTMLElement
          readonly distance: number
        }
      | undefined

    for (const line of lines) {
      const rect = line.getBoundingClientRect()

      if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
        return this.normalizePositionFromLine(line, event)
      }

      const distance =
        event.clientY < rect.top ? rect.top - event.clientY : event.clientY - rect.bottom

      if (!nearest || distance < nearest.distance) {
        nearest = { line, distance }
      }
    }

    return nearest ? this.normalizePositionFromLine(nearest.line, event) : undefined
  }

  private normalizePositionFromLine(line: HTMLElement, event: MouseEvent): number | undefined {
    const from = Number(line.dataset.from)
    const to = Number(line.dataset.to)

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return undefined
    }

    const rect = line.getBoundingClientRect()
    // A gutter is outside the text hit-test area. Use exact UTF-16 endpoints,
    // including an emoji at EOL, rather than estimating a text-node caret.
    const position =
      rect.width > 0 && event.clientX <= rect.left
        ? from
        : rect.width > 0 && event.clientX >= rect.right
          ? to
          : (sourcePositionFromPoint(line, event, this.inputDOM, { allowGeometryFallback: true }) ??
            to)

    return this.normalizeRenderedClickPosition(clamp(position, from, to))
  }

  private normalizeRenderedClickPosition(position: number): number {
    if (this.mode === 'source') {
      return position
    }

    const line = this.findRenderedSourceLineAtPosition(position)
    const contentStart = line
      ? listSyntaxContentStart(
          line.text,
          line.from,
          this.editable ? this.currentSelection() : undefined,
        )
      : undefined

    if (contentStart === undefined || position >= contentStart) {
      return position
    }

    return clamp(contentStart, line?.from ?? position, line?.to ?? position)
  }

  private async blockContext(position: number, maxTextLength?: number, flush = true) {
    if (flush) await this.flushPendingVisibleEdit()
    const source = this.currentSource
    const version = source.version
    const current = () =>
      !this.destroyed &&
      this.currentSource.documentId === source.documentId &&
      this.currentSource.version === version
    const line =
      this.findRenderedSourceLineAtPosition(position) ?? (await source.lineAtPosition(position))
    if (!current()) return undefined
    const key = `${source.documentId}:${version}`
    if (key !== this.fenceContextKey) {
      this.fenceContextKey = key
      this.fenceCheckpoints.clear()
      this.fenceCheckpoints.set(1, undefined)
    }
    // Carry top-level fence state from the document start, in bounded pages.
    // Parsing only the viewport misclassifies list-looking text inside long fences.
    let from = 1
    for (const checkpoint of this.fenceCheckpoints.keys())
      if (checkpoint <= line.number && checkpoint > from) from = checkpoint
    let fence = this.fenceCheckpoints.get(from)
    let code = false,
      closing = false
    for (; from <= line.number; from += 512) {
      const window = await this.readBlockWindow(
        from,
        Math.min(line.number, from + 511),
        maxTextLength,
      )
      if (!current()) return undefined
      for (const item of window.lines) {
        const marker = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(item.text)
        const ends =
          !!fence &&
          !!marker &&
          marker[2]![0] === fence[0] &&
          marker[2]!.length >= fence.length &&
          /^[ \t]*$/.test(marker[3]!)
        if (item.number === line.number) {
          code = !!fence || !!marker || /^(?: {4}|\t)/.test(item.text)
          closing = ends
        }
        if (ends) fence = undefined
        else if (!fence && marker) fence = marker[2]
      }
      if (window.toLine < line.number) this.fenceCheckpoints.set(window.toLine + 1, fence)
    }
    const adjacent = await this.readBlockWindow(
      Math.max(1, line.number - 1),
      Math.min(source.lineCount, line.number + 1),
      maxTextLength,
    )
    const newline = adjacent.text.includes('\r\n') ? '\r\n' : '\n'
    return current() ? { line, code, closing, newline, current } : undefined
  }

  private async readBlockWindow(
    fromLine: number,
    toLine: number,
    maxTextLength?: number,
  ): Promise<DocumentLineWindow> {
    const cached = this.renderedSourceWindow
    if (cached && fromLine >= cached.fromLine && toLine <= cached.toLine) {
      const lines = cached.lines.filter((line) => line.number >= fromLine && line.number <= toLine)
      const from = lines[0]!.from,
        to = lines.at(-1)!.to
      if (maxTextLength !== undefined && to - from > maxTextLength)
        throw new RangeError('Line window exceeds text budget')
      return { fromLine, toLine, from, to, lines, text: readLineWindowRangeText(cached, from, to) }
    }
    return this.currentSource.readLineWindow(fromLine, toLine, maxTextLength)
  }

  private async enterBlock(): Promise<void> {
    const range = this.getSelectedRange()
    const context = await this.blockContext(range.from)
    if (!context) return
    const { line, code, closing, newline } = context
    const prefix = listEditingPrefix(line.text)
    if (!code && prefix && range.from >= line.from + prefix[0].length && range.to <= line.to) {
      if (range.from === range.to && line.text.slice(prefix[0].length).trim() === '') {
        const remove = prefix[1] ? indentRemovalLength(prefix[1]) : line.text.length
        const changes = ChangeSet.delete(line.from, line.from + remove)
        await this.applyVisibleEdit(
          line.from,
          line.from + remove,
          '',
          'isolate',
          this.currentSelection().map(changes),
        )
        return
      }
      await this.applyVisibleEdit(
        range.from,
        range.to,
        newline + (listContinuationPrefix(line.text) ?? ''),
        'isolate',
      )
      return
    }
    const indent =
      code && !closing ? /^[ \t]*/.exec(line.text.slice(0, range.from - line.from))![0] : ''
    await this.applyVisibleEdit(range.from, range.to, newline + indent, 'isolate')
  }

  private async indentBlock(outdent: boolean, navigate: () => void): Promise<void> {
    const range = this.getSelectedRange()
    const context = await this.blockContext(range.from)
    if (!context) return
    const first = context.line
    const lastPosition = range.to > range.from ? range.to - 1 : range.to
    const last =
      this.findRenderedSourceLineAtPosition(lastPosition) ??
      (await this.currentSource.lineAtPosition(lastPosition))
    if (!context.current()) return
    if (
      this.onFocusNavigation &&
      !context.code &&
      !listEditingPrefix(first.text) &&
      // Source-mode pipe rows do not have a live table context. Preserve their
      // existing structural Tab path rather than treating them as prose.
      !pipeLine(first.text) &&
      first.number === last.number &&
      !/^[ \t]+/u.test(first.text)
    ) {
      navigate()
      return
    }
    if (
      !outdent &&
      context.code &&
      range.from === range.to &&
      /[^ \t]/.test(first.text.slice(0, range.from - first.from))
    ) {
      await this.applyVisibleEdit(
        range.from,
        range.to,
        indentationText(this.presentation),
        'isolate',
      )
      return
    }
    const window = await this.readBlockWindow(first.number, last.number)
    if (!context.current()) return
    const edits = window.lines.flatMap((line) => {
      const remove = outdent ? presentationOutdent(line.text, this.presentation) : 0
      return outdent && !remove
        ? []
        : [
            {
              from: line.from,
              to: line.from + remove,
              insert: outdent ? '' : indentationText(this.presentation),
            },
          ]
    })
    if (!edits.length) return
    const changes = ChangeSet.of(edits)
    const local = ChangeSet.of(
      edits.map((edit) => ({ ...edit, from: edit.from - window.from, to: edit.to - window.from })),
    )
    const insert = new MemoryTextDocument(window.text).apply(local).text
    await this.applyVisibleEdit(
      window.from,
      window.to,
      insert,
      'isolate',
      this.currentSelection().map(changes),
    )
  }

  private async backspaceBlock(): Promise<void> {
    if (await this.deleteTableText(-1)) return
    const range = this.getSelectedRange()
    const visible = this.findRenderedSourceLineAtPosition(range.from)
    const prefix = visible ? listEditingPrefix(visible.text) : null
    const before = visible?.text.slice(0, range.from - visible.from) ?? ''
    if (
      range.from !== range.to ||
      (!/^[ \t]+$/.test(before) && (!prefix || before.length !== prefix[0].length))
    ) {
      await this.deleteAroundCursor(-1)
      return
    }
    if (range.from === range.to) {
      const context = await this.blockContext(range.from)
      if (!context) return
      const { line, code } = context
      const offset = range.from - line.from
      const prefix = listEditingPrefix(line.text)
      if (!code && prefix && offset === prefix[0].length) {
        const remove = prefix[1] ? indentRemovalLength(prefix[1]) : prefix[0].length
        const changes = ChangeSet.delete(line.from, line.from + remove)
        await this.applyVisibleEdit(
          line.from,
          line.from + remove,
          '',
          'isolate',
          this.currentSelection().map(changes),
        )
        return
      }
      const before = line.text.slice(0, offset)
      if (/^[ \t]+$/.test(before)) {
        const remove = before.endsWith('\t')
          ? 1
          : Math.min(offset % 2 || 2, / *$/.exec(before)![0].length)
        await this.applyVisibleEdit(range.from - remove, range.from, '', 'isolate')
        return
      }
    }
    await this.deleteAroundCursor(-1)
  }

  private findRenderedSourceLineAtPosition(position: number): SourceLine | undefined {
    return this.renderedSourceWindow?.lines.find(
      (line) => position >= line.from && position <= line.to,
    )
  }

  private getSelectedRange(): { readonly from: number; readonly to: number } {
    return Object.freeze({
      from: Math.min(this.selectionAnchor, this.cursorPosition),
      to: Math.max(this.selectionAnchor, this.cursorPosition),
    })
  }

  private readRenderedSelectionText(): string | undefined {
    const range = this.getSelectedRange()
    const window = this.renderedSourceWindow

    if (!window || range.from === range.to || range.from < window.from || range.to > window.to) {
      return undefined
    }

    return readLineWindowRangeText(window, range.from, range.to)
  }

  private currentSelection(): Selection {
    return this.selectionAnchor === this.cursorPosition
      ? Selection.cursor(this.cursorPosition)
      : Selection.range(this.selectionAnchor, this.cursorPosition)
  }

  private renderSelection(): void {
    this.documentPresentation?.selectionChanged()
    this.selectionLayerDOM.querySelectorAll<HTMLElement>('.milkup-selection').forEach((node) => {
      node.remove()
    })

    const range = this.getSelectedRange()

    if (range.from === range.to) {
      return
    }

    for (const line of Array.from(this.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))) {
      const lineFrom = Number(line.dataset.from)
      const lineTo = Number(line.dataset.to)
      const lineNumber = Number(line.dataset.line)

      if (
        !Number.isInteger(lineFrom) ||
        !Number.isInteger(lineTo) ||
        !Number.isInteger(lineNumber)
      ) {
        continue
      }

      const from = Math.max(range.from, lineFrom)
      const to = Math.min(range.to, lineTo)

      if (to <= from) {
        continue
      }

      const selection = this.ownerDocument.createElement('div')
      selection.className = 'milkup-selection'
      selection.dataset.from = String(from)
      selection.dataset.to = String(to)
      selection.dataset.line = String(lineNumber)
      const rects = domRectsForLineSourceRange(
        this.ownerDocument,
        line,
        this.selectionLayerDOM,
        from,
        to,
      )

      if (rects.length === 0) {
        const fromOffset = sourcePositionToVisualOffsetInLine(line, from)
        const toOffset = sourcePositionToVisualOffsetInLine(line, to)
        selection.style.left = `${fromOffset * 8}px`
        selection.style.top = `${lineLayerTop(
          line,
          this.selectionLayerDOM,
          lineNumber,
          this.getLineHeight(),
        )}px`
        selection.style.width = `${Math.max(1, toOffset - fromOffset) * 8}px`
        selection.style.height = `${lineVisualHeight(line, this.getLineHeight())}px`
        this.selectionLayerDOM.append(selection)
        continue
      }

      for (const [rectIndex, rect] of rects.entries()) {
        const measuredSelection = selection.cloneNode(false) as HTMLElement
        measuredSelection.dataset.rectIndex = String(rectIndex)
        measuredSelection.style.left = `${rect.left}px`
        measuredSelection.style.top = `${rect.top}px`
        measuredSelection.style.width = `${Math.max(1, rect.width)}px`
        measuredSelection.style.visibility = rect.width <= 0 ? 'hidden' : ''
        measuredSelection.style.height = `${rect.height}px`
        this.selectionLayerDOM.append(measuredSelection)
      }
    }
  }

  private renderSearchHighlights(): void {
    this.searchLayerDOM.replaceChildren()

    for (const [index, highlight] of this.searchHighlights.entries()) {
      const line = this.contentDOM.querySelector<HTMLElement>(
        `.milkup-line[data-line="${highlight.line}"]`,
      )

      if (!line) {
        continue
      }

      const lineFrom = Number(line.dataset.from)
      const lineTo = Number(line.dataset.to)
      const from = Math.max(highlight.from, lineFrom)
      const to = Math.min(highlight.to, lineTo)

      if (!Number.isInteger(lineFrom) || !Number.isInteger(lineTo) || to <= from) {
        continue
      }

      const element = this.ownerDocument.createElement('div')
      element.className =
        index === this.activeSearchHighlightIndex
          ? 'milkup-search-highlight is-active'
          : 'milkup-search-highlight'
      element.dataset.index = String(index)
      element.dataset.from = String(from)
      element.dataset.to = String(to)
      element.dataset.line = String(highlight.line)
      const rects = domRectsForLineSourceRange(
        this.ownerDocument,
        line,
        this.searchLayerDOM,
        from,
        to,
      )

      if (rects.length === 0) {
        const fromOffset = sourcePositionToVisualOffsetInLine(line, from)
        const toOffset = sourcePositionToVisualOffsetInLine(line, to)
        element.style.left = `${fromOffset * 8}px`
        element.style.top = `${lineLayerTop(
          line,
          this.searchLayerDOM,
          highlight.line,
          this.getLineHeight(),
        )}px`
        element.style.width = `${Math.max(1, toOffset - fromOffset) * 8}px`
        element.style.height = `${lineVisualHeight(line, this.getLineHeight())}px`
        this.searchLayerDOM.append(element)
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
        this.searchLayerDOM.append(measured)
      }
    }
  }

  private renderCursor(notifySelection = true): void {
    syncTaskAvailability(this.contentDOM, this.editable && !!this.onEdit && !this.taskTogglePending)
    this.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')?.remove()

    if (!this.editable) {
      return
    }

    const line = Array.from(this.contentDOM.querySelectorAll<HTMLElement>('.milkup-line')).find(
      (item) => {
        const from = Number(item.dataset.from)
        const to = Number(item.dataset.to)
        return this.cursorPosition >= from && this.cursorPosition <= to
      },
    )

    if (!line) {
      return
    }

    const lineFrom = Number(line.dataset.from)
    const lineNumber = Number(line.dataset.line)

    if (!Number.isInteger(lineFrom) || !Number.isInteger(lineNumber)) {
      return
    }

    const cursor = this.ownerDocument.createElement('div')
    cursor.className = 'milkup-cursor'
    cursor.dataset.position = String(this.cursorPosition)
    cursor.dataset.line = String(lineNumber)
    cursor.dataset.offset = String(Math.max(0, this.cursorPosition - lineFrom))
    const rect = domRectForLineSourcePosition(
      this.ownerDocument,
      line,
      this.cursorLayerDOM,
      this.cursorPosition,
      { allowGeometryFallback: true, fallbackLineHeight: this.getLineHeight() },
    )
    const height = lineCursorHeight(line, this.getLineHeight())

    if (rect) {
      cursor.style.visibility = isCodePositionClipped(line, this.cursorLayerDOM, rect)
        ? 'hidden'
        : ''
      cursor.style.left = `${rect.left}px`
      cursor.style.top = `${rect.top}px`
      cursor.style.height = `${height}px`
    } else {
      cursor.style.left = `${sourcePositionToVisualOffsetInLine(line, this.cursorPosition) * 8}px`
      cursor.style.top = `${lineLayerTop(
        line,
        this.cursorLayerDOM,
        lineNumber,
        this.getLineHeight(),
      )}px`
      cursor.style.height = `${height}px`
    }
    this.cursorLayerDOM.append(cursor)
    this.syncInputProxyToCursor()
    this.renderCompositionText()
    if (notifySelection) this.dom.dispatchEvent(new Event('milkup-selection-change'))
  }

  private renderCompositionText(): void {
    renderCompositionOverlay(
      this.cursorLayerDOM,
      this.contentDOM,
      this.composing ? this.compositionText : '',
    )
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

    this.inputDOM.style.left = `${Math.max(0, this.cursorLayerDOM.offsetLeft + left)}px`
    this.inputDOM.style.top = `${Math.max(0, this.cursorLayerDOM.offsetTop + top)}px`

    if (Number.isFinite(height) && height > 0) {
      this.inputDOM.style.height = `${height}px`
    }
  }

  private async renderLiveSyntaxAroundPositions(
    previousPosition: number,
    nextPosition: number,
  ): Promise<void> {
    if (this.mode !== 'live') {
      return
    }

    const lineNumbers = new Set<number>()

    for (const position of [previousPosition, nextPosition]) {
      const line = this.findRenderedLineAtPosition(position)

      if (line) {
        lineNumbers.add(line.number)
      }
    }

    for (const lineNumber of lineNumbers) {
      await this.renderRenderedLine(lineNumber)
    }
  }

  private async renderRenderedLine(lineNumber: number): Promise<void> {
    const current = this.contentDOM.querySelector<HTMLElement>(
      `.milkup-line[data-line="${lineNumber}"]`,
    )

    if (!current) {
      return
    }

    const source = this.currentSource,
      version = source.version,
      revision = this.editRevision,
      selectionRevision = this.selectionGeneration,
      editable = this.editable
    const replacement =
      this.mode === 'live'
        ? await this.renderSingleLiveLine(lineNumber)
        : await this.renderSingleSourceLine(lineNumber)

    if (
      replacement &&
      !this.destroyed &&
      source === this.currentSource &&
      version === source.version &&
      revision === this.editRevision &&
      selectionRevision === this.selectionGeneration &&
      editable === this.editable &&
      this.contentDOM.contains(current)
    ) {
      const scrollLeft = current.scrollLeft
      const active = this.ownerDocument.activeElement
      const focusedTask =
        active instanceof HTMLElement &&
        current.contains(active) &&
        active.classList.contains('milkup-task-marker')
          ? active.dataset.from
          : undefined
      current.replaceWith(replacement)
      replacement.scrollLeft = scrollLeft
      syncTaskAvailability(replacement, this.editable && !!this.onEdit && !this.taskTogglePending)
      if (focusedTask !== undefined)
        replacement
          .querySelector<HTMLButtonElement>(`.milkup-task-marker[data-from="${focusedTask}"]`)
          ?.focus({ preventScroll: true })
    }
  }

  private applyOptimisticRenderedLineEdit(
    line: SourceLine,
    from: number,
    to: number,
    insert: string,
  ): void {
    const lineDOM = this.contentDOM.querySelector<HTMLElement>(
      `.milkup-line[data-line="${line.number}"]`,
    )

    if (!lineDOM) {
      return
    }

    const delta = insert.length - (to - from)
    const mapped = Array.from(lineDOM.querySelectorAll<HTMLElement>('[data-from][data-to]'))
      .filter((element) => !element.classList.contains('milkup-marker-hidden'))
      .find((element) => {
        const elementFrom = Number(element.dataset.from)
        const elementTo = Number(element.dataset.to)
        return (
          Number.isInteger(elementFrom) &&
          Number.isInteger(elementTo) &&
          from >= elementFrom &&
          to <= elementTo
        )
      })

    if (mapped) {
      const elementFrom = Number(mapped.dataset.from)
      const elementTo = Number(mapped.dataset.to)
      const text = mapped.textContent ?? ''
      if (mapped.classList.contains('milkup-task-marker')) {
        mapped.dataset.checked = String(insert !== ' ')
        mapped.setAttribute('aria-checked', mapped.dataset.checked)
      } else
        mapped.textContent =
          text.slice(0, from - elementFrom) + insert + text.slice(to - elementFrom)
      mapped.dataset.to = String(elementTo + delta)

      for (const element of Array.from(
        lineDOM.querySelectorAll<HTMLElement>('[data-from][data-to]'),
      )) {
        if (element === mapped) {
          continue
        }

        const nextFrom = Number(element.dataset.from)
        const nextTo = Number(element.dataset.to)

        if (Number.isInteger(nextFrom) && nextFrom >= to) {
          element.dataset.from = String(nextFrom + delta)
        }

        if (Number.isInteger(nextTo) && nextTo >= to) {
          element.dataset.to = String(nextTo + delta)
        }
      }
    } else {
      const text = lineDOM.textContent?.replace(/\u200b/g, '') ?? line.text
      lineDOM.textContent = text.slice(0, from - line.from) + insert + text.slice(to - line.from)
    }

    lineDOM.dataset.to = String(line.to + delta)
  }

  private async renderSingleSourceLine(lineNumber: number): Promise<HTMLElement | undefined> {
    const window = await this.currentSource.readLineWindow(lineNumber, lineNumber)
    const line = window.lines[0]
    return line ? renderSourceLine(this.ownerDocument, line) : undefined
  }

  private async renderSingleLiveLine(lineNumber: number): Promise<HTMLElement | undefined> {
    const fromLine = Math.max(1, lineNumber - this.markdownContextLines)
    const toLine = Math.min(this.currentSource.lineCount, lineNumber + this.markdownContextLines)
    const parsed = await this.parseLiveWindow(fromLine, toLine)
    const line = parsed.window.lines.find((item) => item.number === lineNumber)

    return line
      ? renderLiveLine(this.ownerDocument, line, parsed.root.children ?? [], {
          cursorPosition: this.cursorPosition,
          selection: this.currentSelection(),
          editable: this.editable,
        })
      : undefined
  }

  private mapRenderedLinePositions(lineNumber: number, changes: ChangeSet): void {
    for (const line of Array.from(this.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))) {
      // The optimistic edit already updates its row's content ranges. Block
      // bounds on that row, and every retained row, still use old coordinates.
      mapLineSourceRanges(line, changes, {
        skipContentRanges: Number(line.dataset.line) === lineNumber,
      })
    }
  }
}

interface SourceLine {
  readonly number: number
  readonly from: number
  readonly to: number
  readonly text: string
}

function renderSourceLine(document: Document, line: SourceLine): HTMLElement {
  const lineDOM = createLineElement(document, line)
  lineDOM.textContent = line.text.length > 0 ? line.text : '\u200b'
  return lineDOM
}

function renderLiveLine(
  document: Document,
  line: SourceLine,
  blocks: readonly SyntaxNode[],
  options: {
    readonly cursorPosition?: number
    readonly selection?: Selection
    readonly editable?: boolean
  } = {},
): HTMLElement {
  const lineDOM = createLineElement(document, line)
  lineDOM.classList.add('milkup-line-live')
  applyLiveBlockClasses(lineDOM, line, blocks)
  const selection = options.selection ?? Selection.cursor(options.cursorPosition ?? line.from)

  const heading = findBlockForLine(blocks, 'heading', line.from, line.to)
  const blockquoteLine = findBlockForLine(blocks, 'blockquoteLine', line.from, line.to)
  const tableRow = findBlockForLine(blocks, 'tableRow', line.from, line.to)
  const table = findBlockForLine(blocks, 'table', line.from, line.to)
  const listItem =
    findListItemForLine(blocks, line.from, line.to) ?? fallbackListItemForLine(line, blocks)

  if (lineDOM.classList.contains('milkup-block-code')) {
    const code = codeBlockForLine(blocks, line.from, line.to)
    if (code) renderCodeLine(lineDOM, line.text, line.from, code)
    else lineDOM.textContent = line.text || '\u200b'
  } else if (heading) {
    lineDOM.replaceChildren(
      ...renderMappedLinePieces(document, line, heading, {
        contentClassName: 'milkup-heading-content',
        markerClassName: markerClassNameForSelection(
          'milkup-block-marker milkup-heading-marker',
          line,
          heading,
          selection,
        ),
        selection,
      }),
    )
  } else if (blockquoteLine) {
    lineDOM.replaceChildren(
      ...renderMappedLinePieces(document, line, blockquoteLine, {
        contentClassName: 'milkup-blockquote-content',
        markerClassName: markerClassNameForSelection(
          'milkup-block-marker milkup-blockquote-marker',
          line,
          blockquoteLine,
          selection,
        ),
        selection,
      }),
    )
  } else if (tableRow) {
    lineDOM.replaceChildren(
      ...renderMappedLinePieces(document, line, tableRow, {
        contentClassName: 'milkup-table-cell',
        markerClassName: 'milkup-block-marker milkup-table-marker milkup-marker-hidden',
        hideContentGaps: true,
        preserveEmptyContentRanges: true,
        selection,
      }),
    )
  } else if (table) {
    lineDOM.classList.add('milkup-table-delimiter')
    lineDOM.replaceChildren(
      ...renderHiddenLine(
        document,
        line,
        'milkup-block-marker milkup-table-marker milkup-marker-hidden',
      ),
    )
  } else if (listItem) {
    lineDOM.classList.toggle('milkup-block-list', !isUnfinishedBulletMarker(line.text))
    lineDOM.replaceChildren(
      ...renderListItemLinePieces(document, line, selection, listItem, options.editable !== false),
    )
  } else {
    lineDOM.replaceChildren(
      ...renderInlineDecorations(document, line, selection, line.from, line.to),
    )
  }

  applyTableAlignments(lineDOM, table)
  return lineDOM
}

function markerClassNameForSelection(
  baseClassName: string,
  line: SourceLine,
  node: SyntaxNode,
  selection: Selection,
): string {
  const shouldShow = selection.ranges.some((range) =>
    range.empty
      ? range.head >= line.from &&
        range.head <= line.to &&
        range.head >= node.from &&
        range.head <= node.to
      : range.from < node.to && range.to > node.from,
  )

  return shouldShow ? baseClassName : `${baseClassName} milkup-marker-hidden`
}

function createLineElement(document: Document, line: SourceLine): HTMLElement {
  const lineDOM = document.createElement('div')
  lineDOM.className = 'milkup-line'
  lineDOM.dataset.line = String(line.number)
  lineDOM.dataset.from = String(line.from)
  lineDOM.dataset.to = String(line.to)
  return lineDOM
}

function readLineWindowRangeText(
  window: {
    readonly from: number
    readonly text: string
    readonly lines: readonly SourceLine[]
  },
  from: number,
  to: number,
): string {
  if (from === to) {
    return ''
  }

  const pieces: string[] = []
  let position = from

  for (const line of window.lines) {
    if (line.to < from || line.from > to) {
      continue
    }

    if (position < line.from) {
      pieces.push(readWindowGapText(window, position, Math.min(line.from, to)))
      position = Math.min(line.from, to)
    }

    const lineFrom = Math.max(position, line.from)
    const lineTo = Math.min(to, line.to)

    if (lineTo > lineFrom) {
      pieces.push(line.text.slice(lineFrom - line.from, lineTo - line.from))
      position = lineTo
    }

    if (position >= to) {
      break
    }
  }

  if (position < to) {
    pieces.push(readWindowGapText(window, position, to))
  }

  return pieces.join('')
}

function readWindowGapText(
  window: {
    readonly from: number
    readonly text: string
  },
  from: number,
  to: number,
): string {
  const text = window.text.slice(from - window.from, to - window.from)
  return text.length === to - from ? text : '\n'.repeat(to - from)
}

function mergeSourceDocumentEdits(
  previous: SourceDocumentEdit,
  next: SourceDocumentEdit,
): SourceDocumentEdit | undefined {
  if (previous.historyGroup === 'isolate' || next.historyGroup === 'isolate') return undefined
  const selections = {
    selectionBefore: previous.selectionBefore,
    selectionAfter: next.selectionAfter,
  }

  if (
    previous.from === previous.to &&
    next.from === previous.from + previous.insert.length &&
    next.from === next.to &&
    previous.deletedText.length === 0 &&
    next.deletedText.length === 0
  ) {
    return Object.freeze({
      from: previous.from,
      to: previous.to,
      insert: previous.insert + next.insert,
      deletedText: '',
      ...selections,
    })
  }

  if (
    previous.insert.length === 0 &&
    next.insert.length === 0 &&
    next.from === previous.from &&
    next.to === previous.from + next.deletedText.length
  ) {
    return Object.freeze({
      from: previous.from,
      to: previous.to + next.deletedText.length,
      insert: '',
      deletedText: previous.deletedText + next.deletedText,
      ...selections,
    })
  }

  if (
    previous.insert.length === 0 &&
    next.insert.length === 0 &&
    next.to === previous.from &&
    next.from + next.deletedText.length === previous.from
  ) {
    return Object.freeze({
      from: next.from,
      to: previous.to,
      insert: '',
      deletedText: next.deletedText + previous.deletedText,
      ...selections,
    })
  }

  return undefined
}

function applyLiveBlockClasses(
  lineDOM: HTMLElement,
  line: SourceLine,
  blocks: readonly SyntaxNode[],
): void {
  for (const block of walkSyntaxNodes(blocks)) {
    if (!rangeContainsLine(block, line.from, line.to)) {
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

    if (block.type === 'unorderedList' || block.type === 'orderedList') {
      lineDOM.classList.add('milkup-block-list')
    }

    if (block.type === 'fencedCode') {
      lineDOM.classList.add('milkup-block-code')
      const closing = block.markerRanges?.at(-1)
      if (block.status === 'valid' && closing && (block.markerRanges?.length ?? 0) >= 2) {
        lineDOM.dataset.presentationBlockFrom = String(block.from)
        lineDOM.dataset.presentationBlockTo = String(closing.to)
      }
    }

    if (block.type === 'table') {
      lineDOM.classList.add('milkup-block-table')
    }
  }
}

function renderMappedLinePieces(
  document: Document,
  line: SourceLine,
  node: SyntaxNode,
  classNames: {
    readonly contentClassName: string
    readonly markerClassName: string
    readonly hideContentGaps?: boolean
    readonly preserveEmptyContentRanges?: boolean
    readonly selection: Selection
  },
): readonly Node[] {
  const pieces = [
    ...(node.markerRanges ?? []).map((range) => ({
      ...range,
      className: classNames.markerClassName,
    })),
    ...(node.contentRanges ?? []).map((range) => ({
      ...range,
      className: classNames.contentClassName,
    })),
  ]
    .map((piece) => ({
      ...piece,
      from: Math.max(piece.from, line.from),
      to: Math.min(piece.to, line.to),
    }))
    .filter(
      (piece) =>
        piece.to > piece.from ||
        (classNames.preserveEmptyContentRanges === true && piece.to === piece.from),
    )
    .sort((left, right) => left.from - right.from)

  if (pieces.length === 0) {
    return renderHiddenLine(document, line, classNames.contentClassName)
  }

  const rendered: Node[] = []
  let position = line.from

  for (const piece of pieces) {
    if (piece.from > position) {
      rendered.push(
        createMappedSpan(
          document,
          line,
          position,
          piece.from,
          classNames.hideContentGaps ? classNames.markerClassName : 'milkup-live-text',
        ),
      )
    }

    if (piece.className === classNames.contentClassName) {
      const content = createMappedSpan(document, line, piece.from, piece.to, piece.className)
      if (piece.to > piece.from) {
        content.replaceChildren(
          ...renderInlineDecorations(document, line, classNames.selection, piece.from, piece.to),
        )
      }
      rendered.push(content)
    } else {
      rendered.push(createMappedSpan(document, line, piece.from, piece.to, piece.className))
    }
    position = Math.max(position, piece.to)
  }

  if (position < line.to) {
    rendered.push(
      createMappedSpan(
        document,
        line,
        position,
        line.to,
        classNames.hideContentGaps ? classNames.markerClassName : 'milkup-live-text',
      ),
    )
  }

  return Object.freeze(rendered.length > 0 ? rendered : [document.createTextNode('\u200b')])
}

function renderHiddenLine(
  document: Document,
  line: SourceLine,
  className: string,
): readonly Node[] {
  if (line.text.length === 0) {
    return Object.freeze([document.createTextNode('\u200b')])
  }

  return Object.freeze([createMappedSpan(document, line, line.from, line.to, className)])
}

function renderListItemLinePieces(
  document: Document,
  line: SourceLine,
  selection: Selection,
  listItem: SyntaxNode,
  editable: boolean,
): readonly Node[] {
  const pieces = collectListItemLinePieces(line, listItem, editable ? selection : undefined)

  if (pieces.length === 0) {
    return renderInlineDecorations(document, line, selection, line.from, line.to)
  }

  const rendered: Node[] = []
  let position = line.from

  for (const piece of pieces) {
    if (piece.from > position) {
      rendered.push(createMappedSpan(document, line, position, piece.from, 'milkup-live-text'))
    }

    if (piece.kind === 'marker') {
      const marker = createMappedSpan(document, line, piece.from, piece.to, 'milkup-list-marker')
      marker.textContent = formatListMarker(sourceSlice(line, piece.from, piece.to))
      if (pieces.some((piece) => piece.kind === 'taskMarker'))
        marker.classList.add('milkup-marker-hidden')
      rendered.push(marker)
    } else if (piece.kind === 'taskMarker') {
      const task = createTaskMarker(
        document,
        piece.from,
        piece.to,
        sourceSlice(line, piece.from, piece.to),
      )
      rendered.push(task)
    } else {
      const content = createMappedSpan(document, line, piece.from, piece.to, 'milkup-list-content')
      content.replaceChildren(
        ...renderInlineDecorations(document, line, selection, piece.from, piece.to),
      )
      rendered.push(content)
    }

    position = piece.to
  }

  if (position < line.to) {
    rendered.push(createMappedSpan(document, line, position, line.to, 'milkup-live-text'))
  }

  return Object.freeze(rendered)
}

function collectListItemLinePieces(
  line: SourceLine,
  listItem: SyntaxNode,
  editingSelection?: Selection,
): readonly InlinePiece[] {
  if (isUnfinishedBulletMarker(line.text)) {
    return [{ from: line.from, to: line.to, kind: 'content' }]
  }
  const pieces: InlinePiece[] = []

  for (const range of listItem.markerRanges ?? []) {
    if (rangesIntersect(range.from, range.to, line.from, line.to)) {
      pieces.push({
        from: clamp(range.from, line.from, line.to),
        to: clamp(range.to, line.from, line.to),
        kind: 'marker',
      })
    }
  }

  for (const range of listItem.contentRanges ?? []) {
    if (!rangesIntersect(range.from, range.to, line.from, line.to)) {
      continue
    }

    const taskMarker = taskMarkerRange(line, range.from, range.to, editingSelection)

    if (taskMarker && rangesIntersect(taskMarker.from, taskMarker.to, line.from, line.to)) {
      pieces.push({
        from: clamp(taskMarker.from, line.from, line.to),
        to: clamp(taskMarker.to, line.from, line.to),
        kind: 'taskMarker',
      })
    }

    const contentFrom = taskMarker ? taskMarker.to : range.from
    const pieceFrom = clamp(contentFrom, line.from, line.to)
    const pieceTo = clamp(range.to, line.from, line.to)

    if (pieceTo > pieceFrom) {
      pieces.push({
        from: pieceFrom,
        to: pieceTo,
        kind: 'content',
      })
    }
  }

  return Object.freeze(pieces.sort((left, right) => left.from - right.from || left.to - right.to))
}

function renderInlineDecorations(
  document: Document,
  line: SourceLine,
  selection: Selection,
  from: number,
  to: number,
): readonly Node[] {
  if (to <= from) {
    return [document.createTextNode('\u200b')]
  }

  const localFrom = from - line.from
  const localTo = to - line.from
  const nodes = parseInline(line.text, localFrom, localTo)
  const fragments: Node[] = []
  let position = localFrom

  for (const node of nodes) {
    if (node.from > position) {
      fragments.push(
        createMappedSpan(
          document,
          line,
          line.from + position,
          line.from + node.from,
          'milkup-live-text',
        ),
      )
    }

    fragments.push(renderInlineNode(document, line, selection, node))
    position = node.to
  }

  if (position < localTo) {
    fragments.push(
      createMappedSpan(
        document,
        line,
        line.from + position,
        line.from + localTo,
        'milkup-live-text',
      ),
    )
  }

  return Object.freeze(fragments)
}

function renderInlineNode(
  document: Document,
  line: SourceLine,
  selection: Selection,
  node: SyntaxNode,
): Node {
  const span = document.createElement('span')
  span.className = `milkup-inline milkup-inline-${node.type}`
  span.dataset.from = String(line.from + node.from)
  span.dataset.to = String(line.from + node.to)
  span.dataset.status = node.status
  span.dataset.syntaxVisible = String(shouldShowInlineSyntax(line, node, selection))
  span.replaceChildren(...renderInlineNodePieces(document, line, selection, node))
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

function renderInlineNodePieces(
  document: Document,
  line: SourceLine,
  selection: Selection,
  node: SyntaxNode,
): readonly Node[] {
  const pieces = collectInlinePieces(node)

  if (pieces.length === 0) {
    return [
      createMappedSpan(
        document,
        line,
        line.from + node.from,
        line.from + node.to,
        'milkup-live-text',
      ),
    ]
  }

  const showSyntax = shouldShowInlineSyntax(line, node, selection)
  const rendered: Node[] = []
  let position = node.from

  for (const piece of pieces) {
    if (piece.from > position) {
      rendered.push(
        createMappedSpan(
          document,
          line,
          line.from + position,
          line.from + piece.from,
          'milkup-live-text',
        ),
      )
    }

    const span = createMappedSpan(
      document,
      line,
      line.from + piece.from,
      line.from + piece.to,
      `milkup-inline-${piece.kind}`,
    )

    if (piece.kind === 'content' && node.children?.some((child) => child.type !== 'text')) {
      span.replaceChildren(
        ...renderInlineDecorations(
          document,
          line,
          selection,
          line.from + piece.from,
          line.from + piece.to,
        ),
      )
    }

    if (piece.kind !== 'content' && !showSyntax) {
      span.classList.add('milkup-marker-hidden')
    }

    rendered.push(span)
    position = piece.to
  }

  if (position < node.to) {
    rendered.push(
      createMappedSpan(
        document,
        line,
        line.from + position,
        line.from + node.to,
        'milkup-live-text',
      ),
    )
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

function shouldShowInlineSyntax(line: SourceLine, node: SyntaxNode, selection: Selection): boolean {
  if (node.status !== 'valid') {
    return true
  }

  const from = line.from + node.from
  const to = line.from + node.to

  return selection.ranges.some((range) =>
    range.empty ? range.head >= from && range.head <= to : range.from < to && range.to > from,
  )
}

function createMappedSpan(
  document: Document,
  line: SourceLine,
  from: number,
  to: number,
  className: string,
): HTMLElement {
  const span = document.createElement('span')
  span.className = className
  span.dataset.from = String(from)
  span.dataset.to = String(to)
  span.textContent = line.text.slice(from - line.from, to - line.from)
  return span
}

function sourceSlice(line: SourceLine, from: number, to: number): string {
  return line.text.slice(from - line.from, to - line.from)
}

function formatListMarker(marker: string): string {
  const trimmed = marker.trim()

  if (trimmed === '-' || trimmed === '*' || trimmed === '+') {
    return '•'
  }

  return trimmed
}

function taskMarkerRange(
  line: SourceLine,
  from: number,
  to: number,
  editingSelection?: Selection,
): { readonly from: number; readonly to: number } | undefined {
  const length = presentedTaskMarkerLength(sourceSlice(line, from, to), from, editingSelection)
  return length === undefined ? undefined : { from, to: from + length }
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

function listSyntaxContentStart(
  lineText: string,
  lineFrom: number,
  editingSelection?: Selection,
): number | undefined {
  const prefix = /^(\s*)(?:[-+*]|\d{1,9}[.)])[ \t]+/u.exec(lineText)
  if (!prefix) return undefined
  const from = prefix[0].length
  return (
    lineFrom +
    from +
    (presentedTaskMarkerLength(lineText.slice(from), lineFrom + from, editingSelection) ?? 0)
  )
}

function isCompositionKeyEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.key === 'Process'
}

type InlinePieceKind = 'content' | 'marker' | 'syntax' | 'taskMarker'

interface InlinePiece {
  readonly from: number
  readonly to: number
  readonly kind: InlinePieceKind
}

function findBlockForLine(
  blocks: readonly SyntaxNode[],
  type: string,
  lineFrom: number,
  lineTo: number,
): SyntaxNode | undefined {
  for (const block of walkSyntaxNodes(blocks)) {
    if (block.type === type && rangeContainsLine(block, lineFrom, lineTo)) {
      return block
    }
  }

  return undefined
}

function findListItemForLine(
  blocks: readonly SyntaxNode[],
  lineFrom: number,
  lineTo: number,
): SyntaxNode | undefined {
  let containingItem: SyntaxNode | undefined

  for (const block of walkSyntaxNodes(blocks)) {
    if (block.type !== 'listItem' || !rangeContainsLine(block, lineFrom, lineTo)) {
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
  line: SourceLine,
  blocks: readonly SyntaxNode[],
): SyntaxNode | undefined {
  const match = /^(\s*)(?:([-+*])|(\d{1,9})([.)]))(?:[ \t]+|$)/u.exec(line.text)

  if (!match) {
    return undefined
  }

  if (
    [...walkSyntaxNodes(blocks)].some(
      (block) =>
        (block.type === 'fencedCode' || block.type === 'indentedCode') &&
        rangeContainsLine(block, line.from, line.to),
    )
  ) {
    return undefined
  }

  const indentationLength = match[1]?.length ?? 0
  const markerLength = (match[2] ?? '').length + (match[3] ?? '').length + (match[4] ?? '').length
  const markerFrom = line.from + indentationLength
  const markerTo = markerFrom + markerLength

  return {
    type: 'listItem',
    from: line.from,
    to: line.to,
    status: 'valid',
    markerRanges: [{ from: markerFrom, to: markerTo }],
    contentRanges: [{ from: line.from + match[0].length, to: line.to }],
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

function rangeContainsLine(node: SyntaxNode, lineFrom: number, lineTo: number): boolean {
  if (lineFrom === lineTo) {
    return node.from <= lineFrom && node.to >= lineFrom
  }

  return node.from <= lineFrom && node.to >= lineTo
}

function rangesIntersect(
  leftFrom: number,
  leftTo: number,
  rightFrom: number,
  rightTo: number,
): boolean {
  return leftFrom < rightTo && leftTo > rightFrom
}

function renderSpacer(document: Document, position: 'top' | 'bottom', height: number): HTMLElement {
  const spacer = document.createElement('div')
  spacer.className = 'milkup-virtual-spacer'
  spacer.dataset.spacer = position
  spacer.style.height = `${Math.max(0, height)}px`
  return spacer
}

function lineLayerTop(
  lineDOM: HTMLElement,
  layerDOM: HTMLElement,
  lineNumber: number,
  lineHeight: number,
): number {
  const measuredTop = lineDOM.offsetTop - layerDOM.offsetTop

  if (measuredTop !== 0) {
    return measuredTop
  }

  return lineNumber <= 1 ? 0 : (lineNumber - 1) * lineHeight
}

function lineVisualHeight(lineDOM: HTMLElement, lineHeight: number): number {
  const rect = lineDOM.getBoundingClientRect()
  return rect.height > 0 ? rect.height : lineHeight
}

function lineCursorHeight(lineDOM: HTMLElement, fallbackLineHeight: number): number {
  const view = lineDOM.ownerDocument.defaultView
  const inlineFontSize = Number.parseFloat(lineDOM.style.fontSize)
  const computedFontSize = view ? Number.parseFloat(view.getComputedStyle(lineDOM).fontSize) : 0
  const fontSize =
    Number.isFinite(inlineFontSize) && inlineFontSize > 0 ? inlineFontSize : computedFontSize

  if (Number.isFinite(fontSize) && fontSize > 0) {
    return fontSize
  }

  return fallbackLineHeight
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function listEditingPrefix(line: string): RegExpExecArray | null {
  return /^([ \t]*)(?:[-+*]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/u.exec(line)
}
function indentRemovalLength(text: string): number {
  return /^(?:\t| {1,2})/u.exec(text)?.[0].length ?? 0
}

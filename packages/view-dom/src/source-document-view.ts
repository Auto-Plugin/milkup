import { Selection } from '@milkup/core'
import type { DocumentLineWindow, EditorDocumentSource } from '@milkup/core'
import {
  parseInline,
  parseMarkdownWindow,
  type MarkdownWindowParseResult,
  type SyntaxNode,
} from '@milkup/markdown'

import { createInputProxy, getVisibleLineWindow } from './editor-view'
import {
  domRectForLineSourcePosition,
  domRectsForLineSourceRange,
  isHorizontalScrollbarDragStart,
  lineElementFromEvent,
  sourcePositionFromPoint,
  sourcePositionToVisualOffsetInLine,
} from './source-position-mapping'
import type { SearchHighlight, ViewMode, VirtualViewportConfig } from './types'

export interface SourceDocumentViewConfig {
  readonly parent: HTMLElement
  readonly source: EditorDocumentSource
  readonly mode?: ViewMode
  readonly editable?: boolean
  readonly onEdit?: SourceDocumentEditHandler
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
}

export type SourceDocumentEditHandler = (edit: SourceDocumentEdit) => Promise<void> | void

interface RenderRequest {
  readonly id: number
  readonly fromLine: number
  readonly toLine: number
}

interface RenderedSourceWindow {
  readonly lines: readonly HTMLElement[]
  readonly sourceWindow: DocumentLineWindow
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
  private currentSource: EditorDocumentSource
  private mode: ViewMode
  private editable: boolean
  private cursorPosition = 0
  private selectionAnchor = 0
  private readonly onEdit: SourceDocumentEditHandler | undefined
  private readonly markdownContextLines: number
  private readonly markdownCacheSize: number
  private readonly backgroundMarkdownWarmup: boolean
  private readonly markdownWarmupWindows: number
  private readonly markdownWarmupDelayMs: number
  private readonly markdownCache = new Map<string, Promise<MarkdownWindowParseResult>>()
  private markdownWarmupTimer: ReturnType<typeof setTimeout> | undefined
  private isComposing = false
  private compositionText = ''
  private compositionCommitQueue: Promise<void> = Promise.resolve()
  private compositionCommitError: unknown
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
  private renderedSourceWindow: DocumentLineWindow | undefined
  private searchHighlights: readonly SearchHighlight[] = Object.freeze([])
  private activeSearchHighlightIndex = -1
  private scrollAnchor: { readonly line: number; readonly scrollTop: number } | undefined
  private readonly handleScrollEvent = (): void => {
    const anchor = this.scrollAnchor

    if (anchor && Math.abs(this.dom.scrollTop - anchor.scrollTop) <= 1) {
      this.scrollAnchor = undefined
      void this.renderVisibleWindow(this.createRenderRequestForLine(anchor.line))
      return
    }

    this.scrollAnchor = undefined
    void this.renderVisibleWindow()
  }
  private readonly handleInputEvent = (): void => {
    void this.trackVisibleEditTask(this.readInputProxy())
  }
  private readonly handleCompositionStartEvent = (): void => {
    this.isComposing = true
    this.compositionText = ''
  }
  private readonly handleCompositionUpdateEvent = (event: CompositionEvent): void => {
    this.isComposing = true
    this.compositionText = event.data
  }
  private readonly handleCompositionEndEvent = (event: CompositionEvent): void => {
    this.compositionCommitError = undefined
    this.compositionCommitQueue = this.commitComposition(event.data).catch((error: unknown) => {
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

    const text = event.clipboardData?.getData('text/plain') ?? ''

    if (text.length === 0) {
      return
    }

    event.preventDefault()
    const range = this.getSelectedRange()
    void this.trackVisibleEditTask(this.applyVisibleEdit(range.from, range.to, text))
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
    const range = this.getSelectedRange()
    void this.trackVisibleEditTask(this.applyVisibleEdit(range.from, range.to, ''))
  }
  private readonly handleKeyDownEvent = (event: KeyboardEvent): void => {
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
    this.dom.tabIndex = 0
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
    this.dom.addEventListener('scroll', this.handleScrollEvent)
    this.dom.addEventListener('keydown', this.handleKeyDownEvent)
    this.dom.addEventListener('copy', this.handleCopyEvent)
    this.dom.addEventListener('cut', this.handleCutEvent)
    this.dom.addEventListener('paste', this.handlePasteEvent)
    this.dom.addEventListener('pointerdown', this.handlePointerDownEvent)
    this.contentDOM.addEventListener('pointermove', this.handlePointerMoveEvent)
    this.ownerDocument.addEventListener('pointerup', this.handlePointerUpEvent)
    this.ownerDocument.addEventListener('pointercancel', this.handlePointerCancelEvent)
    this.inputDOM.addEventListener('input', this.handleInputEvent)
    this.inputDOM.addEventListener('keydown', this.handleKeyDownEvent)
    this.inputDOM.addEventListener('compositionstart', this.handleCompositionStartEvent)
    this.inputDOM.addEventListener('compositionupdate', this.handleCompositionUpdateEvent)
    this.inputDOM.addEventListener('compositionend', this.handleCompositionEndEvent)
    config.parent.append(this.dom)
    void this.renderVisibleWindow()
  }

  get source(): EditorDocumentSource {
    return this.currentSource
  }

  updateSource(source: EditorDocumentSource): void {
    const documentChanged = source.documentId !== this.currentSource.documentId

    this.currentSource = source
    this.renderedSourceWindow = undefined
    this.cancelMarkdownWarmup()
    this.markdownCache.clear()
    this.cursorPosition = clamp(
      this.cursorPosition,
      0,
      this.currentSource.length ?? this.cursorPosition,
    )
    this.selectionAnchor = this.cursorPosition
    if (documentChanged) {
      this.dom.scrollTop = 0
    }
    void this.renderVisibleWindow()
  }

  setEditable(editable: boolean): void {
    if (this.editable === editable) {
      return
    }

    this.editable = editable
    this.dom.dataset.editable = String(editable)
    this.inputDOM.readOnly = !editable
  }

  setMode(mode: ViewMode): void {
    if (this.mode === mode) {
      return
    }

    this.mode = mode
    this.dom.dataset.mode = mode
    void this.renderVisibleWindow()
  }

  setSearchHighlights(highlights: readonly SearchHighlight[], activeIndex = -1): void {
    this.searchHighlights = Object.freeze([...highlights])
    this.activeSearchHighlightIndex = activeIndex
    this.renderSearchHighlights()
  }

  async scrollToLine(lineNumber: number): Promise<void> {
    if (
      !Number.isInteger(lineNumber) ||
      lineNumber < 1 ||
      lineNumber > this.currentSource.lineCount
    ) {
      throw new RangeError(`Invalid line number: ${lineNumber}`)
    }

    this.dom.scrollTop = (lineNumber - 1) * this.getLineHeight()
    this.scrollAnchor = Object.freeze({ line: lineNumber, scrollTop: this.dom.scrollTop })
    await this.renderVisibleWindow(this.createRenderRequestForLine(lineNumber))
    const target = this.contentDOM.querySelector<HTMLElement>(
      `.milkup-line[data-line="${lineNumber}"]`,
    )

    if (target && target.offsetTop > 0 && Math.abs(this.dom.scrollTop - target.offsetTop) > 1) {
      this.dom.scrollTop = target.offsetTop
      this.scrollAnchor = Object.freeze({ line: lineNumber, scrollTop: this.dom.scrollTop })
    }
  }

  async renderVisibleWindow(request: RenderRequest = this.createRenderRequest()): Promise<void> {
    const rendered =
      this.mode === 'live'
        ? await this.renderLiveLineWindow(request)
        : await this.renderSourceLineWindow(request)

    if (request.id < this.latestAppliedRequestId) {
      return
    }

    this.latestAppliedRequestId = request.id
    this.renderedSourceWindow = rendered.sourceWindow
    const lineHeight = this.getLineHeight()
    this.contentDOM.replaceChildren(
      renderSpacer(this.ownerDocument, 'top', (request.fromLine - 1) * lineHeight),
      ...rendered.lines,
      renderSpacer(
        this.ownerDocument,
        'bottom',
        (this.currentSource.lineCount - request.toLine) * lineHeight,
      ),
    )
    this.contentDOM.dataset.virtualized = 'true'
    this.contentDOM.dataset.fromLine = String(request.fromLine)
    this.contentDOM.dataset.toLine = String(request.toLine)
    this.contentDOM.dataset.renderMode = this.mode
    this.renderSearchHighlights()
    this.renderSelection()
    this.renderCursor()
    this.scheduleMarkdownWarmup(request)
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
    this.cancelMarkdownWarmup()
    if (this.editCommitTimer !== undefined) {
      clearTimeout(this.editCommitTimer)
      this.editCommitTimer = undefined
    }
    this.dom.removeEventListener('scroll', this.handleScrollEvent)
    this.dom.removeEventListener('keydown', this.handleKeyDownEvent)
    this.dom.removeEventListener('copy', this.handleCopyEvent)
    this.dom.removeEventListener('cut', this.handleCutEvent)
    this.dom.removeEventListener('paste', this.handlePasteEvent)
    this.dom.removeEventListener('pointerdown', this.handlePointerDownEvent)
    this.contentDOM.removeEventListener('pointermove', this.handlePointerMoveEvent)
    this.ownerDocument.removeEventListener('pointerup', this.handlePointerUpEvent)
    this.ownerDocument.removeEventListener('pointercancel', this.handlePointerCancelEvent)
    this.inputDOM.removeEventListener('input', this.handleInputEvent)
    this.inputDOM.removeEventListener('keydown', this.handleKeyDownEvent)
    this.inputDOM.removeEventListener('compositionstart', this.handleCompositionStartEvent)
    this.inputDOM.removeEventListener('compositionupdate', this.handleCompositionUpdateEvent)
    this.inputDOM.removeEventListener('compositionend', this.handleCompositionEndEvent)
    this.dom.remove()
  }

  private createRenderRequest(): RenderRequest {
    const viewportHeight = this.getViewportHeight()
    const lineWindow = getVisibleLineWindow({
      lineCount: this.currentSource.lineCount,
      scrollTop: this.dom.scrollTop,
      lineHeight: this.getLineHeight(),
      overscanLines: this.virtualViewport.overscanLines ?? defaultOverscanLines,
      ...(viewportHeight === undefined ? {} : { viewportHeight }),
    })
    const id = this.nextRequestId
    this.nextRequestId += 1

    return Object.freeze({
      id,
      fromLine: lineWindow.fromLine,
      toLine: lineWindow.toLine,
    })
  }

  private createRenderRequestForLine(lineNumber: number): RenderRequest {
    const lineHeight = this.getLineHeight()
    const visibleLines = Math.max(
      1,
      Math.ceil((this.getViewportHeight() ?? lineHeight) / lineHeight),
    )
    const overscan = this.virtualViewport.overscanLines ?? defaultOverscanLines
    const fromLine = Math.max(1, lineNumber - overscan)
    const toLine = Math.min(
      this.currentSource.lineCount,
      Math.max(lineNumber, fromLine + visibleLines + overscan * 2 - 1),
    )
    const id = this.nextRequestId
    this.nextRequestId += 1

    return Object.freeze({ id, fromLine, toLine })
  }

  private getLineHeight(): number {
    return Math.max(1, this.virtualViewport.lineHeight ?? defaultLineHeight)
  }

  private getViewportHeight(): number | undefined {
    return (
      this.virtualViewport.viewportHeight ??
      (this.dom.clientHeight > 0 ? this.dom.clientHeight : undefined)
    )
  }

  private async renderSourceLineWindow(request: RenderRequest): Promise<RenderedSourceWindow> {
    const window = await this.currentSource.readLineWindow(request.fromLine, request.toLine)
    return Object.freeze({
      lines: Object.freeze(window.lines.map((line) => renderSourceLine(this.ownerDocument, line))),
      sourceWindow: window,
    })
  }

  private async renderLiveLineWindow(request: RenderRequest): Promise<RenderedSourceWindow> {
    const fromLine = Math.max(1, request.fromLine - this.markdownContextLines)
    const toLine = Math.min(
      this.currentSource.lineCount,
      request.toLine + this.markdownContextLines,
    )
    const parsed = await this.parseLiveWindow(fromLine, toLine)
    const blocks = parsed.root.children ?? []

    return Object.freeze({
      lines: Object.freeze(
        parsed.window.lines
          .filter((line) => line.number >= request.fromLine && line.number <= request.toLine)
          .map((line) =>
            renderLiveLine(this.ownerDocument, line, blocks, {
              cursorPosition: this.cursorPosition,
              selection: this.currentSelection(),
            }),
          ),
      ),
      sourceWindow: parsed.window,
    })
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

    const parsed = parseMarkdownWindow(this.currentSource, { fromLine, toLine })
    this.markdownCache.set(key, parsed)
    this.trimMarkdownCache()

    try {
      return await parsed
    } catch (error) {
      this.markdownCache.delete(key)
      throw error
    }
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
    if (!this.backgroundMarkdownWarmup) {
      return
    }

    this.cancelMarkdownWarmup()
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

    if (this.isComposing) {
      return
    }

    const text = this.inputDOM.value

    if (text.length === 0) {
      return
    }

    this.inputDOM.value = ''
    const range = this.getSelectedRange()
    await this.applyVisibleEdit(range.from, range.to, text)
  }

  private async commitComposition(data: string): Promise<void> {
    const text = data.length > 0 ? data : this.compositionText || this.inputDOM.value

    this.isComposing = false
    this.compositionText = ''
    this.inputDOM.value = ''

    if (!this.editable || text.length === 0) {
      return
    }

    const range = this.getSelectedRange()
    await this.applyVisibleEdit(range.from, range.to, text)
  }

  private handleEditingKey(event: KeyboardEvent): boolean {
    if (this.isComposing || event.isComposing || event.key === 'Process' || event.keyCode === 229) {
      return false
    }

    if (!this.editable) {
      return false
    }

    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false
    }

    if (event.key.length === 1) {
      const range = this.getSelectedRange()
      void this.trackVisibleEditTask(this.applyVisibleEdit(range.from, range.to, event.key))
      return true
    }

    if (event.key === 'Enter') {
      const range = this.getSelectedRange()
      void this.trackVisibleEditTask(this.applyVisibleEdit(range.from, range.to, '\n'))
      return true
    }

    if (event.key === 'Backspace') {
      void this.trackVisibleEditTask(this.deleteAroundCursor(-1))
      return true
    }

    if (event.key === 'Delete') {
      void this.trackVisibleEditTask(this.deleteAroundCursor(1))
      return true
    }

    switch (event.key) {
      case 'ArrowLeft':
        void this.moveCursor('left', event.shiftKey)
        return true
      case 'ArrowRight':
        void this.moveCursor('right', event.shiftKey)
        return true
      case 'ArrowUp':
        void this.moveCursor('up', event.shiftKey)
        return true
      case 'ArrowDown':
        void this.moveCursor('down', event.shiftKey)
        return true
      default:
        return false
    }
  }

  private async moveCursor(
    direction: 'left' | 'right' | 'up' | 'down',
    extend: boolean,
  ): Promise<void> {
    const range = this.getSelectedRange()
    const current = this.cursorPosition
    const previous = current
    let next = current
    let targetLineNumber: number | undefined

    if (!extend && range.from !== range.to) {
      next = direction === 'right' || direction === 'down' ? range.to : range.from
    } else if (direction === 'left') {
      next = Math.max(0, current - 1)
    } else if (direction === 'right') {
      next = Math.min(this.currentSource.length ?? current + 1, current + 1)
    } else {
      const verticalMove = await this.moveCursorVertically(current, direction)
      next = verticalMove.position
      targetLineNumber = verticalMove.lineNumber
    }

    if (next === current && (!extend || range.from === range.to)) {
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
      this.findRenderedLineAtPosition(pos) ??
      (await this.currentSource.lineAtPosition(pos).catch(() => undefined))

    if (!line) {
      return { position: pos }
    }

    const targetLineNumber = direction === 'up' ? line.number - 1 : line.number + 1

    if (targetLineNumber < 1 || targetLineNumber > this.currentSource.lineCount) {
      return { position: pos, lineNumber: line.number }
    }

    return {
      position: await this.currentSource.positionAtLineOffset(targetLineNumber, pos - line.from),
      lineNumber: targetLineNumber,
    }
  }

  private async ensureCursorRendered(targetLineNumber?: number): Promise<void> {
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
    this.dom.scrollTop = (nextFirstLine - 1) * lineHeight
    await this.renderVisibleWindow()
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
    const range = this.getSelectedRange()

    if (range.from !== range.to) {
      await this.applyVisibleEdit(range.from, range.to, '')
      return
    }

    const position = this.cursorPosition
    const sourceLine = this.renderedSourceWindow?.lines.find(
      (line) => position >= line.from && position <= line.to,
    )
    let from = direction < 0 ? Math.max(0, position - 1) : position
    let to = direction < 0 ? position : position + 1

    if (direction < 0 && sourceLine) {
      if (position > sourceLine.from) {
        const before = sourceLine.text.slice(0, position - sourceLine.from)
        const previousCharacter = Array.from(before).at(-1)
        from = position - (previousCharacter?.length ?? 1)
      } else if (sourceLine.number === 1) {
        return
      } else {
        const previousLine = this.renderedSourceWindow?.lines.find(
          (line) => line.number === sourceLine.number - 1,
        )
        from = previousLine?.to ?? from
      }
    }

    if (direction > 0 && sourceLine) {
      if (position < sourceLine.to) {
        const nextCharacter = Array.from(sourceLine.text.slice(position - sourceLine.from))[0]
        to = position + (nextCharacter?.length ?? 1)
      } else if (sourceLine.number === this.currentSource.lineCount) {
        return
      } else {
        const nextLine = this.renderedSourceWindow?.lines.find(
          (line) => line.number === sourceLine.number + 1,
        )
        to = nextLine?.from ?? to
      }
    }

    if (from === to) {
      return
    }

    await this.applyVisibleEdit(from, to, '')
  }

  private async applyVisibleEdit(from: number, to: number, insert: string): Promise<void> {
    if (!this.onEdit) {
      return
    }

    const editedLine = this.findRenderedLineAtPosition(from)
    const structuralEdit = insert.includes('\n') || editedLine === undefined || to > editedLine.to
    const delta = insert.length - (to - from)
    this.editRevision += 1
    const editRevision = this.editRevision
    this.cursorPosition = from + insert.length
    this.selectionAnchor = this.cursorPosition
    const deletedText = await this.readVisibleRangeText(from, to)
    this.cancelMarkdownWarmup()

    if (structuralEdit) {
      await this.queueVisibleEditCommit({ from, to, insert, deletedText }, { immediate: true })
      this.markdownCache.clear()
      await this.renderVisibleWindow()
    } else {
      this.applyOptimisticRenderedLineEdit(editedLine, from, to, insert)
      this.shiftRenderedLinePositionsAfter(editedLine.number, delta)
      this.renderSelection()
      this.renderCursor()
      const commit = this.queueVisibleEditCommit({ from, to, insert, deletedText })
      if (this.mode === 'live') {
        void commit
          .then(async () => {
            if (editRevision !== this.editRevision) {
              return
            }

            this.markdownCache.clear()
            await this.renderRenderedLine(editedLine.number)
            this.renderSelection()
            this.renderCursor()
          })
          .catch(() => undefined)
      }
    }

    this.inputDOM.focus({ preventScroll: true })
  }

  private trackVisibleEditTask(task: Promise<void>): Promise<void> {
    const tracked = task.catch((error: unknown) => {
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
      return this.flushPendingVisibleEdit().then(() => this.queueVisibleEditCommit(edit))
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

  private async readVisibleRangeText(from: number, to: number): Promise<string> {
    if (from === to) {
      return ''
    }

    const fromLine = await this.currentSource.lineAtPosition(from).catch(() => undefined)
    const toLine = await this.currentSource
      .lineAtPosition(Math.max(from, to - 1))
      .catch(() => undefined)

    if (fromLine && toLine) {
      const window = await this.currentSource.readLineWindow(fromLine.number, toLine.number)
      return readLineWindowRangeText(window, from, to)
    }

    const renderedFromLine = Number(this.contentDOM.dataset.fromLine)
    const renderedToLine = Number(this.contentDOM.dataset.toLine)

    if (!Number.isInteger(renderedFromLine) || !Number.isInteger(renderedToLine)) {
      throw new RangeError('Visible edit range is outside the rendered document window')
    }

    const window = await this.currentSource.readLineWindow(renderedFromLine, renderedToLine)

    if (from < window.from || to > window.to) {
      throw new RangeError('Visible edit range is outside the rendered document window')
    }

    return readLineWindowRangeText(window, from, to)
  }

  private startSelectionDrag(event: MouseEvent): void {
    if (event.button !== 0) {
      return
    }

    if (isHorizontalScrollbarDragStart(event)) {
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
    const target = lineElementFromEvent(event, this.contentDOM, this.inputDOM)

    if (!target) {
      return undefined
    }

    const from = Number(target.dataset.from)
    const to = Number(target.dataset.to)

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return undefined
    }

    return (
      sourcePositionFromPoint(target, event, this.inputDOM, { allowGeometryFallback: true }) ?? from
    )
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
        measured.style.height = `${rect.height}px`
        this.searchLayerDOM.append(measured)
      }
    }
  }

  private renderCursor(): void {
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

    const replacement =
      this.mode === 'live'
        ? await this.renderSingleLiveLine(lineNumber)
        : await this.renderSingleSourceLine(lineNumber)

    if (replacement) {
      current.replaceWith(replacement)
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
      mapped.textContent = text.slice(0, from - elementFrom) + insert + text.slice(to - elementFrom)
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
        })
      : undefined
  }

  private shiftRenderedLinePositionsAfter(lineNumber: number, delta: number): void {
    if (delta === 0) {
      return
    }

    for (const lineDOM of Array.from(
      this.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'),
    )) {
      const renderedLineNumber = Number(lineDOM.dataset.line)

      if (!Number.isInteger(renderedLineNumber) || renderedLineNumber <= lineNumber) {
        continue
      }

      const from = Number(lineDOM.dataset.from)
      const to = Number(lineDOM.dataset.to)

      if (Number.isInteger(from)) {
        lineDOM.dataset.from = String(from + delta)
      }

      if (Number.isInteger(to)) {
        lineDOM.dataset.to = String(to + delta)
      }

      for (const mapped of Array.from(
        lineDOM.querySelectorAll<HTMLElement>('[data-from][data-to]'),
      )) {
        const mappedFrom = Number(mapped.dataset.from)
        const mappedTo = Number(mapped.dataset.to)

        if (Number.isInteger(mappedFrom)) {
          mapped.dataset.from = String(mappedFrom + delta)
        }

        if (Number.isInteger(mappedTo)) {
          mapped.dataset.to = String(mappedTo + delta)
        }
      }
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
  options: { readonly cursorPosition?: number; readonly selection?: Selection } = {},
): HTMLElement {
  const lineDOM = createLineElement(document, line)
  lineDOM.classList.add('milkup-line-live')
  applyLiveBlockClasses(lineDOM, line, blocks)
  const selection = options.selection ?? Selection.cursor(options.cursorPosition ?? line.from)

  const heading = findBlockForLine(blocks, 'heading', line.from, line.to)
  const blockquoteLine = findBlockForLine(blocks, 'blockquoteLine', line.from, line.to)
  const tableRow = findBlockForLine(blocks, 'tableRow', line.from, line.to)
  const table = findBlockForLine(blocks, 'table', line.from, line.to)
  const listItem = findBlockForLine(blocks, 'listItem', line.from, line.to)

  if (heading) {
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
    lineDOM.replaceChildren(...renderListItemLinePieces(document, line, selection, listItem))
  } else {
    lineDOM.replaceChildren(
      ...renderInlineDecorations(document, line, selection, line.from, line.to),
    )
  }

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
    .filter((piece) => piece.to > piece.from)
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
      content.replaceChildren(
        ...renderInlineDecorations(document, line, classNames.selection, piece.from, piece.to),
      )
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
): readonly Node[] {
  const pieces = collectListItemLinePieces(line, listItem)

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
      rendered.push(marker)
    } else if (piece.kind === 'taskMarker') {
      const task = createMappedSpan(document, line, piece.from, piece.to, 'milkup-task-marker')
      task.dataset.checked = String(/[xX]/u.test(sourceSlice(line, piece.from, piece.to)))
      task.setAttribute('aria-hidden', 'true')
      task.textContent = ''
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

function collectListItemLinePieces(line: SourceLine, listItem: SyntaxNode): readonly InlinePiece[] {
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

    const taskMarker = taskMarkerRange(line, range.from, range.to)

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
): { readonly from: number; readonly to: number } | undefined {
  const text = sourceSlice(line, from, to)
  const match = /^(\s*\[[ xX]\]\s*)/u.exec(text)

  if (!match) {
    return undefined
  }

  return { from, to: from + (match[1]?.length ?? 0) }
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

import { createMarkdownImage, isImageAsset } from '@milkup/assets'
import type { AssetProvider } from '@milkup/assets'
import { ChangeSet, Selection, transactionChangesDocument } from '@milkup/core'
import type { EditorState, Transaction } from '@milkup/core'
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
  EditorViewConfig,
  EditorViewDispatch,
  PositionLineOffset,
  ViewCoordinate,
  ViewMetrics,
  ViewRect,
  ViewMode,
  ViewUpdate,
  VirtualViewportConfig,
} from './types'

const defaultViewMetrics: ViewMetrics = Object.freeze({
  charWidth: 8,
  lineHeight: 20,
})

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
  readonly selectionLayerDOM: HTMLElement
  readonly cursorLayerDOM: HTMLElement
  readonly inputDOM: HTMLTextAreaElement

  private currentState: EditorState
  private markdownParseState: EditorMarkdownParseState
  private readonly ownerDocument: Document
  private readonly assetProvider: AssetProvider | undefined
  private readonly externalDispatch: EditorViewDispatch | undefined
  private isComposing = false
  private compositionText = ''
  private dragAnchor: number | undefined
  private isDraggingSelection = false
  private hasDraggedSelection = false
  private suppressNextClick = false
  private mode: ViewMode
  private editable: boolean
  private readonly virtualViewport: VirtualViewportState | undefined
  private readonly handleInputEvent = (): void => {
    this.readInputProxy()
  }
  private readonly handleScrollEvent = (): void => {
    this.renderVirtualViewportOnScroll()
  }
  private readonly handlePasteEvent = (event: ClipboardEvent): void => {
    void this.handlePaste(event)
  }
  private readonly handleKeyDownEvent = (event: KeyboardEvent): void => {
    if (this.handleEditingKey(event)) {
      event.preventDefault()
    }
  }
  private readonly handleClickEvent = (event: MouseEvent): void => {
    this.placeCursorFromClick(event)
  }
  private readonly handleMouseDownEvent = (event: MouseEvent): void => {
    this.startSelectionDrag(event)
  }
  private readonly handleMouseMoveEvent = (event: MouseEvent): void => {
    this.updateSelectionDrag(event)
  }
  private readonly handleMouseUpEvent = (event: MouseEvent): void => {
    this.finishSelectionDrag(event)
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
    this.commitComposition(event.data)
  }

  constructor(config: EditorViewConfig) {
    this.ownerDocument = config.document ?? config.parent.ownerDocument
    this.currentState = config.state
    this.markdownParseState = createEditorMarkdownParseState(this.currentState.doc.text)
    this.assetProvider = config.assetProvider
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
    this.selectionLayerDOM = this.ownerDocument.createElement('div')
    this.selectionLayerDOM.className = 'milkup-selection-layer'
    this.cursorLayerDOM = this.ownerDocument.createElement('div')
    this.cursorLayerDOM.className = 'milkup-cursor-layer'
    this.inputDOM = createInputProxy(this.ownerDocument)
    this.dom.append(this.contentDOM)
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
    this.contentDOM.addEventListener('click', this.handleClickEvent)
    this.contentDOM.addEventListener('mousedown', this.handleMouseDownEvent)
    this.contentDOM.addEventListener('mousemove', this.handleMouseMoveEvent)
    this.ownerDocument.addEventListener('mouseup', this.handleMouseUpEvent)
    config.parent.append(this.dom)
    this.render()
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

  updateState(state: EditorState, transactions: readonly Transaction[] = []): ViewUpdate {
    const previousState = this.currentState
    this.currentState = state
    const documentChanged = transactions.some(transactionChangesDocument)

    if (documentChanged || previousState.doc.text !== state.doc.text) {
      this.markdownParseState = updateEditorMarkdownParseState(
        this.markdownParseState,
        previousState,
        state,
        transactions,
      )
      if (!this.renderChangedDocumentLines(previousState, state, transactions)) {
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
    if (this.editable === editable) {
      return
    }

    this.editable = editable
    this.dom.dataset.editable = String(editable)
    this.inputDOM.readOnly = !editable
  }

  positionToRect(pos: number, metrics?: Partial<ViewMetrics>): ViewRect {
    return positionToRectForMode(this.currentState, this.mode, pos, metrics)
  }

  coordinateToPosition(coordinate: ViewCoordinate, metrics?: Partial<ViewMetrics>): number {
    return coordinateToPositionForMode(this.currentState, this.mode, coordinate, metrics)
  }

  ensureCursorVisible(options?: CursorVisibilityOptions): number {
    const measuredRect = domRectForSourcePosition(
      this.ownerDocument,
      this.contentDOM,
      this.dom,
      this.currentState,
      this.mode,
      this.currentState.selection.main.head,
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
      ...(options?.metrics === undefined ? {} : { metrics: options.metrics }),
    })

    this.dom.scrollTop = nextScrollTop
    if (this.shouldUseVirtualViewport()) {
      this.renderVirtualViewport()
    }
    return nextScrollTop
  }

  destroy(): void {
    this.inputDOM.removeEventListener('input', this.handleInputEvent)
    this.inputDOM.removeEventListener('paste', this.handlePasteEvent)
    this.inputDOM.removeEventListener('keydown', this.handleKeyDownEvent)
    this.inputDOM.removeEventListener('compositionstart', this.handleCompositionStartEvent)
    this.inputDOM.removeEventListener('compositionupdate', this.handleCompositionUpdateEvent)
    this.inputDOM.removeEventListener('compositionend', this.handleCompositionEndEvent)
    this.dom.removeEventListener('scroll', this.handleScrollEvent)
    this.contentDOM.removeEventListener('click', this.handleClickEvent)
    this.contentDOM.removeEventListener('mousedown', this.handleMouseDownEvent)
    this.contentDOM.removeEventListener('mousemove', this.handleMouseMoveEvent)
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
    this.contentDOM.replaceChildren(
      ...(this.mode === 'source'
        ? renderPlainTextLines(this.ownerDocument, this.currentState)
        : renderMarkdownLines(this.ownerDocument, this.currentState, this.mode, {
            root: this.markdownParseState.cache.root,
          })),
    )
    this.selectionLayerDOM.replaceChildren(
      ...renderSelectionOverlay(this.ownerDocument, this.currentState, this.mode, {
        root: this.markdownParseState.cache.root,
      }),
    )
    this.cursorLayerDOM.replaceChildren(
      ...renderCursorOverlay(this.ownerDocument, this.currentState, this.mode, {
        root: this.markdownParseState.cache.root,
      }),
    )
    this.alignSelectionOverlayToDOM()
    this.alignCursorOverlayToDOM()
    this.syncInputProxyToCursor()
  }

  private renderSelectionAndCursor(): void {
    this.selectionLayerDOM.replaceChildren(
      ...renderSelectionOverlay(this.ownerDocument, this.currentState, this.mode, {
        root: this.markdownParseState.cache.root,
      }),
    )
    this.cursorLayerDOM.replaceChildren(
      ...renderCursorOverlay(this.ownerDocument, this.currentState, this.mode, {
        root: this.markdownParseState.cache.root,
      }),
    )
    this.alignSelectionOverlayToDOM()
    this.alignCursorOverlayToDOM()
    this.syncInputProxyToCursor()
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
      )
      previousLineDOM.replaceWith(nextLineDOM)
    }
  }

  private renderChangedDocumentLines(
    previousState: EditorState,
    state: EditorState,
    transactions: readonly Transaction[],
  ): boolean {
    if (this.mode === 'source') {
      return false
    }

    const lineNumbers = changedDocumentLineNumbers(previousState, state, transactions)

    if (!lineNumbers) {
      return false
    }

    for (const lineNumber of lineNumbers) {
      const previousLineDOM = this.contentDOM.querySelector<HTMLElement>(
        `.milkup-line[data-line="${lineNumber}"]`,
      )

      if (!previousLineDOM) {
        return false
      }

      const nextLineDOM = renderMarkdownLine(
        this.ownerDocument,
        state,
        this.mode,
        this.markdownParseState.cache.root.children ?? [],
        lineNumber,
      )
      previousLineDOM.replaceWith(nextLineDOM)
    }

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
      lineHeight: this.virtualViewport?.lineHeight ?? defaultViewMetrics.lineHeight,
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
        measured.style.height = `${rect.height}px`
        measuredSelections.push(measured)
      }
    }

    if (measuredSelections.length > 0) {
      this.selectionLayerDOM.replaceChildren(...measuredSelections)
    }
  }

  private alignCursorOverlayToDOM(): void {
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

    if (this.isComposing) {
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
    const text = data.length > 0 ? data : this.compositionText || this.inputDOM.value

    this.isComposing = false
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

    const payload = collectClipboardPayload(event)
    const paste = normalizePaste(payload, {
      inCodeBlock: isPositionInsideCodeBlock(
        this.currentState,
        this.currentState.selection.main.head,
      ),
    })

    if (!paste.handled && paste.strategy === 'files-deferred') {
      if (!this.assetProvider || !payload.files?.some(isImageAsset)) {
        return
      }

      event.preventDefault()
      const imported = await this.importPastedImages(payload.files ?? [])

      if (imported.length === 0) {
        return
      }

      this.insertText(imported.join('\n'), 'input.paste')
      return
    }

    if (!paste.handled) {
      return
    }

    event.preventDefault()
    this.insertText(paste.text, 'input.paste')
  }

  private async importPastedImages(files: readonly PastedAssetInput[]): Promise<readonly string[]> {
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
      imported.push(createMarkdownImage(asset))
    }

    return Object.freeze(imported)
  }

  private handleEditingKey(event: KeyboardEvent): boolean {
    if (this.isComposing) {
      return false
    }

    if (!this.editable) {
      return isTextEditingKey(event)
    }

    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false
    }

    if (event.key.length === 1) {
      return this.insertText(event.key)
    }

    switch (event.key) {
      case 'Enter':
        return this.insertText('\n', 'input.enter')
      case 'Backspace':
        return this.deleteBackward()
      case 'Delete':
        return this.deleteForward()
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
    const insertAt = range.from
    const origin =
      originId === undefined
        ? { type: 'input.type' as const }
        : { type: 'input.type' as const, id: originId }

    this.dispatch({
      changes: ChangeSet.replace(range.from, range.to, text),
      selection: Selection.cursor(insertAt + text.length),
      origin,
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

    const from = range.head - 1

    this.dispatch({
      changes: ChangeSet.delete(from, range.head),
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

    const to = range.head + 1

    this.dispatch({
      changes: ChangeSet.delete(range.head, to),
      selection: Selection.cursor(range.head),
      origin: { type: 'input.delete' },
    })
    return true
  }

  private moveCursor(direction: 'left' | 'right' | 'up' | 'down', extend: boolean): boolean {
    const range = this.currentState.selection.main
    const current = range.head
    let next = current

    if (!extend && !range.empty) {
      next = direction === 'right' || direction === 'down' ? range.to : range.from
    } else if (direction === 'left') {
      next = Math.max(0, current - 1)
    } else if (direction === 'right') {
      next = Math.min(this.currentState.doc.length, current + 1)
    } else {
      next = this.moveCursorVertically(current, direction)
    }

    if (next === current && (!extend || range.empty)) {
      return false
    }

    this.dispatch({
      selection: extend ? Selection.range(range.anchor, next) : Selection.cursor(next),
      origin: { type: 'command', id: `view.moveCursor.${direction}` },
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
    return targetLine.from + Math.min(offset, targetLine.to - targetLine.from)
  }

  private placeCursorFromClick(event: MouseEvent): void {
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
    const target = lineElementFromEvent(event, this.contentDOM, this.inputDOM)

    if (!target) {
      return undefined
    }

    const from = Number(target.dataset.from)
    const to = Number(target.dataset.to)

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return undefined
    }

    const caretPosition = sourcePositionFromPoint(target, event, this.inputDOM)

    if (caretPosition !== undefined) {
      return clamp(caretPosition, from, to)
    }

    return from === to ? from : undefined
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

export interface EditorMarkdownParseState {
  readonly cache: MarkdownParseCache
  readonly invalidatedRange?: {
    readonly from: number
    readonly to: number
  }
  readonly reusedPreviousTree: boolean
  readonly version: number
}

function createEditorMarkdownParseState(source: string): EditorMarkdownParseState {
  const parsed = parseMarkdown(source)

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
): EditorMarkdownParseState {
  if (previousState.doc === state.doc) {
    return previousParse
  }

  const change = getSingleTransactionParseChange(transactions)
  const parsed = parseMarkdownIncremental(state.doc.text, {
    previous: previousParse.cache,
    ...(change ? { change } : {}),
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
  const firstVisibleLine = clamp(Math.floor(Math.max(0, config.scrollTop) / lineHeight) + 1, 1, lineCount)
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
}

export function renderMarkdownLines(
  document: Document,
  state: EditorState,
  mode: Exclude<ViewMode, 'source'> = 'live',
  options: RenderMarkdownLinesOptions = {},
): readonly HTMLElement[] {
  const blocks = (options.root ?? parseMarkdown(state.doc.text).root).children ?? []
  const lines: HTMLElement[] = []

  for (let lineNumber = 1; lineNumber <= state.doc.lineCount; lineNumber += 1) {
    lines.push(renderMarkdownLine(document, state, mode, blocks, lineNumber))
  }

  return Object.freeze(lines)
}

function renderMarkdownLine(
  document: Document,
  state: EditorState,
  mode: Exclude<ViewMode, 'source'>,
  blocks: readonly SyntaxNode[],
  lineNumber: number,
): HTMLElement {
  const line = state.doc.line(lineNumber)
  const lineDOM = createLineElement(document, line.number, line.from, line.to)
  lineDOM.classList.add(`milkup-line-${mode}`)
  applyBlockDecorations(lineDOM, blocks, line.from, line.to)

  const listItem = findListItemForLine(blocks, line.from, line.to)
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
    lineDOM.textContent = line.text.length > 0 ? line.text : '\u200b'
  } else if (heading) {
    lineDOM.replaceChildren(
      ...renderBlockLineDecorations(document, state.doc.text, state.selection, heading, line.from, line.to, {
        contentClassName: 'milkup-heading-content',
        markerClassName: 'milkup-heading-marker',
      }),
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

  return lineDOM
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

function isPositionInsideCodeBlock(state: EditorState, position: number): boolean {
  const blocks = parseMarkdown(state.doc.text).root.children ?? []

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
  for (const block of walkSyntaxNodes(blocks)) {
    if (block.type !== 'listItem' || !nodeContainsLineStart(block, lineFrom, lineTo)) {
      continue
    }

    return block
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
  },
): readonly Node[] {
  const pieces = collectContentLinePieces(node, from, to)

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
      span.replaceChildren(
        ...renderInlineDecorations(document, source, selection, piece.from, piece.to),
      )
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
      rendered.push(marker)
    } else if (piece.kind === 'taskMarker') {
      const task = document.createElement('span')
      task.className = 'milkup-task-marker'
      task.dataset.from = String(piece.from)
      task.dataset.to = String(piece.to)
      task.dataset.checked = String(/[xX]/u.test(source.slice(piece.from, piece.to)))
      task.setAttribute('aria-hidden', 'true')
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
): readonly InlinePiece[] {
  const contentPieces = (node.contentRanges ?? [])
    .filter((range) => rangesIntersect(range.from, range.to, from, to))
    .map((range) => ({
      from: clamp(range.from, from, to),
      to: clamp(range.to, from, to),
      kind: 'content' as const,
    }))
    .filter((piece) => piece.to > piece.from)
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

    span.textContent = source.slice(piece.from, piece.to)
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
    return undefined
  }

  const heading = findBlockForLine(blocks, 'heading', from, to)
  const blockquoteLine = findNestedBlockForLine(blocks, 'blockquote', 'blockquoteLine', from, to)
  const tableRow = findNestedBlockForLine(blocks, 'table', 'tableRow', from, to)
  const table = findBlockForLine(blocks, 'table', from, to)

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

function lineElementFromEvent(
  event: MouseEvent,
  contentDOM: HTMLElement,
  overlayDOM?: HTMLElement,
): HTMLElement | null {
  if (event.target instanceof HTMLElement) {
    const direct = event.target.closest<HTMLElement>('.milkup-line')

    if (direct && contentDOM.contains(direct)) {
      return direct
    }
  }

  const previousPointerEvents = overlayDOM?.style.pointerEvents

  if (overlayDOM) {
    overlayDOM.style.pointerEvents = 'none'
  }

  const elements =
    typeof contentDOM.ownerDocument.elementsFromPoint === 'function'
      ? contentDOM.ownerDocument.elementsFromPoint(event.clientX, event.clientY)
      : []

  if (overlayDOM) {
    overlayDOM.style.pointerEvents = previousPointerEvents ?? ''
  }

  for (const element of elements) {
    if (!(element instanceof HTMLElement) || !contentDOM.contains(element)) {
      continue
    }

    const line = element.closest<HTMLElement>('.milkup-line')

    if (line && contentDOM.contains(line)) {
      return line
    }
  }

  return null
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
  if (typeof document.createRange !== 'function') {
    return undefined
  }

  const { line, offset } = positionToVisualLineOffset(state, mode, position, root)
  const lineDOM = contentDOM.querySelector<HTMLElement>(`.milkup-line[data-line="${line.number}"]`)

  if (!lineDOM || !hasMeasurableLayout(lineDOM)) {
    return undefined
  }

  const lineRect = lineDOM.getBoundingClientRect()
  const range = createRangeAtVisualOffset(document, lineDOM, offset)

  if (!range) {
    return rectFromLineStart(lineDOM, referenceDOM)
  }

  if (typeof range.getBoundingClientRect !== 'function') {
    range.detach()
    return undefined
  }

  const rect = range.getBoundingClientRect()
  range.detach()

  if (!isUsableMeasuredRect(rect, lineRect)) {
    return undefined
  }

  const referenceRect = referenceDOM.getBoundingClientRect()
  const height = rect.height > 0 ? rect.height : lineRect.height
  const top = rect.top - referenceRect.top
  const bottom = top + height

  return Object.freeze({
    left: rect.left - referenceRect.left,
    top,
    right: rect.right - referenceRect.left,
    bottom,
    width: rect.width,
    height,
  })
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
  if (typeof document.createRange !== 'function') {
    return []
  }

  const rects: ViewRect[] = []
  const layerRect = layerDOM.getBoundingClientRect()
  const rangeFrom = clamp(from, 0, state.doc.length)
  const rangeTo = clamp(to, rangeFrom, state.doc.length)
  const fromLine = state.doc.lineAt(rangeFrom)
  const toLine = state.doc.lineAt(rangeTo)

  for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber += 1) {
    const line = state.doc.line(lineNumber)
    const lineDOM = contentDOM.querySelector<HTMLElement>(`.milkup-line[data-line="${lineNumber}"]`)

    if (!lineDOM || !hasMeasurableLayout(lineDOM)) {
      continue
    }

    const lineFrom = Math.max(rangeFrom, line.from)
    const lineTo = Math.min(rangeTo, line.to)

    if (lineTo < lineFrom) {
      continue
    }

    const startOffset = positionToVisualLineOffset(state, mode, lineFrom, root).offset
    const endOffset = positionToVisualLineOffset(state, mode, lineTo, root).offset
    const range = createRangeBetweenVisualOffsets(document, lineDOM, startOffset, endOffset)

    if (!range) {
      continue
    }

    const lineRect = lineDOM.getBoundingClientRect()
    const clientRects = Array.from(range.getClientRects?.() ?? [])
    const usableRects = clientRects.filter((rect) => isUsableMeasuredRect(rect, lineRect))

    if (usableRects.length === 0 && typeof range.getBoundingClientRect === 'function') {
      const rect = range.getBoundingClientRect()

      if (isUsableMeasuredRect(rect, lineRect)) {
        usableRects.push(rect)
      }
    }

    range.detach()

    for (const rect of usableRects) {
      const top = rect.top - layerRect.top
      const height = rect.height > 0 ? rect.height : lineRect.height

      rects.push(
        Object.freeze({
          left: rect.left - layerRect.left,
          top,
          right: rect.right - layerRect.left,
          bottom: top + height,
          width: rect.width,
          height,
        }),
      )
    }
  }

  return Object.freeze(rects)
}

function createRangeAtVisualOffset(
  document: Document,
  lineDOM: HTMLElement,
  visualOffset: number,
): Range | undefined {
  const textNodes = visibleTextNodes(lineDOM)
  let remaining = Math.max(0, visualOffset)

  for (const node of textNodes) {
    const textLength = node.data.length

    if (remaining <= textLength) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      return range
    }

    remaining -= textLength
  }

  const last = textNodes[textNodes.length - 1]

  if (last) {
    const range = document.createRange()
    range.setStart(last, last.data.length)
    range.collapse(true)
    return range
  }

  return undefined
}

function createRangeBetweenVisualOffsets(
  document: Document,
  lineDOM: HTMLElement,
  fromOffset: number,
  toOffset: number,
): Range | undefined {
  const start = resolveTextPositionAtVisualOffset(lineDOM, fromOffset)
  const end = resolveTextPositionAtVisualOffset(lineDOM, Math.max(fromOffset, toOffset))

  if (!start || !end) {
    return undefined
  }

  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

function resolveTextPositionAtVisualOffset(
  lineDOM: HTMLElement,
  visualOffset: number,
): { readonly node: Text; readonly offset: number } | undefined {
  const textNodes = visibleTextNodes(lineDOM)
  let remaining = Math.max(0, visualOffset)

  for (const node of textNodes) {
    const textLength = node.data.length

    if (remaining <= textLength) {
      return { node, offset: remaining }
    }

    remaining -= textLength
  }

  const last = textNodes[textNodes.length - 1]

  return last ? { node: last, offset: last.data.length } : undefined
}

function visibleTextNodes(root: HTMLElement): readonly Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current = walker.nextNode()

  while (current) {
    if (current instanceof Text && current.data.length > 0 && !isHiddenTextNode(current, root)) {
      nodes.push(current)
    }

    current = walker.nextNode()
  }

  return Object.freeze(nodes)
}

function isHiddenTextNode(node: Text, root: HTMLElement): boolean {
  for (
    let parent = node.parentElement;
    parent && parent !== root.parentElement;
    parent = parent.parentElement
  ) {
    if (parent.classList.contains('milkup-marker-hidden')) {
      return true
    }
  }

  return false
}

function rectFromLineStart(lineDOM: HTMLElement, referenceDOM: HTMLElement): ViewRect | undefined {
  const lineRect = lineDOM.getBoundingClientRect()

  if (!hasMeasurableLayout(lineDOM)) {
    return undefined
  }

  const referenceRect = referenceDOM.getBoundingClientRect()
  const height = lineRect.height > 0 ? lineRect.height : defaultViewMetrics.lineHeight

  return Object.freeze({
    left: lineRect.left - referenceRect.left,
    top: lineRect.top - referenceRect.top,
    right: lineRect.left - referenceRect.left,
    bottom: lineRect.top - referenceRect.top + height,
    width: 0,
    height,
  })
}

function hasMeasurableLayout(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

function isUsableMeasuredRect(rect: DOMRect, fallbackLineRect: DOMRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    (rect.width > 0 || rect.height > 0 || fallbackLineRect.height > 0)
  )
}

function sourcePositionFromPoint(
  lineDOM: HTMLElement,
  event: MouseEvent,
  overlayDOM?: HTMLElement,
): number | undefined {
  const point = caretPointFromDocument(
    lineDOM.ownerDocument,
    event.clientX,
    event.clientY,
    overlayDOM,
  )

  if (!point || !lineDOM.contains(point.node)) {
    return undefined
  }

  if (point.node.nodeType === Node.TEXT_NODE) {
    return sourcePositionFromTextNode(
      point.node,
      nearestTextOffsetFromPoint(point.node, point.offset, event.clientX),
      lineDOM,
    )
  }

  if (point.node instanceof HTMLElement) {
    const child = point.node.childNodes.item(point.offset)
    const textNode = findNearestTextNode(child, point.node)

    if (textNode) {
      return sourcePositionFromTextNode(textNode, 0, lineDOM)
    }
  }

  return undefined
}

interface CaretPoint {
  readonly node: Node
  readonly offset: number
}

function caretPointFromDocument(
  document: Document,
  x: number,
  y: number,
  overlayDOM?: HTMLElement,
): CaretPoint | undefined {
  const documentWithCaretPosition = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const previousPointerEvents = overlayDOM?.style.pointerEvents

  if (overlayDOM) {
    overlayDOM.style.pointerEvents = 'none'
  }

  try {
    const position = documentWithCaretPosition.caretPositionFromPoint?.(x, y)

    if (position) {
      return { node: position.offsetNode, offset: position.offset }
    }

    const range = documentWithCaretPosition.caretRangeFromPoint?.(x, y)

    if (range) {
      return { node: range.startContainer, offset: range.startOffset }
    }

    return undefined
  } finally {
    if (overlayDOM) {
      overlayDOM.style.pointerEvents = previousPointerEvents ?? ''
    }
  }
}

function sourcePositionFromTextNode(
  node: Node,
  offset: number,
  lineDOM: HTMLElement,
): number | undefined {
  const parent = closestSourceMappedElement(node, lineDOM)
  const from = Number(parent?.dataset.from ?? lineDOM.dataset.from)
  const to = Number(parent?.dataset.to ?? lineDOM.dataset.to)

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return undefined
  }

  const parentOffset = parent ? textOffsetWithinElement(parent, node, offset) : offset
  return clamp(from + parentOffset, from, to)
}

function nearestTextOffsetFromPoint(node: Node, offset: number, clientX: number): number {
  if (!(node instanceof Text) || node.data.length === 0 || !Number.isFinite(clientX)) {
    return offset
  }

  const currentOffset = clamp(offset, 0, node.data.length)
  const candidates = [currentOffset]

  if (currentOffset > 0) {
    candidates.push(currentOffset - 1)
  }

  if (currentOffset < node.data.length) {
    candidates.push(currentOffset + 1)
  }

  let bestOffset = currentOffset
  let bestDistance = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const rect = caretRectForTextOffset(node, candidate)

    if (!rect) {
      continue
    }

    const distance = Math.abs(clientX - rect.left)

    if (distance < bestDistance) {
      bestDistance = distance
      bestOffset = candidate
    }
  }

  return bestOffset
}

function caretRectForTextOffset(node: Text, offset: number): DOMRect | undefined {
  const range = node.ownerDocument.createRange()
  range.setStart(node, offset)
  range.collapse(true)

  if (typeof range.getBoundingClientRect !== 'function') {
    range.detach()
    return undefined
  }

  const rect = range.getBoundingClientRect()
  range.detach()

  if (!Number.isFinite(rect.left)) {
    return undefined
  }

  return rect
}

function closestSourceMappedElement(node: Node, lineDOM: HTMLElement): HTMLElement | undefined {
  for (
    let element = node.parentElement;
    element && element !== lineDOM.parentElement;
    element = element.parentElement
  ) {
    if (
      element.dataset.from !== undefined &&
      element.dataset.to !== undefined &&
      !element.classList.contains('milkup-marker-hidden')
    ) {
      return element
    }
  }

  return lineDOM
}

function textOffsetWithinElement(root: HTMLElement, node: Node, offset: number): number {
  if (!root.contains(node)) {
    return offset
  }

  let textOffset = 0
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()

  while (current) {
    if (current === node) {
      return textOffset + offset
    }

    if (current instanceof Text && !isHiddenTextNode(current, root)) {
      textOffset += current.data.length
    }

    current = walker.nextNode()
  }

  return offset
}

function findNearestTextNode(node: Node | null, fallbackRoot: Node): Node | undefined {
  if (node?.nodeType === Node.TEXT_NODE) {
    return node
  }

  const walker = fallbackRoot.ownerDocument?.createTreeWalker(
    node ?? fallbackRoot,
    NodeFilter.SHOW_TEXT,
  )

  return walker?.nextNode() ?? undefined
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
  config: ScrollPositionIntoViewConfig & { readonly mode: ViewMode },
): number {
  const viewportHeight =
    config.viewportHeight && config.viewportHeight > 0 ? config.viewportHeight : 200
  const scrollPadding = config.scrollPadding ?? 20
  const rect = positionToRectForMode(config.state, config.mode, config.position, config.metrics)
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

function changedSelectionLineNumbers(previousState: EditorState, state: EditorState): readonly number[] {
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

  if (previousLine.number !== previousChangeEndLine.number || previousLine.number !== nextLine.number) {
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
      cursor.style.left = `${offset * defaultViewMetrics.charWidth}px`
      cursor.style.top = `${(line.number - 1) * defaultViewMetrics.lineHeight}px`
      cursor.style.height = `${defaultViewMetrics.lineHeight}px`
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
        selection.style.left = `${from.offset * defaultViewMetrics.charWidth}px`
        selection.style.top = `${(from.line.number - 1) * defaultViewMetrics.lineHeight}px`
        selection.style.height = `${defaultViewMetrics.lineHeight}px`
        selection.style.width = `${Math.max(1, to.offset - from.offset) * defaultViewMetrics.charWidth}px`
        return selection
      }),
  )
}

export function createInputProxy(document: Document): HTMLTextAreaElement {
  const input = document.createElement('textarea')
  input.className = 'milkup-input-proxy'
  input.setAttribute('aria-hidden', 'true')
  input.autocomplete = 'off'
  input.spellcheck = false
  input.tabIndex = 0
  input.value = ''
  return input
}

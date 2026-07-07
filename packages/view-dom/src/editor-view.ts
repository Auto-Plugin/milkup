import { createMarkdownImage, isImageAsset } from '@milkup/assets'
import type { AssetProvider } from '@milkup/assets'
import { ChangeSet, Selection } from '@milkup/core'
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
} from './types'

const defaultViewMetrics: ViewMetrics = Object.freeze({
  charWidth: 8,
  lineHeight: 20,
})

interface PastedAssetInput {
  readonly name: string
  readonly type: string
  readonly file?: File
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
  private suppressNextClick = false
  private mode: ViewMode
  private readonly handleInputEvent = (): void => {
    this.readInputProxy()
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
    this.dom = this.ownerDocument.createElement('div')
    this.dom.className = 'milkup-editor'
    this.dom.dataset.mode = this.mode
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
    this.markdownParseState = updateEditorMarkdownParseState(
      this.markdownParseState,
      previousState,
      state,
      transactions,
    )
    this.render()

    if (selectionChanged(previousState, state)) {
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

  positionToRect(pos: number, metrics?: Partial<ViewMetrics>): ViewRect {
    return positionToRectForMode(this.currentState, this.mode, pos, metrics)
  }

  coordinateToPosition(coordinate: ViewCoordinate, metrics?: Partial<ViewMetrics>): number {
    return coordinateToPositionForMode(this.currentState, this.mode, coordinate, metrics)
  }

  ensureCursorVisible(options?: CursorVisibilityOptions): number {
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
    return nextScrollTop
  }

  destroy(): void {
    this.inputDOM.removeEventListener('input', this.handleInputEvent)
    this.inputDOM.removeEventListener('paste', this.handlePasteEvent)
    this.inputDOM.removeEventListener('keydown', this.handleKeyDownEvent)
    this.inputDOM.removeEventListener('compositionstart', this.handleCompositionStartEvent)
    this.inputDOM.removeEventListener('compositionupdate', this.handleCompositionUpdateEvent)
    this.inputDOM.removeEventListener('compositionend', this.handleCompositionEndEvent)
    this.contentDOM.removeEventListener('click', this.handleClickEvent)
    this.contentDOM.removeEventListener('mousedown', this.handleMouseDownEvent)
    this.contentDOM.removeEventListener('mousemove', this.handleMouseMoveEvent)
    this.ownerDocument.removeEventListener('mouseup', this.handleMouseUpEvent)
    this.dom.remove()
  }

  private render(): void {
    this.contentDOM.replaceChildren(
      ...(this.mode === 'source'
        ? renderPlainTextLines(this.ownerDocument, this.currentState)
        : renderMarkdownLines(this.ownerDocument, this.currentState, this.mode, {
            root: this.markdownParseState.cache.root,
          })),
    )
    this.selectionLayerDOM.replaceChildren(
      ...renderSelectionOverlay(this.ownerDocument, this.currentState, this.mode),
    )
    this.cursorLayerDOM.replaceChildren(
      ...renderCursorOverlay(this.ownerDocument, this.currentState, this.mode),
    )
    this.alignCursorOverlayToDOM()
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
      )

      if (!rect) {
        continue
      }

      cursor.style.left = `${rect.left}px`
      cursor.style.top = `${rect.top}px`
      cursor.style.height = `${rect.height}px`
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

    if (text.length > 0) {
      this.insertText(text, 'input.composition')
    }
  }

  private async handlePaste(event: ClipboardEvent): Promise<void> {
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

    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false
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
      origin: { type: 'command', id: 'view.clickSelection' },
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
    this.dispatch({
      selection: Selection.cursor(pos),
      origin: { type: 'command', id: 'view.dragSelection.start' },
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

    this.suppressNextClick = this.suppressNextClick || pos !== this.dragAnchor
    this.dispatch({
      selection:
        pos === this.dragAnchor ? Selection.cursor(pos) : Selection.range(this.dragAnchor, pos),
      origin: { type: 'command', id: 'view.dragSelection.update' },
      addToHistory: false,
    })
    event.preventDefault()
  }

  private finishSelectionDrag(event: MouseEvent): void {
    if (!this.isDraggingSelection) {
      return
    }

    this.updateSelectionDrag(event)
    this.isDraggingSelection = false
    this.dragAnchor = undefined
    event.preventDefault()
  }

  private positionFromLineEvent(event: MouseEvent): number | undefined {
    const target =
      event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.milkup-line') : null

    if (!target) {
      return undefined
    }

    const from = Number(target.dataset.from)
    const to = Number(target.dataset.to)

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return undefined
    }

    if (this.mode !== 'source' && target.dataset.clickVisualOffset !== undefined) {
      return lineVisualOffsetToSourcePosition(
        this.currentState,
        this.mode,
        from,
        to,
        Number(target.dataset.clickVisualOffset),
      )
    }

    const caretPosition = sourcePositionFromPoint(target, event)

    if (caretPosition !== undefined) {
      return clamp(caretPosition, from, to)
    }

    const renderedLineLength =
      this.mode === 'source'
        ? Math.max(0, to - from)
        : visualLineLength(this.currentState, this.mode, from, to)
    const eventOffset = lineEventOffset(target, event, renderedLineLength)

    if (this.mode !== 'source' && target.dataset.clickOffset === undefined) {
      return lineVisualOffsetToSourcePosition(this.currentState, this.mode, from, to, eventOffset)
    }

    const requestedOffset =
      target.dataset.clickOffset !== undefined ? Number(target.dataset.clickOffset) : eventOffset
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.min(requestedOffset, Math.max(0, to - from)))
      : Math.max(0, to - from)

    return from + offset
  }
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
  const lines: HTMLElement[] = []

  for (let lineNumber = 1; lineNumber <= state.doc.lineCount; lineNumber += 1) {
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

    lines.push(lineDOM)
  }

  return Object.freeze(lines)
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

    if (block.type === 'unorderedList' || block.type === 'orderedList') {
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
  for (const block of blocks) {
    if (block.type !== 'unorderedList' && block.type !== 'orderedList') {
      continue
    }

    const item = (block.children ?? []).find(
      (child) => child.type === 'listItem' && rangeIntersectsLine(child, lineFrom, lineTo),
    )

    if (item) {
      return item
    }
  }

  return undefined
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
  },
): readonly Node[] {
  const pieces = collectContentLinePieces(node, from, to)

  if (pieces.length === 0) {
    return renderInlineDecorations(document, source, selection, from, to)
  }

  const showSyntax = shouldShowBlockSyntax(node, selection)
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
): readonly Node[] {
  if (to <= from) {
    return [document.createTextNode('\u200b')]
  }

  const marker = document.createElement('span')
  marker.className = 'milkup-block-marker milkup-table-marker'
  marker.dataset.from = String(from)
  marker.dataset.to = String(to)
  marker.textContent = source.slice(from, to)

  if (!shouldShowLineSyntax(selection, from, to)) {
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
  const pieces = collectListItemLinePieces(listItem, from, to)

  if (pieces.length === 0) {
    return renderInlineDecorations(document, source, selection, from, to)
  }

  const rendered: Node[] = []
  let pos = from

  for (const piece of pieces) {
    if (piece.from > pos) {
      rendered.push(document.createTextNode(source.slice(pos, piece.from)))
    }

    if (piece.kind === 'marker') {
      const marker = document.createElement('span')
      marker.className = 'milkup-list-marker'
      marker.dataset.from = String(piece.from)
      marker.dataset.to = String(piece.to)
      marker.textContent = source.slice(piece.from, piece.to)
      rendered.push(marker)
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
    rendered.push(document.createTextNode(source.slice(pos, to)))
  }

  return Object.freeze(rendered)
}

function collectListItemLinePieces(
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
      pieces.push({
        from: clamp(range.from, from, to),
        to: clamp(range.to, from, to),
        kind: 'content',
      })
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
      fragments.push(document.createTextNode(source.slice(pos, node.from)))
    }

    fragments.push(renderInlineNode(document, source, selection, node))
    pos = node.to
  }

  if (pos < to) {
    fragments.push(document.createTextNode(source.slice(pos, to)))
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

type InlinePieceKind = 'content' | 'marker' | 'syntax'

interface InlinePiece {
  readonly from: number
  readonly to: number
  readonly kind: InlinePieceKind
}

function renderInlineNodePieces(
  document: Document,
  source: string,
  selection: Selection,
  node: SyntaxNode,
): readonly Node[] {
  const pieces = collectInlinePieces(node)

  if (pieces.length === 0) {
    return [document.createTextNode(source.slice(node.from, node.to))]
  }

  const showSyntax = shouldShowInlineSyntax(node, selection)
  const rendered: Node[] = []
  let pos = node.from

  for (const piece of pieces) {
    if (piece.from > pos) {
      rendered.push(document.createTextNode(source.slice(pos, piece.from)))
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
    rendered.push(document.createTextNode(source.slice(pos, node.to)))
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
): LineProjection {
  const segments: LineProjectionSegment[] = []
  let visualPos = 0
  const showSyntax = shouldShowBlockSyntax(node, selection)

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

function buildMarkerLineProjection(selection: Selection, from: number, to: number): LineProjection {
  const hidden = !shouldShowLineSyntax(selection, from, to)

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
): PositionLineOffset {
  const line = state.doc.lineAt(pos)
  const projection = buildRenderedLineProjection(state, mode, line.from, line.to)

  return Object.freeze({
    line,
    offset:
      projection === undefined ? pos - line.from : sourcePositionToVisualOffset(projection, pos),
  })
}

function visualLineLength(state: EditorState, mode: ViewMode, from: number, to: number): number {
  const projection = buildRenderedLineProjection(state, mode, from, to)

  return projection === undefined ? Math.max(0, to - from) : projection.visualLength
}

function lineVisualOffsetToSourcePosition(
  state: EditorState,
  mode: ViewMode,
  from: number,
  to: number,
  visualOffset: number,
): number {
  const lineLength = Math.max(0, to - from)

  if (!Number.isFinite(visualOffset)) {
    return to
  }

  const projection = buildRenderedLineProjection(state, mode, from, to)

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
): LineProjection | undefined {
  if (mode === 'source' || to <= from) {
    return undefined
  }

  const blocks = parseMarkdown(state.doc.text).root.children ?? []

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
    return buildRangedLineProjection(state.doc.text, state.selection, blockquoteLine, from, to)
  }

  if (tableRow) {
    return buildRangedLineProjection(state.doc.text, state.selection, tableRow, from, to)
  }

  if (table) {
    return buildMarkerLineProjection(state.selection, from, to)
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
): ViewRect {
  const resolvedMetrics = resolveViewMetrics(metrics)
  const { line, offset } = positionToVisualLineOffset(state, mode, pos)
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
): number {
  const resolvedMetrics = resolveViewMetrics(metrics)
  const lineNumber = clamp(
    Math.floor(coordinate.y / resolvedMetrics.lineHeight) + 1,
    1,
    state.doc.lineCount,
  )
  const line = state.doc.line(lineNumber)
  const lineLength = visualLineLength(state, mode, line.from, line.to)
  const offset = clamp(Math.round(coordinate.x / resolvedMetrics.charWidth), 0, lineLength)

  if (mode === 'source') {
    return line.from + offset
  }

  return lineVisualOffsetToSourcePosition(state, mode, line.from, line.to, offset)
}

function resolveViewMetrics(metrics?: Partial<ViewMetrics>): ViewMetrics {
  return {
    charWidth: metrics?.charWidth ?? defaultViewMetrics.charWidth,
    lineHeight: metrics?.lineHeight ?? defaultViewMetrics.lineHeight,
  }
}

function lineEventOffset(lineDOM: HTMLElement, event: MouseEvent, maxOffset: number): number {
  const rect = lineDOM.getBoundingClientRect()
  const relativeX = event.clientX - rect.left

  if (!Number.isFinite(relativeX)) {
    return maxOffset
  }

  const offset = Math.round(relativeX / defaultViewMetrics.charWidth)
  return clamp(offset, 0, maxOffset)
}

function domRectForSourcePosition(
  document: Document,
  contentDOM: HTMLElement,
  layerDOM: HTMLElement,
  state: EditorState,
  mode: ViewMode,
  position: number,
): ViewRect | undefined {
  if (typeof document.createRange !== 'function') {
    return undefined
  }

  const { line, offset } = positionToVisualLineOffset(state, mode, position)
  const lineDOM = contentDOM.querySelector<HTMLElement>(`.milkup-line[data-line="${line.number}"]`)

  if (!lineDOM || !hasMeasurableLayout(lineDOM)) {
    return undefined
  }

  const range = createRangeAtVisualOffset(document, lineDOM, offset)

  if (!range) {
    return rectFromLineStart(lineDOM, layerDOM)
  }

  const rect = range.getBoundingClientRect()
  const lineRect = lineDOM.getBoundingClientRect()
  range.detach()

  if (!isUsableMeasuredRect(rect, lineRect)) {
    return undefined
  }

  const layerRect = layerDOM.getBoundingClientRect()
  const height = rect.height > 0 ? rect.height : lineRect.height

  return Object.freeze({
    left: rect.left - layerRect.left,
    top: lineRect.top - layerRect.top,
    right: rect.right - layerRect.left,
    bottom: lineRect.top - layerRect.top + height,
    width: rect.width,
    height,
  })
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

function rectFromLineStart(lineDOM: HTMLElement, layerDOM: HTMLElement): ViewRect | undefined {
  const lineRect = lineDOM.getBoundingClientRect()

  if (!hasMeasurableLayout(lineDOM)) {
    return undefined
  }

  const layerRect = layerDOM.getBoundingClientRect()
  const height = lineRect.height > 0 ? lineRect.height : defaultViewMetrics.lineHeight

  return Object.freeze({
    left: lineRect.left - layerRect.left,
    top: lineRect.top - layerRect.top,
    right: lineRect.left - layerRect.left,
    bottom: lineRect.top - layerRect.top + height,
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

function sourcePositionFromPoint(lineDOM: HTMLElement, event: MouseEvent): number | undefined {
  const point = caretPointFromDocument(lineDOM.ownerDocument, event.clientX, event.clientY)

  if (!point || !lineDOM.contains(point.node)) {
    return undefined
  }

  if (point.node.nodeType === Node.TEXT_NODE) {
    return sourcePositionFromTextNode(point.node, point.offset, lineDOM)
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

function caretPointFromDocument(document: Document, x: number, y: number): CaretPoint | undefined {
  const documentWithCaretPosition = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const position = documentWithCaretPosition.caretPositionFromPoint?.(x, y)

  if (position) {
    return { node: position.offsetNode, offset: position.offset }
  }

  const range = documentWithCaretPosition.caretRangeFromPoint?.(x, y)

  if (range) {
    return { node: range.startContainer, offset: range.startOffset }
  }

  return undefined
}

function sourcePositionFromTextNode(
  node: Node,
  offset: number,
  lineDOM: HTMLElement,
): number | undefined {
  const parent = node.parentElement?.closest<HTMLElement>('[data-from][data-to]')
  const from = Number(parent?.dataset.from ?? lineDOM.dataset.from)
  const to = Number(parent?.dataset.to ?? lineDOM.dataset.to)

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return undefined
  }

  return clamp(from + offset, from, to)
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

function selectionChanged(previousState: EditorState, state: EditorState): boolean {
  return (
    previousState.selection.main.anchor !== state.selection.main.anchor ||
    previousState.selection.main.head !== state.selection.main.head
  )
}

export function renderCursorOverlay(
  document: Document,
  state: EditorState,
  mode: ViewMode = 'source',
): readonly HTMLElement[] {
  return Object.freeze(
    state.selection.ranges.map((range, index) => {
      const position = range.head
      const { line, offset } = positionToVisualLineOffset(state, mode, position)
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
): readonly HTMLElement[] {
  return Object.freeze(
    state.selection.ranges
      .filter((range) => !range.empty)
      .map((range, index) => {
        const from = positionToVisualLineOffset(state, mode, range.from)
        const to = positionToVisualLineOffset(state, mode, range.to)
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

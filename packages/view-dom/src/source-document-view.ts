import type { EditorDocumentSource } from '@milkup/core'
import {
  parseMarkdownWindow,
  type MarkdownWindowParseResult,
  type SyntaxNode,
} from '@milkup/markdown'

import { createInputProxy, getVisibleLineWindow } from './editor-view'
import type { ViewMode, VirtualViewportConfig } from './types'

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

const defaultLineHeight = 21
const defaultOverscanLines = 12
const defaultMarkdownContextLines = 24
const defaultMarkdownCacheSize = 16
const defaultMarkdownWarmupWindows = 1
const defaultMarkdownWarmupDelayMs = 25

export class SourceDocumentView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
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
  private nextRequestId = 1
  private latestAppliedRequestId = 0
  private readonly handleScrollEvent = (): void => {
    void this.renderVisibleWindow()
  }
  private readonly handleInputEvent = (): void => {
    void this.readInputProxy()
  }
  private readonly handlePasteEvent = (event: ClipboardEvent): void => {
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
    void this.applyVisibleEdit(range.from, range.to, text)
  }
  private readonly handleKeyDownEvent = (event: KeyboardEvent): void => {
    if (this.handleEditingKey(event)) {
      event.preventDefault()
    }
  }
  private readonly handlePointerDownEvent = (event: MouseEvent): void => {
    void this.moveCursorFromPointer(event)
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
    this.inputDOM = createInputProxy(this.ownerDocument)
    this.dom.append(this.contentDOM)
    this.dom.append(this.inputDOM)
    this.dom.addEventListener('scroll', this.handleScrollEvent)
    this.dom.addEventListener('pointerdown', this.handlePointerDownEvent)
    this.inputDOM.addEventListener('input', this.handleInputEvent)
    this.inputDOM.addEventListener('paste', this.handlePasteEvent)
    this.inputDOM.addEventListener('keydown', this.handleKeyDownEvent)
    config.parent.append(this.dom)
    void this.renderVisibleWindow()
  }

  get source(): EditorDocumentSource {
    return this.currentSource
  }

  updateSource(source: EditorDocumentSource): void {
    const documentChanged = source.documentId !== this.currentSource.documentId

    this.currentSource = source
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

  async scrollToLine(lineNumber: number): Promise<void> {
    if (
      !Number.isInteger(lineNumber) ||
      lineNumber < 1 ||
      lineNumber > this.currentSource.lineCount
    ) {
      throw new RangeError(`Invalid line number: ${lineNumber}`)
    }

    this.dom.scrollTop = (lineNumber - 1) * this.getLineHeight()
    await this.renderVisibleWindow()
  }

  async renderVisibleWindow(): Promise<void> {
    const request = this.createRenderRequest()
    const renderedLines =
      this.mode === 'live'
        ? await this.renderLiveLineWindow(request)
        : await this.renderSourceLineWindow(request)

    if (request.id < this.latestAppliedRequestId) {
      return
    }

    this.latestAppliedRequestId = request.id
    const lineHeight = this.getLineHeight()
    this.contentDOM.replaceChildren(
      renderSpacer(this.ownerDocument, 'top', (request.fromLine - 1) * lineHeight),
      ...renderedLines,
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
    this.renderSelection()
    this.renderCursor()
    this.scheduleMarkdownWarmup(request)
  }

  destroy(): void {
    this.cancelMarkdownWarmup()
    this.dom.removeEventListener('scroll', this.handleScrollEvent)
    this.dom.removeEventListener('pointerdown', this.handlePointerDownEvent)
    this.inputDOM.removeEventListener('input', this.handleInputEvent)
    this.inputDOM.removeEventListener('paste', this.handlePasteEvent)
    this.inputDOM.removeEventListener('keydown', this.handleKeyDownEvent)
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

  private getLineHeight(): number {
    return Math.max(1, this.virtualViewport.lineHeight ?? defaultLineHeight)
  }

  private getViewportHeight(): number | undefined {
    return (
      this.virtualViewport.viewportHeight ??
      (this.dom.clientHeight > 0 ? this.dom.clientHeight : undefined)
    )
  }

  private async renderSourceLineWindow(request: RenderRequest): Promise<readonly HTMLElement[]> {
    const window = await this.currentSource.readLineWindow(request.fromLine, request.toLine)
    return Object.freeze(window.lines.map((line) => renderSourceLine(this.ownerDocument, line)))
  }

  private async renderLiveLineWindow(request: RenderRequest): Promise<readonly HTMLElement[]> {
    const fromLine = Math.max(1, request.fromLine - this.markdownContextLines)
    const toLine = Math.min(
      this.currentSource.lineCount,
      request.toLine + this.markdownContextLines,
    )
    const parsed = await this.parseLiveWindow(fromLine, toLine)
    const blocks = parsed.root.children ?? []

    return Object.freeze(
      parsed.window.lines
        .filter((line) => line.number >= request.fromLine && line.number <= request.toLine)
        .map((line) => renderLiveLine(this.ownerDocument, line, blocks)),
    )
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

    const text = this.inputDOM.value

    if (text.length === 0) {
      return
    }

    this.inputDOM.value = ''
    const range = this.getSelectedRange()
    await this.applyVisibleEdit(range.from, range.to, text)
  }

  private handleEditingKey(event: KeyboardEvent): boolean {
    if (!this.editable) {
      return false
    }

    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false
    }

    if (event.key.length === 1) {
      const range = this.getSelectedRange()
      void this.applyVisibleEdit(range.from, range.to, event.key)
      return true
    }

    if (event.key === 'Enter') {
      const range = this.getSelectedRange()
      void this.applyVisibleEdit(range.from, range.to, '\n')
      return true
    }

    if (event.key === 'Backspace') {
      void this.deleteAroundCursor(-1)
      return true
    }

    if (event.key === 'Delete') {
      void this.deleteAroundCursor(1)
      return true
    }

    return false
  }

  private async deleteAroundCursor(direction: -1 | 1): Promise<void> {
    const range = this.getSelectedRange()

    if (range.from !== range.to) {
      await this.applyVisibleEdit(range.from, range.to, '')
      return
    }

    const position = this.cursorPosition
    const from = direction < 0 ? Math.max(0, position - 1) : position
    const to = direction < 0 ? position : position + 1

    if (from === to) {
      return
    }

    await this.applyVisibleEdit(from, to, '')
  }

  private async applyVisibleEdit(from: number, to: number, insert: string): Promise<void> {
    if (!this.onEdit) {
      return
    }

    const deletedText = await this.readVisibleRangeText(from, to)
    await this.onEdit({ from, to, insert, deletedText })
    this.cursorPosition = from + insert.length
    this.selectionAnchor = this.cursorPosition
    this.cancelMarkdownWarmup()
    this.markdownCache.clear()
    await this.renderVisibleWindow()
    this.inputDOM.focus({ preventScroll: true })
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

  private async moveCursorFromPointer(event: MouseEvent): Promise<void> {
    const target = lineElementFromEvent(event, this.contentDOM, this.inputDOM)

    if (!target) {
      return
    }

    const from = Number(target.dataset.from)
    const to = Number(target.dataset.to)

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return
    }

    this.cursorPosition = sourcePositionFromPointer(target, event) ?? from
    if (!event.shiftKey) {
      this.selectionAnchor = this.cursorPosition
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

  private renderSelection(): void {
    this.contentDOM.querySelectorAll<HTMLElement>('.milkup-selection').forEach((node) => {
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
      const fromOffset = visualOffsetForSourcePosition(line, from)
      const toOffset = visualOffsetForSourcePosition(line, to)
      selection.style.left = `${fromOffset * 8}px`
      selection.style.top = `${lineVisualTop(line, lineNumber, this.getLineHeight())}px`
      selection.style.width = `${Math.max(1, toOffset - fromOffset) * 8}px`
      selection.style.height = `${lineVisualHeight(line, this.getLineHeight())}px`
      this.contentDOM.append(selection)
    }
  }

  private renderCursor(): void {
    this.contentDOM.querySelector<HTMLElement>('.milkup-cursor')?.remove()

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
    cursor.style.left = `${visualOffsetForSourcePosition(line, this.cursorPosition) * 8}px`
    cursor.style.top = `${lineVisualTop(line, lineNumber, this.getLineHeight())}px`
    cursor.style.height = `${lineVisualHeight(line, this.getLineHeight())}px`
    this.contentDOM.append(cursor)
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
): HTMLElement {
  const lineDOM = createLineElement(document, line)
  lineDOM.classList.add('milkup-line-live')
  applyLiveBlockClasses(lineDOM, line, blocks)

  const heading = findBlockForLine(blocks, 'heading', line.from, line.to)
  const blockquoteLine = findBlockForLine(blocks, 'blockquoteLine', line.from, line.to)
  const tableRow = findBlockForLine(blocks, 'tableRow', line.from, line.to)
  const table = findBlockForLine(blocks, 'table', line.from, line.to)
  const listItem = findBlockForLine(blocks, 'listItem', line.from, line.to)

  if (heading) {
    lineDOM.replaceChildren(
      ...renderMappedLinePieces(document, line, heading, {
        contentClassName: 'milkup-heading-content',
        markerClassName: 'milkup-heading-marker milkup-marker-hidden',
      }),
    )
  } else if (blockquoteLine) {
    lineDOM.replaceChildren(
      ...renderMappedLinePieces(document, line, blockquoteLine, {
        contentClassName: 'milkup-blockquote-content',
        markerClassName: 'milkup-blockquote-marker milkup-marker-hidden',
      }),
    )
  } else if (tableRow) {
    lineDOM.replaceChildren(
      ...renderMappedLinePieces(document, line, tableRow, {
        contentClassName: 'milkup-table-cell-content',
        markerClassName: 'milkup-table-marker',
      }),
    )
  } else if (table) {
    lineDOM.classList.add('milkup-table-delimiter')
    lineDOM.replaceChildren(
      ...renderHiddenLine(document, line, 'milkup-table-marker milkup-marker-hidden'),
    )
  } else if (listItem) {
    lineDOM.replaceChildren(
      ...renderMappedLinePieces(document, line, listItem, {
        contentClassName: 'milkup-list-content',
        markerClassName: 'milkup-list-marker milkup-marker-hidden',
      }),
    )
  } else {
    lineDOM.textContent = line.text.length > 0 ? line.text : '\u200b'
  }

  return lineDOM
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
      rendered.push(createMappedSpan(document, line, position, piece.from, 'milkup-live-text'))
    }

    rendered.push(createMappedSpan(document, line, piece.from, piece.to, piece.className))
    position = Math.max(position, piece.to)
  }

  if (position < line.to) {
    rendered.push(createMappedSpan(document, line, position, line.to, 'milkup-live-text'))
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

function renderSpacer(document: Document, position: 'top' | 'bottom', height: number): HTMLElement {
  const spacer = document.createElement('div')
  spacer.className = 'milkup-virtual-spacer'
  spacer.dataset.spacer = position
  spacer.style.height = `${Math.max(0, height)}px`
  return spacer
}

function lineElementFromEvent(
  event: Event,
  contentDOM: HTMLElement,
  excludedDOM?: HTMLElement,
): HTMLElement | undefined {
  const target = event.target

  if (!(target instanceof Node) || target === excludedDOM || excludedDOM?.contains(target)) {
    return undefined
  }

  const element = target instanceof HTMLElement ? target : target.parentElement
  const line = element?.closest<HTMLElement>('.milkup-line')

  return line && contentDOM.contains(line) ? line : undefined
}

function sourcePositionFromPointer(lineDOM: HTMLElement, event: MouseEvent): number | undefined {
  const caret = caretPointFromDocument(lineDOM.ownerDocument, event.clientX, event.clientY)

  if (caret && lineDOM.contains(caret.node)) {
    const fromText = sourcePositionFromTextNode(
      caret.node,
      nearestTextOffsetFromPoint(caret.node, caret.offset, event.clientX),
      lineDOM,
    )

    if (fromText !== undefined) {
      return fromText
    }
  }

  const target = event.target
  const element =
    target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null
  const mapped = element?.closest<HTMLElement>('[data-from][data-to]')

  if (mapped && lineDOM.contains(mapped)) {
    const from = Number(mapped.dataset.from)
    const to = Number(mapped.dataset.to)

    if (Number.isInteger(from) && Number.isInteger(to)) {
      return clamp(from + estimateElementOffsetFromPointer(mapped, event), from, to)
    }
  }

  const from = Number(lineDOM.dataset.from)
  const to = Number(lineDOM.dataset.to)

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return undefined
  }

  return clamp(from + estimateElementOffsetFromPointer(lineDOM, event), from, to)
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
  const mapped = closestSourceMappedElement(node, lineDOM)
  const from = Number(mapped?.dataset.from ?? lineDOM.dataset.from)
  const to = Number(mapped?.dataset.to ?? lineDOM.dataset.to)

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return undefined
  }

  const textOffset = mapped ? textOffsetWithinElement(mapped, node, offset) : offset
  return clamp(from + textOffset, from, to)
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

  return Number.isFinite(rect.left) ? rect : undefined
}

function closestSourceMappedElement(node: Node, lineDOM: HTMLElement): HTMLElement | undefined {
  for (
    let element = node instanceof HTMLElement ? node : node.parentElement;
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

function visualOffsetForSourcePosition(lineDOM: HTMLElement, position: number): number {
  const lineFrom = Number(lineDOM.dataset.from)
  const lineTo = Number(lineDOM.dataset.to)

  if (!Number.isInteger(lineFrom) || !Number.isInteger(lineTo)) {
    return 0
  }

  const mappedElements = Array.from(lineDOM.querySelectorAll<HTMLElement>('[data-from][data-to]'))
    .filter((element) => !element.classList.contains('milkup-marker-hidden'))
    .sort((left, right) => Number(left.dataset.from) - Number(right.dataset.from))

  if (mappedElements.length === 0) {
    return clamp(position, lineFrom, lineTo) - lineFrom
  }

  let visualOffset = 0

  for (const element of mappedElements) {
    const from = Number(element.dataset.from)
    const to = Number(element.dataset.to)
    const textLength = element.textContent?.length ?? Math.max(0, to - from)

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      continue
    }

    if (position <= from) {
      return visualOffset
    }

    if (position <= to) {
      return visualOffset + clamp(position - from, 0, textLength)
    }

    visualOffset += textLength
  }

  return visualOffset
}

function lineVisualTop(lineDOM: HTMLElement, lineNumber: number, lineHeight: number): number {
  return lineDOM.offsetTop || (lineNumber - 1) * lineHeight
}

function lineVisualHeight(lineDOM: HTMLElement, lineHeight: number): number {
  const rect = lineDOM.getBoundingClientRect()
  return rect.height > 0 ? rect.height : lineHeight
}

function estimateElementOffsetFromPointer(element: HTMLElement, event: MouseEvent): number {
  const from = Number(element.dataset.from)
  const to = Number(element.dataset.to)
  const length =
    Number.isInteger(from) && Number.isInteger(to)
      ? Math.max(0, to - from)
      : (element.textContent?.length ?? 0)
  const rect = element.getBoundingClientRect()

  if (!Number.isFinite(rect.left) || rect.width <= 0) {
    return 0
  }

  const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1)
  return clamp(Math.round(ratio * length), 0, length)
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

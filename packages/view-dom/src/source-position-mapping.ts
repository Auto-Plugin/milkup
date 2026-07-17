import type { ViewRect } from './types'

export interface SourcePositionRectOptions {
  readonly fallbackLineHeight?: number
  readonly allowGeometryFallback?: boolean
}

export interface SourcePositionFromPointOptions {
  readonly allowGeometryFallback?: boolean
}

/** Preserve the browser's native drag behavior for code-block scrollbars. */
export function isHorizontalScrollbarDragStart(event: MouseEvent): boolean {
  const target = event.target

  if (!(target instanceof HTMLElement)) {
    return false
  }

  const scrollable = target.closest<HTMLElement>('.milkup-block-code')

  if (!scrollable || scrollable.scrollWidth <= scrollable.clientWidth) {
    return false
  }

  const scrollbarHeight = scrollable.offsetHeight - scrollable.clientHeight

  if (scrollbarHeight <= 0) {
    return false
  }

  const rect = scrollable.getBoundingClientRect()
  return event.clientY >= rect.bottom - scrollbarHeight && event.clientY <= rect.bottom
}

export function lineElementFromEvent(
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

export function sourcePositionFromPoint(
  lineDOM: HTMLElement,
  event: MouseEvent,
  overlayDOM?: HTMLElement,
  options: SourcePositionFromPointOptions = {},
): number | undefined {
  const tableCell = tableCellFromPointer(lineDOM, event)

  if (tableCell) {
    const mapped = mappedElementInTableCellFromPointer(tableCell, event)
    const from = Number(mapped.dataset.from)
    const to = Number(mapped.dataset.to)

    if (Number.isInteger(from) && Number.isInteger(to)) {
      return clamp(from + estimateElementOffsetFromPointer(mapped, event), from, to)
    }
  }

  const point = caretPointFromDocument(
    lineDOM.ownerDocument,
    event.clientX,
    event.clientY,
    overlayDOM,
  )

  if (point && lineDOM.contains(point.node)) {
    if (point.node instanceof Text) {
      const fromText = sourcePositionFromTextNode(
        point.node,
        nearestTextOffsetFromPointer(point.node, event.clientX, event.clientY, point.offset),
        lineDOM,
      )

      if (fromText !== undefined) {
        return fromText
      }
    }

    if (point.node instanceof HTMLElement) {
      const child = point.node.childNodes.item(point.offset)
      const textNode = findNearestTextNode(child, point.node)

      if (textNode instanceof Text && !isHiddenTextNode(textNode, lineDOM)) {
        const fromText = sourcePositionFromTextNode(
          textNode,
          nearestTextOffsetFromPointer(textNode, event.clientX, event.clientY),
          lineDOM,
        )

        if (fromText !== undefined) {
          return fromText
        }
      }
    }
  }

  if (!options.allowGeometryFallback) {
    return undefined
  }

  const target = event.target
  const element =
    target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null
  const mapped = element?.closest<HTMLElement>('[data-from][data-to]')

  if (mapped && lineDOM.contains(mapped) && !mapped.classList.contains('milkup-marker-hidden')) {
    const from = Number(mapped.dataset.from)
    const to = Number(mapped.dataset.to)

    if (Number.isInteger(from) && Number.isInteger(to)) {
      return clamp(from + estimateElementOffsetFromPointer(mapped, event), from, to)
    }
  }

  const visibleMappedPosition = estimateVisibleMappedPositionFromPointer(lineDOM, event)

  if (visibleMappedPosition !== undefined) {
    return visibleMappedPosition
  }

  const from = Number(lineDOM.dataset.from)
  const to = Number(lineDOM.dataset.to)

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return undefined
  }

  return clamp(from + estimateElementOffsetFromPointer(lineDOM, event), from, to)
}

function tableCellFromPointer(lineDOM: HTMLElement, event: MouseEvent): HTMLElement | undefined {
  const target = event.target
  const targetElement =
    target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null
  const direct = targetElement?.closest<HTMLElement>('.milkup-table-cell')

  if (direct && lineDOM.contains(direct)) {
    return direct
  }

  return Array.from(lineDOM.querySelectorAll<HTMLElement>('.milkup-table-cell')).find((cell) => {
    const rect = cell.getBoundingClientRect()
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    )
  })
}

function mappedElementInTableCellFromPointer(
  tableCell: HTMLElement,
  event: MouseEvent,
): HTMLElement {
  const target = event.target
  const targetElement =
    target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null
  const direct = targetElement?.closest<HTMLElement>('[data-from][data-to]')

  if (
    direct &&
    (direct === tableCell || tableCell.contains(direct)) &&
    !direct.classList.contains('milkup-marker-hidden')
  ) {
    return direct
  }

  let nearest = tableCell

  for (const candidate of Array.from(
    tableCell.querySelectorAll<HTMLElement>('[data-from][data-to]'),
  )) {
    if (candidate.classList.contains('milkup-marker-hidden')) {
      continue
    }

    const rect = candidate.getBoundingClientRect()

    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      continue
    }

    if (nearest === tableCell || nearest.contains(candidate)) {
      nearest = candidate
    }
  }

  return nearest
}

export function domRectForLineSourcePosition(
  document: Document,
  lineDOM: HTMLElement,
  referenceDOM: HTMLElement,
  position: number,
  options: SourcePositionRectOptions = {},
): ViewRect | undefined {
  const sourceRect = domRectForMappedSourcePosition(
    document,
    lineDOM,
    referenceDOM,
    position,
    options,
  )

  if (sourceRect) {
    return sourceRect
  }

  const rect = domRectForLineVisualOffset(
    document,
    lineDOM,
    referenceDOM,
    sourcePositionToVisualOffsetInLine(lineDOM, position),
    options,
  )

  if (rect || !options.allowGeometryFallback) {
    return rect
  }

  return estimateLineSourcePositionRect(lineDOM, referenceDOM, position, options.fallbackLineHeight)
}

export function domRectsForLineSourceRange(
  document: Document,
  lineDOM: HTMLElement,
  referenceDOM: HTMLElement,
  from: number,
  to: number,
): readonly ViewRect[] {
  const sourceRects = domRectsForMappedSourceRange(document, lineDOM, referenceDOM, from, to)

  if (sourceRects.length > 0) {
    return sourceRects
  }

  return domRectsForLineVisualRange(
    document,
    lineDOM,
    referenceDOM,
    sourcePositionToVisualOffsetInLine(lineDOM, from),
    sourcePositionToVisualOffsetInLine(lineDOM, to),
  )
}

export function domRectForLineVisualOffset(
  document: Document,
  lineDOM: HTMLElement,
  referenceDOM: HTMLElement,
  visualOffset: number,
  options: SourcePositionRectOptions = {},
): ViewRect | undefined {
  if (typeof document.createRange !== 'function') {
    return undefined
  }

  if (!hasMeasurableLayout(lineDOM)) {
    return undefined
  }

  const lineRect = lineDOM.getBoundingClientRect()
  const range = createRangeAtVisualOffset(document, lineDOM, visualOffset)

  if (!range) {
    return rectFromLineStart(lineDOM, referenceDOM, options.fallbackLineHeight)
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

export function domRectsForLineVisualRange(
  document: Document,
  lineDOM: HTMLElement,
  referenceDOM: HTMLElement,
  fromOffset: number,
  toOffset: number,
): readonly ViewRect[] {
  if (typeof document.createRange !== 'function') {
    return Object.freeze([])
  }

  const range = createRangeBetweenVisualOffsets(document, lineDOM, fromOffset, toOffset)

  if (!range) {
    return Object.freeze([])
  }

  const lineRect = lineDOM.getBoundingClientRect()
  const referenceRect = referenceDOM.getBoundingClientRect()
  const clientRects = Array.from(range.getClientRects?.() ?? [])
  const usableRects = clientRects.filter((rect) => isUsableMeasuredRect(rect, lineRect))

  if (usableRects.length === 0 && typeof range.getBoundingClientRect === 'function') {
    const rect = range.getBoundingClientRect()

    if (isUsableMeasuredRect(rect, lineRect)) {
      usableRects.push(rect)
    }
  }

  range.detach()

  return Object.freeze(
    usableRects.map((rect) => {
      const top = rect.top - referenceRect.top
      const height = rect.height > 0 ? rect.height : lineRect.height

      return Object.freeze({
        left: rect.left - referenceRect.left,
        top,
        right: rect.right - referenceRect.left,
        bottom: top + height,
        width: rect.width,
        height,
      })
    }),
  )
}

export function sourcePositionToVisualOffsetInLine(lineDOM: HTMLElement, position: number): number {
  const lineFrom = Number(lineDOM.dataset.from)
  const lineTo = Number(lineDOM.dataset.to)

  if (!Number.isInteger(lineFrom) || !Number.isInteger(lineTo)) {
    return 0
  }

  const segments = visibleTextSourceSegments(lineDOM)

  if (segments.length === 0) {
    return clamp(position, lineFrom, lineTo) - lineFrom
  }

  for (const segment of segments) {
    if (position <= segment.from) {
      return segment.visualFrom
    }

    if (position <= segment.to) {
      const sourceLength = segment.to - segment.from

      if (sourceLength <= 0) {
        return segment.visualFrom
      }

      const ratio = clamp((position - segment.from) / sourceLength, 0, 1)
      return Math.round(segment.visualFrom + ratio * (segment.visualTo - segment.visualFrom))
    }
  }

  return segments.at(-1)?.visualTo ?? 0
}

interface VisibleTextSourceSegment {
  readonly node: Text
  readonly from: number
  readonly to: number
  readonly visualFrom: number
  readonly visualTo: number
}

function domRectForMappedSourcePosition(
  document: Document,
  lineDOM: HTMLElement,
  referenceDOM: HTMLElement,
  position: number,
  options: SourcePositionRectOptions,
): ViewRect | undefined {
  if (typeof document.createRange !== 'function' || !hasMeasurableLayout(lineDOM)) {
    return undefined
  }

  const textPosition = resolveTextPositionAtSourcePosition(lineDOM, position, 1)

  if (!textPosition) {
    return undefined
  }

  const range = document.createRange()
  range.setStart(textPosition.node, textPosition.offset)
  range.collapse(true)

  if (typeof range.getBoundingClientRect !== 'function') {
    range.detach()
    return undefined
  }

  const lineRect = lineDOM.getBoundingClientRect()
  const rect = range.getBoundingClientRect()
  range.detach()

  if (!isUsableMeasuredRect(rect, lineRect)) {
    return undefined
  }

  return viewRectFromClientRect(rect, referenceDOM, lineRect, options.fallbackLineHeight)
}

function domRectsForMappedSourceRange(
  document: Document,
  lineDOM: HTMLElement,
  referenceDOM: HTMLElement,
  from: number,
  to: number,
): readonly ViewRect[] {
  if (typeof document.createRange !== 'function' || to <= from) {
    return Object.freeze([])
  }

  const start = resolveTextPositionAtSourcePosition(lineDOM, from, 1)
  const end = resolveTextPositionAtSourcePosition(lineDOM, to, -1)

  if (!start || !end) {
    return Object.freeze([])
  }

  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)

  const lineRect = lineDOM.getBoundingClientRect()
  const referenceRect = referenceDOM.getBoundingClientRect()
  const clientRects = Array.from(range.getClientRects?.() ?? [])
  const usableRects = clientRects.filter((rect) => isUsableMeasuredRect(rect, lineRect))

  if (usableRects.length === 0 && typeof range.getBoundingClientRect === 'function') {
    const rect = range.getBoundingClientRect()

    if (isUsableMeasuredRect(rect, lineRect)) {
      usableRects.push(rect)
    }
  }

  range.detach()

  return Object.freeze(
    usableRects.map((rect) => {
      const top = rect.top - referenceRect.top
      const height = rect.height > 0 ? rect.height : lineRect.height

      return Object.freeze({
        left: rect.left - referenceRect.left,
        top,
        right: rect.right - referenceRect.left,
        bottom: top + height,
        width: rect.width,
        height,
      })
    }),
  )
}

function resolveTextPositionAtSourcePosition(
  lineDOM: HTMLElement,
  position: number,
  affinity: -1 | 1,
): { readonly node: Text; readonly offset: number } | undefined {
  const element = sourceMappedElementAtPosition(lineDOM, position, affinity)

  if (!element) {
    return undefined
  }

  const from = Number(element.dataset.from)
  const to = Number(element.dataset.to)

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return undefined
  }

  const sourceLength = Math.max(0, to - from)
  const textNodes = visibleTextNodes(element)
  const textLength = textNodes.reduce((length, node) => length + node.length, 0)

  if (textLength <= 0) {
    return undefined
  }

  const sourceOffset = clamp(position, from, to) - from
  const textOffset = sourceLength > 0 ? Math.round((sourceOffset / sourceLength) * textLength) : 0

  return resolveTextPositionInNodes(textNodes, textOffset)
}

function sourceMappedElementAtPosition(
  lineDOM: HTMLElement,
  position: number,
  affinity: -1 | 1,
): HTMLElement | undefined {
  const lineFrom = Number(lineDOM.dataset.from)
  const lineTo = Number(lineDOM.dataset.to)

  if (!Number.isInteger(lineFrom) || !Number.isInteger(lineTo)) {
    return undefined
  }

  const sourcePosition = clamp(position, lineFrom, lineTo)
  const elements = visibleSourceMappedElements(lineDOM)

  if (elements.length === 0) {
    return undefined
  }

  const exactBoundary =
    affinity > 0
      ? elements.filter((element) => Number(element.dataset.from) === sourcePosition)
      : elements.filter((element) => Number(element.dataset.to) === sourcePosition)

  if (exactBoundary.length > 0) {
    return mostSpecificMappedElement(exactBoundary)
  }

  const containing = elements.filter((element) => {
    const from = Number(element.dataset.from)
    const to = Number(element.dataset.to)
    return (
      Number.isInteger(from) && Number.isInteger(to) && sourcePosition > from && sourcePosition < to
    )
  })

  if (containing.length > 0) {
    return mostSpecificMappedElement(containing)
  }

  const adjacentBoundary =
    affinity > 0
      ? elements.filter((element) => Number(element.dataset.to) === sourcePosition)
      : elements.filter((element) => Number(element.dataset.from) === sourcePosition)

  if (adjacentBoundary.length > 0) {
    return mostSpecificMappedElement(adjacentBoundary)
  }

  const next = elements.find((element) => sourcePosition < Number(element.dataset.from))

  if (next) {
    return next
  }

  return elements.at(-1)
}

function visibleSourceMappedElements(lineDOM: HTMLElement): readonly HTMLElement[] {
  return Object.freeze(
    Array.from(lineDOM.querySelectorAll<HTMLElement>('[data-from][data-to]'))
      .filter((element) => !element.classList.contains('milkup-marker-hidden'))
      .filter((element) => visibleTextNodes(element).length > 0)
      .sort((left, right) => {
        const leftFrom = Number(left.dataset.from)
        const rightFrom = Number(right.dataset.from)
        const leftTo = Number(left.dataset.to)
        const rightTo = Number(right.dataset.to)
        return leftFrom - rightFrom || leftTo - rightTo || elementDepth(right) - elementDepth(left)
      }),
  )
}

function mostSpecificMappedElement(elements: readonly HTMLElement[]): HTMLElement | undefined {
  return [...elements].sort((left, right) => {
    const leftLength = Number(left.dataset.to) - Number(left.dataset.from)
    const rightLength = Number(right.dataset.to) - Number(right.dataset.from)
    return leftLength - rightLength || elementDepth(right) - elementDepth(left)
  })[0]
}

function elementDepth(element: HTMLElement): number {
  let depth = 0

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    depth += 1
  }

  return depth
}

function resolveTextPositionInNodes(
  textNodes: readonly Text[],
  textOffset: number,
): { readonly node: Text; readonly offset: number } | undefined {
  let remaining = Math.max(0, textOffset)

  for (const node of textNodes) {
    if (remaining <= node.length) {
      return { node, offset: remaining }
    }

    remaining -= node.length
  }

  const last = textNodes.at(-1)
  return last ? { node: last, offset: last.length } : undefined
}

function visibleTextSourceSegments(lineDOM: HTMLElement): readonly VisibleTextSourceSegment[] {
  const segments: VisibleTextSourceSegment[] = []
  let visualOffset = 0

  for (const node of visibleTextNodes(lineDOM)) {
    const from = sourcePositionFromTextNode(node, 0, lineDOM)
    const to = sourcePositionFromTextNode(node, node.length, lineDOM)
    const visualTo = visualOffset + node.length

    if (from !== undefined && to !== undefined) {
      segments.push(
        Object.freeze({
          node,
          from,
          to,
          visualFrom: visualOffset,
          visualTo,
        }),
      )
    }

    visualOffset = visualTo
  }

  return Object.freeze(segments)
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
  if (node instanceof Text && isHiddenTextNode(node, lineDOM)) {
    return undefined
  }

  const mapped = closestSourceMappedElement(node, lineDOM)
  const from = Number(mapped?.dataset.from ?? lineDOM.dataset.from)
  const to = Number(mapped?.dataset.to ?? lineDOM.dataset.to)

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return undefined
  }

  const textOffset = mapped ? textOffsetWithinElement(mapped, node, offset) : offset
  return clamp(from + textOffset, from, to)
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

function rectFromLineStart(
  lineDOM: HTMLElement,
  referenceDOM: HTMLElement,
  fallbackLineHeight = 20,
): ViewRect | undefined {
  const lineRect = lineDOM.getBoundingClientRect()

  if (!hasMeasurableLayout(lineDOM)) {
    return undefined
  }

  const referenceRect = referenceDOM.getBoundingClientRect()
  const height = lineRect.height > 0 ? lineRect.height : fallbackLineHeight

  return Object.freeze({
    left: lineRect.left - referenceRect.left,
    top: lineRect.top - referenceRect.top,
    right: lineRect.left - referenceRect.left,
    bottom: lineRect.top - referenceRect.top + height,
    width: 0,
    height,
  })
}

function viewRectFromClientRect(
  rect: DOMRect,
  referenceDOM: HTMLElement,
  fallbackLineRect: DOMRect,
  fallbackLineHeight = 20,
): ViewRect {
  const referenceRect = referenceDOM.getBoundingClientRect()
  const height = rect.height > 0 ? rect.height : fallbackLineRect.height || fallbackLineHeight
  const top = rect.top - referenceRect.top

  return Object.freeze({
    left: rect.left - referenceRect.left,
    top,
    right: rect.right - referenceRect.left,
    bottom: top + height,
    width: rect.width,
    height,
  })
}

function hasMeasurableLayout(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

function isUsableMeasuredRect(rect: DOMRect, fallbackLineRect: DOMRect): boolean {
  return (
    Number.isFinite(rect.left) && Number.isFinite(rect.top) && (rect.width > 0 || rect.height > 0)
  )
}

function estimateElementOffsetFromPointer(element: HTMLElement, event: MouseEvent): number {
  const from = Number(element.dataset.from)
  const to = Number(element.dataset.to)
  const length =
    Number.isInteger(from) && Number.isInteger(to)
      ? Math.max(0, to - from)
      : (element.textContent?.length ?? 0)
  const rect = element.getBoundingClientRect()

  const textOffset = nearestElementTextOffsetFromPointer(element, event.clientX, event.clientY)

  if (textOffset !== undefined) {
    const textLength = visibleTextNodes(element).reduce((length, node) => length + node.length, 0)

    if (textLength > 0) {
      return clamp(Math.round((textOffset / textLength) * length), 0, length)
    }
  }

  if (!Number.isFinite(rect.left) || rect.width <= 0) {
    return 0
  }

  const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1)
  return clamp(Math.round(ratio * length), 0, length)
}

function nearestTextOffsetFromPointer(
  node: Text,
  clientX: number,
  clientY: number,
  fallbackOffset = 0,
): number {
  let nearestOffset = clamp(fallbackOffset, 0, node.length)
  let nearestDistance = Number.POSITIVE_INFINITY
  const candidates = new Set<number>()

  if (node.length <= 256) {
    for (let offset = 0; offset <= node.length; offset += 1) {
      candidates.add(offset)
    }
  } else {
    let low = 0
    let high = node.length

    while (low <= high) {
      const offset = Math.floor((low + high) / 2)
      const rect = caretRectForTextOffset(node, offset)

      candidates.add(offset)

      if (!rect) {
        break
      }

      if (clientY > rect.bottom || (clientY >= rect.top && clientX > rect.left)) {
        low = offset + 1
      } else {
        high = offset - 1
      }
    }

    for (const offset of [0, node.length, fallbackOffset, low, high]) {
      for (let nearby = offset - 2; nearby <= offset + 2; nearby += 1) {
        candidates.add(clamp(nearby, 0, node.length))
      }
    }
  }

  for (const offset of candidates) {
    const rect = caretRectForTextOffset(node, offset)

    if (!rect) {
      continue
    }

    const distance = pointToRectDistance(clientX, clientY, rect)

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestOffset = offset
    }
  }

  return nearestOffset
}

function nearestElementTextOffsetFromPointer(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): number | undefined {
  let elementOffset = 0
  let nearestOffset: number | undefined
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const node of visibleTextNodes(element)) {
    const offset = nearestTextOffsetFromPointer(node, clientX, clientY)
    const rect = caretRectForTextOffset(node, offset)

    if (rect) {
      const distance = pointToRectDistance(clientX, clientY, rect)

      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestOffset = elementOffset + offset
      }
    }

    elementOffset += node.length
  }

  return nearestOffset
}

function pointToRectDistance(clientX: number, clientY: number, rect: DOMRect): number {
  const horizontal =
    clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0
  const vertical =
    clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0
  return horizontal * horizontal + vertical * vertical
}

function estimateVisibleMappedPositionFromPointer(
  lineDOM: HTMLElement,
  event: MouseEvent,
): number | undefined {
  const mappedElements = Array.from(lineDOM.querySelectorAll<HTMLElement>('[data-from][data-to]'))
    .filter((element) => !element.classList.contains('milkup-marker-hidden'))
    .sort((left, right) => Number(left.dataset.from) - Number(right.dataset.from))

  if (mappedElements.length === 0) {
    return undefined
  }

  let nearest:
    | {
        readonly element: HTMLElement
        readonly distance: number
      }
    | undefined

  for (const element of mappedElements) {
    const rect = element.getBoundingClientRect()

    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.right)) {
      continue
    }

    if (event.clientX >= rect.left && event.clientX <= rect.right) {
      const from = Number(element.dataset.from)
      const to = Number(element.dataset.to)
      return Number.isInteger(from) && Number.isInteger(to)
        ? clamp(from + estimateElementOffsetFromPointer(element, event), from, to)
        : undefined
    }

    const distance =
      event.clientX < rect.left ? rect.left - event.clientX : event.clientX - rect.right

    if (!nearest || distance < nearest.distance) {
      nearest = { element, distance }
    }
  }

  if (!nearest) {
    return undefined
  }

  const from = Number(nearest.element.dataset.from)
  const to = Number(nearest.element.dataset.to)

  return Number.isInteger(from) && Number.isInteger(to)
    ? clamp(from + estimateElementOffsetFromPointer(nearest.element, event), from, to)
    : undefined
}

function estimateLineSourcePositionRect(
  lineDOM: HTMLElement,
  referenceDOM: HTMLElement,
  position: number,
  fallbackLineHeight = 20,
): ViewRect | undefined {
  const lineRect = lineDOM.getBoundingClientRect()

  if (!Number.isFinite(lineRect.left) || (lineRect.width <= 0 && lineRect.height <= 0)) {
    return undefined
  }

  const referenceRect = referenceDOM.getBoundingClientRect()
  const left = estimateLineSourcePositionClientLeft(lineDOM, position, lineRect)
  const top = lineRect.top - referenceRect.top
  const height = resolveLineCursorHeight(lineDOM, fallbackLineHeight)

  return Object.freeze({
    left: left - referenceRect.left,
    top,
    right: left - referenceRect.left,
    bottom: top + height,
    width: 0,
    height,
  })
}

function estimateLineSourcePositionClientLeft(
  lineDOM: HTMLElement,
  position: number,
  lineRect: DOMRect,
): number {
  const tableCells = Array.from(lineDOM.querySelectorAll<HTMLElement>('.milkup-table-cell'))

  if (tableCells.length > 0) {
    const containing = tableCells.find((cell) => {
      const from = Number(cell.dataset.from)
      const to = Number(cell.dataset.to)
      return Number.isInteger(from) && Number.isInteger(to) && position >= from && position <= to
    })
    const cell =
      containing ?? tableCells.find((candidate) => position <= Number(candidate.dataset.from))

    if (cell) {
      const from = Number(cell.dataset.from)
      const to = Number(cell.dataset.to)
      const rect = cell.getBoundingClientRect()

      if (Number.isInteger(from) && Number.isInteger(to) && Number.isFinite(rect.left)) {
        const sourceLength = to - from
        const ratio = sourceLength > 0 ? clamp((position - from) / sourceLength, 0, 1) : 0
        return rect.left + rect.width * ratio
      }
    }
  }

  const mappedElements = Array.from(lineDOM.querySelectorAll<HTMLElement>('[data-from][data-to]'))
    .filter((element) => !element.classList.contains('milkup-marker-hidden'))
    .sort((left, right) => Number(left.dataset.from) - Number(right.dataset.from))

  if (mappedElements.length > 0) {
    for (const element of mappedElements) {
      const from = Number(element.dataset.from)
      const to = Number(element.dataset.to)

      if (!Number.isInteger(from) || !Number.isInteger(to)) {
        continue
      }

      const rect = element.getBoundingClientRect()

      if (!Number.isFinite(rect.left) || rect.width <= 0) {
        continue
      }

      if (position <= from) {
        return rect.left
      }

      if (position <= to) {
        const spanLength = Math.max(1, to - from)
        const ratio = clamp((position - from) / spanLength, 0, 1)
        return rect.left + rect.width * ratio
      }
    }

    const last = mappedElements.at(-1)
    const rect = last?.getBoundingClientRect()

    if (rect && Number.isFinite(rect.right)) {
      return rect.right
    }
  }

  const from = Number(lineDOM.dataset.from)
  const to = Number(lineDOM.dataset.to)
  const offset =
    Number.isInteger(from) && Number.isInteger(to) ? clamp(position, from, to) - from : 0
  const textLength = Math.max(1, lineDOM.textContent?.replace(/\u200b/g, '').length ?? to - from)
  const characterWidth = lineRect.width > 0 ? lineRect.width / textLength : 8

  return lineRect.left + offset * characterWidth
}

function resolveLineCursorHeight(lineDOM: HTMLElement, fallbackLineHeight: number): number {
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

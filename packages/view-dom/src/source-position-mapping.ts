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
  const point = caretPointFromDocument(
    lineDOM.ownerDocument,
    event.clientX,
    event.clientY,
    overlayDOM,
  )

  if (point && lineDOM.contains(point.node)) {
    if (point.node.nodeType === Node.TEXT_NODE) {
      const fromText = sourcePositionFromTextNode(
        point.node,
        nearestTextOffsetFromPoint(point.node, point.offset, event.clientX),
        lineDOM,
      )

      if (fromText !== undefined) {
        return fromText
      }
    }

    if (point.node instanceof HTMLElement) {
      const child = point.node.childNodes.item(point.offset)
      const textNode = findNearestTextNode(child, point.node)

      if (textNode) {
        const fromText = sourcePositionFromTextNode(textNode, 0, lineDOM)

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

  const from = Number(lineDOM.dataset.from)
  const to = Number(lineDOM.dataset.to)

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return undefined
  }

  return clamp(from + estimateElementOffsetFromPointer(lineDOM, event), from, to)
}

export function domRectForLineSourcePosition(
  document: Document,
  lineDOM: HTMLElement,
  referenceDOM: HTMLElement,
  position: number,
  options: SourcePositionRectOptions = {},
): ViewRect | undefined {
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

export function sourcePositionToVisualOffsetInLine(
  lineDOM: HTMLElement,
  position: number,
): number {
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

function hasMeasurableLayout(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

function isUsableMeasuredRect(rect: DOMRect, fallbackLineRect: DOMRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    (rect.width > 0 || rect.height > 0)
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

  if (!Number.isFinite(rect.left) || rect.width <= 0) {
    return 0
  }

  const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1)
  return clamp(Math.round(ratio * length), 0, length)
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
  const offset = Number.isInteger(from) && Number.isInteger(to) ? clamp(position, from, to) - from : 0
  const textLength = Math.max(1, lineDOM.textContent?.replace(/\u200b/g, '').length ?? to - from)
  const characterWidth = lineRect.width > 0 ? lineRect.width / textLength : 8

  return lineRect.left + offset * characterWidth
}

function resolveLineCursorHeight(lineDOM: HTMLElement, fallbackLineHeight: number): number {
  const view = lineDOM.ownerDocument.defaultView
  const inlineFontSize = Number.parseFloat(lineDOM.style.fontSize)
  const computedFontSize = view ? Number.parseFloat(view.getComputedStyle(lineDOM).fontSize) : 0
  const fontSize = Number.isFinite(inlineFontSize) && inlineFontSize > 0 ? inlineFontSize : computedFontSize

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

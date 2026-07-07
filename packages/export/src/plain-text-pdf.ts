import { parseInline, parseMarkdown } from '@milkup/markdown'
import type { SourceRange, SyntaxNode } from '@milkup/markdown'

import type { PdfExportProvider } from './scoped-export'

export interface PlainTextPdfOptions {
  readonly pageWidth?: number
  readonly pageHeight?: number
  readonly margin?: number
  readonly fontSize?: number
  readonly lineHeight?: number
}

interface PdfPage {
  readonly lines: readonly string[]
}

interface PdfLayoutOptions {
  readonly pageWidth: number
  readonly pageHeight: number
  readonly margin: number
  readonly fontSize: number
  readonly lineHeight: number
  readonly maxCharsPerLine: number
  readonly maxLinesPerPage: number
}

const DEFAULT_PAGE_WIDTH = 612
const DEFAULT_PAGE_HEIGHT = 792
const DEFAULT_MARGIN = 72
const DEFAULT_FONT_SIZE = 11
const DEFAULT_LINE_HEIGHT = 15

export function createPlainTextPdfProvider(options: PlainTextPdfOptions = {}): PdfExportProvider {
  const layout = normalizeLayoutOptions(options)

  return (input) => {
    const textLines = markdownToPlainTextLines(input.source)
    const pages = paginateLines(textLines.length > 0 ? textLines : [''], layout)

    return writePdf({
      title: input.title,
      pages,
      layout,
    })
  }
}

function markdownToPlainTextLines(source: string): string[] {
  const parsed = parseMarkdown(source)
  const lines: string[] = []

  for (const block of parsed.root.children ?? []) {
    appendBlockLines(source, block, lines)
  }

  return trimTrailingBlankLines(lines)
}

function appendBlockLines(source: string, block: SyntaxNode, lines: string[]): void {
  switch (block.type) {
    case 'blankLine':
      lines.push('')
      return
    case 'heading':
      lines.push(inlineRangesToText(source, block.contentRanges))
      lines.push('')
      return
    case 'paragraph':
      lines.push(inlineRangesToText(source, block.contentRanges))
      lines.push('')
      return
    case 'fencedCode':
    case 'indentedCode':
      lines.push(...joinRanges(source, block.contentRanges).replace(/\n$/u, '').split('\n'))
      lines.push('')
      return
    case 'blockquote':
      appendBlockquoteLines(source, block, lines)
      return
    case 'unorderedList':
      appendListLines(source, block, lines, false)
      return
    case 'orderedList':
      appendListLines(source, block, lines, true)
      return
    case 'table':
      appendTableLines(source, block, lines)
      return
    case 'thematicBreak':
      lines.push('---')
      lines.push('')
      return
    default:
      lines.push(
        block.contentRanges?.length
          ? inlineRangesToText(source, block.contentRanges)
          : source.slice(block.from, block.to),
      )
      lines.push('')
  }
}

function appendBlockquoteLines(source: string, block: SyntaxNode, lines: string[]): void {
  const children = block.children ?? []

  if (children.length === 0) {
    lines.push(`> ${inlineRangesToText(source, block.contentRanges)}`)
    lines.push('')
    return
  }

  for (const child of children) {
    lines.push(`> ${inlineRangesToText(source, child.contentRanges)}`)
  }

  lines.push('')
}

function appendListLines(
  source: string,
  block: SyntaxNode,
  lines: string[],
  ordered: boolean,
): void {
  const start = typeof block.data?.start === 'number' ? block.data.start : 1

  for (const [index, item] of (block.children ?? []).entries()) {
    const marker = ordered ? `${start + index}.` : '-'
    lines.push(`${marker} ${inlineRangesToText(source, item.contentRanges)}`)
  }

  lines.push('')
}

function appendTableLines(source: string, block: SyntaxNode, lines: string[]): void {
  for (const row of block.children ?? []) {
    const cells = (row.children ?? []).map((cell) => inlineRangesToText(source, cell.contentRanges))
    lines.push(cells.join(' | '))
  }

  lines.push('')
}

function inlineRangesToText(source: string, ranges: readonly SourceRange[] | undefined): string {
  return (ranges ?? [])
    .map((range) => inlineNodesToText(source, parseInline(source, range.from, range.to)))
    .join('')
}

function inlineNodesToText(source: string, nodes: readonly SyntaxNode[]): string {
  return nodes.map((node) => inlineNodeToText(source, node)).join('')
}

function inlineNodeToText(source: string, node: SyntaxNode): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return joinRanges(source, node.contentRanges) || source.slice(node.from, node.to)
    case 'escape':
      return String(node.data?.value ?? joinRanges(source, node.contentRanges))
    case 'hardBreak':
      return '\n'
    case 'strong':
    case 'emphasis':
    case 'link':
      return inlineNodesToText(source, node.children ?? [])
    case 'image':
      return typeof node.data?.label === 'string'
        ? node.data.label
        : joinRanges(source, [node.contentRanges?.[0]].filter(isRange))
    case 'autolink':
      return String(node.data?.value ?? '')
    default:
      return node.children?.length
        ? inlineNodesToText(source, node.children)
        : joinRanges(source, node.contentRanges) || source.slice(node.from, node.to)
  }
}

function paginateLines(lines: readonly string[], layout: PdfLayoutOptions): PdfPage[] {
  const pages: PdfPage[] = []
  let pageLines: string[] = []

  for (const line of lines) {
    const wrappedLines = wrapLine(line, layout.maxCharsPerLine)

    for (const wrappedLine of wrappedLines) {
      if (pageLines.length >= layout.maxLinesPerPage) {
        pages.push({ lines: pageLines })
        pageLines = []
      }

      pageLines.push(wrappedLine)
    }
  }

  if (pageLines.length > 0 || pages.length === 0) {
    pages.push({ lines: pageLines })
  }

  return pages
}

function wrapLine(line: string, maxCharsPerLine: number): string[] {
  if (line.length <= maxCharsPerLine) {
    return [line]
  }

  const result: string[] = []
  let remaining = line

  while (remaining.length > maxCharsPerLine) {
    const breakpoint = remaining.lastIndexOf(' ', maxCharsPerLine)
    const splitAt = breakpoint > maxCharsPerLine * 0.5 ? breakpoint : maxCharsPerLine

    result.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }

  result.push(remaining)
  return result
}

function writePdf(input: {
  readonly title: string
  readonly pages: readonly PdfPage[]
  readonly layout: PdfLayoutOptions
}): Uint8Array {
  const catalogObjectId = 1
  const fontObjectId = 3
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const pageObjectIds: number[] = []

  for (const page of input.pages) {
    const contentObjectId = addObject(objects, renderPageContent(page, input.layout))
    const pageObjectId = addObject(
      objects,
      [
        '<< /Type /Page',
        '/Parent 2 0 R',
        `/MediaBox [0 0 ${input.layout.pageWidth} ${input.layout.pageHeight}]`,
        `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >>`,
        `/Contents ${contentObjectId} 0 R`,
        '>>',
      ].join(' '),
    )

    pageObjectIds.push(pageObjectId)
  }

  objects[1] = [
    '<< /Type /Pages',
    `/Count ${pageObjectIds.length}`,
    `/Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}]`,
    '>>',
  ].join(' ')

  const infoObjectId = objects.length + 1
  objects.push(`<< /Title ${pdfString(input.title)} /Producer ${pdfString('milkup export')} >>`)

  return encodePdf(catalogObjectId, infoObjectId, objects)
}

function renderPageContent(page: PdfPage, layout: PdfLayoutOptions): string {
  const startY = layout.pageHeight - layout.margin
  const lines = [
    'BT',
    `/F1 ${layout.fontSize} Tf`,
    `${layout.margin} ${startY} Td`,
    `${layout.lineHeight} TL`,
  ]

  for (const line of page.lines) {
    lines.push(`${pdfString(line)} Tj`)
    lines.push('T*')
  }

  lines.push('ET')

  const content = lines.join('\n')
  return `<< /Length ${asciiByteLength(content)} >>\nstream\n${content}\nendstream`
}

function addObject(objects: string[], content: string): number {
  objects.push(content)
  return objects.length
}

function encodePdf(
  catalogObjectId: number,
  infoObjectId: number,
  objects: readonly string[],
): Uint8Array {
  const chunks: string[] = ['%PDF-1.4\n']
  const offsets = [0]

  for (const [index, object] of objects.entries()) {
    offsets.push(asciiByteLength(chunks.join('')))
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`)
  }

  const xrefOffset = asciiByteLength(chunks.join(''))
  chunks.push(`xref\n0 ${objects.length + 1}\n`)
  chunks.push('0000000000 65535 f \n')

  for (const offset of offsets.slice(1)) {
    chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  }

  chunks.push(
    [
      'trailer',
      `<< /Size ${objects.length + 1} /Root ${catalogObjectId} 0 R /Info ${infoObjectId} 0 R >>`,
      'startxref',
      String(xrefOffset),
      '%%EOF',
      '',
    ].join('\n'),
  )

  return new TextEncoder().encode(chunks.join(''))
}

function pdfString(value: string): string {
  return `(${value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll('\r', '')
    .replaceAll('\n', '\\n')})`
}

function normalizeLayoutOptions(options: PlainTextPdfOptions): PdfLayoutOptions {
  const pageWidth = options.pageWidth ?? DEFAULT_PAGE_WIDTH
  const pageHeight = options.pageHeight ?? DEFAULT_PAGE_HEIGHT
  const margin = options.margin ?? DEFAULT_MARGIN
  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE
  const lineHeight = options.lineHeight ?? DEFAULT_LINE_HEIGHT
  const textWidth = Math.max(1, pageWidth - margin * 2)
  const textHeight = Math.max(1, pageHeight - margin * 2)

  return {
    pageWidth,
    pageHeight,
    margin,
    fontSize,
    lineHeight,
    maxCharsPerLine: Math.max(10, Math.floor(textWidth / (fontSize * 0.55))),
    maxLinesPerPage: Math.max(1, Math.floor(textHeight / lineHeight)),
  }
}

function trimTrailingBlankLines(lines: readonly string[]): string[] {
  const result = [...lines]

  while (result.at(-1) === '') {
    result.pop()
  }

  return result
}

function joinRanges(source: string, ranges: readonly SourceRange[] | undefined): string {
  return (ranges ?? []).map((range) => source.slice(range.from, range.to)).join('')
}

function isRange(range: SourceRange | undefined): range is SourceRange {
  return range !== undefined
}

function asciiByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

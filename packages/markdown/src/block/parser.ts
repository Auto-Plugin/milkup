import { createNode, type SyntaxNode } from '../cst/node'
import {
  compileMarkdownSyntaxPattern,
  runMarkdownExtensionSafely,
  type MarkdownSyntaxExtension,
} from '../extensions/safe'
import { scanLines, type SourceLine } from './lines'

export interface MarkdownParseResult {
  readonly source: string
  readonly root: SyntaxNode
}

export interface MarkdownParseOptions {
  readonly syntaxExtensions?: readonly MarkdownSyntaxExtension[]
}

export function parseMarkdown(
  source: string,
  options: MarkdownParseOptions = {},
): MarkdownParseResult {
  try {
    return {
      source,
      root: createNode({
        type: 'document',
        from: 0,
        to: source.length,
        status: 'valid',
        children: parseBlocks(source, options.syntaxExtensions ?? []),
      }),
    }
  } catch {
    return {
      source,
      root: createNode({
        type: 'document',
        from: 0,
        to: source.length,
        status: 'fallback',
        children:
          source.length > 0
            ? [
                createNode({
                  type: 'fallbackText',
                  from: 0,
                  to: source.length,
                  status: 'fallback',
                  contentRanges: [{ from: 0, to: source.length }],
                }),
              ]
            : [],
      }),
    }
  }
}

function parseBlocks(
  source: string,
  extensions: readonly MarkdownSyntaxExtension[],
): readonly SyntaxNode[] {
  const lines = scanLines(source)
  const nodes: SyntaxNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line) {
      break
    }

    if (isBlankLine(line)) {
      nodes.push(parseBlankLine(line))
      index += 1
      continue
    }

    const extensionBlock = parseExtensionBlock(line, extensions)

    if (extensionBlock) {
      nodes.push(extensionBlock)
      index += 1
      continue
    }

    const fencedCode = parseFencedCode(lines, index)

    if (fencedCode) {
      nodes.push(fencedCode.node)
      index = fencedCode.nextIndex
      continue
    }

    const indentedCode = parseIndentedCode(lines, index)

    if (indentedCode) {
      nodes.push(indentedCode.node)
      index = indentedCode.nextIndex
      continue
    }

    const blockquote = parseBlockquote(lines, index)

    if (blockquote) {
      nodes.push(blockquote.node)
      index = blockquote.nextIndex
      continue
    }

    const thematicBreak = parseThematicBreak(line)

    if (thematicBreak) {
      nodes.push(thematicBreak)
      index += 1
      continue
    }

    const heading = parseAtxHeading(line)

    if (heading) {
      nodes.push(heading)
      index += 1
      continue
    }

    const table = parseTable(lines, index)

    if (table) {
      nodes.push(table.node)
      index = table.nextIndex
      continue
    }

    const list = parseList(lines, index)

    if (list) {
      nodes.push(list.node)
      index = list.nextIndex
      continue
    }

    const paragraph = collectParagraph(lines, index, extensions)
    nodes.push(parseParagraph(source, paragraph, extensions))
    index += paragraph.length
  }

  return Object.freeze(nodes)
}

function parseExtensionBlock(
  line: SourceLine,
  extensions: readonly MarkdownSyntaxExtension[],
): SyntaxNode | undefined {
  for (const extension of extensions) {
    if (!extension.block) {
      continue
    }

    const result = runMarkdownExtensionSafely({ extensionName: extension.id, hook: 'block' }, () =>
      compileMarkdownSyntaxPattern(extension).exec(line.text),
    )
    const match = result.ok ? result.value : undefined

    if (!match) {
      continue
    }

    const from = line.from + match.index
    const to = from + match[0].length
    return createNode({
      type: extension.nodeType,
      from,
      to,
      status: 'valid',
      contentRanges: [{ from, to }],
      data: { extensionId: extension.id },
    })
  }

  return undefined
}

function isBlankLine(line: SourceLine): boolean {
  return line.text.trim().length === 0
}

function parseBlankLine(line: SourceLine): SyntaxNode {
  return createNode({
    type: 'blankLine',
    from: line.from,
    to: line.to,
    status: 'valid',
    contentRanges: [],
  })
}

function parseAtxHeading(line: SourceLine): SyntaxNode | undefined {
  const match = /^( {0,3})(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line.text)

  if (!match) {
    return undefined
  }

  const indent = match[1]?.length ?? 0
  const marker = match[2]

  if (!marker) {
    return undefined
  }

  const markerFrom = line.from + indent
  const markerTo = markerFrom + marker.length
  const contentFrom = findHeadingContentStart(line.text, markerTo - line.from)
  const contentRange = { from: line.from + contentFrom, to: line.contentTo }

  return createNode({
    type: 'heading',
    from: line.from,
    to: line.to,
    status: 'valid',
    markerRanges: [{ from: markerFrom, to: markerTo }],
    contentRanges: contentRange.from <= contentRange.to ? [contentRange] : [],
    data: { level: marker.length },
  })
}

interface BlockParseResult {
  readonly node: SyntaxNode
  readonly nextIndex: number
}

function parseFencedCode(
  lines: readonly SourceLine[],
  startIndex: number,
): BlockParseResult | undefined {
  const opener = lines[startIndex]

  if (!opener) {
    return undefined
  }

  const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(opener.text)

  if (!opening) {
    return undefined
  }

  const indent = opening[1]?.length ?? 0
  const fence = opening[2]
  const info = opening[3]?.trim() ?? ''

  if (!fence) {
    return undefined
  }

  const fenceChar = fence[0]

  if (!fenceChar) {
    return undefined
  }
  const fenceLength = fence.length
  const openingMarkerFrom = opener.from + indent
  const openingMarkerTo = openingMarkerFrom + fenceLength
  let closingLine: SourceLine | undefined
  let closingMarkerFrom: number | undefined
  let closingMarkerTo: number | undefined
  let nextIndex = lines.length

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]

    if (!line) {
      break
    }

    const closing = matchClosingFence(line, fenceChar, fenceLength)

    if (closing) {
      closingLine = line
      closingMarkerFrom = line.from + closing.indent
      closingMarkerTo = closingMarkerFrom + closing.length
      nextIndex = index + 1
      break
    }
  }

  const lastLine = closingLine ?? lines[lines.length - 1] ?? opener
  const contentFrom = opener.to
  const contentTo = closingLine ? closingLine.from : lastLine.to
  const markerRanges =
    closingMarkerFrom !== undefined && closingMarkerTo !== undefined
      ? [
          { from: openingMarkerFrom, to: openingMarkerTo },
          { from: closingMarkerFrom, to: closingMarkerTo },
        ]
      : [{ from: openingMarkerFrom, to: openingMarkerTo }]

  return {
    node: createNode({
      type: 'fencedCode',
      from: opener.from,
      to: lastLine.to,
      status: closingLine ? 'valid' : 'incomplete',
      markerRanges,
      contentRanges: [{ from: contentFrom, to: contentTo }],
      data: { fenceChar, fenceLength, info },
    }),
    nextIndex,
  }
}

function matchClosingFence(
  line: SourceLine,
  fenceChar: string,
  fenceLength: number,
): { readonly indent: number; readonly length: number } | undefined {
  const escaped = fenceChar === '`' ? '`' : '~'
  const pattern = new RegExp(`^( {0,3})(${escaped}{${fenceLength},})[ \\t]*$`)
  const match = pattern.exec(line.text)

  if (!match) {
    return undefined
  }

  return {
    indent: match[1]?.length ?? 0,
    length: match[2]?.length ?? fenceLength,
  }
}

function parseIndentedCode(
  lines: readonly SourceLine[],
  startIndex: number,
): BlockParseResult | undefined {
  const first = lines[startIndex]

  if (!first || !isIndentedCodeLine(first)) {
    return undefined
  }

  const codeLines: SourceLine[] = []
  let nextIndex = startIndex

  while (nextIndex < lines.length) {
    const line = lines[nextIndex]

    if (!line || !isIndentedCodeLine(line)) {
      break
    }

    codeLines.push(line)
    nextIndex += 1
  }

  const last = codeLines[codeLines.length - 1] ?? first

  return {
    node: createNode({
      type: 'indentedCode',
      from: first.from,
      to: last.to,
      status: 'valid',
      markerRanges: codeLines.map((line) => ({ from: line.from, to: line.from + 4 })),
      contentRanges: codeLines.map((line) => ({ from: line.from + 4, to: line.contentTo })),
    }),
    nextIndex,
  }
}

function isIndentedCodeLine(line: SourceLine): boolean {
  return line.text.startsWith('    ')
}

function parseBlockquote(
  lines: readonly SourceLine[],
  startIndex: number,
): BlockParseResult | undefined {
  const first = parseBlockquoteLine(lines[startIndex])

  if (!first) {
    return undefined
  }

  const children: SyntaxNode[] = [first]
  let nextIndex = startIndex + 1

  while (nextIndex < lines.length) {
    const child = parseBlockquoteLine(lines[nextIndex])

    if (!child) {
      break
    }

    children.push(child)
    nextIndex += 1
  }

  const last = children[children.length - 1] ?? first

  return {
    node: createNode({
      type: 'blockquote',
      from: first.from,
      to: last.to,
      status: 'valid',
      markerRanges: children.flatMap((child) => child.markerRanges ?? []),
      contentRanges: children.flatMap((child) => child.contentRanges ?? []),
      children,
    }),
    nextIndex,
  }
}

function parseBlockquoteLine(line: SourceLine | undefined): SyntaxNode | undefined {
  if (!line) {
    return undefined
  }

  const match = /^( {0,3})>(?:[ \t]?)(.*)$/.exec(line.text)

  if (!match) {
    return undefined
  }

  const indent = match[1]?.length ?? 0
  const markerFrom = line.from + indent
  const markerTo = markerFrom + 1
  const contentFrom = findBlockquoteContentStart(line.text, markerTo - line.from)

  return createNode({
    type: 'blockquoteLine',
    from: line.from,
    to: line.to,
    status: 'valid',
    markerRanges: [{ from: markerFrom, to: markerTo }],
    contentRanges: [{ from: line.from + contentFrom, to: line.contentTo }],
  })
}

function findBlockquoteContentStart(text: string, markerEnd: number): number {
  let pos = markerEnd

  if (text[pos] === ' ' || text[pos] === '\t') {
    pos += 1
  }

  return pos
}

function parseThematicBreak(line: SourceLine): SyntaxNode | undefined {
  const match = /^( {0,3})((?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.exec(line.text)

  if (!match) {
    return undefined
  }

  const indent = match[1]?.length ?? 0

  return createNode({
    type: 'thematicBreak',
    from: line.from,
    to: line.to,
    status: 'valid',
    markerRanges: [{ from: line.from + indent, to: line.contentTo }],
  })
}

type ListKind = 'unordered' | 'ordered'

interface ListItemParse {
  readonly kind: ListKind
  readonly node: SyntaxNode
  readonly start?: number
}

function parseList(lines: readonly SourceLine[], startIndex: number): BlockParseResult | undefined {
  const first = parseListItem(lines[startIndex])

  if (!first) {
    return undefined
  }

  const items: SyntaxNode[] = [first.node]
  let nextIndex = startIndex + 1

  while (nextIndex < lines.length) {
    const item = parseListItem(lines[nextIndex])

    if (!item || item.kind !== first.kind) {
      break
    }

    items.push(item.node)
    nextIndex += 1
  }

  const last = items[items.length - 1] ?? first.node

  return {
    node: createNode({
      type: first.kind === 'ordered' ? 'orderedList' : 'unorderedList',
      from: first.node.from,
      to: last.to,
      status: 'valid',
      children: items,
      data: first.kind === 'ordered' ? { start: first.start ?? 1 } : {},
    }),
    nextIndex,
  }
}

function parseListItem(line: SourceLine | undefined): ListItemParse | undefined {
  if (!line || isBlankLine(line) || parseThematicBreak(line)) {
    return undefined
  }

  const unordered = /^( {0,3})([-+*])(?:[ \t]+|$)(.*)$/.exec(line.text)

  if (unordered) {
    const indent = unordered[1]?.length ?? 0
    const marker = unordered[2]

    if (!marker) {
      return undefined
    }

    const markerFrom = line.from + indent
    const markerTo = markerFrom + marker.length
    const contentFrom = findListContentStart(line.text, markerTo - line.from)

    return {
      kind: 'unordered',
      node: createNode({
        type: 'listItem',
        from: line.from,
        to: line.to,
        status: 'valid',
        markerRanges: [{ from: markerFrom, to: markerTo }],
        contentRanges: [{ from: line.from + contentFrom, to: line.contentTo }],
        data: { marker },
      }),
    }
  }

  const ordered = /^( {0,3})(\d{1,9})([.)])(?:[ \t]+|$)(.*)$/.exec(line.text)

  if (!ordered) {
    return undefined
  }

  const indent = ordered[1]?.length ?? 0
  const numberText = ordered[2]
  const delimiter = ordered[3]

  if (!numberText || !delimiter) {
    return undefined
  }

  const markerFrom = line.from + indent
  const markerTo = markerFrom + numberText.length + delimiter.length
  const contentFrom = findListContentStart(line.text, markerTo - line.from)

  return {
    kind: 'ordered',
    start: Number.parseInt(numberText, 10),
    node: createNode({
      type: 'listItem',
      from: line.from,
      to: line.to,
      status: 'valid',
      markerRanges: [{ from: markerFrom, to: markerTo }],
      contentRanges: [{ from: line.from + contentFrom, to: line.contentTo }],
      data: { number: Number.parseInt(numberText, 10), delimiter },
    }),
  }
}

function findListContentStart(text: string, markerEnd: number): number {
  let pos = markerEnd

  while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t')) {
    pos += 1
  }

  return pos
}

function findHeadingContentStart(text: string, markerEnd: number): number {
  let pos = markerEnd

  while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t')) {
    pos += 1
  }

  return pos
}

function parseTable(
  lines: readonly SourceLine[],
  startIndex: number,
): BlockParseResult | undefined {
  const header = parseTableRow(lines[startIndex])
  const delimiterLine = lines[startIndex + 1]
  const delimiter = parseTableDelimiterRow(delimiterLine)

  if (!header || !delimiter || header.cells.length < 2) {
    return undefined
  }

  const rows: SyntaxNode[] = [header.node]
  let nextIndex = startIndex + 2

  while (nextIndex < lines.length) {
    const row = parseTableRow(lines[nextIndex])

    if (!row || row.cells.length === 0) {
      break
    }

    rows.push(row.node)
    nextIndex += 1
  }

  const last = rows[rows.length - 1] ?? header.node

  return {
    node: createNode({
      type: 'table',
      from: header.node.from,
      to: last.to,
      status: 'valid',
      children: rows,
      data: {
        alignments: delimiter.alignments,
      },
    }),
    nextIndex,
  }
}

interface TableRowParse {
  readonly node: SyntaxNode
  readonly line: SourceLine
  readonly cells: readonly SyntaxNode[]
}

function parseTableRow(line: SourceLine | undefined): TableRowParse | undefined {
  if (!line || !line.text.includes('|')) {
    return undefined
  }

  const cells = splitTableCells(line)

  if (cells.length === 0) {
    return undefined
  }

  const children = cells.map((cell) =>
    createNode({
      type: 'tableCell',
      from: cell.from,
      to: cell.to,
      status: 'valid',
      contentRanges: [{ from: cell.from, to: cell.to }],
    }),
  )

  return {
    cells: children,
    line,
    node: createNode({
      type: 'tableRow',
      from: line.from,
      to: line.to,
      status: 'valid',
      children,
      contentRanges: children.flatMap((cell) => cell.contentRanges ?? []),
    }),
  }
}

interface TableDelimiterParse {
  readonly alignments: readonly TableAlignment[]
}

type TableAlignment = 'left' | 'center' | 'right' | undefined

function parseTableDelimiterRow(line: SourceLine | undefined): TableDelimiterParse | undefined {
  const row = parseTableRow(line)

  if (!row) {
    return undefined
  }

  const parsedAlignments = row.cells.map((cell) => parseTableDelimiterCell(row.line, cell))

  if (parsedAlignments.some((alignment) => alignment === false)) {
    return undefined
  }

  return {
    alignments: parsedAlignments.map((alignment) =>
      alignment === true || alignment === false ? undefined : alignment,
    ),
  }
}

function parseTableDelimiterCell(line: SourceLine, cell: SyntaxNode): TableAlignment | boolean {
  const text = line.text.slice(cell.from - line.from, cell.to - line.from).trim()

  if (!/^:?-{3,}:?$/.test(text)) {
    return false
  }

  const left = text.startsWith(':')
  const right = text.endsWith(':')

  if (left && right) {
    return 'center'
  }

  if (right) {
    return 'right'
  }

  if (left) {
    return 'left'
  }

  return true
}

interface TableCellRange {
  readonly from: number
  readonly to: number
}

function splitTableCells(line: SourceLine): readonly TableCellRange[] {
  const ranges: TableCellRange[] = []
  const text = line.text
  const startsWithPipe = text.trimStart().startsWith('|')
  const endsWithPipe = text.trimEnd().endsWith('|')
  const start = startsWithPipe ? text.indexOf('|') + 1 : 0
  const end = endsWithPipe ? text.lastIndexOf('|') : text.length
  let cellStart = start
  let pos = start

  while (pos <= end) {
    const atCellEnd = pos === end
    const char = text[pos]
    const escaped = pos > 0 && text[pos - 1] === '\\'

    if (atCellEnd || (char === '|' && !escaped)) {
      ranges.push(trimTableCellRange(line.from + cellStart, line.from + pos, text, line.from))
      cellStart = pos + 1
    }

    pos += 1
  }

  return Object.freeze(ranges)
}

function trimTableCellRange(
  from: number,
  to: number,
  lineText: string,
  lineFrom: number,
): TableCellRange {
  let start = from
  let end = to

  while (start < end && /\s/.test(lineText[start - lineFrom] ?? '')) {
    start += 1
  }

  while (end > start && /\s/.test(lineText[end - lineFrom - 1] ?? '')) {
    end -= 1
  }

  return Object.freeze({ from: start, to: end })
}

function collectParagraph(
  lines: readonly SourceLine[],
  startIndex: number,
  extensions: readonly MarkdownSyntaxExtension[],
): readonly SourceLine[] {
  const paragraph: SourceLine[] = []

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index]

    if (
      !line ||
      isBlankLine(line) ||
      parseFencedCode(lines, index) ||
      parseIndentedCode(lines, index) ||
      parseBlockquote(lines, index) ||
      parseThematicBreak(line) ||
      parseAtxHeading(line) ||
      parseTable(lines, index) ||
      parseList(lines, index) ||
      parseExtensionBlock(line, extensions)
    ) {
      break
    }

    paragraph.push(line)
  }

  return paragraph
}

function parseParagraph(
  source: string,
  lines: readonly SourceLine[],
  extensions: readonly MarkdownSyntaxExtension[],
): SyntaxNode {
  const first = lines[0]
  const last = lines[lines.length - 1]

  if (!first || !last) {
    return createNode({
      type: 'paragraph',
      from: 0,
      to: 0,
      status: 'fallback',
      contentRanges: [],
    })
  }

  return createNode({
    type: 'paragraph',
    from: first.from,
    to: last.to,
    status: 'valid',
    contentRanges: [{ from: first.from, to: last.contentTo }],
    children: parseInlineExtensions(source, first.from, last.contentTo, extensions),
  })
}

function parseInlineExtensions(
  source: string,
  from: number,
  to: number,
  extensions: readonly MarkdownSyntaxExtension[],
): readonly SyntaxNode[] {
  const nodes: SyntaxNode[] = []
  const text = source.slice(from, to)

  for (const extension of extensions) {
    if (!extension.inline) {
      continue
    }

    const result = runMarkdownExtensionSafely(
      { extensionName: extension.id, hook: 'inline' },
      () => {
        const base = compileMarkdownSyntaxPattern(extension)
        const pattern = new RegExp(base.source, `${base.flags}g`)
        return [...text.matchAll(pattern)]
      },
    )

    if (!result.ok) {
      continue
    }

    for (const match of result.value) {
      const matchFrom = from + (match.index ?? 0)
      const matchTo = matchFrom + match[0].length

      if (matchTo <= matchFrom) {
        continue
      }

      nodes.push(
        createNode({
          type: extension.nodeType,
          from: matchFrom,
          to: matchTo,
          status: 'valid',
          contentRanges: [{ from: matchFrom, to: matchTo }],
          data: { extensionId: extension.id },
        }),
      )
    }
  }

  return Object.freeze(nodes.sort((left, right) => left.from - right.from || left.to - right.to))
}

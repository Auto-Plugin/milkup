import type { MarkdownAstDocument, MarkdownAstNode } from '../ast/tree'

export interface StringifyMarkdownAstOptions {
  readonly preserveSource?: boolean
}

export function stringifyMarkdownAst(
  node: MarkdownAstNode | MarkdownAstDocument,
  options: StringifyMarkdownAstOptions = {},
): string {
  const preserveSource = options.preserveSource ?? true

  if (preserveSource) {
    if (node.type === 'document' && 'source' in node) {
      return node.source
    }

    if (node.raw.length > 0 || node.from === node.to) {
      return node.raw
    }
  }

  return stringifyNode(node, options)
}

function stringifyNode(node: MarkdownAstNode, options: StringifyMarkdownAstOptions): string {
  switch (node.type) {
    case 'document':
      return stringifyChildren(node, options)
    case 'blankLine':
      return '\n'
    case 'heading':
      return `${'#'.repeat(readNumber(node.data?.level, 1))} ${readText(node)}\n`
    case 'paragraph':
      return `${readText(node)}\n`
    case 'fencedCode':
      return stringifyFencedCode(node)
    case 'indentedCode':
      return readText(node)
        .split('\n')
        .map((line) => (line.length > 0 ? `    ${line}` : line))
        .join('\n')
    case 'blockquote':
      return stringifyBlockquote(node, options)
    case 'unorderedList':
      return stringifyList(node, options, false)
    case 'orderedList':
      return stringifyList(node, options, true)
    case 'listItem':
      return `${readText(node)}\n`
    case 'thematicBreak':
      return '---\n'
    case 'table':
      return stringifyChildren(node, options)
    case 'tableRow':
      return `| ${(node.children ?? []).map(readText).join(' | ')} |\n`
    default:
      if ((node.children?.length ?? 0) > 0) {
        return stringifyChildren(node, options)
      }

      return readText(node) || node.raw
  }
}

function stringifyChildren(node: MarkdownAstNode, options: StringifyMarkdownAstOptions): string {
  return (node.children ?? []).map((child) => stringifyMarkdownAst(child, options)).join('')
}

function stringifyFencedCode(node: MarkdownAstNode): string {
  const fenceChar = typeof node.data?.fenceChar === 'string' ? node.data.fenceChar : '`'
  const fenceLength = readNumber(node.data?.fenceLength, 3)
  const info =
    typeof node.data?.info === 'string' && node.data.info.length > 0 ? node.data.info : ''
  const fence = fenceChar.repeat(fenceLength)
  const text = readText(node)
  const trailingNewline = text.endsWith('\n') ? '' : '\n'

  return `${fence}${info}\n${text}${trailingNewline}${fence}\n`
}

function stringifyBlockquote(node: MarkdownAstNode, options: StringifyMarkdownAstOptions): string {
  const body =
    stringifyChildren(node, { ...options, preserveSource: false }) || `${readText(node)}\n`

  return body
    .split('\n')
    .map((line, index, lines) => {
      if (index === lines.length - 1 && line.length === 0) {
        return ''
      }

      return line.length > 0 ? `> ${line}` : '>'
    })
    .join('\n')
}

function stringifyList(
  node: MarkdownAstNode,
  options: StringifyMarkdownAstOptions,
  ordered: boolean,
): string {
  const start = readNumber(node.data?.start, 1)

  return (node.children ?? [])
    .map((child, index) => {
      const marker = ordered ? `${start + index}.` : '-'
      return `${marker} ${readText(child) || stringifyMarkdownAst(child, { ...options, preserveSource: false }).trim()}\n`
    })
    .join('')
}

function readText(node: MarkdownAstNode): string {
  if (node.text !== undefined) {
    return node.text
  }

  if ((node.inlineChildren?.length ?? 0) > 0) {
    return (node.inlineChildren ?? []).map(readText).join('')
  }

  return ''
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

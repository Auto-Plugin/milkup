import { parseInline, parseMarkdown } from '@milkup/markdown'
import type { SourceRange, SyntaxNode } from '@milkup/markdown'

export type ExportUrlKind = 'link' | 'image'
export type ExportUrlResolver = (url: string, kind: ExportUrlKind) => string

export interface RenderMarkdownHtmlOptions {
  readonly title?: string
  readonly resolveUrl?: ExportUrlResolver
  readonly themeStyles?: string
}

interface RenderContext {
  readonly resolveUrl?: ExportUrlResolver
}

export function renderMarkdownDocumentHtml(
  source: string,
  options: RenderMarkdownHtmlOptions = {},
): string {
  const parsed = parseMarkdown(source)
  const title = escapeHtml(options.title ?? 'Document')
  const context: RenderContext = {
    ...(options.resolveUrl ? { resolveUrl: options.resolveUrl } : {}),
  }
  const body = renderBlocks(source, parsed.root.children ?? [], context)

  const styles = options.themeStyles ? `<style>${escapeStyleText(options.themeStyles)}</style>` : ''

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${styles}</head><body>${body}</body></html>`
}

function renderBlocks(
  source: string,
  blocks: readonly SyntaxNode[],
  context: RenderContext,
): string {
  return blocks.map((block) => renderBlock(source, block, context)).join('')
}

function renderBlock(source: string, block: SyntaxNode, context: RenderContext): string {
  switch (block.type) {
    case 'blankLine':
      return ''
    case 'heading':
      return renderHeading(source, block, context)
    case 'paragraph': {
      const math = tryRenderMathPlaceholder(source, block)

      if (math) {
        return math
      }

      return `<p>${renderInlineRanges(source, block.contentRanges, context)}</p>`
    }
    case 'fencedCode':
    case 'indentedCode':
      return renderCodeBlock(source, block)
    case 'blockquote':
      return `<blockquote>${renderBlockquote(source, block, context)}</blockquote>`
    case 'table':
      return renderTable(source, block, context)
    case 'unorderedList':
      return `<ul>${renderListItems(source, block.children ?? [], context)}</ul>`
    case 'orderedList':
      return renderOrderedList(source, block, context)
    case 'thematicBreak':
      return '<hr>'
    case 'fallbackText':
      return `<p>${escapeHtml(source.slice(block.from, block.to))}</p>`
    default:
      return renderUnknownBlock(source, block, context)
  }
}

function renderHeading(source: string, block: SyntaxNode, context: RenderContext): string {
  const rawLevel = block.data?.level
  const level = typeof rawLevel === 'number' ? clamp(rawLevel, 1, 6) : 1

  return `<h${level}>${renderInlineRanges(source, block.contentRanges, context)}</h${level}>`
}

function renderCodeBlock(source: string, block: SyntaxNode): string {
  const info = typeof block.data?.info === 'string' ? block.data.info.trim() : ''
  const language = info.length > 0 ? info.split(/\s+/, 1)[0] : ''
  const className = language ? ` class="language-${escapeHtmlAttribute(language)}"` : ''
  const code = escapeHtml(joinRanges(source, block.contentRanges).replace(/\n$/g, ''))

  return `<pre><code${className}>${code}</code></pre>`
}

function renderTable(source: string, block: SyntaxNode, context: RenderContext): string {
  const rows = block.children ?? []
  const [header, ...body] = rows
  const alignments = Array.isArray(block.data?.alignments) ? block.data.alignments : []

  if (!header) {
    return ''
  }

  return [
    '<table>',
    '<thead>',
    renderTableRow(source, header, context, 'th', alignments),
    '</thead>',
    body.length > 0
      ? `<tbody>${body.map((row) => renderTableRow(source, row, context, 'td', alignments)).join('')}</tbody>`
      : '',
    '</table>',
  ].join('')
}

function renderTableRow(
  source: string,
  row: SyntaxNode,
  context: RenderContext,
  cellTag: 'td' | 'th',
  alignments: readonly unknown[],
): string {
  const cells = row.children ?? []

  return `<tr>${cells
    .map((cell, index) => {
      const align = normalizeAlignment(alignments[index])
      const alignAttribute = align ? ` style="text-align:${align}"` : ''
      return `<${cellTag}${alignAttribute}>${renderInlineRanges(source, cell.contentRanges, context)}</${cellTag}>`
    })
    .join('')}</tr>`
}

function normalizeAlignment(value: unknown): 'left' | 'center' | 'right' | undefined {
  return value === 'left' || value === 'center' || value === 'right' ? value : undefined
}

function renderBlockquote(source: string, block: SyntaxNode, context: RenderContext): string {
  const lines = block.children?.length ? block.children : []

  if (lines.length === 0) {
    return `<p>${renderInlineRanges(source, block.contentRanges, context)}</p>`
  }

  return lines
    .map((line) => `<p>${renderInlineRanges(source, line.contentRanges, context)}</p>`)
    .join('')
}

function renderOrderedList(source: string, block: SyntaxNode, context: RenderContext): string {
  const start = typeof block.data?.start === 'number' && block.data.start !== 1
  const startAttribute = start ? ` start="${block.data?.start}"` : ''

  return `<ol${startAttribute}>${renderListItems(source, block.children ?? [], context)}</ol>`
}

function renderListItems(
  source: string,
  items: readonly SyntaxNode[],
  context: RenderContext,
): string {
  return items
    .map((item) => `<li>${renderInlineRanges(source, item.contentRanges, context)}</li>`)
    .join('')
}

function renderUnknownBlock(source: string, block: SyntaxNode, context: RenderContext): string {
  if ((block.contentRanges?.length ?? 0) > 0) {
    return `<p>${renderInlineRanges(source, block.contentRanges, context)}</p>`
  }

  return `<p>${escapeHtml(source.slice(block.from, block.to))}</p>`
}

function tryRenderMathPlaceholder(source: string, block: SyntaxNode): string | undefined {
  if (block.type !== 'paragraph') {
    return undefined
  }

  const text = joinRanges(source, block.contentRanges).trim()
  const blockMath = /^\$\$\s*([\s\S]*?)\s*\$\$$/.exec(text)

  if (blockMath) {
    return `<div class="math math-display" data-math="${escapeHtmlAttribute(blockMath[1] ?? '')}">${escapeHtml(blockMath[1] ?? '')}</div>`
  }

  const inlineMath = /^\$\s*([^$]+?)\s*\$$/.exec(text)

  if (inlineMath) {
    return `<p><span class="math math-inline" data-math="${escapeHtmlAttribute(inlineMath[1] ?? '')}">${escapeHtml(inlineMath[1] ?? '')}</span></p>`
  }

  return undefined
}

function renderInlineRanges(
  source: string,
  ranges: readonly SourceRange[] | undefined,
  context: RenderContext,
): string {
  if (!ranges || ranges.length === 0) {
    return ''
  }

  return ranges
    .map((range) => renderInlineNodes(source, parseInline(source, range.from, range.to), context))
    .join('')
}

function renderInlineNodes(
  source: string,
  nodes: readonly SyntaxNode[],
  context: RenderContext,
): string {
  return nodes.map((node) => renderInlineNode(source, node, context)).join('')
}

function renderInlineNode(source: string, node: SyntaxNode, context: RenderContext): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(joinRanges(source, node.contentRanges) || source.slice(node.from, node.to))
    case 'escape':
      return escapeHtml(String(node.data?.value ?? joinRanges(source, node.contentRanges)))
    case 'hardBreak':
      return '<br>'
    case 'inlineCode':
      return `<code>${escapeHtml(joinRanges(source, node.contentRanges))}</code>`
    case 'strong':
      return `<strong>${renderInlineNodes(source, node.children ?? [], context)}</strong>`
    case 'emphasis':
      return `<em>${renderInlineNodes(source, node.children ?? [], context)}</em>`
    case 'link':
      return renderLink(source, node, context)
    case 'image':
      return renderImage(source, node, context)
    case 'autolink':
      return renderAutolink(node, context)
    default:
      return escapeHtml(joinRanges(source, node.contentRanges) || source.slice(node.from, node.to))
  }
}

function renderLink(source: string, node: SyntaxNode, context: RenderContext): string {
  const destination =
    typeof node.data?.destination === 'string'
      ? node.data.destination
      : joinRanges(source, [node.contentRanges?.[1]].filter(isRange))
  const href = context.resolveUrl?.(destination, 'link') ?? destination
  const label = renderInlineNodes(source, node.children ?? [], context)

  return `<a href="${escapeHtmlAttribute(href)}">${label}</a>`
}

function renderImage(source: string, node: SyntaxNode, context: RenderContext): string {
  const destination =
    typeof node.data?.destination === 'string'
      ? node.data.destination
      : joinRanges(source, [node.contentRanges?.[1]].filter(isRange))
  const alt =
    typeof node.data?.label === 'string'
      ? node.data.label
      : joinRanges(source, [node.contentRanges?.[0]].filter(isRange))
  const src = context.resolveUrl?.(destination, 'image') ?? destination

  return `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}">`
}

function renderAutolink(node: SyntaxNode, context: RenderContext): string {
  const value = String(node.data?.value ?? '')
  const href = node.data?.kind === 'email' ? `mailto:${value}` : value
  const resolvedHref = context.resolveUrl?.(href, 'link') ?? href

  return `<a href="${escapeHtmlAttribute(resolvedHref)}">${escapeHtml(value)}</a>`
}

function joinRanges(source: string, ranges: readonly SourceRange[] | undefined): string {
  return (ranges ?? []).map((range) => source.slice(range.from, range.to)).join('')
}

function isRange(range: SourceRange | undefined): range is SourceRange {
  return range !== undefined
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", '&#39;')
}

function escapeStyleText(value: string): string {
  return value.replaceAll('</style', '<\\/style')
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

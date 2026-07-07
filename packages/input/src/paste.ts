export interface ClipboardFilePayload {
  readonly name: string
  readonly type: string
  readonly file?: File
}

export interface ClipboardPayload {
  readonly plainText?: string
  readonly html?: string
  readonly files?: readonly ClipboardFilePayload[]
}

export interface PasteContext {
  readonly inCodeBlock?: boolean
}

export type PasteStrategy = 'plain-text' | 'html-to-markdown' | 'files-deferred' | 'empty'

export interface NormalizedPaste {
  readonly text: string
  readonly strategy: PasteStrategy
  readonly handled: boolean
}

export function collectClipboardPayload(event: ClipboardEvent): ClipboardPayload {
  const clipboardData = event.clipboardData

  if (!clipboardData) {
    return {}
  }

  const plainText = clipboardData.getData('text/plain')
  const html = clipboardData.getData('text/html')
  const files = Array.from(clipboardData.files).map((file) => ({
    name: file.name,
    type: file.type,
    file,
  }))

  return Object.freeze({
    ...(plainText.length > 0 ? { plainText } : {}),
    ...(html.length > 0 ? { html } : {}),
    ...(files.length > 0 ? { files: Object.freeze(files) } : {}),
  })
}

export function normalizePaste(
  payload: ClipboardPayload,
  context: PasteContext = {},
): NormalizedPaste {
  if (context.inCodeBlock && payload.plainText !== undefined) {
    return createPaste(payload.plainText, 'plain-text')
  }

  if (payload.plainText !== undefined && payload.plainText.length > 0) {
    return createPaste(payload.plainText, 'plain-text')
  }

  if (payload.html !== undefined && payload.html.length > 0) {
    return createPaste(convertHtmlToMarkdown(payload.html), 'html-to-markdown')
  }

  if ((payload.files?.length ?? 0) > 0) {
    return Object.freeze({
      text: '',
      strategy: 'files-deferred',
      handled: false,
    })
  }

  return Object.freeze({
    text: '',
    strategy: 'empty',
    handled: false,
  })
}

export function convertHtmlToMarkdown(html: string): string {
  const parser = new DOMParser()
  const document = parser.parseFromString(html, 'text/html')
  const markdown = renderChildren(document.body).trim()

  return markdown.length > 0 ? markdown : (document.body.textContent ?? '')
}

function createPaste(text: string, strategy: PasteStrategy): NormalizedPaste {
  return Object.freeze({
    text,
    strategy,
    handled: text.length > 0,
  })
}

function renderChildren(parent: ParentNode): string {
  return Array.from(parent.childNodes).map(renderNode).join('')
}

function renderNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }

  if (!(node instanceof HTMLElement)) {
    return node.textContent ?? ''
  }

  const tagName = node.tagName.toLowerCase()

  switch (tagName) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return `${'#'.repeat(Number(tagName.slice(1)))} ${normalizeInline(renderChildren(node))}\n\n`
    case 'p':
      return `${normalizeInline(renderChildren(node))}\n\n`
    case 'div':
    case 'section':
    case 'article':
      return hasBlockChild(node)
        ? renderChildren(node)
        : `${normalizeInline(renderChildren(node))}\n\n`
    case 'br':
      return '\n'
    case 'strong':
    case 'b':
      return `**${normalizeInline(renderChildren(node))}**`
    case 'em':
    case 'i':
      return `*${normalizeInline(renderChildren(node))}*`
    case 'code':
      return node.parentElement?.tagName.toLowerCase() === 'pre'
        ? (node.textContent ?? '')
        : `\`${(node.textContent ?? '').replaceAll('`', '\\`')}\``
    case 'pre':
      return `\`\`\`\n${trimTrailingBlankLines(node.textContent ?? '')}\n\`\`\`\n\n`
    case 'a':
      return renderLink(node)
    case 'ul':
      return renderList(node, false)
    case 'ol':
      return renderList(node, true)
    case 'blockquote':
      return renderBlockquote(node)
    case 'table':
      return renderTable(node)
    default:
      return renderChildren(node)
  }
}

function renderLink(node: HTMLElement): string {
  const label = normalizeInline(renderChildren(node))
  const href = node.getAttribute('href')

  return href && label.length > 0 ? `[${label}](${href})` : label
}

function renderList(node: HTMLElement, ordered: boolean): string {
  const items = Array.from(node.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'LI',
  )

  return `${items
    .map((item, index) => {
      const marker = ordered ? `${index + 1}.` : '-'
      return `${marker} ${normalizeInline(renderChildren(item))}`
    })
    .join('\n')}\n\n`
}

function renderTable(node: HTMLElement): string {
  const rows = collectTableRows(node)

  if (rows.length === 0) {
    return ''
  }

  const columnCount = Math.max(...rows.map((row) => row.length))
  const paddedRows = rows.map((row) => padCells(row, columnCount))
  const [header, ...body] = paddedRows

  if (!header) {
    return ''
  }

  return `${[
    renderTableRow(header),
    renderTableRow(Array.from({ length: columnCount }, () => '---')),
    ...body.map(renderTableRow),
  ].join('\n')}\n\n`
}

function collectTableRows(table: HTMLElement): readonly (readonly string[])[] {
  return Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.children)
      .filter(
        (cell): cell is HTMLElement =>
          cell instanceof HTMLElement && (cell.tagName === 'TH' || cell.tagName === 'TD'),
      )
      .map((cell) => escapeTableCell(normalizeInline(renderChildren(cell)))),
  )
}

function renderTableRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`
}

function padCells(cells: readonly string[], columnCount: number): readonly string[] {
  return Object.freeze([
    ...cells,
    ...Array.from({ length: Math.max(0, columnCount - cells.length) }, () => ''),
  ])
}

function renderBlockquote(node: HTMLElement): string {
  const quote = renderChildren(node).trim()

  return `${quote
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}\n\n`
}

function normalizeInline(value: string): string {
  return value.replace(/[ \t\r\n]+/g, ' ').trim()
}

function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|')
}

function hasBlockChild(node: HTMLElement): boolean {
  return Array.from(node.children).some((child) => isBlockElement(child.tagName.toLowerCase()))
}

function isBlockElement(tagName: string): boolean {
  return [
    'article',
    'blockquote',
    'div',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ol',
    'p',
    'pre',
    'section',
    'table',
    'ul',
  ].includes(tagName)
}

function trimTrailingBlankLines(value: string): string {
  return value.replace(/\n+$/g, '')
}

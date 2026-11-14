import {
  copyDocumentPresentationAggregate,
  copyDocumentPresentationRequest,
  serializeDocumentPresentationNode,
  type DocumentPresentationRequest,
  type DocumentPresentationResult,
  type DocumentPresentationFragment,
  type DocumentPresentationNode,
  type DocumentRendererDeclaration,
} from '@milkup/core'
import { parseMarkdown, parseInline, type SourceRange, type SyntaxNode } from '@milkup/markdown'
import type { ExportUrlResolver } from './markdown-html'

export interface ExportPresentationBatch {
  readonly request: DocumentPresentationRequest
  readonly result: DocumentPresentationResult
  readonly declarations: readonly DocumentRendererDeclaration[]
}
export interface StaticExportWarning extends SourceRange {
  readonly code: string
  readonly message: string
}
export interface MarkdownImageResource extends SourceRange {
  readonly url: string
}
export interface StaticMarkdownDocumentOptions {
  readonly documentId: string
  readonly version: number
  /** Absolute UTF-16 start of a selected snapshot. Returned warning offsets are absolute. */
  readonly sourceOffset?: number
  readonly title?: string
  readonly presentations?: readonly ExportPresentationBatch[]
  /** Host-only lookup. An empty result means missing/denied; no network is performed. */
  readonly resolveUrl?: ExportUrlResolver
  readonly imageMode?: 'embed' | 'omit'
  readonly pageSize?: 'a4' | 'letter'
  readonly landscape?: boolean
}
export interface StaticMarkdownDocumentResult {
  readonly html: string
  readonly warnings: readonly StaticExportWarning[]
}
export const STATIC_EXPORT_LIMITS = Object.freeze({
  sourceUtf16: 2 * 1024 * 1024,
  htmlBytes: 32 * 1024 * 1024,
  imageBytes: 32 * 1024 * 1024,
  outputBytes: 64 * 1024 * 1024,
})
const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const bytes = (value: string): number => new TextEncoder().encode(value).byteLength
const destination = (node: SyntaxNode): string => String(node.data?.destination ?? '')

/** Enumerates only parser-recognized image uses, excluding code and raw HTML. */
export function collectMarkdownImageResources(source: string): readonly MarkdownImageResource[] {
  assertSource(source)
  const resources: MarkdownImageResource[] = []
  const visitInline = (node: SyntaxNode): void => {
    if (node.type === 'image')
      resources.push({ url: destination(node), from: node.from, to: node.to })
    for (const child of node.children ?? []) visitInline(child)
  }
  const visitBlock = (node: SyntaxNode): void => {
    if (['fencedCode', 'indentedCode', 'fallbackText'].includes(node.type)) return
    if (node.children?.length && !['paragraph', 'heading'].includes(node.type)) {
      for (const child of node.children) visitBlock(child)
    } else
      for (const range of node.contentRanges ?? []) {
        for (const child of parseInline(source, range.from, range.to)) visitInline(child)
      }
  }
  for (const block of parseMarkdown(source).root.children ?? []) visitBlock(block)
  return Object.freeze(resources.map((resource) => Object.freeze(resource)))
}
function assertSource(source: string): void {
  if (typeof source !== 'string' || source.length > STATIC_EXPORT_LIMITS.sourceUtf16)
    throw new RangeError('Static export source exceeds the 2 Mi UTF-16 limit')
}

/** A pure static document conversion. Only closed core presentation data is accepted. */
export function renderStaticMarkdownDocument(
  source: string,
  options: StaticMarkdownDocumentOptions,
): StaticMarkdownDocumentResult {
  assertSource(source)
  return new StaticRenderer(source, options).render()
}

class StaticRenderer {
  private readonly base: number
  private readonly fragments: DocumentPresentationFragment[] = []
  private readonly used = new Set<DocumentPresentationFragment>()
  private readonly warnings: StaticExportWarning[] = []
  private readonly warningKeys = new Set<string>()
  private readonly anchors = new Set<number>()
  private imageBytes = 0
  private imageIndex = 0
  private serialBytes = 0
  constructor(
    private readonly source: string,
    private readonly options: StaticMarkdownDocumentOptions,
  ) {
    this.base = options.sourceOffset ?? 0
    if (
      !Number.isSafeInteger(this.base) ||
      this.base < 0 ||
      !Number.isSafeInteger(this.base + source.length) ||
      !options.documentId ||
      !Number.isSafeInteger(options.version) ||
      options.version < 0
    )
      throw new TypeError('Invalid static export document identity or offset')
    let presentationBytes = 0
    for (const batch of options.presentations ?? []) {
      const request = copyDocumentPresentationRequest(batch.request)
      if (
        request.documentId !== options.documentId ||
        request.version !== options.version ||
        request.target !== 'export' ||
        request.from < this.base ||
        request.to > this.base + source.length ||
        source.slice(request.from - this.base, request.to - this.base) !== request.source
      )
        throw new TypeError('Static export presentation snapshot mismatch')
      const result = copyDocumentPresentationAggregate(batch.result, request, batch.declarations)
      presentationBytes += bytes(JSON.stringify(result))
      if (presentationBytes > STATIC_EXPORT_LIMITS.htmlBytes)
        throw new RangeError('Static export presentation byte limit exceeded')
      if (!result.complete)
        this.warn(
          'incomplete-presentation',
          request.from - this.base,
          request.to - this.base,
          '增强渲染未完成；未渲染部分保留源码。',
        )
      for (const fragment of result.fragments)
        this.fragments.push({
          ...fragment,
          from: fragment.from - this.base,
          to: fragment.to - this.base,
        })
    }
    this.fragments.sort((a, b) => a.from - b.from || a.to - b.to)
    for (let i = 0; i < this.fragments.length; i++) {
      const fragment = this.fragments[i]!
      if (i && fragment.from < this.fragments[i - 1]!.to)
        throw new TypeError('Overlapping static export presentations')
      this.anchors.add(fragment.from + this.base)
    }
  }
  render(): StaticMarkdownDocumentResult {
    const blocks = parseMarkdown(this.source).root.children ?? []
    let body = ''
    for (let i = 0; i < blocks.length; i++) {
      const unit = this.renderUnit(blocks, i)
      const block = unit.block
      if (block?.type === 'heading' && block.status === 'valid') {
        let next = unit.lastIndex + 1
        while (blocks[next]?.type === 'blankLine') next++
        const following = blocks[next]
        if (
          following?.status === 'valid' &&
          [
            'paragraph',
            'table',
            'fencedCode',
            'indentedCode',
            'orderedList',
            'unorderedList',
          ].includes(following.type)
        ) {
          const lead = this.renderUnit(blocks, next)
          if (
            lead.block &&
            !this.fragments.some(
              (f) =>
                !this.used.has(f) &&
                f.layout === 'block' &&
                f.from < blocks[lead.lastIndex]!.to &&
                f.to > block.from,
            )
          ) {
            // Consume complete original units in source order. This soft print
            // constraint helps short blocks; oversized blocks can still split.
            body += `<div class="heading-lead">${unit.render()}${lead.render()}</div>`
            i = lead.lastIndex
            continue
          }
        }
      }
      body += unit.render()
      i = unit.lastIndex
    }
    for (const fragment of this.fragments)
      if (!this.used.has(fragment)) {
        this.warn(
          'presentation-boundary',
          fragment.from,
          fragment.to,
          '增强片段跨越不支持的 Markdown 边界；保留源码。',
        )
      }
    const emitted = new Set([...this.used].map((f) => f.from + this.base))
    body = body.replace(
      /<a href="#source-(\d+)">([\s\S]*?)<\/a>/g,
      (markup, offset: string, label: string) => {
        if (emitted.has(Number(offset))) return markup
        this.warn(
          'reference-unrendered-target',
          Number(offset) - this.base,
          Number(offset) - this.base,
          '引用目标未渲染；保留引用标签。',
        )
        return `<span>${label}</span>`
      },
    )
    if (this.warnings.length)
      body += `<aside class="export-warning" aria-label="导出警告"><strong>导出警告</strong><ul>${this.warnings.map((warning) => `<li>${escape(warning.message)}（${warning.from}–${warning.to}）</li>`).join('')}</ul></aside>`
    const size = this.options.pageSize === 'letter' ? 'letter' : 'A4'
    const orientation = this.options.landscape ? ' landscape' : ''
    const css = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0 auto;padding:24px;max-width:1000px;color:#202124;background:#fff;font-family:"Noto Sans CJK SC","Microsoft YaHei","PingFang SC",sans-serif;line-height:1.65;overflow-wrap:anywhere;word-break:normal}h1,h2,h3,h4,h5,h6{line-height:1.3;break-after:avoid}p{orphans:3;widows:3}table{border-collapse:collapse;width:100%;table-layout:auto;margin:1em 0}th,td{border:1px solid #999;padding:.4em .6em;overflow-wrap:anywhere}thead{display:table-header-group}tfoot{display:table-footer-group}tr{break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all;padding:1em;background:#f4f4f4;break-inside:auto}code{font-family:"Noto Sans Mono CJK SC",monospace}blockquote{margin-left:0;padding-left:1em;border-left:3px solid #aaa}img,svg{max-width:100%;height:auto}math[display=block]{display:block;margin:1em 0;overflow-wrap:anywhere}.heading-lead{display:contents}.presentation-block{text-align:center;break-inside:avoid}.source-fallback{white-space:pre-wrap}.export-warning{color:#6b3a00;background:#fff4db;padding:.3em .6em;font-size:.9em}.image-placeholder{border:1px dashed #888;padding:.4em}a{color:#164c96} @page{size:${size}${orientation};margin:16mm}@media print{.heading-lead{display:block;break-inside:avoid;page-break-inside:avoid}aside.export-warning{break-inside:avoid;page-break-inside:avoid}body{max-width:none;margin:0;padding:0}a{color:inherit;text-decoration:underline}.presentation-block,img,svg{break-inside:avoid}pre{break-inside:auto}table{break-inside:auto}thead{display:table-header-group}}`
    const csp =
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; font-src 'none'; object-src 'none'"
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(this.options.title ?? 'Document')}</title><style>${css}</style></head><body>${body}</body></html>`
    const total = bytes(html)
    if (
      total - this.imageBytes > STATIC_EXPORT_LIMITS.htmlBytes ||
      total > STATIC_EXPORT_LIMITS.outputBytes
    )
      throw new RangeError('Static export HTML/output byte limit exceeded')
    return Object.freeze({ html, warnings: Object.freeze(this.warnings) })
  }
  /** Resolve the existing consumption path without rendering or claiming fragments. */
  private renderUnit(
    blocks: readonly SyntaxNode[],
    index: number,
  ): { lastIndex: number; block?: SyntaxNode; render: () => string } {
    const block = blocks[index]!
    if (block.type === 'orderedList' || block.type === 'unorderedList') {
      // The parser does not nest continuation blocks beneath list items. Keep
      // such a whole source run together rather than falsely flattening it.
      let next = index + 1
      while (blocks[next]?.type === 'blankLine') next++
      if (
        blocks[next] &&
        /^(?: +|\t)/.test(this.source.slice(blocks[next]!.from, blocks[next]!.to))
      ) {
        let end = next
        while (
          end + 1 < blocks.length &&
          (blocks[end + 1]!.type === 'blankLine' ||
            /^(?: +|\t)/.test(this.source.slice(blocks[end + 1]!.from, blocks[end + 1]!.to)))
        )
          end++
        return {
          lastIndex: end,
          render: () =>
            this.raw(
              block.from,
              blocks[end]!.to,
              'unsupported-nesting',
              '嵌套或多行列表尚不支持完整导出；保留源码。',
              true,
            ),
        }
      }
    }
    const fragment = this.fragments.find(
      (f) => !this.used.has(f) && f.layout === 'block' && f.from <= block.from && f.to > block.from,
    )
    if (fragment) {
      let end = index
      while (end + 1 < blocks.length && blocks[end + 1]!.from < fragment.to) end++
      if (!this.source.slice(fragment.to, blocks[end]!.to).trim())
        return { lastIndex: end, render: () => this.fragment(fragment) }
    }
    return { lastIndex: index, block, render: () => this.block(block) }
  }
  private warn(code: string, from: number, to: number, message: string): void {
    const key = `${code}:${from}:${to}`
    if (this.warningKeys.has(key)) return
    this.warningKeys.add(key)
    this.warnings.push(Object.freeze({ code, from: from + this.base, to: to + this.base, message }))
  }
  private raw(from: number, to: number, code: string, message: string, block = false): string {
    this.warn(code, from, to, message)
    const tag = block ? 'pre' : 'span'
    return `<${tag} class="source-fallback">${escape(this.source.slice(from, to))}</${tag}>`
  }
  private fragment(fragment: DocumentPresentationFragment): string {
    this.used.add(fragment)
    const tag = fragment.layout === 'block' ? 'div' : 'span'
    let html: string
    if (fragment.status === 'error')
      html = this.raw(
        fragment.from,
        fragment.to,
        'renderer-error',
        fragment.message ?? '增强渲染失败；保留源码。',
      )
    else {
      html = this.presentation(fragment.content)
      if (fragment.message)
        this.warn('renderer-message', fragment.from, fragment.to, fragment.message)
    }
    this.serialBytes += bytes(html)
    if (this.serialBytes > STATIC_EXPORT_LIMITS.htmlBytes)
      throw new RangeError('Static export presentation byte limit exceeded')
    return `<${tag} id="source-${fragment.from + this.base}" class="presentation-${fragment.layout}" aria-label="${escape(fragment.accessibleText)}">${html}</${tag}>`
  }
  private presentation(node: DocumentPresentationNode): string {
    if (node.type === 'reference') {
      const target = node.target
      if (target.documentId !== this.options.documentId || target.version !== this.options.version)
        throw new TypeError('Static export reference identity mismatch')
      if (!this.anchors.has(target.from)) {
        this.warn(
          'reference-outside-export',
          Math.max(0, target.from - this.base),
          Math.max(0, target.to - this.base),
          '引用目标不在当前导出范围或未完成渲染；保留引用标签。',
        )
        return `<span>${escape(node.label)}</span>`
      }
      return `<a href="#source-${target.from}">${escape(node.label)}</a>`
    }
    if (node.type === 'text') return escape(node.text)
    if ('children' in node && ['group', 'emphasis', 'code', 'sup', 'sub'].includes(node.type)) {
      const tag = node.type === 'group' ? 'span' : node.type === 'emphasis' ? 'em' : node.type
      return `<${tag}>${(node.children as readonly DocumentPresentationNode[]).map((n) => this.presentation(n)).join('')}</${tag}>`
    }
    return serializeDocumentPresentationNode(node, undefined, {
      idPrefix: `export-svg-${this.imageIndex++}`,
    })
  }
  private block(block: SyntaxNode): string {
    const source = this.source.slice(block.from, block.to)
    if (
      this.fragments.some(
        (f) => !this.used.has(f) && f.layout === 'block' && f.from < block.to && f.to > block.from,
      )
    )
      return this.raw(
        block.from,
        block.to,
        'presentation-boundary',
        '块级增强片段跨越不支持的 Markdown 边界；保留源码。',
        true,
      )
    if (block.status !== 'valid' && block.type !== 'blankLine')
      return this.raw(
        block.from,
        block.to,
        'unsupported-markdown',
        '不完整或不支持的 Markdown；保留源码。',
        true,
      )
    if (
      ['blockquote', 'unorderedList', 'orderedList'].includes(block.type) &&
      (/(?:^|\n)\s*(?:>\s*)?(?:>|[-+*]\s|\d+[.)]\s).*?(?:`{3,}|~{3,}|<\/?[A-Za-z!])/.test(source) ||
        /(?:^|\n) {1,3}(?:[-+*]|\d+[.)])\s/.test(source) ||
        /(?:^|\n)\s*>\s*(?:>|#|[-+*]\s|\d+[.)]\s|\|)/.test(source))
    )
      return this.raw(
        block.from,
        block.to,
        'unsupported-nesting',
        '嵌套 Markdown 尚不支持完整导出；保留源码。',
        true,
      )
    const ranges = () => (block.contentRanges ?? []).map((r) => this.inline(r.from, r.to)).join('')
    switch (block.type) {
      case 'blankLine':
        return ''
      case 'paragraph':
        return `<p>${ranges()}</p>`
      case 'heading':
        return `<h${block.data?.level}>${ranges()}</h${block.data?.level}>`
      case 'thematicBreak':
        return '<hr>'
      case 'fencedCode':
      case 'indentedCode': {
        const info =
          String(block.data?.info ?? '')
            .trim()
            .split(/\s+/)[0] ?? ''
        if (['mermaid', 'math'].includes(info))
          return this.raw(
            block.from,
            block.to,
            'unrendered-enhancement',
            '增强渲染器不可用或片段未完成；保留源码。',
            true,
          )
        const code = (block.contentRanges ?? [])
          .map((r) => this.source.slice(r.from, r.to))
          .join(block.type === 'indentedCode' ? '\n' : '')
          .replace(/\n$/, '')
        return `<pre><code${info ? ` class="language-${escape(info)}"` : ''}>${escape(code)}</code></pre>`
      }
      case 'blockquote':
        return `<blockquote>${(block.children ?? []).map((line) => `<p>${(line.contentRanges ?? []).map((r) => this.inline(r.from, r.to)).join('')}</p>`).join('')}</blockquote>`
      case 'unorderedList':
      case 'orderedList': {
        const ordered = block.type === 'orderedList',
          tag = ordered ? 'ol' : 'ul'
        return `<${tag}${ordered && block.data?.start !== 1 ? ` start="${Number(block.data?.start ?? 1)}"` : ''}>${(block.children ?? []).map((item) => `<li>${(item.contentRanges ?? []).map((r) => this.inline(r.from, r.to)).join('')}</li>`).join('')}</${tag}>`
      }
      case 'table': {
        const rows = block.children ?? [],
          alignments = block.data?.alignments as unknown[] | undefined
        const row = (node: SyntaxNode, tag: string) =>
          `<tr>${(node.children ?? [])
            .map((cell, i) => {
              const align = alignments?.[i]
              return `<${tag}${['left', 'center', 'right'].includes(String(align)) ? ` style="text-align:${align}"` : ''}>${(cell.contentRanges ?? []).map((r) => this.inline(r.from, r.to)).join('')}</${tag}>`
            })
            .join('')}</tr>`
        return `<table><thead>${rows[0] ? row(rows[0], 'th') : ''}</thead><tbody>${rows
          .slice(1)
          .map((r) => row(r, 'td'))
          .join('')}</tbody></table>`
      }
      default:
        return this.raw(
          block.from,
          block.to,
          'unsupported-markdown',
          '不支持的 Markdown 块；保留源码。',
          true,
        )
    }
  }
  private inline(from: number, to: number): string {
    const nodes = parseInline(this.source, from, to)
    // Fallback detection only: ordinary escaping must not consume extension source.
    const opaque: SourceRange[] = []
    const protect = (node: SyntaxNode): void => {
      if (node.type === 'inlineCode' || node.type === 'escape') opaque.push(node)
      if (node.type === 'link' || node.type === 'image') {
        const target = node.contentRanges?.[1]
        if (target) opaque.push(target)
      }
      for (const child of node.children ?? []) protect(child)
    }
    for (const node of nodes) protect(node)
    for (let index = from; index < to; index++) {
      if (this.source[index] !== '$' && this.source.slice(index, index + 2) !== '[^') continue
      if (opaque.some((r) => index >= r.from && index < r.to)) continue
      if (this.fragments.some((f) => index >= f.from && index < f.to)) continue
      return this.raw(
        from,
        to,
        'unrendered-enhancement',
        '可能的公式或脚注未由增强渲染器处理；保留源码。',
      )
    }
    let result = '',
      cursor = from
    for (const node of nodes) {
      if (node.to <= cursor) continue
      if (node.from < cursor) {
        result += this.inline(cursor, node.to)
        cursor = node.to
        continue
      }
      const fragment = this.fragments.find(
        (f) =>
          !this.used.has(f) &&
          f.layout === 'inline' &&
          f.from >= node.from &&
          f.from < node.to &&
          f.to <= to,
      )
      const nested =
        fragment &&
        fragment.to <= node.to &&
        ['emphasis', 'strong', 'strikethrough', 'link'].includes(node.type) &&
        (node.children ?? []).some((child) => fragment.from >= child.from)
      if (fragment && !nested) {
        result += this.inline(node.from, fragment.from) + this.fragment(fragment)
        cursor = fragment.to
        if (cursor < node.to) {
          result += this.inline(cursor, node.to)
          cursor = node.to
        }
      } else {
        result += this.inlineNode(node)
        cursor = node.to
      }
    }
    return result
  }
  private inlineNode(node: SyntaxNode): string {
    const content = () =>
      (node.contentRanges ?? []).map((r) => this.source.slice(r.from, r.to)).join('')
    const children = () => {
      const list = node.children ?? []
      return list.length ? this.inline(list[0]!.from, list[list.length - 1]!.to) : ''
    }
    if (node.status !== 'valid')
      return this.raw(node.from, node.to, 'unsupported-markdown', '不完整的行内语法；保留源码。')
    switch (node.type) {
      case 'text': {
        const raw = this.source.slice(node.from, node.to)
        if (/\$|\[\^/.test(raw))
          this.warn(
            'unrendered-enhancement',
            node.from,
            node.to,
            '可能的公式或脚注未由增强渲染器处理；保留源码。',
          )
        return escape(content() || raw)
      }
      case 'escape':
        return escape(String(node.data?.value ?? content()))
      case 'hardBreak':
        return '<br>'
      case 'inlineCode':
        return `<code>${escape(content())}</code>`
      case 'strong':
        return `<strong>${children()}</strong>`
      case 'emphasis':
        return `<em>${children()}</em>`
      case 'strikethrough':
        return `<del>${children()}</del>`
      case 'image':
        return this.image(node)
      case 'link':
        return this.link(destination(node), children(), node)
      case 'autolink': {
        const value = String(node.data?.value ?? '')
        return this.link(
          node.data?.kind === 'email' ? `mailto:${value}` : value,
          escape(value),
          node,
        )
      }
      default:
        return this.raw(node.from, node.to, 'unsupported-markdown', '不支持的行内语法；保留源码。')
    }
  }
  private link(url: string, label: string, node: SyntaxNode): string {
    const resolved = this.options.resolveUrl?.(url, 'link') ?? url
    // No file or custom-protocol navigation in portable output. Relative links are
    // meaningful only if the host explicitly resolves them to a safe destination.
    if (
      !resolved ||
      /[\u0000-\u0020\u007f\\]/.test(resolved) ||
      !/^(?:https?:\/\/|mailto:|tel:|#)/i.test(resolved)
    ) {
      this.warn(
        'unsafe-or-unresolved-link',
        node.from,
        node.to,
        '链接地址不安全或未解析；保留源码。',
      )
      return `<span>${escape(this.source.slice(node.from, node.to))}</span>`
    }
    return `<a href="${escape(resolved)}" rel="noreferrer">${label}</a>`
  }
  private image(node: SyntaxNode): string {
    const url = destination(node)
    if (this.options.imageMode === 'omit') {
      this.warn('image-omitted', node.from, node.to, '按导出选项省略图片；保留占位与原始地址。')
      return `<span class="image-placeholder">${escape(this.source.slice(node.from, node.to))}</span>`
    }
    const resolved = this.options.resolveUrl?.(url, 'image') ?? url
    if (resolved.length + this.imageBytes > STATIC_EXPORT_LIMITS.imageBytes)
      throw new RangeError('Static export embedded image byte limit exceeded')
    const comma = resolved.indexOf(',')
    const payload = resolved.slice(comma + 1)
    if (
      !/^data:image\/(?:png|jpeg|gif|webp);base64$/i.test(resolved.slice(0, comma)) ||
      !payload.length ||
      payload.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)
    ) {
      this.warn(
        'image-unavailable',
        node.from,
        node.to,
        '图片未获授权、缺失或无法离线内嵌；保留占位与原始地址。',
      )
      return `<span class="image-placeholder">${escape(this.source.slice(node.from, node.to))}</span>`
    }
    this.imageBytes += bytes(resolved)
    if (this.imageBytes > STATIC_EXPORT_LIMITS.imageBytes)
      throw new RangeError('Static export embedded image byte limit exceeded')
    return `<img src="${escape(resolved)}" alt="${escape(String(node.data?.label ?? ''))}">`
  }
}

import type { EditorDocumentSource } from '@milkup/core'
import { parseMarkdown } from '@milkup/markdown'

export const RESOURCE_SCAN_LIMIT = 4 * 1024 * 1024
const REFERENCE_LIMIT = 4096
const CHUNK_LIMIT = 64 * 1024
export class ResourceReferenceScanError extends Error {
  constructor(readonly code: 'too-large' | 'unsupported-syntax' | 'invalidated' | 'aborted') {
    super(
      code === 'too-large'
        ? '文档包含图片且超过资源迁移扫描预算，暂不支持安全另存为。'
        : code === 'unsupported-syntax'
          ? '图片引用语法暂不能安全迁移，请转换为直接图片链接后再另存为。'
          : code === 'invalidated'
            ? '文档在资源扫描期间发生变化，请重试。'
            : '资源扫描已取消。',
    )
    this.name = 'ResourceReferenceScanError'
  }
}
const fail = (code: ResourceReferenceScanError['code']): never => {
  throw new ResourceReferenceScanError(code)
}
const punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/
const unescape = (text: string) => text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1')

// A container can absorb unmarked continuation lines only while its final block is a paragraph.
// Consult the existing block parser rather than treating every indent after a quote/list as code.
function endsInParagraph(text: string, depth = 0): boolean {
  if (depth > 32 || /\n[ \t]*$/.test(text)) return false
  const last = parseMarkdown(text).root.children?.at(-1)
  if (!last) return false
  if (last.type === 'paragraph') return true
  if (last.type === 'blockquote')
    return endsInParagraph(
      (last.contentRanges ?? []).map((range) => text.slice(range.from, range.to)).join('\n'),
      depth + 1,
    )
  if (last.type === 'orderedList' || last.type === 'unorderedList') {
    const item = last.children?.at(-1)
    return (
      !!item &&
      endsInParagraph(
        (item.contentRanges ?? []).map((range) => text.slice(range.from, range.to)).join('\n'),
        depth + 1,
      )
    )
  }
  return false
}
const interruptsParagraph = (line: string) =>
  /^ {0,3}(?:>|#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|(?:[-+*]|\d{1,9}[.)])[ \t]|(?:---+|___+|\*\*\*+)[ \t]*$)/.test(
    line,
  )

/** Conservative Markdown image scanner. Unsupported image forms fail closed; no filesystem authority here. */
export function scanResourceReferences(source: string): readonly string[] {
  if (!source.includes('![')) return []
  if (source.length > RESOURCE_SCAN_LIMIT) fail('too-large')
  const references = new Set<string>()
  let count = 0
  let inspected = 0
  const inspect = (length = 1) => {
    inspected += length
    if (inspected > Math.max(1024, source.length * 16)) fail('too-large')
  }
  const accept = (url: string) => {
    if (++count > REFERENCE_LIMIT) fail('too-large')
    const decoded = unescape(url)
    if (/^(?:https?:\/\/|\/\/)/i.test(decoded)) return
    // Entity decoding needs a complete HTML entity table. Never guess a different local filename.
    if (/&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/i.test(decoded)) fail('unsupported-syntax')
    if (decoded) references.add(decoded)
  }
  function inline(text: string) {
    let at = 0
    while (at < text.length) {
      inspect()
      if (text.startsWith('<!--', at)) {
        const close = text.indexOf('-->', at + 4)
        if (close < 0) fail('unsupported-syntax')
        at = close + 3
        continue
      }
      if (text[at] === '\\' && punctuation.test(text[at + 1] ?? '')) {
        at += 2
        continue
      }
      if (text[at] === '`') {
        let end = at + 1
        while (text[end] === '`') end++
        const length = end - at
        let cursor = end,
          close = -1
        while (cursor < text.length) {
          const next = text.indexOf('`', cursor)
          inspect(next < 0 ? text.length - cursor : next - cursor + 1)
          if (next < 0) break
          cursor = next + 1
          while (text[cursor] === '`') cursor++
          inspect(cursor - next)
          if (cursor - next === length) {
            close = cursor
            break
          }
        }
        at = close < 0 ? end : close
        continue
      }
      if (text[at] !== '!' || text[at + 1] !== '[') {
        at++
        continue
      }
      let end = at + 2,
        depth = 1
      while (end < text.length && depth > 0) {
        if (text[end] === '\\' && punctuation.test(text[end + 1] ?? '')) {
          end += 2
          continue
        }
        if (text[end] === '[') {
          if (++depth > 32) fail('unsupported-syntax')
        } else if (text[end] === ']') depth--
        end++
      }
      if (depth || text[end] !== '(') fail('unsupported-syntax') // reference/shortcut forms are not silently omitted
      end++
      while (/\s/.test(text[end] ?? '') && end < text.length) end++
      let url = ''
      if (text[end] === '<') {
        const start = ++end
        while (end < text.length && text[end] !== '>') {
          if (text[end] === '\n' || text[end] === '<') fail('unsupported-syntax')
          if (text[end] === '\\' && punctuation.test(text[end + 1] ?? '')) end++
          end++
        }
        if (text[end] !== '>') fail('unsupported-syntax')
        url = text.slice(start, end++)
      } else {
        const start = end
        let nesting = 0
        while (end < text.length) {
          if (text[end] === '\\' && punctuation.test(text[end + 1] ?? '')) {
            end += 2
            continue
          }
          if (text[end] === '(') {
            if (++nesting > 32) fail('unsupported-syntax')
          } else if (text[end] === ')') {
            if (nesting === 0) break
            nesting--
          } else if (/\s/.test(text[end]!) && nesting === 0) break
          else if (text[end] === '<' || /[\u0000-\u001f]/.test(text[end]!))
            fail('unsupported-syntax')
          end++
        }
        if (nesting) fail('unsupported-syntax')
        url = text.slice(start, end)
      }
      const beforeWhitespace = end
      while (end < text.length && /\s/.test(text[end]!)) end++
      if (text[end] !== ')') {
        const quote = text[end]
        if (end === beforeWhitespace || !quote || !['"', "'", '('].includes(quote))
          fail('unsupported-syntax')
        const closing = quote === '(' ? ')' : quote
        end++
        while (end < text.length && text[end] !== closing) {
          if (text[end] === '\\' && punctuation.test(text[end + 1] ?? '')) end++
          end++
        }
        if (text[end++] !== closing) fail('unsupported-syntax')
        while (end < text.length && /\s/.test(text[end]!)) end++
      }
      if (text[end] !== ')') fail('unsupported-syntax')
      accept(url)
      at = end + 1
    }
  }
  function blocks(text: string, level = 0) {
    if (level > 32) fail('unsupported-syntax')
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    let paragraph: string[] = []
    const flush = () => {
      if (paragraph.length) inline(paragraph.join('\n'))
      paragraph = []
    }
    for (let index = 0; index < lines.length;) {
      const line = lines[index]!
      if (!line.trim()) {
        flush()
        index++
        continue
      }
      const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (fence && !(fence[1]![0] === '`' && fence[2]!.includes('`'))) {
        flush()
        index++
        const closing = new RegExp(`^ {0,3}${fence[1]![0]}{${fence[1]!.length},}[ \\t]*$`)
        while (index < lines.length && !closing.test(lines[index]!)) index++
        if (index < lines.length) index++
        continue
      }
      if (!paragraph.length && /^(?: {4}| {0,3}\t)/.test(line)) {
        index++
        continue
      }
      const quote = /^ {0,3}>[ \t]?/.exec(line)
      if (quote) {
        flush()
        const body: string[] = []
        while (index < lines.length) {
          const prefix = /^ {0,3}>[ \t]?/.exec(lines[index]!)
          if (!prefix) break
          body.push(lines[index]!.slice(prefix[0].length))
          index++
        }
        if (endsInParagraph(body.join('\n'))) {
          while (
            index < lines.length &&
            lines[index]!.trim() &&
            !interruptsParagraph(lines[index]!)
          ) {
            body.push(lines[index]!)
            index++
          }
        }
        blocks(body.join('\n'), level + 1)
        continue
      }
      const list = /^( {0,3})(?:[-+*]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line)
      if (list) {
        flush()
        if (list[2]!.includes('\t')) {
          if (line.includes('![')) fail('unsupported-syntax')
        }
        const extraIndent = list[2]!.length > 4 ? list[2]!.slice(1) : ''
        const width = line.length - list[3]!.length - extraIndent.length
        const body = [extraIndent + list[3]!]
        index++
        let lazy: boolean | undefined
        while (index < lines.length) {
          const continuation = lines[index]!
          if (!continuation.trim()) {
            body.push('')
            lazy = false
            index++
            continue
          }
          if (!continuation.startsWith(' '.repeat(width))) {
            lazy ??= endsInParagraph(body.join('\n'))
            if (!lazy || interruptsParagraph(continuation)) break
            body.push(continuation)
          } else {
            body.push(continuation.slice(width))
            lazy = undefined
          }
          index++
        }
        blocks(body.join('\n'), level + 1)
        continue
      }
      if (/^ {0,3}<!--/.test(line)) {
        flush()
        while (index < lines.length && !lines[index]!.includes('-->')) index++
        if (index < lines.length) index++
        continue
      }
      const htmlCode = /^ {0,3}<(script|pre|style|textarea)(?:[\s>]|$)/i.exec(line)
      if (htmlCode) {
        flush()
        const closing = new RegExp(`</${htmlCode[1]}[ \\t]*>`, 'i')
        while (index < lines.length && !closing.test(lines[index]!)) index++
        if (index < lines.length) index++
        continue
      }
      paragraph.push(line)
      index++
    }
    flush()
  }
  blocks(source)
  return Object.freeze([...references])
}

export interface ResourceReferenceScanOptions {
  readonly chunks?: AsyncIterable<string>
  readonly signal?: AbortSignal
}
/** Native callers supply version-checked UTF8-safe chunks. Line windows are a bounded memory-source fallback. */
export async function scanDocumentResourceReferences(
  source: EditorDocumentSource,
  options: ResourceReferenceScanOptions = {},
): Promise<{
  readonly documentId: string
  readonly version: number
  readonly references: readonly string[]
}> {
  const expected = source.snapshot()
  const guard = () => {
    if (options.signal?.aborted) fail('aborted')
    const current = source.snapshot()
    if (
      current.documentId !== expected.documentId ||
      current.version !== expected.version ||
      current.lineCount !== expected.lineCount ||
      current.length !== expected.length
    )
      fail('invalidated')
  }
  async function* windows() {
    for (let from = 1; from <= expected.lineCount;) {
      guard()
      let to = Math.min(expected.lineCount, from + 127)
      let window
      while (!window) {
        try {
          window = await source.readLineWindow(from, to, CHUNK_LIMIT)
        } catch (error) {
          if (!(error instanceof RangeError)) throw error
          if (to === from) fail('too-large')
          to = from + Math.floor((to - from) / 2)
        }
      }
      guard()
      if (window.fromLine !== from || window.toLine !== to || window.text.length > CHUNK_LIMIT)
        fail('invalidated')
      yield window.text
      // Line windows exclude the final separator. A normalized separator preserves Markdown grammar.
      if (to < expected.lineCount) yield '\n'
      from = to + 1
    }
  }
  guard()
  let total = 0,
    carry = '',
    potential = false
  let pieces: string[] = []
  for await (const text of options.chunks ?? windows()) {
    guard()
    if (typeof text !== 'string') fail('invalidated')
    if (text.length > CHUNK_LIMIT) fail('too-large')
    total += text.length
    potential ||= (carry + text).includes('![')
    if (text.length) carry = text.slice(-1)
    if (total <= RESOURCE_SCAN_LIMIT) pieces.push(text)
    else pieces = []
    if (total > RESOURCE_SCAN_LIMIT && potential) fail('too-large')
  }
  guard()
  if (options.chunks && expected.length !== undefined && total !== expected.length)
    fail('invalidated')
  const references = potential ? scanResourceReferences(pieces.join('')) : []
  return Object.freeze({ documentId: expected.documentId, version: expected.version, references })
}

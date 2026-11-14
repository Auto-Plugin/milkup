export interface Span {
  from: number
  to: number
}
export interface SyntaxNode extends Span {
  type: string
  status: string
  markerRanges: readonly Span[]
  contentRanges?: readonly Span[]
}
export interface Capture {
  text: string
  selection: { anchor: number; head: number }
  lineEnding: '\n' | '\r\n'
  syntax: { context: 'text' | 'code' | 'table' | 'unknown'; complete: boolean; nodes: SyntaxNode[] }
}
export interface Edit {
  changes: { from: number; to: number; insert: string }[]
  selection: { anchor: number; head: number }
}
const unsupported = (detail: string): never => {
  throw new Error(detail)
}
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
function graphemeBoundary(text: string, at: number): boolean {
  if (at === 0 || at === text.length) return true
  for (const part of graphemes.segment(text)) {
    if (part.index === at) return true
    if (part.index > at) return false
  }
  return false
}
function splitSurrogate(text: string, at: number): boolean {
  return (
    at > 0 &&
    at < text.length &&
    /[\uD800-\uDBFF]/.test(text[at - 1]!) &&
    /[\uDC00-\uDFFF]/.test(text[at]!)
  )
}
function map(at: number, changes: Edit['changes'], affinity = 1): number {
  let delta = 0
  for (const c of changes) {
    if (at < c.from || (at === c.from && affinity < 0)) break
    if (at <= c.to) return c.from + delta + (affinity > 0 ? c.insert.length : 0)
    delta += c.insert.length - (c.to - c.from)
  }
  return at + delta
}
function finish(c: Capture, changes: Edit['changes'], selection?: Edit['selection']): Edit {
  changes.sort((a, b) => a.from - b.from)
  const nextSelection = selection ?? {
    anchor: map(c.selection.anchor, changes),
    head: map(c.selection.head, changes),
  }
  if (changes.length > 64) {
    const from = changes[0]!.from,
      to = changes[changes.length - 1]!.to
    let insert = c.text.slice(from, to)
    for (const change of [...changes].reverse())
      insert = insert.slice(0, change.from - from) + change.insert + insert.slice(change.to - from)
    changes = [{ from, to, insert }]
  }
  return { changes, selection: nextSelection }
}
function range(c: Capture) {
  return {
    from: Math.min(c.selection.anchor, c.selection.head),
    to: Math.max(c.selection.anchor, c.selection.head),
  }
}
function direction(c: Capture, from: number, to: number) {
  return c.selection.anchor > c.selection.head
    ? { anchor: to, head: from }
    : { anchor: from, head: to }
}
function exactNode(c: Capture, type: string): SyntaxNode | undefined {
  const r = range(c)
  return c.syntax.nodes.find(
    (n) =>
      n.type === type &&
      n.status === 'valid' &&
      ((n.from === r.from && n.to === r.to) ||
        n.contentRanges?.some((s) => s.from === r.from && s.to === r.to)),
  )
}
function removeMarkers(c: Capture, node: SyntaxNode): Edit {
  const changes = node.markerRanges.map((m) => ({ ...m, insert: '' }))
  return finish(c, changes)
}
function inline(c: Capture, action: string, input?: string): Edit {
  const r = range(c),
    selected = c.text.slice(r.from, r.to)
  const type = (
    {
      bold: 'strong',
      italic: 'emphasis',
      strike: 'strikethrough',
      inlineCode: 'inlineCode',
      link: 'link',
    } as Record<string, string>
  )[action]!
  const existing = exactNode(c, type)
  if (existing && action !== 'link') return removeMarkers(c, existing)
  if (action === 'link' && existing?.contentRanges?.length === 2) {
    safeExistingLink(c, existing)
    const target = linkTarget(input)
    const destination = existing.contentRanges[1]!
    return finish(c, [{ ...destination, insert: target }])
  }
  if (/\r|\n/.test(selected)) unsupported('行内格式不能跨行，请缩小选区。')
  if (c.syntax.nodes.some((n) => n.status !== 'valid' && n.from < r.to && n.to > r.from))
    unsupported('选区包含尚未闭合的 Markdown，请先补全语法。')
  if (
    c.syntax.nodes.some((n) =>
      n.markerRanges.some(
        (m) => (r.from > m.from && r.from < m.to) || (r.to > m.from && r.to < m.to),
      ),
    )
  )
    unsupported('选区切入了 Markdown 标记，请选择完整内容。')
  if (
    c.syntax.nodes.some(
      (n) =>
        ['strong', 'emphasis', 'strikethrough', 'link', 'inlineCode', 'image', 'escape'].includes(
          n.type,
        ) &&
        ((n.from < r.from && r.from < n.to && r.to > n.to) ||
          (r.from < n.from && n.from < r.to && r.to < n.to)),
    )
  )
    unsupported('选区跨越了部分 Markdown 结构，请选择完整内容。')
  if (
    c.syntax.nodes.some(
      (n) =>
        ['inlineCode', 'codeSpan', 'link', 'image'].includes(n.type) &&
        n.from <= r.from &&
        n.to >= r.to,
    )
  )
    unsupported('当前位置位于代码、链接或图片语法内，请先选择完整外部内容。')
  if (
    r.from > 0 &&
    /\\$/.test(c.text.slice(0, r.from)) &&
    /\\+$/.exec(c.text.slice(0, r.from))![0].length % 2
  )
    unsupported('选区紧接转义符，不能安全插入格式标记。')
  let left = '',
    right = ''
  if (action === 'link') {
    const target = linkTarget(input)
    if (/[\[\]]/.test(selected)) unsupported('链接文字包含方括号，请先转义或缩小选区。')
    left = '['
    right = `](${target})`
  } else if (action === 'inlineCode') {
    const longest = Math.max(0, ...Array.from(selected.matchAll(/`+/g), (m) => m[0].length))
    const fence = '`'.repeat(longest + 1)
    const pad =
      selected.startsWith('`') ||
      selected.endsWith('`') ||
      (/^ .* $/.test(selected) && /\S/.test(selected))
        ? ' '
        : ''
    left = fence + pad
    right = pad + fence
  } else {
    if (selected && /^\s|\s$/.test(selected)) unsupported('强调选区首尾不能是空白，请调整选区。')
    const delimiter = action === 'bold' ? '**' : action === 'italic' ? '*' : '~~'
    const nested = c.syntax.nodes.some(
      (n) =>
        n.type !== type &&
        ['strong', 'emphasis', 'strikethrough'].includes(n.type) &&
        n.status === 'valid' &&
        n.contentRanges?.some((s) => s.from === r.from && s.to === r.to),
    )
    if (!nested && (c.text[r.from - 1] === delimiter[0] || c.text[r.to] === delimiter[0]))
      unsupported('选区邻接同类标记，请选择完整已格式化内容再切换。')
    left = right = delimiter
  }
  return finish(
    c,
    [{ from: r.from, to: r.to, insert: left + selected + right }],
    direction(c, r.from + left.length, r.to + left.length),
  )
}
function linkTarget(input?: string): string {
  const target = (input ?? '').trim()
  if (
    !target ||
    /[\u0000-\u0020\u007f]/.test(target) ||
    (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^(https?:|mailto:)/i.test(target))
  )
    unsupported('请输入有效的 http(s)、mailto 或相对链接；不能包含空白或控制字符。')
  // Encode URI delimiters instead of emitting Markdown escapes that older host
  // link parsers cannot safely include in their destination range.
  return target.replace(/[\\()]/g, (char) => ({ '\\': '%5C', '(': '%28', ')': '%29' })[char]!)
}
function safeExistingLink(c: Capture, node: SyntaxNode) {
  const closing = node.to - 1
  const slashes = /\\*$/.exec(c.text.slice(0, closing))![0].length
  if (slashes % 2 || c.text[node.to] === ')')
    unsupported('现有链接的括号边界无法可靠确认，请先修正链接或使用编码后的地址。')
}
function lines(c: Capture, action: string): Edit {
  const r = range(c)
  const from = r.from === 0 ? 0 : c.text.lastIndexOf('\n', r.from - 1) + 1
  const exclusiveEnd = r.to > r.from && c.text[r.to - 1] === '\n' ? r.to - 1 : r.to
  const end = c.text.indexOf('\n', exclusiveEnd)
  const to = end < 0 ? c.text.length : end > 0 && c.text[end - 1] === '\r' ? end - 1 : end
  const source = c.text.slice(from, to)
  const entries = source.split(/\r\n|\n/)
  const endings = source.match(/\r\n|\n/g) ?? []
  if (action !== 'quote' && entries.some((line) => /^(?: {4}|\t| {0,3}>)/.test(line)))
    unsupported('暂不转换嵌套引用或缩进代码；请先选择普通段落。')
  const heading = /^heading([1-6])$/.exec(action)
  const prefix = heading
    ? `${'#'.repeat(Number(heading[1]))} `
    : action === 'bullet'
      ? '- '
      : action === 'ordered'
        ? '1. '
        : action === 'task'
          ? '- [ ] '
          : '> '
  const pattern = heading
    ? new RegExp(`^ {0,3}#{${heading[1]}}(?:[ \\t]+|$)`)
    : action === 'bullet'
      ? /^ {0,3}[-+*] /
      : action === 'ordered'
        ? /^ {0,3}\d+[.)] /
        : action === 'task'
          ? /^ {0,3}[-+*] \[[ xX]\] /
          : /^ {0,3}> ?/
  const remove =
    entries.some((line) => pattern.test(line)) &&
    entries.every((line) => !line || pattern.test(line))
  const changes: Edit['changes'] = []
  let offset = from
  for (let i = 0; i < entries.length; i++) {
    const line = entries[i]!
    if (line || entries.length === 1) {
      const matched = remove
        ? (pattern.exec(line)?.[0] ?? '')
        : heading
          ? (/^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(line)?.[0] ?? '')
          : ['bullet', 'ordered', 'task'].includes(action)
            ? (/^ {0,3}(?:[-+*] |\d+[.)] )(?:\[[ xX]\] )?/.exec(line)?.[0] ?? '')
            : ''
      changes.push({
        from: offset,
        to: offset + matched.length,
        insert: remove ? '' : action === 'ordered' ? `${i + 1}. ` : prefix,
      })
      if (heading && matched) {
        const closing = /[ \t]+#+[ \t]*$/.exec(line.slice(matched.length))
        if (closing)
          changes.push({
            from: offset + matched.length + closing.index,
            to: offset + line.length,
            insert: '',
          })
      }
    }
    offset += line.length + (endings[i]?.length ?? 0)
  }
  return finish(c, changes)
}
export function transform(c: Capture, action: string, input?: string): Edit {
  const r = range(c)
  if (!c.syntax.complete || c.syntax.context === 'unknown')
    unsupported('无法确认完整语法上下文，请选择更小的完整段落后重试。')
  if (
    r.from < 0 ||
    r.to > c.text.length ||
    !Number.isInteger(r.from) ||
    !Number.isInteger(r.to) ||
    splitSurrogate(c.text, r.from) ||
    splitSurrogate(c.text, r.to) ||
    !graphemeBoundary(c.text, r.from) ||
    !graphemeBoundary(c.text, r.to)
  )
    unsupported('选区不是有效的 Unicode 文本边界。')
  if (action === 'fence') {
    const existing = exactNode(c, 'fencedCode') ?? exactNode(c, 'codeBlock')
    const content = existing?.contentRanges?.[0]
    if (existing && content) {
      const insert = c.text.slice(content.from, content.to)
      return finish(
        c,
        [{ from: existing.from, to: existing.to, insert }],
        direction(c, existing.from, existing.from + insert.length),
      )
    }
  }
  if (c.syntax.context === 'code')
    unsupported('代码上下文中不应用 Markdown 格式；完整选择代码块可取消围栏。')
  if (action === 'unlink') {
    const node = exactNode(c, 'link'),
      label = node?.contentRanges?.[0]
    if (!node || !label) unsupported('请完整选择链接或链接文字后取消链接。')
    safeExistingLink(c, node!)
    const insert = c.text.slice(label!.from, label!.to)
    return finish(
      c,
      [{ from: node!.from, to: node!.to, insert }],
      direction(c, node!.from, node!.from + insert.length),
    )
  }
  if (['bold', 'italic', 'strike', 'inlineCode', 'link'].includes(action))
    return inline(c, action, input)
  if (c.syntax.context === 'table')
    unsupported('请使用表格操作编辑结构；段落格式不能直接覆盖表格。')
  if (action === 'fence') {
    const text = c.text.slice(r.from, r.to)
    if (
      (r.from && c.text[r.from - 1] !== '\n') ||
      (r.to < c.text.length && !['\n', '\r'].includes(c.text[r.to]!))
    )
      unsupported('代码块需要选择完整行。')
    const fence = '`'.repeat(
      Math.max(3, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)),
    )
    const left = fence + c.lineEnding,
      right = (text.endsWith('\n') ? '' : c.lineEnding) + fence
    return finish(
      c,
      [{ from: r.from, to: r.to, insert: left + text + right }],
      direction(c, r.from + left.length, r.to + left.length),
    )
  }
  if (/^heading[1-6]$/.test(action) || ['bullet', 'ordered', 'task', 'quote'].includes(action))
    return lines(c, action)
  return unsupported('不支持的格式操作。')
}

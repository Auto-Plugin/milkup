/** A deliberately small, fully consumed Mermaid grammar. No DOM or executable directives. */
export const limits = Object.freeze({ source: 32768, nodes: 100, edges: 200, label: 256 })
export class DiagramError extends Error {
  constructor(readonly code: 'syntax' | 'unsupported' | 'limit' | 'layout' = 'unsupported') {
    super(
      code === 'limit' || code === 'layout'
        ? '图表超过安全解析或布局预算，已保留完整源码。'
        : '图表含未支持或不完整语法，已保留完整源码。',
    )
    this.name = 'DiagramError'
  }
}
export interface FlowNode {
  id: string
  label: string
  shape: 'rect' | 'rounded' | 'diamond'
}
export interface Edge {
  from: string
  to: string
  label: string
}
export interface Participant {
  id: string
  label: string
  actor: boolean
}
export type Diagram =
  | { kind: 'flow'; direction: 'TD' | 'LR'; nodes: FlowNode[]; edges: Edge[] }
  | { kind: 'sequence'; participants: Participant[]; messages: (Edge & { dashed: boolean })[] }
  | { kind: 'pie'; title: string; slices: { label: string; value: number }[] }

export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Diagram rendering cancelled')
}
function fail(code: ConstructorParameters<typeof DiagramError>[0] = 'syntax'): never {
  throw new DiagramError(code)
}
function label(text: string, allowEmpty = false): string {
  const value = text.trim()
  if (value.length > limits.label) fail('limit')
  // Markdown strings, HTML, entity decoding and escape sequences are not this dialect.
  if (
    (!value && !allowEmpty) ||
    /[`\\\u0000-\u001f\u007f]/u.test(value) ||
    /<\/?[A-Za-z!][^>]*>|&(?:#\w+|[A-Za-z]+);/u.test(value)
  )
    fail('unsupported')
  return value
}
function quoted(text: string): string {
  if (!text.startsWith('"')) return label(text)
  if (text.length < 2 || !text.endsWith('"') || text.slice(1, -1).includes('"')) fail()
  return label(text.slice(1, -1))
}

/** One scan: newline/semicolon delimit statements outside shapes and quoted text. */
function statements(source: string, signal?: AbortSignal): string[] {
  if (source.length > limits.source) fail('limit')
  const result: string[] = []
  let start = 0,
    quote = false
  const closers: string[] = []
  const push = (end: number) => {
    const value = source.slice(start, end).trim()
    if (value) result.push(value)
  }
  for (let i = 0; i < source.length; i++) {
    if ((i & 1023) === 0) checkCancelled(signal)
    const char = source[i]!
    if (char === '"') quote = !quote
    if (quote) {
      if (char === '\n' || char === '\r') fail()
      continue
    }
    if (char === '%' && source[i + 1] === '%' && closers.length === 0) {
      if (source[i + 2] === '{') fail('unsupported')
      push(i)
      while (i < source.length && source[i] !== '\n') i++
      start = i + 1
      continue
    }
    if (char === '\n' || char === '\r') {
      if (closers.length) fail()
      push(i)
      start = i + 1
    } else if (char === ';' && !closers.length) {
      push(i)
      start = i + 1
    } else if (result[0] !== 'sequenceDiagram' && result[0] !== 'pie' && '[({'.includes(char)) {
      closers.push(char === '[' ? ']' : char === '(' ? ')' : '}')
    } else if (result[0] !== 'sequenceDiagram' && result[0] !== 'pie' && '])}'.includes(char)) {
      if (closers.pop() !== char) fail()
    }
  }
  if (quote || closers.length) fail()
  push(source.length)
  return result
}

const reserved = new Set([
  'subgraph',
  'end',
  'direction',
  'click',
  'style',
  'class',
  'classDef',
  'linkStyle',
  'flowchart',
  'graph',
  'accTitle',
  'accDescr',
])
function flow(lines: string[], direction: 'TD' | 'LR', signal?: AbortSignal): Diagram {
  const nodes = new Map<string, FlowNode>(),
    edges: Edge[] = []
  for (const statement of lines) {
    checkCancelled(signal)
    let cursor = 0
    const spaces = () => {
      while (/\s/u.test(statement[cursor] ?? '') && cursor < statement.length) cursor++
    }
    const readNode = (): string => {
      spaces()
      const idPattern = /[A-Za-z_][A-Za-z0-9_]*/y
      idPattern.lastIndex = cursor
      const match = idPattern.exec(statement)
      if (!match || reserved.has(match[0])) fail('unsupported')
      const id = match[0]
      cursor = idPattern.lastIndex
      spaces()
      if (id.length > 64) fail('limit')
      let value: FlowNode | undefined
      const open = statement[cursor]
      if (open && '[({'.includes(open)) {
        const close = open === '[' ? ']' : open === '(' ? ')' : '}'
        const start = ++cursor
        let inQuote = false
        while (cursor < statement.length) {
          const ch = statement[cursor]!
          if (ch === '"') inQuote = !inQuote
          if (!inQuote && ch === close) break
          if (!inQuote && '[({])}'.includes(ch)) fail('unsupported')
          cursor++
        }
        if (cursor === statement.length) fail()
        value = {
          id,
          label: quoted(statement.slice(start, cursor).trim()),
          shape: open === '[' ? 'rect' : open === '(' ? 'rounded' : 'diamond',
        }
        cursor++
      }
      if (!nodes.has(id) && nodes.size >= limits.nodes) fail('limit')
      if (value || !nodes.has(id)) nodes.set(id, value ?? { id, label: id, shape: 'rect' })
      return id
    }
    let from = readNode()
    spaces()
    while (cursor < statement.length) {
      let edgeLabel = ''
      if (statement.startsWith('-->', cursor)) {
        cursor += 3
        spaces()
        if (statement[cursor] === '|') {
          const end = statement.indexOf('|', cursor + 1)
          if (end < 0) fail()
          edgeLabel = quoted(statement.slice(cursor + 1, end).trim())
          cursor = end + 1
        }
      } else if (statement.startsWith('-- ', cursor)) {
        const end = statement.indexOf('-->', cursor + 3)
        if (end < 0) fail()
        edgeLabel = quoted(statement.slice(cursor + 3, end).trim())
        cursor = end + 3
      } else fail('unsupported')
      const to = readNode()
      if (edges.length >= limits.edges) fail('limit')
      edges.push({ from, to, label: edgeLabel })
      from = to
      spaces()
    }
  }
  if (!nodes.size) fail()
  return { kind: 'flow', direction, nodes: [...nodes.values()], edges }
}

function sequence(lines: string[], signal?: AbortSignal): Diagram {
  const participants = new Map<string, Participant>(),
    declared = new Set<string>()
  const messages: (Edge & { dashed: boolean })[] = []
  const add = (id: string, value?: Participant) => {
    if (id.length > 64) fail('limit')
    if (!participants.has(id) && participants.size >= limits.nodes) fail('limit')
    if (value || !participants.has(id))
      participants.set(id, value ?? { id, label: id, actor: false })
  }
  for (const line of lines) {
    checkCancelled(signal)
    const declaration = /^(participant|actor)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+(.+))?$/u.exec(
      line,
    )
    if (declaration) {
      const id = declaration[2]!
      if (declared.has(id)) fail('unsupported')
      declared.add(id)
      add(id, { id, label: label(declaration[3] ?? id), actor: declaration[1] === 'actor' })
      continue
    }
    const message =
      /^([A-Za-z_][A-Za-z0-9_]*)\s*(-->>|->>)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/u.exec(line)
    if (!message) fail('unsupported')
    const from = message[1]!,
      to = message[3]!
    add(from)
    add(to)
    if (messages.length >= limits.edges) fail('limit')
    messages.push({ from, to, dashed: message[2] === '-->>', label: label(message[4]!, true) })
  }
  if (!participants.size) fail()
  return { kind: 'sequence', participants: [...participants.values()], messages }
}

function pie(lines: string[], signal?: AbortSignal): Diagram {
  let title = '',
    hasTitle = false
  const slices: { label: string; value: number }[] = [],
    labels = new Set<string>()
  let total = 0
  for (const line of lines) {
    checkCancelled(signal)
    if (line.startsWith('title ')) {
      if (hasTitle) fail('unsupported')
      hasTitle = true
      title = label(line.slice(6))
      continue
    }
    const match = /^"([^"\r\n]+)"\s*:\s*(\d+(?:\.\d+)?)$/u.exec(line)
    if (!match) fail('unsupported')
    const name = label(match[1]!),
      value = Number(match[2])
    if (!Number.isFinite(value) || (value === 0 && /[1-9]/u.test(match[2]!)) || labels.has(name))
      fail('unsupported')
    labels.add(name)
    total += value
    if (slices.length >= limits.nodes) fail('limit')
    slices.push({ label: name, value })
  }
  if (!slices.length || total <= 0 || !Number.isFinite(total)) fail()
  return { kind: 'pie', title, slices }
}

export function parseDiagram(source: string, signal?: AbortSignal): Diagram {
  checkCancelled(signal)
  const [header, ...lines] = statements(source, signal)
  const heading = /^(?:flowchart|graph)\s+(TD|TB|LR)$/u.exec(header ?? '')
  if (heading) return flow(lines, heading[1] === 'LR' ? 'LR' : 'TD', signal)
  if (header === 'sequenceDiagram') return sequence(lines, signal)
  if (header === 'pie') return pie(lines, signal)
  fail('unsupported')
}

import type { SdkDocumentPresentationNode } from '@milkup/plugin-sdk'
type Vector = Extract<SdkDocumentPresentationNode, { type: 'vector' }>
type Primitive = Vector['children'][number]
type Description = { text: string; type?: string; wrap?: boolean }
type FlowNode = { id: string; label: string; shape: string }
type Edge = { a: string; b: string; label: string }
type SequenceAction = {
  type: string
  actor: string
  description?: Description
  draw?: string
  from: string
  to: string
  signalType: number
  msg: Description
}
type Message = { from: string; to: string; signalType: number; label: string }
import flow from './vendor/flow-parser.mjs'
import sequence from './vendor/sequence-parser.mjs'
export const LIMITS = Object.freeze({
  source: 8192,
  lines: 128,
  nodes: 20,
  edges: 32,
  actors: 6,
  messages: 16,
  label: 24,
})
const unsupported = (detail: string): never => {
  throw new Error(`受限流程图与时序图：${detail}。已保留完整源码。`)
}
const label = (value: unknown): string => {
  const s = String(value ?? '').trim()
  if (!s || [...s].length > LIMITS.label || /[<>`\n\r]/u.test(s))
    unsupported('plain labels must contain 1–24 characters, without HTML or Markdown')
  return s
}
const texts = (x: number, y: number, s: string): Primitive[] => {
  const chars = [...s]
  const lines = chars.length <= 12 ? [s] : [chars.slice(0, 12).join(''), chars.slice(12).join('')]
  return lines.map((text, i) => ({
    type: 'text',
    x,
    y: y + (i - (lines.length - 1) / 2) * 17,
    text,
    anchor: 'middle',
    fontSize: 14,
  }))
}
const line = (x1: number, y1: number, x2: number, y2: number): Primitive => ({
  type: 'line',
  x1,
  y1,
  x2,
  y2,
  stroke: 'border',
  strokeWidth: 1.5,
})
const arrow = (x: number, y: number, dx: number, dy: number): Primitive => ({
  type: 'polygon',
  points: [
    { x, y },
    { x: x - dx * 9 + dy * 4, y: y - dy * 9 - dx * 4 },
    { x: x - dx * 9 - dy * 4, y: y - dy * 9 + dx * 4 },
  ],
  fill: 'foreground',
})
const denyMethods = [
  'addClass',
  'addSubGraph',
  'setAccDescription',
  'setAccTitle',
  'setClass',
  'setClickEvent',
  'setLink',
  'setTooltip',
  'updateLink',
  'updateLinkInterpolate',
  'setDiagramTitle',
  'parseBoxData',
]
const base = () =>
  Object.fromEntries(
    denyMethods.map((key) => [key, () => unsupported(`${key} syntax is not supported`)]),
  )
function flowchart(source: string): Vector {
  const nodes = new Map<string, FlowNode>(),
    edges: Edge[] = []
  let direction = 'TD'
  const yy = {
    ...base(),
    lex: { firstGraph: () => true },
    setDirection(v: string) {
      direction = v.trim()
      if (!['TD', 'TB', 'LR'].includes(direction))
        unsupported('only TD/TB/LR flow direction is supported')
    },
    addVertex(id: string, description?: Description, shape?: string, ...rest: unknown[]) {
      if (rest.some((v) => v !== undefined)) unsupported('node metadata/styles are not supported')
      if (shape && !['square', 'round', 'diamond'].includes(shape))
        unsupported(`shape ${shape} is not supported`)
      if (description?.type && !['text', 'string'].includes(description.type))
        unsupported('Markdown labels are not supported')
      const old = nodes.get(id)
      nodes.set(id, {
        id,
        label: description ? label(description.text) : (old?.label ?? label(id)),
        shape: shape ?? old?.shape ?? 'square',
      })
      if (nodes.size > LIMITS.nodes) unsupported('node limit exceeded')
    },
    destructLink(raw: string, start?: string) {
      if (raw.trim() !== '-->' || (start && start.trim() !== '--'))
        unsupported('only directed --> flow edges are supported')
      return { type: 'arrow_point', stroke: 'normal', length: 1 }
    },
    addLink(
      from: string[],
      to: string[],
      style: { type: string; stroke: string; length: number; text?: Description },
      ...extra: unknown[]
    ) {
      if (extra.some((v) => v !== undefined)) unsupported('edge metadata is not supported')
      if (style.type !== 'arrow_point' || style.stroke !== 'normal' || style.length !== 1)
        unsupported('edge style is not supported')
      if (style.text?.type && !['text', 'string'].includes(style.text.type))
        unsupported('Markdown edge labels are not supported')
      for (const a of from)
        for (const b of to) {
          edges.push({ a, b, label: style.text ? label(style.text.text) : '' })
          if (edges.length > LIMITS.edges) unsupported('edge limit exceeded')
        }
    },
  }
  flow.yy = yy
  flow.parse(source + '\n')
  if (!nodes.size) unsupported('diagram is empty')
  for (const node of nodes.values())
    if (node.shape === 'diamond' && [...node.label].length > 12)
      unsupported('diamond labels are limited to 12 characters')
  if (direction === 'LR' && edges.some((edge) => [...edge.label].length > 4))
    unsupported('horizontal edge labels are limited to 4 characters')
  const incoming = new Map([...nodes.keys()].map((k) => [k, 0])),
    levels = new Map([...nodes.keys()].map((k) => [k, 0]))
  for (const { a, b } of edges) {
    if (!nodes.has(a) || !nodes.has(b)) unsupported('edge references missing node')
    incoming.set(b, incoming.get(b)! + 1)
  }
  const queue = [...nodes.keys()].filter((k) => incoming.get(k) === 0)
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i]!
    for (const e of edges.filter((e) => e.a === a)) {
      levels.set(e.b, Math.max(levels.get(e.b)!, levels.get(a)! + 1))
      incoming.set(e.b, incoming.get(e.b)! - 1)
      if (incoming.get(e.b) === 0) queue.push(e.b)
    }
  }
  if (queue.length !== nodes.size) unsupported('cyclic flowcharts are not supported')
  for (const { a, b } of edges)
    if (levels.get(b)! - levels.get(a)! !== 1)
      unsupported('flow edges that skip a layout layer are not supported')
  const rows = new Map<number, number>(),
    pos = new Map<string, { x: number; y: number }>()
  let width = 0,
    height = 0
  for (const n of nodes.values()) {
    const rank = levels.get(n.id)!,
      index = rows.get(rank) ?? 0
    rows.set(rank, index + 1)
    const x = 30 + (direction === 'LR' ? rank * 310 : index * 310),
      y = 30 + (direction === 'LR' ? index * 140 : rank * 140)
    pos.set(n.id, { x, y })
    width = Math.max(width, x + 270)
    height = Math.max(height, y + 90)
  }
  if (width > 4096 || height > 4096) unsupported('layout limit exceeded')
  const children: Primitive[] = []
  for (const e of edges) {
    const a = pos.get(e.a)!,
      b = pos.get(e.b)!,
      lr = direction === 'LR'
    const x1 = a.x + (lr ? 240 : 120),
      y1 = a.y + (lr ? 30 : 60),
      x2 = b.x + (lr ? 0 : 120),
      y2 = b.y + (lr ? 30 : 0)
    children.push(line(x1, y1, x2, y2))
    const d = Math.hypot(x2 - x1, y2 - y1)
    children.push(arrow(x2, y2, (x2 - x1) / d, (y2 - y1) / d))
    if (e.label) children.push(...texts((x1 + x2) / 2, (y1 + y2) / 2 - 20, e.label))
  }
  for (const n of nodes.values()) {
    const { x, y } = pos.get(n.id)!
    children.push(
      n.shape === 'diamond'
        ? {
            type: 'polygon',
            points: [
              { x: x + 120, y },
              { x: x + 240, y: y + 30 },
              { x: x + 120, y: y + 60 },
              { x, y: y + 30 },
            ],
            stroke: 'border',
            fill: 'background',
          }
        : {
            type: 'rect',
            x,
            y,
            width: 240,
            height: 60,
            radius: n.shape === 'round' ? 15 : 2,
            stroke: 'border',
            fill: 'background',
          },
    )
    children.push(...texts(x + 120, y + 35, n.label))
  }
  return { type: 'vector', width, height, children }
}
function sequenceDiagram(source: string): Vector {
  const actors = new Map<string, string>(),
    messages: Message[] = []
  const participant = (id: string, description?: Description, draw?: string) => {
    if (draw && draw !== 'participant') unsupported('actor shapes are not supported')
    const old = actors.get(id)
    actors.set(id, description?.text ? label(description.text) : (old ?? label(id)))
    if (actors.size > LIMITS.actors) unsupported('participant limit exceeded')
  }
  const yy = {
    ...base(),
    LINETYPE: { SOLID: 0, DOTTED: 1, SOLID_OPEN: 5, DOTTED_OPEN: 6 },
    PLACEMENT: { LEFTOF: 0, RIGHTOF: 1, OVER: 2 },
    parseMessage: (x: string) => {
      if (/^:?\s*(?:wrap|nowrap):/u.test(x))
        unsupported('message wrapping controls are not supported')
      return { text: x.replace(/^:/u, ''), wrap: false }
    },
    apply(values: unknown) {
      const visit = (value: unknown, depth: number): void => {
        if (depth > 32) unsupported('nesting limit exceeded')
        if (Array.isArray(value)) {
          for (const item of value) visit(item, depth + 1)
          return
        }
        if (!value) return
        const action = value as SequenceAction
        const allowed =
          action.type === 'addParticipant'
            ? ['type', 'actor', 'description', 'draw']
            : ['type', 'from', 'to', 'signalType', 'msg']
        if (Object.keys(action).some((key) => !allowed.includes(key)))
          unsupported('participant configuration and message effects are not supported')
        if (action.type === 'addParticipant') {
          participant(action.actor, action.description, action.draw)
          return
        }
        if (action.type !== 'addMessage' || ![0, 1].includes(action.signalType))
          unsupported(`${action.type} / arrow style is not supported`)
        if (action.from === action.to) unsupported('self messages are not supported')
        messages.push({ ...action, label: label(action.msg.text) })
        if (messages.length > LIMITS.messages) unsupported('message limit exceeded')
      }
      visit(values, 0)
    },
  }
  sequence.yy = yy
  sequence.parse(source + '\n')
  if (!actors.size) unsupported('diagram is empty')
  const children: Primitive[] = [],
    xs = new Map([...actors.keys()].map((k, i) => [k, 150 + i * 310])),
    height = 140 + messages.length * 70,
    width = actors.size * 310
  for (const [id, name] of actors) {
    const x = xs.get(id)!
    children.push(
      {
        type: 'rect',
        x: x - 120,
        y: 20,
        width: 240,
        height: 55,
        radius: 3,
        stroke: 'border',
        fill: 'background',
      },
      ...texts(x, 53, name),
    )
    for (let y = 75; y < height - 20; y += 14)
      children.push(line(x, y, x, Math.min(y + 7, height - 20)))
  }
  messages.forEach((m, i) => {
    const x1 = xs.get(m.from)!,
      x2 = xs.get(m.to)!,
      y = 120 + i * 70,
      dx = Math.sign(x2 - x1)
    if (m.signalType === 0) children.push(line(x1, y, x2, y))
    else
      for (let x = x1; dx * (x2 - x) > 0; x += dx * 14)
        children.push(line(x, y, x + dx * Math.min(7, Math.abs(x2 - x)), y))
    children.push(arrow(x2, y, dx, 0), ...texts((x1 + x2) / 2, y - 20, m.label))
  })
  return { type: 'vector', width, height, children }
}
export function compileDiagram(source: string): Vector {
  if (
    typeof source !== 'string' ||
    source.length > LIMITS.source ||
    source.split('\n').length > LIMITS.lines
  )
    unsupported('source budget exceeded')
  if (
    /(?:^|[\n;])\s*(?:create|destroy|activate|deactivate|autonumber|title|accTitle|accDescr)\b/u.test(
      source,
    )
  )
    unsupported('dynamic participants, activation, numbering and titles are not supported')
  if (
    /^\s*---/u.test(source) ||
    /%%\s*\{/u.test(source) ||
    /\b(?:click|href|linkStyle|classDef|style|subgraph)\b/u.test(source)
  )
    unsupported('configuration, links, style and subgraph syntax are not supported')
  if ([...source.matchAll(/^\s*(?:flowchart|graph|sequenceDiagram)\b/gmu)].length !== 1)
    unsupported('exactly one diagram header is required')
  if (/^\s*(?:flowchart|graph)\s/u.test(source)) return flowchart(source)
  if (/^\s*sequenceDiagram\b/u.test(source)) return sequenceDiagram(source)
  return unsupported('only limited flowchart and sequenceDiagram are supported')
}

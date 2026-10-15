import type { SdkDocumentPresentationNode, SdkDocumentVectorPrimitive } from '@milkup/plugin-sdk'
import { checkCancelled, DiagramError, parseDiagram, type Diagram, type FlowNode } from './parser'

type Vector = Extract<SdkDocumentPresentationNode, { type: 'vector' }>
type Point = { x: number; y: number }
type Box = Point & { width: number; height: number; lines: string[] }
export type DiagramRender =
  | { ok: true; vector: Vector; accessibleText: string }
  | { ok: false; source: string; message: string }
const FONT = 14,
  LINE = 18,
  PAD = 24
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
function charWidth(grapheme: string): number {
  // Conservative advance, without a DOM font measurement dependency in the Worker.
  return /^[\x20-\x7e]$/u.test(grapheme) ? 14 : 20
}
function width(text: string): number {
  let result = 0
  for (const item of segmenter.segment(text)) result += charWidth(item.segment)
  return result
}
export function wrapLabel(text: string, maximum = 208): string[] {
  const lines: string[] = []
  let line = '',
    measured = 0
  for (const item of segmenter.segment(text)) {
    const advance = charWidth(item.segment)
    if (line && measured + advance > maximum) {
      lines.push(line)
      line = ''
      measured = 0
    }
    line += item.segment
    measured += advance
  }
  if (line || !lines.length) lines.push(line)
  return lines
}
function push(children: SdkDocumentVectorPrimitive[], node: SdkDocumentVectorPrimitive): void {
  if (children.length >= 4095) throw new DiagramError('limit')
  children.push(node)
}
function textLines(
  children: SdkDocumentVectorPrimitive[],
  lines: string[],
  x: number,
  y: number,
  anchor: 'middle' | 'start' = 'middle',
): void {
  for (const [i, text] of lines.entries())
    push(children, {
      type: 'text',
      x,
      y: y + i * LINE,
      text,
      tone: 'foreground',
      fontSize: FONT,
      anchor,
    })
}
function line(
  children: SdkDocumentVectorPrimitive[],
  a: Point,
  b: Point,
  tone: 'border' | 'foreground' = 'foreground',
): void {
  push(children, {
    type: 'line',
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    stroke: tone,
    strokeWidth: 1.5,
  })
}
function arrow(children: SdkDocumentVectorPrimitive[], points: Point[], dashed = false): void {
  if (!dashed)
    push(children, {
      type: 'polyline',
      points,
      stroke: 'foreground',
      strokeWidth: 1.5,
      fill: 'none',
    })
  else
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!,
        length = Math.hypot(b.x - a.x, b.y - a.y)
      const step = Math.max(12, length / 64)
      for (let distance = 0; distance < length; distance += step) {
        const end = Math.min(distance + step * 0.6, length)
        line(
          children,
          {
            x: a.x + ((b.x - a.x) * distance) / length,
            y: a.y + ((b.y - a.y) * distance) / length,
          },
          { x: a.x + ((b.x - a.x) * end) / length, y: a.y + ((b.y - a.y) * end) / length },
        )
      }
    }
  const end = points.at(-1)!,
    previous = points.at(-2)!
  const angle = Math.atan2(end.y - previous.y, end.x - previous.x)
  const base = { x: end.x - 8 * Math.cos(angle), y: end.y - 8 * Math.sin(angle) }
  push(children, {
    type: 'polygon',
    points: [
      end,
      { x: base.x + 4 * Math.sin(angle), y: base.y - 4 * Math.cos(angle) },
      { x: base.x - 4 * Math.sin(angle), y: base.y + 4 * Math.cos(angle) },
    ],
    fill: 'foreground',
  })
}
function nodeSize(node: FlowNode): Box {
  const lines = wrapLabel(node.label),
    textWidth = Math.max(...lines.map(width))
  return {
    x: 0,
    y: 0,
    lines,
    width: Math.max(96, textWidth * (node.shape === 'diamond' ? 2 : 1) + 32),
    height: Math.max(40, lines.length * LINE * (node.shape === 'diamond' ? 2 : 1) + 16),
  }
}

/** Kosaraju SCC followed by a DAG longest path: bounded O(nodes + edges), including cycles. */
function ranks(model: Extract<Diagram, { kind: 'flow' }>): number[] {
  const ids = new Map(model.nodes.map((n, i) => [n.id, i]))
  const forward = model.nodes.map(() => [] as number[]),
    reverse = model.nodes.map(() => [] as number[])
  for (const edge of model.edges) {
    const a = ids.get(edge.from)!,
      b = ids.get(edge.to)!
    forward[a]!.push(b)
    reverse[b]!.push(a)
  }
  const seen = new Set<number>(),
    order: number[] = []
  const visit = (node: number) => {
    if (seen.has(node)) return
    seen.add(node)
    for (const next of forward[node]!) visit(next)
    order.push(node)
  }
  model.nodes.forEach((_, i) => visit(i))
  const component = model.nodes.map(() => -1),
    groups: number[][] = []
  const assign = (node: number, group: number) => {
    if (component[node] !== -1) return
    component[node] = group
    groups[group]!.push(node)
    for (const next of reverse[node]!) assign(next, group)
  }
  for (const node of order.reverse())
    if (component[node] === -1) {
      groups.push([])
      assign(node, groups.length - 1)
    }
  for (const group of groups) group.sort((a, b) => a - b)
  const outgoing = groups.map(() => new Set<number>()),
    indegree = groups.map(() => 0),
    base = groups.map(() => 0)
  for (let a = 0; a < forward.length; a++)
    for (const b of forward[a]!) {
      const from = component[a]!,
        to = component[b]!
      if (from !== to && !outgoing[from]!.has(to)) {
        outgoing[from]!.add(to)
        indegree[to] = indegree[to]! + 1
      }
    }
  const queue = groups.flatMap((_, i) => (indegree[i] === 0 ? [i] : []))
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!
    for (const next of outgoing[current]!) {
      base[next] = Math.max(base[next]!, base[current]! + groups[current]!.length)
      indegree[next] = indegree[next]! - 1
      if (indegree[next] === 0) queue.push(next)
    }
  }
  const result = model.nodes.map(() => 0)
  groups.forEach((group, i) =>
    group.forEach((node, offset) => {
      result[node] = base[i]! + offset
    }),
  )
  return result
}

function flow(model: Extract<Diagram, { kind: 'flow' }>): {
  vector: Vector
  accessibleText: string
} {
  const horizontal = model.direction === 'LR',
    children: SdkDocumentVectorPrimitive[] = []
  const levels = ranks(model),
    boxes = model.nodes.map(nodeSize)
  const ids = new Map(model.nodes.map((n, i) => [n.id, i]))
  const edgeLabels = model.edges.map((e) => (e.label ? wrapLabel(e.label, 176) : []))
  const gaps = model.nodes.map(() => 16),
    lanes: number[] = [],
    layerEnds: number[] = []
  model.edges.forEach((e, i) => {
    const rank = levels[ids.get(e.from)!]!
    lanes[i] = gaps[rank]!
    gaps[rank] =
      gaps[rank]! +
      (horizontal && edgeLabels[i]!.length
        ? Math.max(...edgeLabels[i]!.map(width)) + 8
        : edgeLabels[i]!.length * LINE + 8)
  })
  // Keep the incoming lane of the next layer clear of the previous layer's labels.
  for (const rank of new Set(
    model.edges.flatMap((edge, i) => (edgeLabels[i]!.length ? [levels[ids.get(edge.from)!]!] : [])),
  ))
    gaps[rank] = gaps[rank]! + 24
  let progress = PAD,
    crossMaximum = 0
  for (let rank = 0; rank <= Math.max(...levels); rank++) {
    let cross = PAD,
      size = 0
    for (let i = 0; i < boxes.length; i++)
      if (levels[i] === rank) {
        const box = boxes[i]!
        box.x = horizontal ? progress : cross
        box.y = horizontal ? cross : progress
        cross += (horizontal ? box.height : box.width) + 24
        size = Math.max(size, horizontal ? box.width : box.height)
      }
    layerEnds[rank] = progress + size
    crossMaximum = Math.max(crossMaximum, cross)
    progress += size + gaps[rank]!
  }
  // Keep outer rails beyond both nodes and labels, so labels never straddle a rail.
  model.edges.forEach((edge, i) => {
    if (!edgeLabels[i]!.length) return
    const a = boxes[ids.get(edge.from)!]!,
      b = boxes[ids.get(edge.to)!]!
    crossMaximum = Math.max(
      crossMaximum,
      horizontal
        ? Math.max(a.y + a.height / 2, b.y + b.height / 2) + edgeLabels[i]!.length * LINE + PAD
        : Math.max(a.x + a.width / 2, b.x + b.width / 2) +
            8 +
            Math.max(...edgeLabels[i]!.map(width)) +
            PAD,
    )
  })
  // Adjacent forward edges use the clear layer gap. Only feedback, skipped layers,
  // and duplicate edges need distinct outer rails.
  const usedPairs = new Set<string>()
  let outerEdges = 0
  model.edges.forEach((edge, i) => {
    const a = boxes[ids.get(edge.from)!]!,
      b = boxes[ids.get(edge.to)!]!
    const pair = `${edge.from}\0${edge.to}`
    const adjacent =
      levels[ids.get(edge.to)!] === levels[ids.get(edge.from)!]! + 1 && !usedPairs.has(pair)
    usedPairs.add(pair)
    const offset = lanes[i]!
    if (adjacent) {
      if (horizontal) {
        const start = { x: a.x + a.width, y: a.y + a.height / 2 },
          end = { x: b.x, y: b.y + b.height / 2 }
        const x = layerEnds[levels[ids.get(edge.from)!]!]! + offset
        arrow(
          children,
          start.y === end.y ? [start, end] : [start, { x, y: start.y }, { x, y: end.y }, end],
        )
        textLines(children, edgeLabels[i]!, x + 4, Math.max(start.y, end.y) + 18, 'start')
      } else {
        const start = { x: a.x + a.width / 2, y: a.y + a.height },
          end = { x: b.x + b.width / 2, y: b.y }
        const y = layerEnds[levels[ids.get(edge.from)!]!]! + offset
        arrow(
          children,
          start.x === end.x ? [start, end] : [start, { x: start.x, y }, { x: end.x, y }, end],
        )
        textLines(children, edgeLabels[i]!, Math.max(start.x, end.x) + 8, y + 18, 'start')
      }
      return
    }
    const rail = crossMaximum + 16 + outerEdges++ * 8
    if (!horizontal) {
      const y = layerEnds[levels[ids.get(edge.from)!]!]! + offset
      arrow(children, [
        { x: a.x + a.width / 2, y: a.y + a.height },
        { x: a.x + a.width / 2, y },
        { x: rail, y },
        { x: rail, y: b.y - 12 },
        { x: b.x + b.width / 2, y: b.y - 12 },
        { x: b.x + b.width / 2, y: b.y },
      ])
      textLines(children, edgeLabels[i]!, a.x + a.width / 2 + 8, y + 18, 'start')
    } else {
      const x = layerEnds[levels[ids.get(edge.from)!]!]! + offset
      arrow(children, [
        { x: a.x + a.width, y: a.y + a.height / 2 },
        { x, y: a.y + a.height / 2 },
        { x, y: rail },
        { x: b.x - 12, y: rail },
        { x: b.x - 12, y: b.y + b.height / 2 },
        { x: b.x, y: b.y + b.height / 2 },
      ])
      textLines(children, edgeLabels[i]!, x + 4, a.y + a.height / 2 + 18, 'start')
    }
  })
  model.nodes.forEach((node, i) => {
    const b = boxes[i]!
    if (node.shape === 'diamond')
      push(children, {
        type: 'polygon',
        points: [
          { x: b.x + b.width / 2, y: b.y },
          { x: b.x + b.width, y: b.y + b.height / 2 },
          { x: b.x + b.width / 2, y: b.y + b.height },
          { x: b.x, y: b.y + b.height / 2 },
        ],
        fill: 'background',
        stroke: 'accent',
        strokeWidth: 1.5,
      })
    else
      push(children, {
        type: 'rect',
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        radius: node.shape === 'rounded' ? 12 : 0,
        fill: 'background',
        stroke: 'accent',
        strokeWidth: 1.5,
      })
    textLines(
      children,
      b.lines,
      b.x + b.width / 2,
      b.y + (b.height - b.lines.length * LINE) / 2 + 14,
    )
  })
  const cross = crossMaximum + (outerEdges ? 32 + outerEdges * 8 : 0)
  return {
    vector: {
      type: 'vector',
      width: horizontal ? progress + PAD : cross,
      height: horizontal ? cross : progress + PAD,
      children,
    },
    accessibleText: `流程图（${model.direction}），${model.nodes.length} 个节点，${model.edges.length} 条连线。\n${model.nodes.map((n) => `${n.id}：${n.label}`).join('\n')}\n${model.edges.map((e) => `${e.from} → ${e.to}${e.label ? `：${e.label}` : ''}`).join('\n')}`,
  }
}

function sequence(model: Extract<Diagram, { kind: 'sequence' }>): {
  vector: Vector
  accessibleText: string
} {
  const children: SdkDocumentVectorPrimitive[] = []
  const lines = model.participants.map((p) => wrapLabel(p.label, 160))
  const heights = lines.map((l) => l.length * LINE + 24)
  const header = Math.max(...heights) + 64
  let x = PAD
  const positions = model.participants.map((p, i) => {
    const size = Math.max(56, ...lines[i]!.map(width)) + 24
    const center = x + size / 2
    x += size + 32
    if (p.actor) {
      push(children, {
        type: 'ellipse',
        cx: center,
        cy: PAD + 10,
        rx: 8,
        ry: 8,
        fill: 'background',
        stroke: 'accent',
        strokeWidth: 1.5,
      })
      line(children, { x: center, y: PAD + 18 }, { x: center, y: PAD + 36 })
      line(children, { x: center - 14, y: PAD + 25 }, { x: center + 14, y: PAD + 25 })
      line(children, { x: center, y: PAD + 36 }, { x: center - 12, y: PAD + 47 })
      line(children, { x: center, y: PAD + 36 }, { x: center + 12, y: PAD + 47 })
      textLines(children, lines[i]!, center, PAD + 64)
    } else {
      push(children, {
        type: 'rect',
        x: center - size / 2,
        y: PAD,
        width: size,
        height: heights[i]!,
        radius: 4,
        fill: 'background',
        stroke: 'accent',
        strokeWidth: 1.5,
      })
      textLines(children, lines[i]!, center, PAD + 22)
    }
    return center
  })
  const ids = new Map(model.participants.map((p, i) => [p.id, i])),
    rows: { y: number; lines: string[] }[] = []
  let y = header + PAD
  for (const message of model.messages) {
    const label = wrapLabel(message.label, 192)
    y += label.length * LINE + 8
    rows.push({ y, lines: label })
    y += message.from === message.to ? 40 : 12
  }
  // Lifelines are deliberately segmented typed lines; arbitrary SVG dash CSS is unavailable.
  for (const position of positions)
    for (let start = header; start < y + 16; start += 16)
      line(
        children,
        { x: position, y: start },
        { x: position, y: Math.min(start + 8, y + 16) },
        'border',
      )
  model.messages.forEach((message, i) => {
    const a = positions[ids.get(message.from)!]!,
      b = positions[ids.get(message.to)!]!,
      row = rows[i]!
    if (a === b) {
      arrow(
        children,
        [
          { x: a, y: row.y },
          { x: a + 48, y: row.y },
          { x: a + 48, y: row.y + 28 },
          { x: a, y: row.y + 28 },
        ],
        message.dashed,
      )
      textLines(children, row.lines, a + 8, row.y - row.lines.length * LINE + 12, 'start')
    } else {
      arrow(
        children,
        [
          { x: a, y: row.y },
          { x: b, y: row.y },
        ],
        message.dashed,
      )
      textLines(children, row.lines, (a + b) / 2, row.y - row.lines.length * LINE + 12)
    }
  })
  return {
    vector: { type: 'vector', width: x + 192, height: y + PAD, children },
    accessibleText: `时序图，${model.participants.length} 位参与者，${model.messages.length} 条消息。\n${model.participants.map((p) => `${p.actor ? '角色' : '参与者'} ${p.id}：${p.label}`).join('\n')}\n${model.messages.map((m) => `${m.from} ${m.dashed ? '-->>' : '->>'} ${m.to}：${m.label}`).join('\n')}`,
  }
}

function pie(model: Extract<Diagram, { kind: 'pie' }>): { vector: Vector; accessibleText: string } {
  const children: SdkDocumentVectorPrimitive[] = [],
    title = wrapLabel(model.title, 600)
  const titleHeight = model.title ? title.length * LINE + 16 : 0
  if (model.title) textLines(children, title, 24, 24, 'start')
  const center = { x: 180, y: 190 + titleHeight },
    radius = 140,
    total = model.slices.reduce((s, n) => s + n.value, 0)
  const tones = ['accent', 'muted', 'foreground', 'border', 'background'] as const
  let angle = -Math.PI / 2,
    legendY = 48 + titleHeight
  model.slices.forEach((slice, i) => {
    const sweep = (slice.value / total) * Math.PI * 2,
      steps = Math.max(1, Math.ceil(sweep / (Math.PI / 90)))
    if (sweep > 0) {
      const points: Point[] = [center]
      for (let p = 0; p <= steps; p++) {
        const theta = angle + (sweep * p) / steps
        points.push({
          x: center.x + radius * Math.cos(theta),
          y: center.y + radius * Math.sin(theta),
        })
      }
      push(children, {
        type: 'polygon',
        points,
        fill: tones[i % tones.length]!,
        stroke: 'border',
        strokeWidth: 1,
      })
      // Numbers outside the pie link visible wedges to the full textual legend.
      if (sweep >= 0.18) {
        const theta = angle + sweep / 2
        textLines(
          children,
          [String(i + 1)],
          center.x + (radius + 18) * Math.cos(theta),
          center.y + (radius + 18) * Math.sin(theta) + 5,
        )
      }
    }
    angle += sweep
    const label = wrapLabel(
      `${i + 1}. ${slice.label}：${slice.value} (${((slice.value / total) * 100).toFixed(1)}%)`,
      320,
    )
    push(children, {
      type: 'rect',
      x: 376,
      y: legendY - 12,
      width: 12,
      height: 12,
      fill: tones[i % tones.length]!,
      stroke: 'foreground',
      strokeWidth: 1,
    })
    textLines(children, label, 400, legendY, 'start')
    legendY += label.length * LINE + 12
  })
  return {
    vector: {
      type: 'vector',
      width: 752,
      height: Math.max(center.y + radius + 40, legendY + PAD),
      children,
    },
    accessibleText: `饼图${model.title ? `：${model.title}` : ''}，总数 ${total}。\n${model.slices.map((s, i) => `${i + 1}. ${s.label}：${s.value}，${((s.value / total) * 100).toFixed(1)}%`).join('\n')}`,
  }
}

export function countVectorNodes(vector: Vector): number {
  return vector.children.reduce(
    (sum, child) => sum + 1 + ('points' in child ? child.points.length : 0),
    1,
  )
}
function withinBudget(vector: Vector): boolean {
  if (
    vector.width > 8192 ||
    vector.height > 8192 ||
    vector.width <= 0 ||
    vector.height <= 0 ||
    countVectorNodes(vector) > 4096
  )
    return false
  // Validate every coordinate too: a long message may extend beyond nominal layout bounds.
  const finite = (value: unknown): boolean =>
    typeof value === 'number'
      ? Number.isFinite(value) && Math.abs(value) <= 8192
      : Array.isArray(value)
        ? value.every(finite)
        : value !== null && typeof value === 'object'
          ? Object.values(value).every(finite)
          : true
  return finite(vector)
}
function fitCanvas(vector: Vector): Vector {
  let right = vector.width,
    bottom = vector.height
  for (const node of vector.children)
    if (node.type === 'text') {
      const advance = width(node.text)
      const left =
        node.x - (node.anchor === 'middle' ? advance / 2 : node.anchor === 'end' ? advance : 0)
      if (left < 0 || node.y < FONT) throw new DiagramError('layout')
      right = Math.max(right, left + advance + PAD)
      bottom = Math.max(bottom, node.y + PAD)
    }
  return { ...vector, width: right, height: bottom }
}
export function renderDiagram(source: string, signal?: AbortSignal): DiagramRender {
  checkCancelled(signal)
  try {
    const model = parseDiagram(source, signal)
    const result =
      model.kind === 'flow' ? flow(model) : model.kind === 'sequence' ? sequence(model) : pie(model)
    checkCancelled(signal)
    const vector = fitCanvas(result.vector)
    if (!withinBudget(vector) || result.accessibleText.length > 8192)
      throw new DiagramError('layout')
    const output: DiagramRender = { ok: true, ...result, vector }
    if (new TextEncoder().encode(JSON.stringify(output)).length > 250 * 1024)
      throw new DiagramError('limit')
    return output
  } catch (error) {
    checkCancelled(signal)
    if (!(error instanceof DiagramError)) throw error
    return { ok: false, source, message: error.message }
  }
}

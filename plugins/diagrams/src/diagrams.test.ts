import { describe, expect, it } from 'vitest'
import { parseDiagram, DiagramError } from './parser'
import { renderDiagram } from './layout'

describe('bounded Mermaid subset parser', () => {
  it('preserves shapes, isolated nodes, comments, every edge and cycle', () => {
    const model = parseDiagram(
      'flowchart TD\n%% comment\nA[开始] -->|继续| B(运行)\nB --> C{完成?}\nC --> A\nD[孤立]',
    )
    expect(model.kind).toBe('flow')
    if (model.kind !== 'flow') return
    expect(model.nodes.map((n) => n.shape)).toEqual(['rect', 'rounded', 'diamond', 'rect'])
    expect(model.edges).toHaveLength(3)
    expect(model.edges[0]?.label).toBe('继续')
  })
  it('supports TB/LR, semicolons, chained edges and text-between-dashes labels', () => {
    const model = parseDiagram('graph LR; A --> B --> C; C -- retry --> A')
    expect(model.kind === 'flow' && model.direction).toBe('LR')
    expect(model.kind === 'flow' && model.edges.map((e) => e.label)).toEqual(['', '', 'retry'])
    expect(parseDiagram('graph TB\nA')).toMatchObject({ direction: 'TD' })
  })
  it('does not treat delimiters or comment signs inside quoted labels as syntax', () => {
    expect(parseDiagram('flowchart TD\nA["a; ] %% b"] --> B')).toMatchObject({
      nodes: [{ label: 'a; ] %% b' }, { label: 'B' }],
    })
  })
  it('uses the last explicit node label without resetting it for a bare reference', () => {
    expect(parseDiagram('flowchart TD\nA[old]\nA[new]\nA --> B')).toMatchObject({
      nodes: [{ label: 'new' }, { label: 'B' }],
    })
  })
  it('supports actors, aliases, implicit participants, dashed and self messages', () => {
    const model = parseDiagram(
      'sequenceDiagram\nactor A as 用户😀\nparticipant B as 服务\nA->>B: 请求\nB-->>A: 回应\nB->>B: 自检',
    )
    expect(model.kind === 'sequence' && model.participants.map((p) => p.actor)).toEqual([
      true,
      false,
    ])
    expect(model.kind === 'sequence' && model.messages.map((m) => m.dashed)).toEqual([
      false,
      true,
      false,
    ])
    expect(parseDiagram('sequenceDiagram\nA->>B: hi')).toMatchObject({
      participants: [{ id: 'A' }, { id: 'B' }],
    })
  })
  it('supports pie title, decimal values and preserves zero-value entries', () => {
    expect(parseDiagram('pie\ntitle 分布\n"甲": 2.5\n"乙😀": 0\n"丙": 1')).toMatchObject({
      kind: 'pie',
      title: '分布',
      slices: [{ value: 2.5 }, { value: 0 }, { value: 1 }],
    })
  })
  it('rejects a positive pie value that underflows to zero rather than silently losing its data', () => {
    expect(() => parseDiagram(`pie\n"tiny": 0.${'0'.repeat(324)}1\n"other": 1`)).toThrow(
      DiagramError,
    )
  })
  it('keeps ordinary punctuation in sequence labels and pie titles as plain text', () => {
    expect(parseDiagram('sequenceDiagram\nA->>B: 结果 (x > 1) [部分')).toMatchObject({
      messages: [{ label: '结果 (x > 1) [部分' }],
    })
    expect(parseDiagram('pie\ntitle Counts (preliminary\n"A": 1')).toMatchObject({
      title: 'Counts (preliminary',
    })
  })
  it.each([
    'flowchart BT\nA-->B',
    'flowchart TD\nsubgraph S\nA-->B\nend',
    'flowchart TD\nA-->B\nclick A "https://example.com"',
    'flowchart TD\nA-->B\nstyle A fill:red',
    'flowchart TD\nA-->B\nlinkStyle 0 stroke:red',
    'flowchart TD\nA-->B\nclassDef red fill:red',
    'flowchart TD\nA---B',
    'flowchart TD\nA((circle))',
    'flowchart TD\nA[<b>HTML</b>]',
    'flowchart TD\nA["`markdown`"]',
    'flowchart TD\nA[&#35;]',
    '%%{init: {}}%%\nflowchart TD\nA',
    'flowchart TD\nA\n%%{config: {}}%%',
    'sequenceDiagram\nA->>B: hi\nactivate B',
    'sequenceDiagram\nNote over A: note',
    'sequenceDiagram\nA->B: unsupported arrow',
    'sequenceDiagram\nA->>B: <br>html',
    'pie showData\n"A": 1',
    'pie\n"A": -1',
    'pie\n"A": 0',
    'pie\n"A": 1\n"A": 2',
    'pie\n"A": Infinity',
    'flowchart TD\nA -->',
    'flowchart TD\nA[unterminated',
    'sequenceDiagram',
  ])('rejects the complete diagram rather than dropping unsupported input: %s', (source) => {
    expect(() => parseDiagram(source)).toThrow(DiagramError)
    const result = renderDiagram(source)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.source).toBe(source)
  })
  it('enforces source, label, node, edge and participant limits', () => {
    for (const source of [
      ' '.repeat(32769),
      `flowchart TD\nA[${'x'.repeat(257)}]`,
      'flowchart TD\n' + Array.from({ length: 101 }, (_, i) => `N${i}`).join('\n'),
      'flowchart TD\n' + Array.from({ length: 201 }, () => 'A-->B').join('\n'),
      'sequenceDiagram\n' + Array.from({ length: 101 }, (_, i) => `participant N${i}`).join('\n'),
    ])
      expect(() => parseDiagram(source)).toThrow(DiagramError)
  })
})

describe('safe deterministic layout', () => {
  it.each(['TD', 'LR'])('draws an unobstructed adjacent %s edge as a direct arrow', (direction) => {
    const result = renderDiagram(`flowchart ${direction}\nA[中文] --> B[结束]`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const routes = result.vector.children.filter((n) => n.type === 'polyline')
    expect(routes).toHaveLength(1)
    expect(routes[0]?.points).toHaveLength(2)
    expect(direction === 'LR' ? routes[0]?.points[0]?.y : routes[0]?.points[0]?.x).toBe(
      direction === 'LR' ? routes[0]?.points[1]?.y : routes[0]?.points[1]?.x,
    )
  })
  it.each(['TD', 'LR'])('keeps %s edge lines outside the label text box', (direction) => {
    const result = renderDiagram(`flowchart ${direction}\nA -->|label| B`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const label = result.vector.children.find((n) => n.type === 'text' && n.text === 'label')!
    if (label.type !== 'text') throw new Error('missing edge label')
    const bounds = { x: label.x, right: label.x + 70, y: label.y - 14, bottom: label.y }
    for (const route of result.vector.children)
      if (route.type === 'polyline') {
        for (let i = 1; i < route.points.length; i++) {
          const a = route.points[i - 1]!,
            b = route.points[i]!
          const crosses =
            a.y === b.y
              ? a.y >= bounds.y &&
                a.y <= bounds.bottom &&
                Math.max(a.x, b.x) > bounds.x &&
                Math.min(a.x, b.x) < bounds.right
              : a.x >= bounds.x &&
                a.x <= bounds.right &&
                Math.max(a.y, b.y) > bounds.y &&
                Math.min(a.y, b.y) < bounds.bottom
          expect(crosses).toBe(false)
        }
      }
  })
  it.each([
    'flowchart TD\nA[开始]-->B{继续?}\nB-->|是|A\nB-->|否|C(结束)\nA-->A\nD[孤立]',
    'flowchart LR\nA-->B\nA-->C\nB-->D\nC-->D',
    'sequenceDiagram\nactor A as 用户\nparticipant B as 服务\nA->>B: 请求😀\nB-->>A: 返回\nB->>B: self',
    'pie\ntitle 比例\n"甲": 3\n"乙": 2\n"零": 0',
  ])('produces finite typed geometry and complete accessible meaning: %s', (source) => {
    const result = renderDiagram(source)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.vector.width).toBeLessThanOrEqual(8192)
    expect(result.vector.height).toBeLessThanOrEqual(8192)
    expect(result.vector.children.length).toBeLessThanOrEqual(4096)
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(262144)
    const json = JSON.stringify(result.vector)
    expect(json).not.toMatch(/"(?:path|html|style|href|url)":/)
    expect(result.accessibleText.length).toBeGreaterThan(10)
    expect(renderDiagram(source)).toEqual(result)
  })
  it('keeps all hundred nodes and two hundred cyclic edges bounded', () => {
    const source =
      'flowchart TD\n' +
      Array.from(
        { length: 100 },
        (_, i) => `N${i}-->N${(i + 1) % 100}\nN${i}-->N${(i + 2) % 100}`,
      ).join('\n')
    const result = renderDiagram(source)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.accessibleText).toContain('100 个节点，200 条连线')
      expect(result.vector.children.length).toBeGreaterThanOrEqual(500)
    }
  })
  it('wraps Chinese, emoji and long labels without breaking surrogate or combining sequences', () => {
    const label = '中文😀e\u0301👩‍💻'.repeat(12)
    const result = renderDiagram(`flowchart TD\nA["${label}"] --> B`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = result.vector.children.filter((n) => n.type === 'text').map((n) => n.text)
    expect(text.join('')).toContain(label)
    expect(text.every((t) => !/^[\uDC00-\uDFFF\u0300-\u036F\u200D]/u.test(t))).toBe(true)
  })
  it('rejects cancellation without doing a partial render', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => renderDiagram('flowchart TD\nA-->B', controller.signal)).toThrow(/cancel/i)
  })
  it.each(['TD', 'LR'])(
    'keeps long edge labels inside the %s canvas without negative baselines',
    (direction) => {
      const result = renderDiagram(`flowchart ${direction}\nA -->|${'中文'.repeat(40)}| B`)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      for (const node of result.vector.children)
        if (node.type === 'text') {
          expect(node.y).toBeGreaterThanOrEqual(14)
          expect(node.y).toBeLessThanOrEqual(result.vector.height)
          const estimate = [...node.text].reduce(
            (sum, char) => sum + (char.charCodeAt(0) < 128 ? 8 : 16),
            0,
          )
          expect(node.x + (node.anchor === 'middle' ? estimate / 2 : estimate)).toBeLessThanOrEqual(
            result.vector.width,
          )
        }
    },
  )
  it('routes branch edges through the layer gap instead of a taller neighbouring node', () => {
    const result = renderDiagram(`flowchart TD\nA[short] --> C\nB[${'long '.repeat(30)}] --> C`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const boxes = result.vector.children.filter((n) => n.type === 'rect')
    for (const route of result.vector.children)
      if (route.type === 'polyline') {
        for (let i = 1; i < route.points.length; i++) {
          const a = route.points[i - 1]!,
            b = route.points[i]!
          for (const box of boxes)
            if (a.y === b.y) {
              const crosses =
                a.y > box.y &&
                a.y < box.y + box.height &&
                Math.max(a.x, b.x) > box.x &&
                Math.min(a.x, b.x) < box.x + box.width
              expect(crosses).toBe(false)
            }
        }
      }
  })
})

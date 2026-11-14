import { expect, it } from 'vitest'
import { compileDiagram } from './compiler'
it('compiles Unicode flowchart through fixed official grammar without DOM', () => {
  const result = compileDiagram('flowchart LR\n A["开始😀"] -->|确认| B{Ready}\n B --> C[Done]')
  expect(result.type).toBe('vector')
  expect(JSON.stringify(result)).toContain('开始😀')
  expect(JSON.stringify(result)).toContain('确认')
})
it('compiles aliases and dotted sequence return messages', () => {
  const result = compileDiagram(
    'sequenceDiagram\n participant A as 用户😀\n A->>B: 你好\n B-->>A: 返回',
  )
  expect(result.type).toBe('vector')
  expect(JSON.stringify(result)).toContain('用户😀')
  expect(JSON.stringify(result)).toContain('返回')
})
it.each([
  'pie\n"x":1',
  'flowchart TD\nA-->A',
  'flowchart TD\nA-->B\nclick A "https://example.com"',
  'flowchart TD\nA["<img src=x>"]',
  'sequenceDiagram\nloop Again\nA->>B: x\nend',
  '---\nconfig: x\n---\nflowchart TD\nA-->B',
])('explicitly rejects unsupported input without partial diagram: %s', (source) =>
  expect(() => compileDiagram(source)).toThrow(),
)
it('wraps long CJK labels to bounded text lines instead of overflowing node geometry', () => {
  const result = compileDiagram(
    'flowchart TD\n A["这是最多二十四个字符的中文标签不应溢出"] --> B[Done]',
  )
  for (const primitive of result.children)
    if (primitive.type === 'text') expect([...primitive.text].length).toBeLessThanOrEqual(12)
})
it.each([
  'flowchart RL\nA-->B',
  'flowchart TD\nA((Round))-->B',
  'flowchart TD\nA-.->B',
  'flowchart TD\nA-->B\nB-->C\nA-->C',
  'flowchart TD\nA:::danger-->B',
  'flowchart TD\nA-->B\nstyle A fill:red',
  'flowchart TD\nsubgraph X\nA-->B\nend',
  '%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\nA-->B',
  'sequenceDiagram\nA->>A: self',
  'sequenceDiagram\nactor A\nA->>B: x',
  'sequenceDiagram\nparticipant A@{type: "queue"}\nA->>B: x',
  'sequenceDiagram\ncreate participant A\nA->>B: x',
  'sequenceDiagram\nA->>+B: activate',
  'sequenceDiagram\nautonumber\nA->>B: x',
  'sequenceDiagram\nNote over A: note',
  'sequenceDiagram\nA->B: open arrow',
  'classDiagram\nclass A',
  'flowchart TD\nA["`markdown`"]-->B',
  'flowchart TD\nA["xxxxxxxxxxxxxxxxxxxxxxxxx"]-->B',
  'flowchart TD\nA[broken',
])('retains unsupported semantics by refusing the whole diagram: %s', (source) =>
  expect(() => compileDiagram(source)).toThrow(),
)
it.each([
  'flowchart TD\nA-->B\nA-->C\nB-->D\nC-->D',
  'graph TB\nA(开始)-->B[结束]',
  'sequenceDiagram\nA->>B: request\nB-->>A: response',
])('supports the documented syntax: %s', (source) => {
  const output = compileDiagram(source)
  expect(output.children.length).toBeGreaterThan(0)
  expect(output.width).toBeLessThanOrEqual(4096)
  expect(output.height).toBeLessThanOrEqual(4096)
  expect(JSON.stringify(output)).not.toMatch(/foreignObject|href|innerHTML|<svg/u)
})
it('bounds request text and graph/sequence expansion', () => {
  for (const source of [
    'x'.repeat(8193),
    '\n'.repeat(129),
    'flowchart TD\n' + Array.from({ length: 21 }, (_, i) => 'N' + i).join('\n'),
    'sequenceDiagram\n' + Array.from({ length: 7 }, (_, i) => 'participant A' + i).join('\n'),
    'sequenceDiagram\n' + Array.from({ length: 17 }, () => 'A->>B: message').join('\n'),
  ])
    expect(() => compileDiagram(source)).toThrow()
})
it('bounds the largest supported sequence to existing host output limits', () => {
  const source =
    'sequenceDiagram\n' +
    Array.from({ length: 6 }, (_, i) => 'participant A' + i).join('\n') +
    '\n' +
    Array.from({ length: 16 }, () => 'A0-->>A5: 返回').join('\n')
  const output = compileDiagram(source)
  expect(output.children.length).toBeLessThan(4096)
  expect(new TextEncoder().encode(JSON.stringify(output)).length).toBeLessThan(262144)
})
it.each([
  'flowchart TD\nA{这是超过十二个汉字的菱形标签}-->B',
  'flowchart LR\nA-->|此标签超过四字|B',
  'flowchart TD\nA-->B\nflowchart LR\nC-->D',
])('rejects layouts that would obscure labels or merge two diagrams: %s', (source) =>
  expect(() => compileDiagram(source)).toThrow(),
)
it.each(['flowchart TD\nA -->|"`bold`"| B', 'sequenceDiagram\nA->>B: wrap: message'])(
  'rejects Mermaid formatting controls instead of silently changing meaning: %s',
  (source) => expect(() => compileDiagram(source)).toThrow(),
)

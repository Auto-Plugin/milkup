import { expect, it } from 'vitest'
import { isCompleteMermaidPendingFence } from './mermaid-pending-fence'

it('recognizes only one bounded complete Mermaid fence, never arbitrary code or partial context', () => {
  for (const source of ['```mermaid\nflowchart LR\nA-->B\n```', '~~~mermaid\r\nA-->B\r\n~~~'])
    expect(isCompleteMermaidPendingFence(source)).toBe(true)
  for (const source of [
    '```js\nmermaid()\n```',
    '```Mermaid\nA-->B\n```',
    '```mermaid\nA-->B',
    '    ```mermaid\n    A-->B\n    ```',
    '> ```mermaid\n> A-->B\n> ```',
    'text\n```mermaid\nA-->B\n```',
    '```mermaid\nA-->B\n```\ntext',
    '```mermaid\nA-->B\n```\n```mermaid\nC-->D\n```',
    '```mermaid\n' + 'x'.repeat(100000) + '\n```',
  ])
    expect(isCompleteMermaidPendingFence(source)).toBe(false)
})

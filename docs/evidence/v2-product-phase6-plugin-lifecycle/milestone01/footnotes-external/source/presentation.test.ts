import { expect, it } from 'vitest'
import type { SdkDocumentPresentationRequest as Request } from '@milkup/plugin-sdk'
import { FootnoteIndex } from './indexer'
import { present } from './presentation'
const source = 'A[^x] again[^x] missing[^no]\n[^x]: **strong** `code`\n[^x]: duplicate'
function fixture() {
  const index = new FootnoteIndex()
  let from = 0
  for (const [i, text] of source.split('\n').entries()) {
    index.consume({ number: i + 1, from, to: from + text.length, text })
    from += text.length + 1
  }
  index.finish()
  return index
}
const request: Request = {
  documentId: 'doc',
  version: 2,
  from: 0,
  to: source.length,
  source,
  fromLine: 1,
  toLine: 3,
  completeStart: true,
  completeEnd: true,
  contextKnown: true,
  protectedRanges: [{ from: 45, to: 51 }],
  blocks: [{ kind: 'text', from: 0, to: source.length, complete: true, contentRanges: [] }],
  selection: { anchor: source.length + 1, head: source.length + 1 },
  theme: 'light',
  target: 'screen',
  width: 800,
}
it('renders safe bidirectional references, duplicate and missing diagnostics without replacing definition bodies', () => {
  const result = present(request, fixture())
  expect(result.fragments.filter((f) => f.content.type === 'sup')).toHaveLength(2)
  const definition = result.fragments.find((f) => f.from === source.indexOf('[^x]:'))!
  expect(definition.to - definition.from).toBe(5)
  expect(JSON.stringify(definition.content)).toContain('返回引用 2')
  expect(result.fragments.some((f) => f.message?.includes('未定义'))).toBe(true)
  expect(result.fragments.some((f) => f.message?.includes('重复脚注'))).toBe(true)
  expect(JSON.stringify(result)).not.toContain('href')
})
it('preserves protected/unknown context and never calls partial search missing', () => {
  const index = fixture()
  index.limit('scan-limit')
  const result = present({ ...request, selection: { anchor: 2, head: 2 } }, index)
  expect(result.fragments.some((f) => f.message?.includes('未定义'))).toBe(false)
  expect(result.fragments.some((f) => f.message?.includes('索引未完成'))).toBe(true)
  expect(present({ ...request, contextKnown: false }, index)).toEqual({
    fragments: [],
    complete: false,
  })
})

it('bounds repeated definition summaries and keeps outputs inside fragment and JSON budgets', () => {
  const index = new FootnoteIndex()
  const refs = Array.from({ length: 200 }, () => '[^x]').join(' ')
  const full = refs + '\n[^x]: ' + '字'.repeat(8000)
  index.consume({ number: 1, from: 0, to: refs.length, text: refs })
  index.consume({
    number: 2,
    from: refs.length + 1,
    to: full.length,
    text: full.slice(refs.length + 1),
  })
  index.finish()
  const result = present(
    {
      ...request,
      source: full,
      to: full.length,
      protectedRanges: [],
      blocks: [],
      selection: { anchor: full.length + 1, head: full.length + 1 },
    },
    index,
  )
  expect(result.fragments).toHaveLength(128)
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(262144)
  expect(result.complete).toBe(false)
})

it('returns selection-independent fragments so cached previews recover when the caret leaves', () => {
  const index = fixture()
  const referenceActive = present({ ...request, selection: { anchor: 2, head: 2 } }, index)
  const definitionPosition = source.indexOf('[^x]:') + 3
  const definitionActive = present(
    { ...request, selection: { anchor: definitionPosition, head: definitionPosition } },
    index,
  )
  const inactive = present(request, index)
  expect(referenceActive).toEqual(inactive)
  expect(definitionActive).toEqual(inactive)
})

import { expect, it } from 'vitest'
import { parseMarkdown, parseInline } from '../index'
it('header-only table includes its delimiter in the table range', () => {
  const source = '| A | B |\n| --- | --- |'
  expect(parseMarkdown(source).root.children?.[0]?.to).toBe(source.length)
})
it('pipe after an even number of backslashes still divides cells', () => {
  const table = parseMarkdown('| A | B |\n| --- | --- |\n| x\\\\| y |').root.children?.[0]
  expect(table?.children?.[1]?.children).toHaveLength(2)
})
it('only safe attribute-free br tags become inline line breaks', () => {
  expect(parseInline('a<br>b<BR />c').filter((n) => n.type === 'hardBreak')).toHaveLength(2)
  expect(parseInline('<br onclick="bad()">').some((n) => n.type === 'hardBreak')).toBe(false)
})
it('does not recognize mismatched table header and delimiter widths', () => {
  expect(
    parseMarkdown('| A | B |\n| --- | --- | --- |').root.children?.some((n) => n.type === 'table'),
  ).toBe(false)
})

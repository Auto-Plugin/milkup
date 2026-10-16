import { expect, it } from 'vitest'
import { createMarkdownClipboardPayload } from './clipboard'
const source = '| 名称 | Value |\r\n| :--- | ---: |\r\n| A & <x> | **1**<br>two |\r\n'
it('keeps exact Unicode/CRLF Markdown plus semantic HTML table in live copy', () => {
  const p = createMarkdownClipboardPayload(source, true)
  expect(p.text).toBe(source)
  expect(p.html).toContain('<table border="1"')
  expect(p.html).toContain('<thead><tr>')
  expect(p.html).toContain('<tbody><tr>')
  expect(p.html).toContain('A &amp; &lt;x&gt;')
  expect(p.html).toContain('<strong>1</strong><br>two')
  expect(p.html).toContain('text-align:right')
})
it('source copy and incomplete table selections stay exact plain text', () => {
  expect(createMarkdownClipboardPayload(source, false)).toEqual({ text: source })
  expect(createMarkdownClipboardPayload('A | B', true)).toEqual({ text: 'A | B' })
})
it('escapes attributes and raw HTML, and blocks executable URLs in rich clipboard', () => {
  const p = createMarkdownClipboardPayload(
    '| A | B |\n| --- | --- |\n| <script>alert(1)</script> | [click](javascript:alert) |',
    true,
  )
  expect(p.html).not.toContain('<script>')
  expect(p.html).toContain('&lt;script&gt;')
  expect(p.html).toContain('<a href="">click</a>')
  expect(p.html).not.toContain('href="javascript:')
})
it('preserves escaped pipes and inline code without treating code as a table', () => {
  const p = createMarkdownClipboardPayload('| A | B |\n| --- | --- |\n| a\\|b | `x` |', true)
  expect(p.html).toContain('a|b')
  expect(p.html).toContain('<code>x</code>')
  expect(createMarkdownClipboardPayload('```\n' + source + '```', true).html).toBeUndefined()
})

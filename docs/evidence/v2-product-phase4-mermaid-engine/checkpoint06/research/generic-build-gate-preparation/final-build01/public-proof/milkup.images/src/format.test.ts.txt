import { describe, expect, it } from 'vitest'
import { markdownImage, parsePolicy } from './format'

describe('image text and policy boundaries', () => {
  it('constructs plain Markdown without treating alt as markup', () => {
    expect(markdownImage('图 [示例] \\ <script>', 'assets/image.png')).toBe(
      '![图 \\[示例\\] \\\\ <script>](assets/image.png)',
    )
  })
  it('keeps an intentionally empty alternative text', () => {
    expect(markdownImage('', 'note.assets/image.webp')).toBe('![](note.assets/image.webp)')
  })
  it('normalizes line breaks in alt text without adding document paragraphs', () => {
    expect(markdownImage('一\r\n二\n三', 'assets/image.jpg')).toBe('![一 二 三](assets/image.jpg)')
  })
  it('preserves host URL escaping without double encoding', () => {
    expect(markdownImage('图', 'note%20name.assets/image.png')).toBe(
      '![图](note%20name.assets/image.png)',
    )
  })
  it.each([
    'https://example.com/a.png',
    '/tmp/a.png',
    '../a.png',
    'assets/../a.png',
    'assets\\a.png',
    'assets/a.png)\nother',
    'assets/%2e%2e/a.png',
    'assets/%2Fetc.png',
  ])('rejects an unsafe resource reference %s', (path) => {
    expect(() => markdownImage('image', path)).toThrow()
  })
  it('limits alt text before it enters an editing request', () => {
    expect(() => markdownImage('a'.repeat(513), 'assets/image.png')).toThrow()
  })
  it('only restores the two public policies', () => {
    expect(parsePolicy('document-assets')).toBe('document-assets')
    expect(parsePolicy('assets')).toBe('assets')
    expect(parsePolicy('/etc')).toBe('assets')
    expect(parsePolicy({ policy: 'document-assets' })).toBe('assets')
  })
})

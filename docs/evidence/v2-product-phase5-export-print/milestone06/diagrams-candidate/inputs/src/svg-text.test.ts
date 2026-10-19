import { describe, expect, it } from 'vitest'
import { ConversionError, svgText } from './svg-primitives'

describe('SVG text and accessibility metadata domain', () => {
  it('preserves the complete 4096 UTF16 boundary without truncation or normalization', () => {
    const value = '😀'.repeat(2048)
    expect(svgText(value, 'title')).toBe(value)
    expect(svgText('中\r\n\t<&>', 'textRun')).toBe('中\r\n\t<&>')
  })
  it.each(['title', 'description', 'textRun', 'textBox'])(
    'rejects oversized %s before returning an AST',
    (field) => {
      try {
        svgText('a'.repeat(4097), field)
        throw new Error('oversized text was accepted')
      } catch (error) {
        expect(error).toBeInstanceOf(ConversionError)
        expect((error as ConversionError).code).toBe('limit-exceeded')
      }
    },
  )
  it.each(['\u0000', '\u000b', '\ufffe', '\uffff', '\ud800', '\udc00', '\ud800x'])(
    'rejects XML-inexpressible text %j',
    (value) => {
      expect(() => svgText(value, 'textRun')).toThrow(ConversionError)
    },
  )
})

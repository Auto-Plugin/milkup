import { expect, it } from 'vitest'
import { MeasuredLineHeights } from '../measured-line-heights'
it('maps measured multiline rows and hidden delimiters back to logical lines', () => {
  const heights = new MeasuredLineHeights()
  heights.set(2, 0)
  heights.set(3, 63)
  expect(heights.top(3, 21)).toBe(21)
  expect(heights.top(4, 21)).toBe(84)
  expect(heights.lineAt(21, 100, 21)).toBe(3)
  expect(heights.lineAt(83, 100, 21)).toBe(3)
  expect(heights.lineAt(84, 100, 21)).toBe(4)
  heights.clear()
  expect(heights.top(4, 21)).toBe(63)
})

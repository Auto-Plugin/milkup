import { expect, it } from 'vitest'
import { domRectForLineSourcePosition } from '../source-position-mapping'
it('uses the empty cell bounds and padding instead of a following text cell', () => {
  const line = document.createElement('div')
  line.dataset.from = '0'
  line.dataset.to = '20'
  const empty = document.createElement('span')
  empty.className = 'milkup-table-cell'
  empty.dataset.from = '5'
  empty.dataset.to = '5'
  empty.style.padding = '4px 10px'
  empty.style.fontSize = '14px'
  line.append(empty)
  const next = document.createElement('span')
  next.dataset.from = '10'
  next.dataset.to = '11'
  next.textContent = 'x'
  line.append(next)
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    width,
    height,
    toJSON() {},
  })
  empty.getBoundingClientRect = () => rect(200, 50, 100, 30)
  line.getBoundingClientRect = () => rect(0, 50, 400, 30)
  const reference = document.createElement('div')
  reference.getBoundingClientRect = () => rect(0, 0, 400, 200)
  const result = domRectForLineSourcePosition(document, line, reference, 5, {
    allowGeometryFallback: true,
  })
  expect(result?.left).toBe(210)
  expect(result?.top).toBe(54)
  expect(result?.height).toBe(14)
  expect(empty.textContent).toBe('')
})

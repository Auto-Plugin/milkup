import { afterEach, expect, it } from 'vitest'
import { DocumentPendingImage } from '../document-pending-image'

afterEach(() => document.body.replaceChildren())
it('preserves exact source nodes, styles and selection mapping across repeated pending paints', () => {
  const line = document.createElement('div')
  line.style.position = 'sticky'
  line.innerHTML = '<span data-from="12" data-to="15">A😀</span>'
  document.body.append(line)
  const original = line.firstChild
  const owner = new DocumentPendingImage()
  owner.update([{ from: 10, lines: [line] }])
  const mask = line.querySelector<HTMLElement>('[data-presentation-pending-source]')!
  const label = line.querySelector<HTMLElement>('[role=status]')!
  expect(mask.firstChild).toBe(original)
  expect(mask.style.display).toBe('contents')
  expect(mask.style.visibility).toBe('hidden')
  expect(label.textContent).toBe('正在生成图表…')
  expect(line.style.position).toBe('sticky')
  owner.update([{ from: 10, lines: [line] }])
  expect(line.querySelector('[role=status]')).toBe(label)
  owner.clear()
  owner.clear()
  expect(line.firstChild).toBe(original)
  expect(line.childNodes).toHaveLength(1)
  expect(line.style.position).toBe('sticky')
})
it('never resurrects old document nodes after virtual line replacement or closure', () => {
  const line = document.createElement('div')
  line.textContent = 'old document'
  document.body.append(line)
  const owner = new DocumentPendingImage()
  owner.update([{ from: 0, lines: [line] }])
  line.replaceChildren(document.createTextNode('new document'))
  owner.clear()
  expect(line.textContent).toBe('new document')
  owner.update([{ from: 0, lines: [line] }])
  line.remove()
  owner.clear()
  expect(line.textContent).toBe('new document')
  expect(document.querySelector('[role=status]')).toBeNull()
})

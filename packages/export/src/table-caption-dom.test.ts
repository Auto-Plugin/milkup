// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderStaticMarkdownDocument } from './static-html'

const options = { documentId: 'caption-contract', version: 1 }
const table = '| Left | Right |\n| :--- | ---: |\n| value | **strong** |'
const documentFor = (source: string) =>
  new DOMParser().parseFromString(renderStaticMarkdownDocument(source, options).html, 'text/html')

describe('table caption semantics in standalone HTML and PDF input', () => {
  it('retains an ordinary unheaded table, alignments and inline content', () => {
    const doc = documentFor(table)
    const element = doc.querySelector('table')!
    expect(element.caption).toBeNull()
    expect(element.tHead?.rows[0]?.cells.length).toBe(2)
    expect(element.tBodies[0]?.rows.length).toBe(1)
    expect(element.tBodies[0]?.rows[0]?.cells[0]?.style.textAlign).toBe('left')
    expect(element.tBodies[0]?.rows[0]?.cells[1]?.style.textAlign).toBe('right')
    expect(element.querySelector('strong')?.textContent).toBe('strong')
  })

  it('attaches one visible heading to a native caption without flattening semantic roles', () => {
    const doc = documentFor('## Title & [details](https://example.invalid/details)\n\n' + table)
    const element = doc.querySelector('table')!
    expect(element.firstElementChild).toBe(element.caption)
    expect(element.caption?.querySelector('h2')?.textContent).toBe('Title & details')
    expect(element.caption?.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.invalid/details',
    )
    expect(doc.querySelectorAll('h2').length).toBe(1)
    expect(doc.querySelectorAll('caption').length).toBe(1)
    expect(element.querySelectorAll('th').length).toBe(2)
    expect(element.querySelectorAll('td').length).toBe(2)
    expect(element.hasAttribute('role')).toBe(false)
    expect(element.hasAttribute('aria-hidden')).toBe(false)
    expect(element.caption?.hasAttribute('aria-hidden')).toBe(false)
  })

  it('does not consume the next table, paragraph or heading as part of a caption', () => {
    const doc = documentFor('## Title\n\n' + table + '\n\nBetween.\n\n' + table + '\n\n## End')
    const tables = doc.querySelectorAll('table')
    expect(tables.length).toBe(2)
    expect(tables[0]?.caption?.textContent).toBe('Title')
    expect(tables[1]?.caption).toBeNull()
    expect(doc.querySelector('p')?.textContent).toBe('Between.')
    expect(doc.body.lastElementChild?.textContent).toBe('End')
  })
})

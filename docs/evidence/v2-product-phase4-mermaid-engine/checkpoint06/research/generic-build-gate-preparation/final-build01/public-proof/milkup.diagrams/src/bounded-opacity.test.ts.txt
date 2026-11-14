import { describe, expect, it } from 'vitest'
import { boundedOpacityFilter } from './bounded-opacity'
import { ConversionError } from './svg-primitives'

function fixture() {
  type Node = {
    localName: string
    namespaceURI: string
    children: Node[]
    childNodes: { nodeType: number }[]
    firstChild?: { nodeType: number }
    parentElement: Node | null
    ownerSVGElement?: Node
    getBoundingClientRect?: () => unknown
    getScreenCTM?: () => unknown
  }
  const node = (localName: string): Node => ({
    localName,
    namespaceURI: 'http://www.w3.org/2000/svg',
    children: [],
    childNodes: [],
    parentElement: null,
  })
  const root = node('svg'),
    parent = node('g'),
    group = node('g'),
    line = node('line'),
    text = node('text')
  root.children = [parent]
  parent.children = [group]
  group.children = [line, text]
  parent.parentElement = root
  group.parentElement = parent
  line.parentElement = group
  text.parentElement = group
  for (const n of [parent, group, line, text]) n.ownerSVGElement = root
  text.firstChild = { nodeType: 3 }
  text.childNodes = [text.firstChild]
  root.getBoundingClientRect = () => ({ x: 8, y: 8, width: 1000, height: 196 })
  group.getScreenCTM = () => ({
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 108,
    f: 162,
    inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: -108, f: -162 }),
  })
  const styles = new Map<Node, Record<string, string>>([[group, { opacity: '.8' }]])
  const defaults: Record<string, string> = {
    opacity: '1',
    visibility: 'visible',
    display: 'inline',
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
  }
  const read = (n: Element, p: string) => styles.get(n as unknown as Node)?.[p] ?? defaults[p] ?? ''
  const set = (n: Node, p: string, v: string) => styles.set(n, { ...styles.get(n), [p]: v })
  const convert = () =>
    boundedOpacityFilter(
      root as unknown as SVGSVGElement,
      group as unknown as SVGGraphicsElement,
      'opacityBound0',
      read,
    )
  return { root, parent, group, line, text, set, convert }
}

describe('bounded identity opacity surface', () => {
  it('maps the actual clipped viewport into local coordinates without glyph bbox claims', () => {
    const f = fixture()
    const result = f.convert()
    expect(result).toEqual({
      kind: 'dropShadowFilter',
      id: 'opacityBound0',
      units: 'userSpaceOnUse',
      primitiveUnits: 'userSpaceOnUse',
      region: [
        { unit: 'user', value: -100 },
        { unit: 'user', value: -154 },
        { unit: 'user', value: 1000 },
        { unit: 'user', value: 196 },
      ],
      colorInterpolation: 'sRGB',
      dx: 0,
      dy: 0,
      stdDeviation: [0, 0],
      color: [0, 0, 0, 0],
    })
    expect(f.group.children).toEqual([f.line, f.text])
  })
  it.each(['filter', 'clip-path', 'mask-image', 'text-shadow'])(
    'does not clip unknown ancestor %s effects',
    (property) => {
      const f = fixture()
      f.set(f.parent, property, 'url(#existing)')
      expect(f.convert()).toBeUndefined()
    },
  )
  it('does not derive a region from an overflow-visible root', () => {
    const f = fixture()
    f.set(f.root, 'overflow-x', 'visible')
    expect(f.convert()).toBeUndefined()
  })
  it('rejects nested viewport contexts', () => {
    const f = fixture()
    f.group.ownerSVGElement = f.parent
    expect(f.convert()).toBeUndefined()
  })
  it('leaves child opacity and marker effects outside this normalization', () => {
    const f = fixture()
    f.set(f.line, 'marker-end', 'url(#arrow)')
    expect(f.convert()).toBeUndefined()
    f.set(f.line, 'marker-end', 'none')
    f.set(f.text, 'opacity', '.5')
    expect(f.convert()).toBeUndefined()
  })
  it('leaves non-plain text structures untouched', () => {
    const f = fixture()
    f.text.firstChild = { nodeType: 1 }
    f.text.childNodes = [f.text.firstChild]
    expect(f.convert()).toBeUndefined()
  })
  it('does not guess identity for a singular transform', () => {
    const f = fixture()
    f.group.getScreenCTM = () => ({
      a: 1,
      b: 0,
      c: 0,
      d: 0,
      e: 0,
      f: 0,
      inverse: () => {
        throw Error('singular')
      },
    })
    expect(f.convert()).toBeUndefined()
  })
  it('keeps the existing coordinate budget', () => {
    const f = fixture()
    f.root.getBoundingClientRect = () => ({ x: 8, y: 8, width: 9000, height: 196 })
    expect(f.convert).toThrow(ConversionError)
  })
})

import { describe, expect, it } from 'vitest'
import {
  copyDocumentPresentationNode,
  serializeDocumentPresentationNode,
} from '../document-presentation'

const rectangle = { kind: 'rect', x: 0, y: 0, width: 100, height: 50 }
const length = (value: number, unit = 'user') => ({ value, unit })
function image(children: readonly unknown[] = [rectangle]) {
  return {
    type: 'svg-image',
    profile: 'bounded-svg-v1',
    motion: 'static',
    width: 300,
    height: 200,
    rasterBounds: [0, 0, 300, 200],
    viewBox: [0, 0, 300, 200],
    aspect: { align: 'xMidYMid', fit: 'meet' },
    styles: [] as unknown[],
    definitions: [] as unknown[],
    children,
  }
}
const accepted = (value: unknown) => expect(() => copyDocumentPresentationNode(value)).not.toThrow()
const rejected = (value: unknown) => expect(() => copyDocumentPresentationNode(value)).toThrow()

describe('independent closed image safety through public presentation APIs', () => {
  it('preserves ordinary gradients, shadows, markers, symbols and fixed Journey text', () => {
    const content = {
      ...image([
        { ...rectangle, style: 0 },
        {
          kind: 'path',
          commands: [
            ['M', 0, 0],
            ['C', 10, 0, 20, 40, 30, 40],
          ],
          markerEnd: 'arrow',
        },
        { kind: 'use', ref: 'icon', x: 20, y: 20, width: 20, height: 20 },
        {
          kind: 'textBox',
          box: [0, 100, 200, 50],
          text: 'Go to work',
          color: [51, 51, 51, 1],
          fontId: 'arial-sans',
          fontSizePx: 16,
          fontWeight: 400,
          fontStyle: 'normal',
          lineHeight: 'normal',
          hAlign: 'center',
          vAlign: 'middle',
          whiteSpace: 'normal',
          overflowWrap: 'normal',
          wordBreak: 'normal',
        },
      ]),
      styles: [
        {
          fill: { kind: 'gradient', ref: 'gradient' },
          filter: { kind: 'definition', ref: 'shadow' },
        },
      ],
      definitions: [
        {
          kind: 'linearGradient',
          id: 'gradient',
          units: 'objectBoundingBox',
          x1: length(0),
          y1: length(0),
          x2: length(1),
          y2: length(0),
          spread: 'pad',
          stops: [
            { offset: 0, color: [255, 0, 0, 1] },
            { offset: 1, color: [0, 0, 255, 1] },
          ],
        },
        {
          kind: 'dropShadowFilter',
          id: 'shadow',
          units: 'objectBoundingBox',
          primitiveUnits: 'userSpaceOnUse',
          region: [
            length(-10, 'percent'),
            length(-10, 'percent'),
            length(120, 'percent'),
            length(120, 'percent'),
          ],
          colorInterpolation: 'sRGB',
          dx: 1,
          dy: 1,
          stdDeviation: [1, 1],
          color: [0, 0, 0, 0.2],
        },
        {
          kind: 'marker',
          id: 'arrow',
          width: 10,
          height: 10,
          refX: length(0),
          refY: length(0),
          units: 'strokeWidth',
          orient: 'auto',
          children: [{ kind: 'path', commands: [['M', 0, 0], ['L', 10, 5], ['L', 0, 10], ['Z']] }],
        },
        {
          kind: 'symbol',
          id: 'icon',
          viewBox: [0, 0, 20, 20],
          children: [{ kind: 'circle', cx: 10, cy: 10, r: 5 }],
        },
      ],
    }
    accepted(content)
    const output = serializeDocumentPresentationNode(content)
    for (const fragment of [
      '<linearGradient',
      '<feDropShadow',
      '<marker',
      '<symbol',
      '<foreignObject',
      'font-family:Arial, sans-serif',
      'font-size:16px',
      'color:rgba(51,51,51,1)',
      'Go to work',
    ])
      expect(output).toContain(fragment)
    expect(output).not.toContain('url(#gradient)')
  })
  it('never invokes transport accessors or toJSON', () => {
    let calls = 0
    const accessor = image()
    Object.defineProperty(accessor, 'title', {
      enumerable: true,
      get() {
        calls++
        return 'unsafe'
      },
    })
    rejected(accessor)
    rejected({
      ...image(),
      toJSON() {
        calls++
        return {}
      },
    })
    expect(calls).toBe(0)
  })
  it('rejects custom prototypes and sparse/custom arrays', () => {
    const prototype = image()
    Object.setPrototypeOf(prototype, { hidden: 1 })
    rejected(prototype)
    rejected(image(Array(1)))
    const children = [rectangle]
    Object.defineProperty(children, 'extra', { value: 1 })
    rejected(image(children))
  })
  it.each([
    { rawSvg: '<svg/>' },
    { url: 'data:image/svg+xml,<svg/>' },
    { styles: [{ fill: 'url(https://example.invalid)' }] },
    { children: [{ kind: 'image', href: 'file:///private' }] },
    { children: [{ ...rectangle, onload: 'active' }] },
    { motion: 'animated' },
    { styles: [{ animationName: 'moving' }] },
  ])('rejects active or unknown transport without dropping fields: %j', (patch) => {
    accepted(image())
    rejected({ ...image(), ...patch })
  })
  it('keeps markup-like text inert and rejects invalid XML text', () => {
    const output = serializeDocumentPresentationNode({ ...image(), title: '</svg><script> & "' })
    expect(output).toContain('&lt;/svg&gt;&lt;script&gt; &amp; &quot;')
    expect(output).not.toContain('<script>')
    for (const title of ['\0', '\uffff', '\ud800']) rejected({ ...image(), title })
  })
  it('rejects invalid path numbers, flags, arity and command strings', () => {
    for (const commands of [
      [['M', NaN, 0]],
      [['L', 0, 0]],
      [
        ['M', 0, 0],
        ['A', 5, 5, 0, 2, 0, 10, 10],
      ],
      [
        ['M', 0, 0],
        ['C', 1, 2],
      ],
      [
        ['M', 0, 0],
        ['L url(x)', 0, 0],
      ],
    ])
      rejected(image([{ kind: 'path', commands }]))
  })
  it('rejects wrong-kind/missing/cyclic references, including unused definitions', () => {
    rejected(image([{ kind: 'use', ref: 'missing' }]))
    const symbol = { kind: 'symbol', id: 'local', children: [rectangle] }
    rejected({ ...image(), definitions: [symbol, symbol] })
    rejected({
      ...image([{ kind: 'use', ref: 'local' }]),
      definitions: [
        { kind: 'clipPath', id: 'local', units: 'userSpaceOnUse', children: [rectangle] },
      ],
    })
    rejected({
      ...image(),
      definitions: [{ kind: 'symbol', id: 'cycle', children: [{ kind: 'use', ref: 'cycle' }] }],
    })
    rejected({ ...image(), styles: [{ clipPath: 'missing' }] })
  })
  it('counts local expansion in addition to independently charged style data', () => {
    const definitions = [
      { kind: 'symbol', id: 'many', children: Array.from({ length: 1000 }, () => rectangle) },
    ]
    const repeated = {
      ...image([
        { kind: 'use', ref: 'many' },
        { kind: 'use', ref: 'many' },
      ]),
      definitions,
    }
    accepted(repeated)
    rejected({
      ...repeated,
      styles: [{ dashArray: Array.from({ length: 2200 }, () => length(2)) }],
    })
  })
  it('checks expanded reference depth in the containing presentation, not a fresh root', () => {
    const definitions = Array.from({ length: 30 }, (_, i) => ({
      kind: 'symbol',
      id: `level${i}`,
      children: i === 29 ? [rectangle] : [{ kind: 'use', ref: `level${i + 1}` }],
    }))
    const standalone = { ...image([{ kind: 'use', ref: 'level0' }]), definitions }
    accepted(standalone)
    let nested: unknown = standalone
    for (let i = 0; i < 10; i++) nested = { type: 'group', children: [nested] }
    rejected(nested)
  })
  it('checks shear corners and ellipse extrema rather than just opposite corners', () => {
    const translations = Array.from({ length: 4 }, () => ({ kind: 'translate', x: 8192, y: 0 }))
    rejected(
      image([
        {
          ...rectangle,
          width: 100,
          height: 100,
          transforms: [...translations, { kind: 'matrix', values: [1, -1, -1, 1, 0, 0] }],
        },
      ]),
    )
    rejected(
      image([
        {
          kind: 'ellipse',
          cx: 0,
          cy: 0,
          rx: 100,
          ry: 100,
          transforms: [...translations, { kind: 'matrix', values: [1, 0, -1, 1, 0, 0] }],
        },
      ]),
    )
  })
  it('checks root amplification and SVG arc radii correction', () => {
    rejected({ ...image(), viewBox: [0, 0, 0.00001, 0.00001] })
    rejected(
      image([
        {
          kind: 'path',
          transforms: Array.from({ length: 4 }, () => ({ kind: 'translate', x: 8190, y: 0 })),
          commands: [
            ['M', 0, 0],
            ['A', 0.001, 0.001, 45, 0, 0, 0, 100],
          ],
        },
      ]),
    )
    accepted(
      image([
        {
          kind: 'path',
          commands: [
            ['M', 10, 20],
            ['A', 20, 10, 45, 1, 0, 80, 50],
          ],
        },
      ]),
    )
  })
  it('retains explicit inactive text filters but rejects geometry-dependent text effects', () => {
    const content = image([
      {
        kind: 'text',
        children: [{ kind: 'tspan', style: 0, children: [{ kind: 'textRun', text: 'kept' }] }],
      },
    ])
    accepted({ ...content, styles: [{ filter: { kind: 'none' } }] })
    for (const style of [
      { opacity: 0.5 },
      { mixBlendMode: 'multiply' },
      { isolation: 'isolate' },
      {
        filter: {
          kind: 'cssDropShadow',
          shadows: [{ dx: 1, dy: 1, blur: 1, color: [0, 0, 0, 1] }],
        },
      },
    ])
      rejected({ ...content, styles: [style] })
  })
  it.each([{ opacity: 0.5 }, { mixBlendMode: 'multiply' }, { isolation: 'isolate' }])(
    'charges nested compositing surfaces: %j',
    (style) => {
      let child: unknown = { ...rectangle, width: 4000, height: 4000 }
      for (let i = 0; i < 20; i++) child = { kind: 'group', style: 0, children: [child] }
      rejected({
        ...image([child]),
        width: 4000,
        height: 4000,
        rasterBounds: [0, 0, 4000, 4000],
        viewBox: [0, 0, 4000, 4000],
        styles: [style],
      })
    },
  )
  it('shares raster work across otherwise valid images', () => {
    const large = {
      ...image(),
      width: 4000,
      height: 4000,
      rasterBounds: [0, 0, 4000, 4000],
      viewBox: [0, 0, 4000, 4000],
    }
    accepted(large)
    rejected({ type: 'group', children: Array.from({ length: 18 }, () => large) })
  })
  it('charges repeated marker compositing instead of evaluating one marker for many vertices', () => {
    const marker = {
      kind: 'marker',
      id: 'large',
      width: 1000,
      height: 1000,
      refX: length(0),
      refY: length(0),
      units: 'userSpaceOnUse',
      orient: 'auto',
      style: 0,
      children: [{ ...rectangle, width: 1000, height: 1000 }],
    }
    const content = {
      ...image([
        {
          kind: 'polyline',
          points: Array.from({ length: 142 }, (_, i) => [i, 20]),
          markerMid: 'large',
        },
      ]),
      definitions: [marker],
      styles: [{ opacity: 0.5 }],
    }
    rejected(content)
  })
  it('uses actual object bounding boxes for filter allocations and inherited font sizes', () => {
    const filter = {
      kind: 'dropShadowFilter',
      id: 'shadow',
      units: 'objectBoundingBox',
      primitiveUnits: 'objectBoundingBox',
      region: [length(-0.1), length(-0.1), length(1.2), length(1.2)],
      colorInterpolation: 'sRGB',
      dx: 1,
      dy: 1,
      stdDeviation: [1, 1],
      color: [0, 0, 0, 0.2],
    }
    rejected({
      ...image([{ ...rectangle, width: 1000, height: 1000, style: 0 }]),
      definitions: [filter],
      styles: [{ filter: { kind: 'definition', ref: 'shadow' } }],
    })
    rejected({
      ...image([{ kind: 'text', style: 1, children: [{ kind: 'textRun', text: 'x' }] }]),
      rootStyle: 0,
      styles: [{ fontSize: length(32, 'px') }, { fontSize: length(32, 'em') }],
    })
  })
  it('charges inherited gradients per drawable while retaining normal small shared palettes', () => {
    const gradient = (count: number) => ({
      kind: 'linearGradient',
      id: 'paint',
      units: 'objectBoundingBox',
      x1: length(0),
      y1: length(0),
      x2: length(1),
      y2: length(0),
      spread: 'pad',
      stops: Array.from({ length: count }, (_, i) => ({
        offset: i / (count - 1),
        color: [0, 0, 255, 1],
      })),
    })
    const content = {
      ...image([
        { kind: 'group', style: 0, children: Array.from({ length: 50 }, () => rectangle) },
      ]),
      styles: [{ fill: { kind: 'gradient', ref: 'paint' } }],
    }
    accepted({ ...content, definitions: [gradient(3)] })
    rejected({ ...content, definitions: [gradient(100)] })
  })
  it('keeps definition cost context-sensitive when the same symbol inherits different gradients', () => {
    const gradient = (id: string, count: number) => ({
      kind: 'linearGradient',
      id,
      units: 'objectBoundingBox',
      x1: length(0),
      y1: length(0),
      x2: length(1),
      y2: length(0),
      spread: 'pad',
      stops: Array.from({ length: count }, (_, i) => ({
        offset: i / (count - 1),
        color: [0, 0, 255, 1],
      })),
    })
    const content = {
      ...image([
        { kind: 'use', ref: 'shape', style: 0 },
        ...Array.from({ length: 50 }, () => ({ kind: 'use', ref: 'shape', style: 1 })),
      ]),
      styles: [
        { fill: { kind: 'gradient', ref: 'small' } },
        { fill: { kind: 'gradient', ref: 'large' } },
      ],
      definitions: [
        gradient('small', 3),
        gradient('large', 100),
        { kind: 'symbol', id: 'shape', children: [rectangle] },
      ],
    }
    accepted({ ...content, children: [{ kind: 'use', ref: 'shape', style: 0 }] })
    rejected(content)
  })
})

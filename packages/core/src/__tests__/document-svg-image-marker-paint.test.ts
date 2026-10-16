import { describe, expect, it } from 'vitest'
import { copyDocumentPresentationNode } from '../document-presentation'

const length = (value: number) => ({ value, unit: 'user' })
const gradient = {
  kind: 'linearGradient',
  id: 'paint',
  units: 'userSpaceOnUse',
  spread: 'pad',
  x1: length(0),
  y1: length(0),
  x2: length(20),
  y2: length(0),
  stops: Array.from({ length: 64 }, (_, i) => ({ offset: i / 63, color: [i, 0, 0, 1] })),
}
const marker = {
  kind: 'marker',
  id: 'arrow',
  width: 2,
  height: 2,
  refX: length(0),
  refY: length(0),
  units: 'userSpaceOnUse',
  orient: { degrees: 0 },
  children: [{ kind: 'rect', x: 0, y: 0, width: 1, height: 1 }],
}
function image(rootGradient: boolean, referenceGradient: boolean) {
  return {
    type: 'svg-image',
    profile: 'bounded-svg-v1',
    motion: 'static',
    width: 160,
    height: 96,
    rasterBounds: [0, 0, 160, 96],
    viewBox: [0, 0, 160, 96],
    aspect: { align: 'none', fit: 'meet' },
    styles: [
      { fill: { kind: 'gradient', ref: 'paint' } },
      { fill: referenceGradient ? { kind: 'gradient', ref: 'paint' } : { kind: 'none' } },
      { fill: { kind: 'none' } },
    ],
    ...(rootGradient ? { rootStyle: 0 } : {}),
    definitions: [gradient, marker],
    children: [
      {
        kind: 'polyline',
        style: 1,
        markerMid: 'arrow',
        points: Array.from({ length: 65 }, (_, i) => [i, 1]),
      },
    ],
  }
}

describe('marker paint comes from its definition ancestry', () => {
  it('charges root-inherited gradients on each marker when the referring shape has no fill', () => {
    const input = image(true, false)
    const small = {
      ...input,
      children: [
        {
          ...input.children[0],
          points: [
            [0, 1],
            [1, 1],
            [2, 1],
          ],
        },
      ],
    }
    expect(() => copyDocumentPresentationNode(small)).not.toThrow()
    expect(() => copyDocumentPresentationNode(input)).toThrow()
  })

  it('does not propagate a referring shape gradient into an independently styled marker', () => {
    expect(() => copyDocumentPresentationNode(image(false, true))).not.toThrow()
  })

  it('honors the marker own fill overriding the root gradient', () => {
    const input = image(true, false)
    expect(() =>
      copyDocumentPresentationNode({ ...input, definitions: [gradient, { ...marker, style: 2 }] }),
    ).not.toThrow()
  })

  it('continues inheriting each use element paint into symbol instances', () => {
    const input = image(false, true)
    const symbol = { kind: 'symbol', id: 'icon', children: marker.children }
    const children = Array.from({ length: 63 }, () => ({
      kind: 'use',
      style: 1,
      ref: 'icon',
      width: 2,
      height: 2,
    }))
    expect(() =>
      copyDocumentPresentationNode({ ...input, definitions: [gradient, symbol], children }),
    ).toThrow()
    expect(() =>
      copyDocumentPresentationNode({
        ...input,
        definitions: [gradient, symbol],
        children: children.map((child) => ({ ...child, style: 2 })),
      }),
    ).not.toThrow()
  })
})

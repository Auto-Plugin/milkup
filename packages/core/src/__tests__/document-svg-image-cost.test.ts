import { describe, expect, it } from 'vitest'
import { copyDocumentPresentationNode } from '../document-presentation'

// Public transport fixtures: no private work counter or duplicated cost formula.
// These fixed adversarial inputs target single-instance marker accounting and
// local-coordinate-only blur accounting. Execution evidence is recorded separately.
const length = (value: number) => ({ value, unit: 'user' as const })
const rect = (size: number, style?: number) => ({
  kind: 'rect',
  x: 0,
  y: 0,
  width: size,
  height: size,
  ...(style === undefined ? {} : { style }),
})
function image(children: readonly unknown[]) {
  return {
    type: 'svg-image',
    profile: 'bounded-svg-v1',
    motion: 'static',
    width: 160,
    height: 96,
    rasterBounds: [0, 0, 160, 96],
    viewBox: [0, 0, 160, 96],
    aspect: { align: 'none', fit: 'meet' },
    styles: [],
    definitions: [],
    children,
  }
}
function marked(children: readonly unknown[], size = 1000) {
  return {
    ...image(children),
    styles: [{ opacity: 0.5 }],
    definitions: [
      {
        kind: 'marker',
        id: 'layer',
        width: size,
        height: size,
        refX: length(0),
        refY: length(0),
        units: 'userSpaceOnUse',
        orient: 'auto',
        children: [rect(size, 0)],
      },
    ],
  }
}
function shadowImage(scale: number) {
  return {
    ...image([{ ...rect(100, 0), transforms: [{ kind: 'scale', x: scale, y: scale }] }]),
    styles: [{ filter: { kind: 'definition', ref: 'shadow' } }],
    definitions: [
      {
        kind: 'dropShadowFilter',
        id: 'shadow',
        units: 'userSpaceOnUse',
        primitiveUnits: 'userSpaceOnUse',
        region: [0, 0, 100, 100].map(length),
        colorInterpolation: 'sRGB',
        dx: 0,
        dy: 0,
        stdDeviation: [32, 32],
        color: [0, 0, 0, 0.5],
      },
    ],
  }
}

describe('aggregate raster work across repeated vertices and transformed kernels', () => {
  it('charges every middle marker on a polyline, even when markers overlap', () => {
    const input = marked([
      {
        kind: 'polyline',
        markerMid: 'layer',
        points: Array.from({ length: 142 }, (_, i) => [i, 0]),
      },
    ])
    expect(() => copyDocumentPresentationNode(input)).toThrow()
  })

  it('charges middle markers on curve endpoints, not on Bezier control points', () => {
    const input = marked([
      {
        kind: 'path',
        markerMid: 'layer',
        commands: [['M', 0, 0], ...Array.from({ length: 141 }, () => ['c', 0, 0, 1, 0, 1, 0])],
      },
    ])
    expect(() => copyDocumentPresentationNode(input)).toThrow()
  })

  it('charges middle markers at the internal endpoints of disconnected subpaths', () => {
    const input = marked([
      {
        kind: 'path',
        markerMid: 'layer',
        commands: Array.from({ length: 140 }, (_, i) => [
          ['M', i, 0],
          ['l', 1, 0],
        ]).flat(),
      },
    ])
    expect(() => copyDocumentPresentationNode(input)).toThrow()
  })

  it('keeps start and end markers at the two path endpoints across multiple subpaths', () => {
    const input = marked([
      {
        kind: 'path',
        markerStart: 'layer',
        markerEnd: 'layer',
        commands: Array.from({ length: 140 }, (_, i) => [
          ['M', i, 0],
          ['l', 1, 0],
        ]).flat(),
      },
    ])
    expect(() => copyDocumentPresentationNode(input)).not.toThrow()
  })

  it('shares repeated-marker work between separate images in one response', () => {
    const input = marked([
      {
        kind: 'polyline',
        markerMid: 'layer',
        points: Array.from({ length: 102 }, (_, i) => [i, 0]),
      },
    ])
    expect(() => copyDocumentPresentationNode(input)).not.toThrow()
    expect(() =>
      copyDocumentPresentationNode({ type: 'group', children: [input, input] }),
    ).toThrow()
  })

  it('charges a Gaussian kernel after scaling into output pixels', () => {
    expect(() => copyDocumentPresentationNode(shadowImage(1))).not.toThrow()
    expect(() => copyDocumentPresentationNode(shadowImage(20))).toThrow()
  })

  it('also charges the output-pixel kernel for CSS drop shadows', () => {
    const input = {
      ...image([{ ...rect(1, 0), transforms: [{ kind: 'scale', x: 40, y: 40 }] }]),
      styles: [
        {
          filter: {
            kind: 'cssDropShadow',
            shadows: [{ dx: 0, dy: 0, blur: 8, color: [0, 0, 0, 0.5] }],
          },
        },
      ],
    }
    expect(() => copyDocumentPresentationNode(input)).toThrow()
  })

  it('retains ordinary small arrowheads with shared reusable definitions', () => {
    const input = marked(
      Array.from({ length: 30 }, (_, i) => ({
        kind: 'line',
        x1: 0,
        y1: i,
        x2: 100,
        y2: i,
        markerEnd: 'layer',
      })),
      10,
    )
    expect(() => copyDocumentPresentationNode(input)).not.toThrow()
  })
})

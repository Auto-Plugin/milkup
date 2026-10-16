import { describe, expect, it } from 'vitest'
import { copyDocumentPresentationNode } from '../document-presentation'

const length = (value: number, unit = 'user') => ({ value, unit })
function markedLayer(viewBox: readonly number[], refX: unknown, refY: unknown, markerSize = 2000) {
  return {
    type: 'svg-image',
    profile: 'bounded-svg-v1',
    motion: 'static',
    width: 100,
    height: 100,
    rasterBounds: [0, 0, 100, 100],
    viewBox: [0, 0, 100, 100],
    aspect: { align: 'none', fit: 'meet' },
    styles: [{ opacity: 0.5 }],
    definitions: [
      {
        kind: 'marker',
        id: 'large',
        width: markerSize,
        height: markerSize,
        viewBox,
        refX,
        refY,
        units: 'userSpaceOnUse',
        orient: { degrees: 0 },
        children: [
          { kind: 'rect', x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] },
        ],
      },
    ],
    children: [
      {
        kind: 'group',
        style: 0,
        children: [
          {
            kind: 'line',
            x1: 0,
            y1: 0,
            x2: 1,
            y2: 0,
            markerEnd: 'large',
          },
        ],
      },
    ],
  }
}

describe('marker reference points share the marker viewBox coordinate mapping', () => {
  it('rejects the real oversized parent surface when a scaled marker uses its far reference corner', () => {
    expect(() =>
      copyDocumentPresentationNode(markedLayer([0, 0, 1000, 1000], length(1000), length(1000))),
    ).toThrow()
  })
  it('retains the same cost rejection after a viewBox-origin shift and reflected parent placement', () => {
    const input = markedLayer([100, 200, 1000, 1000], length(1100), length(1200))
    const first = input.children[0]!
    const reflected = {
      ...input,
      children: [{ ...first, transforms: [{ kind: 'scale', x: -1, y: 1 }] }],
    }
    expect(() => copyDocumentPresentationNode(reflected)).toThrow()
  })
  it('resolves percentage references in viewBox dimensions before applying the viewport transform', () => {
    expect(() =>
      copyDocumentPresentationNode(
        markedLayer([-500, -500, 500, 500], length(100, 'percent'), length(100, 'percent'), 1000),
      ),
    ).toThrow()
  })
  it('keeps an ordinary scaled marker accepted', () => {
    expect(() =>
      copyDocumentPresentationNode(markedLayer([0, 0, 5, 5], length(5), length(5), 10)),
    ).not.toThrow()
  })
  it('does not let a referencing shape erase the marker stroke inherited from the root', () => {
    const input = markedLayer([0, 0, 1, 1], length(0), length(0), 1)
    const subject = input.children[0]!.children[0]!
    const inherited = {
      ...input,
      rootStyle: 1,
      styles: [
        { opacity: 0.5 },
        {
          stroke: { kind: 'color', rgba: [0, 0, 0, 1] },
          strokeWidth: length(4000),
          lineJoin: 'round',
        },
        { stroke: { kind: 'none' } },
      ],
      children: [{ kind: 'group', style: 0, children: [{ ...subject, style: 2 }] }],
    }
    expect(() => copyDocumentPresentationNode(inherited)).toThrow()
  })

  it('resolves marker em references from the marker font, independent of the shape font', () => {
    const input = markedLayer([0, 0, 1, 1], length(8, 'em'), length(8, 'em'), 1)
    const subject = input.children[0]!.children[0]!
    const inherited = {
      ...input,
      rootStyle: 1,
      styles: [
        { opacity: 0.5 },
        { fontSize: length(512) },
        { fontSize: length(1) },
        { fontSize: length(1, 'em') },
      ],
      definitions: [{ ...input.definitions[0]!, style: 3 }],
      children: [{ kind: 'group', style: 0, children: [{ ...subject, style: 2 }] }],
    }
    expect(() => copyDocumentPresentationNode(inherited)).toThrow()
  })
})

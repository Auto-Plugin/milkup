import { expect, it } from 'vitest'
import { copyDocumentPresentationNode } from '../document-presentation'
const length = (value: number) => ({ value, unit: 'user' })
const image = (children: readonly unknown[]) => ({
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
})
it('charges present title and description elements even when their text is empty', () => {
  const input = image(Array.from({ length: 4092 }, () => ({ kind: 'group', children: [] })))
  expect(() => copyDocumentPresentationNode(input)).not.toThrow()
  expect(() => copyDocumentPresentationNode({ ...input, title: '', description: '' })).toThrow()
})
it('charges fixed textBox children for every expanded symbol instance', () => {
  const text = {
    kind: 'textBox',
    box: [0, 0, 100, 50],
    text: 'Journey',
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
  }
  const input = {
    ...image([{ kind: 'use', ref: 'label' }]),
    definitions: [{ kind: 'symbol', id: 'label', children: [text] }],
  }
  expect(() => copyDocumentPresentationNode(input)).not.toThrow()
  expect(() =>
    copyDocumentPresentationNode({
      ...input,
      children: Array.from({ length: 1000 }, () => ({ kind: 'use', ref: 'label' })),
    }),
  ).toThrow()
})
it('charges the fixed shadow primitive for every applied filter instance', () => {
  const rect = { kind: 'rect', x: 0, y: 0, width: 1, height: 1, style: 0 }
  const input = {
    ...image([rect]),
    styles: [{ filter: { kind: 'definition', ref: 'shadow' } }],
    definitions: [
      {
        kind: 'dropShadowFilter',
        id: 'shadow',
        units: 'userSpaceOnUse',
        primitiveUnits: 'userSpaceOnUse',
        region: [0, 0, 10, 10].map(length),
        colorInterpolation: 'sRGB',
        dx: 0,
        dy: 0,
        stdDeviation: [0, 0],
        color: [0, 0, 0, 0.2],
      },
    ],
  }
  expect(() => copyDocumentPresentationNode(input)).not.toThrow()
  expect(() =>
    copyDocumentPresentationNode({ ...input, children: Array.from({ length: 2000 }, () => rect) }),
  ).toThrow()
})

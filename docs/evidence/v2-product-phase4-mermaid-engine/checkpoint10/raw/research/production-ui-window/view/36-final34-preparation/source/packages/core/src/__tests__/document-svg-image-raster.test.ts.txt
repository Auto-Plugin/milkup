import { describe, expect, it } from 'vitest'
import {
  copyDocumentPresentationNode,
  serializeDocumentPresentationNode,
} from '../document-presentation'

// Unknown wire data exercises the public validator without assuming a new export.
function image() {
  return {
    type: 'svg-image',
    profile: 'bounded-svg-v1',
    motion: 'static',
    width: 160,
    height: 96,
    viewBox: [0, 0, 160, 96],
    aspect: { align: 'xMidYMid', fit: 'meet' },
    styles: [],
    definitions: [],
    children: [{ kind: 'rect', x: 0, y: 0, width: 20, height: 20 }],
  }
}

describe('explicit SVG raster region', () => {
  it('rejects the old implicit viewport rather than silently clipping visible ink', () => {
    expect(() => copyDocumentPresentationNode(image())).toThrow()
  })

  it('preserves negative fractional origins in the host outer viewport', () => {
    const input = { ...image(), rasterBounds: [-4.25, -2.5, 170.5, 102.25] }
    expect(copyDocumentPresentationNode(input)).toEqual(input)
    const output = serializeDocumentPresentationNode(input)
    expect(output).toMatch(/^<svg[^>]*width="172"[^>]*height="103"[^>]*viewBox="-5 -3 172 103"/)
    expect(output).toContain('width="160" height="96" viewBox="0 0 160 96"')
  })

  it('keeps the precise root footprint while allowing right and bottom visible ink', () => {
    const input = { ...image(), width: 160.25, height: 96.75, rasterBounds: [0, 0, 166.5, 101.25] }
    const output = serializeDocumentPresentationNode(input)
    expect(output).toMatch(/^<svg[^>]*width="167"[^>]*height="102"[^>]*viewBox="0 0 167 102"/)
    expect(output).toContain('width="160.25" height="96.75"')
  })

  it('retains intentional inner clipping rather than making the root overflow visible', () => {
    const input = {
      ...image(),
      rasterBounds: [0, 0, 160, 96],
      styles: [{ overflow: 'hidden' }],
      rootStyle: 0,
    }
    const output = serializeDocumentPresentationNode(input)
    expect(output).toContain('overflow:hidden')
  })

  it('requires the region to contain every edge of the original root viewport', () => {
    expect(() =>
      copyDocumentPresentationNode({ ...image(), rasterBounds: [0, 0, 160, 96] }),
    ).not.toThrow()
    for (const rasterBounds of [
      [1, 0, 160, 96],
      [0, 1, 160, 96],
      [-1, 0, 160, 96],
      [0, -1, 160, 96],
    ]) {
      expect(() => copyDocumentPresentationNode({ ...image(), rasterBounds })).toThrow()
    }
  })

  it('rejects invalid or excessively large integer raster surfaces', () => {
    for (const rasterBounds of [
      [NaN, 0, 160, 96],
      [0, 0, Infinity, 96],
      [0, 0, 0, 96],
      [-0.5, 0, 8192, 96],
      [0, 0, 4096.1, 4096],
    ]) {
      expect(() => copyDocumentPresentationNode({ ...image(), rasterBounds })).toThrow()
    }
  })

  it('charges expanded output pixels across images even when each root viewport is tiny', () => {
    const large = { ...image(), rasterBounds: [-100, -100, 4096, 4096] }
    expect(() => copyDocumentPresentationNode(large)).not.toThrow()
    expect(() =>
      copyDocumentPresentationNode({
        type: 'group',
        children: Array.from({ length: 17 }, () => large),
      }),
    ).toThrow()
  })
})

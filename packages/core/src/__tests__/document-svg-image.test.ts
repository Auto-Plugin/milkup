import { describe, expect, it } from 'vitest'
import {
  copyDocumentPresentationAggregate,
  copyDocumentPresentationNode,
  copyDocumentPresentationRequest,
  serializeDocumentPresentationNode,
} from '../document-presentation'

// Unknown transport data deliberately exercises the existing public validator.
// Integer viewport fixtures avoid freezing the unresolved fractional image policy.
function svg(children: readonly unknown[] = [{ kind: 'rect', x: 4, y: 8, width: 80, height: 40 }]) {
  return {
    type: 'svg-image',
    profile: 'bounded-svg-v1',
    motion: 'static',
    width: 160,
    height: 96,
    rasterBounds: [0, 0, 160, 96],
    viewBox: [0, 0, 160, 96],
    aspect: { align: 'xMidYMid', fit: 'meet' },
    title: 'Independent typed diagram',
    styles: [],
    definitions: [],
    children,
  }
}
const request = copyDocumentPresentationRequest({
  documentId: 'svg-test',
  version: 0,
  source: 'first\nsecond\nthird',
  from: 0,
  to: 18,
  fromLine: 1,
  toLine: 3,
  completeStart: true,
  completeEnd: true,
  contextKnown: true,
  protectedRanges: [],
  blocks: [],
  selection: { anchor: 18, head: 18 },
  theme: 'light',
  target: 'screen',
  width: 760,
})
function aggregate(contents: readonly unknown[]) {
  return copyDocumentPresentationAggregate(
    {
      complete: true,
      fragments: contents.map((content, i) => ({
        from: i * 6,
        to: i * 6 + 5,
        layout: 'block',
        accessibleText: `diagram ${i}`,
        content,
      })),
    },
    request,
    [{ id: 'generic', contexts: ['text'] }],
  )
}

describe('closed SVG image document presentation contract', () => {
  it('accepts and independently clones the new typed image through the existing validator', () => {
    const input = svg()
    const copied = copyDocumentPresentationNode(input)
    expect(copied).toEqual(input)
    expect(copied).not.toBe(input)
    expect(Object.isFrozen(copied)).toBe(true)
  })

  it('serializes canonical geometry and escaped accessible text, never producer markup', () => {
    const input = { ...svg(), title: '<script> & "label"' }
    const output = serializeDocumentPresentationNode(input)
    expect(output).toContain('<svg')
    expect(output).toContain('<rect')
    expect(output).toContain('&lt;script&gt; &amp; &quot;label&quot;')
    expect(output).not.toContain('<script>')
    expect(() => copyDocumentPresentationNode({ ...input, rawSvg: '<svg onload="x"/>' })).toThrow()
  })

  it('rejects an unknown child as a whole instead of silently dropping it', () => {
    expect(() => copyDocumentPresentationNode(svg())).not.toThrow()
    expect(() =>
      copyDocumentPresentationNode(
        svg([
          { kind: 'rect', x: 0, y: 0, width: 20, height: 20 },
          { kind: 'foreignRaw', html: '<button>unsafe</button>' },
        ]),
      ),
    ).toThrow()
  })

  it('does not reset the charged-node budget for each SVG image', () => {
    const image = svg(
      Array.from({ length: 2200 }, () => ({
        kind: 'rect',
        x: 1,
        y: 1,
        width: 2,
        height: 2,
      })),
    )
    expect(() => copyDocumentPresentationNode(image)).not.toThrow()
    expect(() => aggregate([image, image])).toThrow()
  })

  it('shares the node budget with existing MathML and ordinary presentation nodes', () => {
    const image = svg(
      Array.from({ length: 2000 }, () => ({
        kind: 'rect',
        x: 1,
        y: 1,
        width: 2,
        height: 2,
      })),
    )
    const math = {
      type: 'math',
      tree: {
        tag: 'math',
        children: Array.from({ length: 2200 }, () => ({ tag: 'mi', text: 'x' })),
      },
    }
    expect(() => copyDocumentPresentationNode(image)).not.toThrow()
    expect(() => copyDocumentPresentationNode(math)).not.toThrow()
    expect(() => aggregate([image, math])).toThrow()
  })

  it('applies depth to the whole presentation tree, not from each nested image root', () => {
    let image: unknown = svg()
    // Independently valid subtree, nested inside existing presentation groups.
    expect(() => copyDocumentPresentationNode(image)).not.toThrow()
    for (let i = 0; i < 64; i++) image = { type: 'group', children: [image] }
    expect(() => copyDocumentPresentationNode(image)).toThrow()
  })

  it('caps aggregate canonical bytes after XML escaping, not only input JSON bytes', () => {
    const image = svg(
      Array.from({ length: 14 }, () => ({
        kind: 'text',
        children: [{ kind: 'textRun', text: '&'.repeat(2000) }],
      })),
    )
    const single = serializeDocumentPresentationNode(image)
    expect(new TextEncoder().encode(single).byteLength).toBeLessThan(262144)
    expect(() =>
      serializeDocumentPresentationNode({ type: 'group', children: [image, image] }),
    ).toThrow()
  })

  it('checks local reference kinds and rebinds IDs in canonical output', () => {
    const image = {
      ...svg([{ kind: 'use', ref: 'owned-icon', width: 20, height: 20 }]),
      definitions: [
        {
          kind: 'symbol',
          id: 'owned-icon',
          viewBox: [0, 0, 20, 20],
          children: [{ kind: 'circle', cx: 10, cy: 10, r: 5 }],
        },
      ],
    }
    expect(() => copyDocumentPresentationNode(image)).not.toThrow()
    const output = serializeDocumentPresentationNode(image)
    expect(output).not.toContain('href="#owned-icon"')
    expect(output).toMatch(/href="#[A-Za-z][A-Za-z0-9_-]*"/)
    expect(() =>
      copyDocumentPresentationNode({
        ...image,
        children: [{ kind: 'use', ref: 'https://example.invalid/icon' }],
      }),
    ).toThrow()
  })

  it.each([83, 323])('preserves all %i dash lengths including zeros and phase', (size) => {
    const dashArray = Array.from({ length: size }, (_, i) => ({
      value: i < 2 ? 0 : i === size - 1 ? 4 : 2,
      unit: 'user',
    }))
    const image = {
      ...svg([{ kind: 'line', x1: 0, y1: 10, x2: 100, y2: 10, style: 0 }]),
      styles: [{ dashArray, dashOffset: { value: 3, unit: 'user' } }],
    }
    expect(copyDocumentPresentationNode(image)).toEqual(image)
    expect(serializeDocumentPresentationNode(image)).toContain(
      `stroke-dasharray:${dashArray.map((x) => x.value).join(' ')}`,
    )
  })

  it('charges dash elements across styles and images against the shared node limit', () => {
    const dashArray = Array.from({ length: 2200 }, () => ({ value: 2, unit: 'user' }))
    const image = { ...svg(), styles: [{ dashArray }] }
    expect(() => copyDocumentPresentationNode(image)).not.toThrow()
    expect(() => aggregate([image, image])).toThrow()
    expect(() =>
      copyDocumentPresentationNode({ ...image, styles: [{ dashArray }, { dashArray }] }),
    ).toThrow()
  })

  it('wraps fractional image dimensions once without changing the inner viewport', () => {
    const image = { ...svg(), width: 160.25, height: 96.75, rasterBounds: [0, 0, 160.25, 96.75] }
    const output = serializeDocumentPresentationNode(image)
    expect(output).toMatch(
      /^<svg[^>]*width="161"[^>]*height="97"[^>]*viewBox="0 0 161 97"[^>]*preserveAspectRatio="none"><svg/,
    )
    expect(output).toContain('width="160.25" height="96.75" viewBox="0 0 160 96"')
    expect((output.match(/<svg /g) ?? []).length).toBe(2)
  })
})

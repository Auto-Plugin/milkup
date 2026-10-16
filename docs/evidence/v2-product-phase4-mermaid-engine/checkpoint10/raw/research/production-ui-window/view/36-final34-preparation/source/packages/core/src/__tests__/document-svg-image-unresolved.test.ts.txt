import { expect, it } from 'vitest'
import {
  copyDocumentPresentationNode,
  serializeDocumentPresentationNode,
} from '../document-presentation'
const rect = { kind: 'rect', x: 0, y: 0, width: 20, height: 20, style: 0 }
const image = (children: readonly unknown[] = [rect]) => ({
  type: 'svg-image',
  profile: 'bounded-svg-v1',
  motion: 'static',
  width: 160,
  height: 96,
  rasterBounds: [0, 0, 160, 96],
  viewBox: [0, 0, 160, 96],
  aspect: { align: 'none', fit: 'meet' },
  styles: [{ filter: { kind: 'unresolved-local' } }],
  definitions: [],
  children,
})
it('preserves a deliberately unresolved local filter without accepting a URL', () => {
  const input = image()
  expect(() => copyDocumentPresentationNode(input)).not.toThrow()
  expect(serializeDocumentPresentationNode(input)).toContain(
    'filter:url(#document-svg-0-unresolved-filter)',
  )
  for (const extra of [
    { ref: 'owned' },
    { url: 'https://example.invalid/filter' },
    { url: 'data:text/xml,active' },
  ])
    expect(() =>
      copyDocumentPresentationNode({
        ...input,
        styles: [{ filter: { kind: 'unresolved-local', ...extra } }],
      }),
    ).toThrow()
})
it('keeps reserved missing IDs unbound even when producer IDs imitate them', () => {
  const input = {
    ...image(),
    definitions: [
      {
        kind: 'symbol',
        id: 'document-svg-0-unresolved-filter',
        children: [{ ...rect, style: undefined }],
      },
    ],
  }
  // Omitted style is distinct from an explicitly undefined transport property.
  const safe = {
    ...input,
    definitions: [
      {
        kind: 'symbol',
        id: 'document-svg-0-unresolved-filter',
        children: [{ kind: 'rect', x: 0, y: 0, width: 1, height: 1 }],
      },
    ],
  }
  const output = serializeDocumentPresentationNode({ type: 'group', children: [safe, safe] })
  const ids = [...output.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
  expect(ids).toEqual(['document-svg-0-d0', 'document-svg-1-d0'])
  for (const prefix of ['document-svg-0', 'document-svg-1']) {
    expect(output).toContain(`filter:url(#${prefix}-unresolved-filter)`)
    expect(ids).not.toContain(`${prefix}-unresolved-filter`)
  }
})
it('does not use an unresolved token to bypass unknown text geometry', () => {
  const text = { kind: 'text', children: [{ kind: 'textRun', text: 'source retained' }] }
  for (const children of [
    [{ ...text, style: 0 }],
    [{ kind: 'group', style: 0, children: [text] }],
    [{ kind: 'text', children: [{ kind: 'tspan', style: 0, children: text.children }] }],
  ])
    expect(() => copyDocumentPresentationNode(image(children))).toThrow()
})
it('charges known-ink compositing surfaces for repeated unresolved filters', () => {
  const large = { ...rect, width: 4000, height: 4000 }
  expect(() => copyDocumentPresentationNode(image([large]))).not.toThrow()
  expect(() =>
    copyDocumentPresentationNode(image(Array.from({ length: 18 }, () => large))),
  ).toThrow()
})

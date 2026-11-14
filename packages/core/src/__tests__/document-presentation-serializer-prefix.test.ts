import { expect, it } from 'vitest'
import { serializeDocumentPresentationNode } from '../document-presentation'
it('validates optional SVG prefixes while preserving the default serializer contract', () => {
  const node = { type: 'text', text: '<safe>' }
  expect(serializeDocumentPresentationNode(node)).toBe('&lt;safe&gt;')
  expect(serializeDocumentPresentationNode(node, undefined, { idPrefix: 'export-12' })).toBe(
    '&lt;safe&gt;',
  )
  for (const prefix of ['bad" onclick="x', '', 'x'.repeat(65)])
    expect(() => serializeDocumentPresentationNode(node, undefined, { idPrefix: prefix })).toThrow(
      'invalid-input',
    )
})

import { describe, it, expect } from 'vitest'
import { parsePluginManifest, validatePluginManifest } from './manifest'
import { copyDocumentPresentationRequest, copyDocumentPresentationResult } from '@milkup/core'
const manifest = {
  id: 'test.presentation',
  name: 'Presentation',
  version: '1.0.0',
  permissions: ['document:read'],
  contributes: { documentRenderers: [{ id: 'sample', contexts: ['text'] }] },
}
export const request = () =>
  copyDocumentPresentationRequest({
    documentId: 'doc',
    version: 1,
    from: 0,
    to: 5,
    source: 'hello',
    fromLine: 1,
    toLine: 1,
    completeStart: true,
    completeEnd: true,
    contextKnown: true,
    protectedRanges: [],
    blocks: [{ from: 0, to: 5, kind: 'text', complete: true, contentRanges: [{ from: 0, to: 5 }] }],
    selection: { anchor: 0, head: 0 },
    theme: 'light',
    target: 'screen',
    width: 400,
  })
export const result = () => ({
  fragments: [
    {
      from: 0,
      to: 5,
      layout: 'inline',
      content: { type: 'text', text: 'hello' },
      accessibleText: 'hello',
    },
  ],
  complete: true,
})
describe('document rendering contract', () => {
  it('retains a new declaration without changing existing syntax/UI contributions', () =>
    expect(parsePluginManifest(manifest).contributes).toEqual(manifest.contributes))
  it.each([
    { id: 'sample', contexts: ['unknown'] },
    { id: 'sample', contexts: ['fence'] },
    { id: 'sample', contexts: ['text'], module: 'evil' },
  ])('rejects malformed declaration %j', (declaration) =>
    expect(
      validatePluginManifest({ ...manifest, contributes: { documentRenderers: [declaration] } }).ok,
    ).toBe(false),
  )
  it('requires read permission', () =>
    expect(validatePluginManifest({ ...manifest, permissions: [] }).ok).toBe(false))
  it('copies immutable inert semantics', () => {
    const value = copyDocumentPresentationResult(result(), request())
    expect(value).toEqual(result())
    expect(Object.isFrozen(value.fragments[0]?.content)).toBe(true)
  })
  it.each([
    { type: 'html', html: '<script/>' },
    { type: 'text', text: 'ok', href: 'javascript:x' },
    { type: 'vector', width: Infinity, height: 20, children: [] },
    { type: 'reference', label: 'x', target: { documentId: 'other', version: 1, from: 0, to: 1 } },
  ])('rejects unsafe semantic node %j', (content) =>
    expect(() =>
      copyDocumentPresentationResult(
        { ...result(), fragments: [{ ...result().fragments[0], content }] },
        request(),
      ),
    ).toThrow(),
  )
  it('rejects output inside protected code or unknown context', () => {
    expect(() =>
      copyDocumentPresentationResult(result(), {
        ...request(),
        protectedRanges: [{ from: 1, to: 2 }],
      }),
    ).toThrow()
    expect(() =>
      copyDocumentPresentationResult(result(), { ...request(), contextKnown: false }),
    ).toThrow()
  })
  it('rejects overlapping, oversized and deep results', () => {
    expect(() =>
      copyDocumentPresentationResult(
        { ...result(), fragments: [...result().fragments, ...result().fragments] },
        request(),
      ),
    ).toThrow()
    expect(() =>
      copyDocumentPresentationResult(
        {
          ...result(),
          fragments: [{ ...result().fragments[0], accessibleText: 'x'.repeat(9000) }],
        },
        request(),
      ),
    ).toThrow()
    let content: unknown = { type: 'text', text: 'x' }
    for (let i = 0; i < 65; i++) content = { type: 'group', children: [content] }
    expect(() =>
      copyDocumentPresentationResult(
        { ...result(), fragments: [{ ...result().fragments[0], content }] },
        request(),
      ),
    ).toThrow()
  })
})

import { copyDocumentPresentationAggregate } from '@milkup/core'
describe('aggregate presentation authorization and budgets', () => {
  it('accepts a complete declared fence but rejects partial/wrong-language/unowned fence output', () => {
    const req = {
      ...request(),
      blocks: [
        {
          from: 0,
          to: 5,
          kind: 'fence' as const,
          complete: true,
          info: 'graph',
          contentRanges: [{ from: 1, to: 4 }],
        },
      ],
      protectedRanges: [{ from: 0, to: 5 }],
    }
    const out = { ...result(), fragments: [{ ...result().fragments[0], layout: 'block' }] }
    const declarations = [
      { id: 'text', contexts: ['text' as const] },
      { id: 'diagram', contexts: ['fence' as const], fenceLanguages: ['graph'] },
    ]
    expect(copyDocumentPresentationAggregate(out, req, declarations)).toEqual(out)
    expect(() => copyDocumentPresentationAggregate(out, req, [declarations[0]!])).toThrow()
    expect(() =>
      copyDocumentPresentationAggregate(
        out,
        { ...req, blocks: [{ ...req.blocks[0]!, complete: false }] },
        declarations,
      ),
    ).toThrow()
    expect(() => copyDocumentPresentationAggregate(out, req, [])).toThrow()
  })
  it('applies the combined node and UTF-8 byte budget to every provider result', () => {
    const fragment = result().fragments[0]!
    const enormous = {
      type: 'group',
      children: Array.from({ length: 4096 }, () => ({ type: 'text', text: 'x' })),
    }
    expect(() =>
      copyDocumentPresentationResult(
        { ...result(), fragments: [{ ...fragment, content: enormous }] },
        request(),
      ),
    ).toThrow()
    const unicode = {
      type: 'group',
      children: Array.from({ length: 4 }, () => ({ type: 'text', text: '漢'.repeat(40000) })),
    }
    expect(() =>
      copyDocumentPresentationResult(
        { ...result(), fragments: [{ ...fragment, content: unicode }] },
        request(),
      ),
    ).toThrow()
  })
  it('rejects misleading source line counts and attribute getters without invoking them', () => {
    expect(() =>
      copyDocumentPresentationRequest({ ...request(), source: '\n'.repeat(300), to: 300 }),
    ).toThrow()
    let called = false
    const content = {
      type: 'text',
      get text() {
        called = true
        return 'evil'
      },
    }
    expect(() =>
      copyDocumentPresentationResult(
        { ...result(), fragments: [{ ...result().fragments[0], content }] },
        request(),
      ),
    ).toThrow()
    expect(called).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  copyDocumentPresentationAggregate,
  copyDocumentPresentationRequest,
  copyDocumentPresentationResult,
} from '../document-presentation'

const request = copyDocumentPresentationRequest({
  documentId: 'document',
  version: 7,
  source: 'text',
  from: 0,
  to: 4,
  fromLine: 1,
  toLine: 1,
  completeStart: true,
  completeEnd: true,
  contextKnown: true,
  protectedRanges: [],
  blocks: [],
  selection: { anchor: 0, head: 0 },
  theme: 'light',
  target: 'export',
  width: 400,
})
const declarations = [{ id: 'index', contexts: ['text'] as const }]
const fragment = {
  from: 0,
  to: 4,
  layout: 'inline',
  content: { type: 'text', text: 'text' },
  accessibleText: 'text',
}

describe('explicit pending presentation contract', () => {
  it('preserves a pending signal and immutable validated partial output through copies', () => {
    const input = { fragments: [fragment], complete: false, pending: true }
    const copied = copyDocumentPresentationResult(input, request, declarations)
    expect(copied).toEqual(input)
    expect(Object.isFrozen(copied)).toBe(true)
    expect(copied.fragments[0]).not.toBe(fragment)
    expect(Object.isFrozen(copied.fragments[0]?.content)).toBe(true)
    expect(copyDocumentPresentationResult(copied, request, declarations)).toEqual(input)
  })

  it('retains pending after aggregate validation and a JSON transport round trip', () => {
    const input = { fragments: [], complete: false, pending: true }
    const copied = copyDocumentPresentationAggregate(
      JSON.parse(JSON.stringify(input)),
      request,
      declarations,
    )
    expect(copied).toEqual(input)
    expect(Object.hasOwn(copied, 'pending')).toBe(true)
  })

  it.each([true, false])(
    'preserves legacy complete=%s without synthesizing pending',
    (complete) => {
      const input = { fragments: [fragment], complete }
      const copied = copyDocumentPresentationAggregate(input, request, declarations)
      expect(copied).toEqual(input)
      expect(Object.hasOwn(copied, 'pending')).toBe(false)
    },
  )

  it.each([false, 'true', 1, null, undefined, {}, []])(
    'rejects a present pending field other than literal true: %j',
    (pending) => {
      expect(() =>
        copyDocumentPresentationResult({ fragments: [], complete: false, pending }, request),
      ).toThrow('invalid-output')
    },
  )

  it('rejects pending with a complete result', () => {
    expect(() =>
      copyDocumentPresentationResult({ fragments: [], complete: true, pending: true }, request),
    ).toThrow('invalid-output')
  })

  it('does not widen the closed result or fragment grammar', () => {
    expect(() =>
      copyDocumentPresentationResult(
        { fragments: [], complete: false, pending: true, retryAfterMs: 1 },
        request,
      ),
    ).toThrow('invalid-output')
    expect(() =>
      copyDocumentPresentationResult(
        { fragments: [{ ...fragment, pending: true }], complete: false, pending: true },
        request,
      ),
    ).toThrow('invalid-output')
  })
})

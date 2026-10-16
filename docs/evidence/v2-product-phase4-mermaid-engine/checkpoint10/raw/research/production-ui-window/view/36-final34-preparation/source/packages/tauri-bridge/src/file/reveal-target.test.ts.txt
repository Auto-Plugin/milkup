import { describe, expect, it } from 'vitest'

import { createDocumentSession } from '../session/document-session'
import { getRevealTarget } from './reveal-target'

describe('reveal target', () => {
  it('resolves a reveal target through documentId', () => {
    const session = createDocumentSession({
      documentId: 'doc-1',
      file: { path: 'D:/notes/a.md' },
    })

    expect(getRevealTarget([session], { kind: 'revealInFolder', documentId: 'doc-1' })).toEqual({
      canReveal: true,
      path: 'D:/notes/a.md',
    })
  })

  it('does not reveal an unsaved document', () => {
    const session = createDocumentSession({ documentId: 'doc-1' })

    expect(getRevealTarget([session], { kind: 'revealInFolder', documentId: 'doc-1' })).toEqual({
      canReveal: false,
      reason: 'unsaved-document',
    })
  })

  it('does not reveal a missing document id', () => {
    expect(getRevealTarget([], { kind: 'revealInFolder', documentId: 'doc-1' })).toEqual({
      canReveal: false,
      reason: 'missing-document',
    })
  })
})

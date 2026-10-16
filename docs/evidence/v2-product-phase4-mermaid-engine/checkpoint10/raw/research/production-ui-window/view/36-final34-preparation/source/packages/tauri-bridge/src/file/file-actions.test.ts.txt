import { describe, expect, it } from 'vitest'

import {
  fileActionRequiresDocumentId,
  getFileActionDocumentId,
  type FileActionKind,
} from './file-actions'

describe('file action contracts', () => {
  it('requires documentId for document-scoped file actions', () => {
    const scopedKinds: FileActionKind[] = ['new', 'reload', 'save', 'saveAs', 'revealInFolder']

    expect(scopedKinds.every((kind) => fileActionRequiresDocumentId(kind))).toBe(true)
    expect(fileActionRequiresDocumentId('open')).toBe(false)
  })

  it('extracts documentId only from actions that are explicitly document-scoped', () => {
    expect(getFileActionDocumentId({ kind: 'open', path: 'D:/notes/a.md' })).toBeUndefined()
    expect(
      getFileActionDocumentId({ kind: 'reload', documentId: 'doc-1', path: 'D:/notes/a.md' }),
    ).toBe('doc-1')
    expect(getFileActionDocumentId({ kind: 'save', documentId: 'doc-1' })).toBe('doc-1')
    expect(
      getFileActionDocumentId({ kind: 'saveAs', documentId: 'doc-1', path: 'D:/notes/b.md' }),
    ).toBe('doc-1')
  })
})

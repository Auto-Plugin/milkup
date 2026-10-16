import { describe, expect, it } from 'vitest'

import {
  createDocumentSession,
  markExternalFileDeleted,
  markExternalFileModified,
  markSessionReadonly,
} from './document-session'
import { getSaveSafety } from './save-safety'

describe('save safety', () => {
  it('allows normal clean or dirty sessions to save', () => {
    const session = createDocumentSession({ documentId: 'doc-1' })

    expect(getSaveSafety(session)).toEqual({ canSave: true })
  })

  it('blocks readonly saves', () => {
    const session = markSessionReadonly(createDocumentSession({ documentId: 'doc-1' }), true)

    expect(getSaveSafety(session)).toMatchObject({
      canSave: false,
      reason: 'readonly',
    })
  })

  it('blocks saves when the file changed externally', () => {
    const modified = markExternalFileModified(createDocumentSession({ documentId: 'doc-1' }))
    const deleted = markExternalFileDeleted(createDocumentSession({ documentId: 'doc-1' }))

    expect(getSaveSafety(modified)).toMatchObject({
      canSave: false,
      reason: 'external-change',
    })
    expect(getSaveSafety(deleted)).toMatchObject({
      canSave: false,
      reason: 'external-change',
    })
  })
})

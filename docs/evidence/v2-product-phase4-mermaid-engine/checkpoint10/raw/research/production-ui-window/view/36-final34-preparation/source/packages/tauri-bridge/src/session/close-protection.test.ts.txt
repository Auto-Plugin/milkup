import { ChangeSet, Selection } from '@milkup/core'
import { describe, expect, it } from 'vitest'

import {
  applyCloseDecision,
  evaluateCloseProtection,
  shouldPromptBeforeClose,
} from './close-protection'
import {
  createDocumentSession,
  markExternalFileModified,
  recordDocumentTransaction,
} from './document-session'

const edit = {
  changes: ChangeSet.insert(0, 'x'),
  selection: Selection.cursor(1),
  origin: { type: 'input.type' as const },
}

describe('close protection', () => {
  it('does not prompt for clean documents', () => {
    const clean = createDocumentSession({ documentId: 'doc-clean' })

    expect(shouldPromptBeforeClose(clean)).toBe(false)
    expect(
      evaluateCloseProtection([clean], {
        scope: 'tab',
        documentIds: ['doc-clean'],
      }),
    ).toMatchObject({
      allowClose: true,
      blockedDocumentIds: [],
      requestedDocumentIds: ['doc-clean'],
    })
  })

  it('prompts for dirty documents and keeps them open when cancelled', () => {
    const dirty = recordDocumentTransaction(
      createDocumentSession({ documentId: 'doc-dirty' }),
      edit,
    )
    const decision = evaluateCloseProtection([dirty], {
      scope: 'tab',
      documentIds: ['doc-dirty'],
    })

    expect(decision.allowClose).toBe(false)
    expect(decision.blockedDocumentIds).toEqual(['doc-dirty'])
    expect(applyCloseDecision([dirty], decision, 'cancel')).toEqual([dirty])
  })

  it('closes a dirty tab after explicit confirmation', () => {
    const dirty = recordDocumentTransaction(
      createDocumentSession({ documentId: 'doc-dirty' }),
      edit,
    )
    const clean = createDocumentSession({ documentId: 'doc-clean' })
    const decision = evaluateCloseProtection([dirty, clean], {
      scope: 'tab',
      documentIds: ['doc-dirty'],
    })

    expect(applyCloseDecision([dirty, clean], decision, 'confirm')).toEqual([clean])
  })

  it('closes every requested tab after confirming a mixed clean and dirty close request', () => {
    const cleanRequested = createDocumentSession({ documentId: 'doc-clean-requested' })
    const dirtyRequested = recordDocumentTransaction(
      createDocumentSession({ documentId: 'doc-dirty-requested' }),
      edit,
    )
    const cleanUnrequested = createDocumentSession({ documentId: 'doc-clean-unrequested' })
    const sessions = [cleanRequested, dirtyRequested, cleanUnrequested]
    const decision = evaluateCloseProtection(sessions, {
      scope: 'tab',
      documentIds: ['doc-clean-requested', 'doc-dirty-requested'],
    })

    expect(decision.allowClose).toBe(false)
    expect(decision.requestedDocumentIds).toEqual(['doc-clean-requested', 'doc-dirty-requested'])
    expect(decision.blockedDocumentIds).toEqual(['doc-dirty-requested'])
    expect(applyCloseDecision(sessions, decision, 'confirm')).toEqual([cleanUnrequested])
  })

  it('checks all requested documents for window and quit close requests', () => {
    const clean = createDocumentSession({ documentId: 'doc-clean' })
    const dirty = recordDocumentTransaction(
      createDocumentSession({ documentId: 'doc-dirty' }),
      edit,
    )

    expect(evaluateCloseProtection([clean, dirty], { scope: 'window' })).toMatchObject({
      allowClose: false,
      blockedDocumentIds: ['doc-dirty'],
    })
    expect(evaluateCloseProtection([clean, dirty], { scope: 'quit' })).toMatchObject({
      allowClose: false,
      blockedDocumentIds: ['doc-dirty'],
    })
  })

  it('prompts for conflicted documents', () => {
    const dirty = recordDocumentTransaction(
      createDocumentSession({ documentId: 'doc-dirty' }),
      edit,
    )
    const conflicted = markExternalFileModified(dirty)

    expect(shouldPromptBeforeClose(conflicted)).toBe(true)
    expect(evaluateCloseProtection([conflicted], { scope: 'window' }).blockedDocumentIds).toEqual([
      'doc-dirty',
    ])
  })
})

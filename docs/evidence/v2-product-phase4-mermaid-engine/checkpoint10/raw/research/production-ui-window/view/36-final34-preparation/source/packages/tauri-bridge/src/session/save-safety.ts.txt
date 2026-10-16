import type { DocumentSession } from './document-session'

export type SaveBlockReason = 'readonly' | 'external-change'

export type SaveSafety =
  | {
      readonly canSave: true
    }
  | {
      readonly canSave: false
      readonly reason: SaveBlockReason
      readonly message: string
    }

export function getSaveSafety(session: DocumentSession): SaveSafety {
  if (session.readonly) {
    return {
      canSave: false,
      reason: 'readonly',
      message: 'The document is read-only.',
    }
  }

  if (session.externalChangeState !== 'none') {
    return {
      canSave: false,
      reason: 'external-change',
      message: 'The file changed outside the editor.',
    }
  }

  return { canSave: true }
}

export function canSaveSession(session: DocumentSession): boolean {
  return getSaveSafety(session).canSave
}

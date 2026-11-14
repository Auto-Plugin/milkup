import type { RevealInFolderAction } from './file-actions'
import type { DocumentSession } from '../session/document-session'

export type RevealTarget =
  | {
      readonly canReveal: true
      readonly path: string
    }
  | {
      readonly canReveal: false
      readonly reason: 'missing-document' | 'unsaved-document'
    }

export function getRevealTarget(
  sessions: readonly DocumentSession[],
  action: RevealInFolderAction,
): RevealTarget {
  const session = sessions.find((candidate) => candidate.documentId === action.documentId)

  if (!session) {
    return {
      canReveal: false,
      reason: 'missing-document',
    }
  }

  if (!session.file) {
    return {
      canReveal: false,
      reason: 'unsaved-document',
    }
  }

  return {
    canReveal: true,
    path: session.file.path,
  }
}

import type { DocumentSession, DocumentSessionId } from './document-session'

export type CloseScope = 'tab' | 'window' | 'quit'

export interface CloseRequest {
  readonly scope: CloseScope
  readonly documentIds?: readonly DocumentSessionId[]
}

export interface CloseProtectionDecision {
  readonly scope: CloseScope
  readonly allowClose: boolean
  readonly requestedDocumentIds: readonly DocumentSessionId[]
  readonly blockedDocumentIds: readonly DocumentSessionId[]
}

export type CloseUserChoice = 'confirm' | 'cancel'

export function shouldPromptBeforeClose(session: DocumentSession): boolean {
  return session.dirty || session.externalChangeState === 'conflict'
}

export function evaluateCloseProtection(
  sessions: readonly DocumentSession[],
  request: CloseRequest,
): CloseProtectionDecision {
  const requested = selectRequestedSessions(sessions, request)
  const requestedDocumentIds = requested.map((session) => session.documentId)
  const blockedDocumentIds = requested
    .filter((session) => shouldPromptBeforeClose(session))
    .map((session) => session.documentId)

  return Object.freeze({
    scope: request.scope,
    allowClose: blockedDocumentIds.length === 0,
    requestedDocumentIds: Object.freeze(requestedDocumentIds),
    blockedDocumentIds: Object.freeze(blockedDocumentIds),
  })
}

export function applyCloseDecision(
  sessions: readonly DocumentSession[],
  decision: CloseProtectionDecision,
  choice: CloseUserChoice,
): readonly DocumentSession[] {
  if (!decision.allowClose && choice === 'cancel') {
    return sessions
  }

  const closingIds = new Set(decision.requestedDocumentIds)

  if (decision.scope === 'tab') {
    return Object.freeze(sessions.filter((session) => !closingIds.has(session.documentId)))
  }

  return Object.freeze([])
}

function selectRequestedSessions(
  sessions: readonly DocumentSession[],
  request: CloseRequest,
): readonly DocumentSession[] {
  if (!request.documentIds) {
    return sessions
  }

  const requestedIds = new Set(request.documentIds)
  return sessions.filter((session) => requestedIds.has(session.documentId))
}

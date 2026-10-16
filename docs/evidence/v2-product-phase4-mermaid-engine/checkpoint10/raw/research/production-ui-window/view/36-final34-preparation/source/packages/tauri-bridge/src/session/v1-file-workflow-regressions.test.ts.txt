import { ChangeSet, Selection, type Transaction } from '@milkup/core'
import { describe, expect, it } from 'vitest'

import {
  applyFileWatchEvent,
  applyCloseDecision,
  createFileWatchEvent,
  evaluateCloseProtection,
  getSaveSafety,
  recordDocumentTransaction,
  recordFileSaveResult,
  recordModeChange,
  recordParserCacheUpdate,
  recordSelectionChange,
  recordThemeChange,
} from '..'
import { createDocumentSessionFromOpenResult } from './document-session'

const typeText = (pos: number, text: string): Transaction => ({
  changes: ChangeSet.insert(pos, text),
  selection: Selection.cursor(pos + text.length),
  origin: { type: 'input.type' },
})

describe('v1 dirty/save/file watcher regressions', () => {
  it('keeps an opened file clean until a document-changing transaction occurs', () => {
    let session = createDocumentSessionFromOpenResult({
      documentId: 'file:D:/notes/opened.md',
      file: { path: 'D:/notes/opened.md' },
      text: '# Opened\n',
      diskSnapshotHash: 'hash-opened',
    })

    session = recordSelectionChange(session)
    session = recordModeChange(session, 'live')
    session = recordThemeChange(session, 'dark')
    session = recordParserCacheUpdate(session)

    expect(session.documentVersion).toBe(0)
    expect(session.savedVersion).toBe(0)
    expect(session.dirty).toBe(false)

    session = recordDocumentTransaction(session, typeText(9, 'changed'))

    expect(session.documentVersion).toBe(1)
    expect(session.savedVersion).toBe(0)
    expect(session.dirty).toBe(true)
  })

  it('clears dirty only when the matching document save result is applied', () => {
    const opened = createDocumentSessionFromOpenResult({
      documentId: 'file:D:/notes/a.md',
      file: { path: 'D:/notes/a.md' },
      text: 'a',
      diskSnapshotHash: 'hash-a',
    })
    const dirty = recordDocumentTransaction(opened, typeText(1, ' changed'))

    expect(() =>
      recordFileSaveResult(dirty, {
        documentId: 'file:D:/notes/other.md',
        file: { path: 'D:/notes/other.md' },
        diskSnapshotHash: 'hash-other',
      }),
    ).toThrow('does not match session')
    expect(dirty.dirty).toBe(true)

    const saved = recordFileSaveResult(dirty, {
      documentId: dirty.documentId,
      file: { path: 'D:/notes/a.md' },
      diskSnapshotHash: 'hash-saved',
    })
    const watcherEcho = applyFileWatchEvent(
      saved,
      createFileWatchEvent({
        kind: 'modified',
        documentId: saved.documentId,
        file: { path: 'D:/notes/a.md' },
        diskSnapshotHash: 'hash-saved',
      }),
    )

    expect(saved.savedVersion).toBe(saved.documentVersion)
    expect(saved.diskSnapshotHash).toBe('hash-saved')
    expect(saved.dirty).toBe(false)
    expect(saved.externalChangeState).toBe('none')
    expect(watcherEcho).toBe(saved)
  })

  it('blocks overwriting externally changed files until conflict handling resolves it', () => {
    const opened = createDocumentSessionFromOpenResult({
      documentId: 'file:D:/notes/conflict.md',
      file: { path: 'D:/notes/conflict.md' },
      text: 'original',
      diskSnapshotHash: 'hash-original',
    })
    const dirty = recordDocumentTransaction(opened, typeText(8, ' local'))
    const conflicted = applyFileWatchEvent(
      dirty,
      createFileWatchEvent({
        kind: 'modified',
        documentId: dirty.documentId,
        file: { path: 'D:/notes/conflict.md' },
        diskSnapshotHash: 'hash-external',
      }),
    )

    expect(conflicted.externalChangeState).toBe('conflict')
    expect(getSaveSafety(conflicted)).toMatchObject({
      canSave: false,
      reason: 'external-change',
    })

    const deleted = applyFileWatchEvent(
      dirty,
      createFileWatchEvent({
        kind: 'deleted',
        documentId: dirty.documentId,
        file: { path: 'D:/notes/conflict.md' },
      }),
    )

    expect(deleted.externalChangeState).toBe('conflict')
    expect(getSaveSafety(deleted).canSave).toBe(false)
  })

  it('checks every requested document before window or quit close can continue', () => {
    const clean = createDocumentSessionFromOpenResult({
      documentId: 'file:D:/notes/clean.md',
      file: { path: 'D:/notes/clean.md' },
      text: 'clean',
      diskSnapshotHash: 'hash-clean',
    })
    const dirty = recordDocumentTransaction(
      createDocumentSessionFromOpenResult({
        documentId: 'file:D:/notes/dirty.md',
        file: { path: 'D:/notes/dirty.md' },
        text: 'dirty',
        diskSnapshotHash: 'hash-dirty',
      }),
      typeText(5, ' edit'),
    )
    const conflicted = applyFileWatchEvent(
      dirty,
      createFileWatchEvent({
        kind: 'modified',
        documentId: dirty.documentId,
        file: { path: 'D:/notes/dirty.md' },
        diskSnapshotHash: 'hash-external',
      }),
    )

    const windowDecision = evaluateCloseProtection([clean, conflicted], { scope: 'window' })
    const quitDecision = evaluateCloseProtection([clean, conflicted], { scope: 'quit' })

    expect(windowDecision.allowClose).toBe(false)
    expect(windowDecision.blockedDocumentIds).toEqual([conflicted.documentId])
    expect(quitDecision.allowClose).toBe(false)
    expect(quitDecision.blockedDocumentIds).toEqual([conflicted.documentId])
    expect(applyCloseDecision([clean, conflicted], windowDecision, 'cancel')).toEqual([
      clean,
      conflicted,
    ])
    expect(applyCloseDecision([clean, conflicted], windowDecision, 'confirm')).toEqual([])
  })
})

import { ChangeSet, Selection } from '@milkup/core'
import {
  applyFileWatchEvent,
  createDocumentSessionFromOpenResult,
  createFileWatchEvent,
  getSaveSafety,
  recordDocumentTransaction,
  recordFileReloadResult,
  recordFileSaveResult,
} from '@milkup/tauri-bridge'
import { describe, expect, it } from 'vitest'

import { v1Issue } from './helpers/metadata'

const issue = v1Issue({
  area: 'file',
  lesson: 'File watcher events must never overwrite dirty memory state silently.',
  risk: 'External file changes in v1 could race with save/reload and lose edits.',
  source: 'https://github.com/Auto-Plugin/milkup/issues/105',
})

describe('v1 regression: file watcher conflict state', () => {
  it('separates own-save watcher echoes, clean reloadable changes, and dirty conflicts', () => {
    expect(issue.source).toContain('/105')

    const opened = createDocumentSessionFromOpenResult({
      documentId: 'file:D:/notes/watched.md',
      file: { path: 'D:/notes/watched.md' },
      text: 'base',
      diskSnapshotHash: 'hash-base',
    })
    const dirty = recordDocumentTransaction(opened, {
      changes: ChangeSet.insert(4, ' local'),
      selection: Selection.cursor(10),
      origin: { type: 'input.type' },
    })
    const saved = recordFileSaveResult(dirty, {
      documentId: dirty.documentId,
      file: { path: 'D:/notes/watched.md' },
      diskSnapshotHash: 'hash-saved',
    })
    const ownSaveEcho = applyFileWatchEvent(
      saved,
      createFileWatchEvent({
        kind: 'modified',
        documentId: saved.documentId,
        file: { path: 'D:/notes/watched.md' },
        diskSnapshotHash: 'hash-saved',
      }),
    )

    expect(ownSaveEcho).toBe(saved)

    const externallyModifiedClean = applyFileWatchEvent(
      saved,
      createFileWatchEvent({
        kind: 'modified',
        documentId: saved.documentId,
        file: { path: 'D:/notes/watched.md' },
        diskSnapshotHash: 'hash-external',
      }),
    )

    expect(externallyModifiedClean.externalChangeState).toBe('modified-clean')
    expect(getSaveSafety(externallyModifiedClean)).toMatchObject({
      canSave: false,
      reason: 'external-change',
    })

    const reloaded = recordFileReloadResult(externallyModifiedClean, {
      documentId: externallyModifiedClean.documentId,
      file: { path: 'D:/notes/watched.md' },
      text: 'external\r\n',
      diskSnapshotHash: 'hash-external',
    })

    expect(reloaded).toMatchObject({
      dirty: false,
      externalChangeState: 'none',
      diskSnapshotHash: 'hash-external',
      lineEnding: 'crlf',
    })

    const dirtyAgain = recordDocumentTransaction(reloaded, {
      changes: ChangeSet.insert(8, ' local'),
      selection: Selection.cursor(14),
      origin: { type: 'input.type' },
    })
    const conflicted = applyFileWatchEvent(
      dirtyAgain,
      createFileWatchEvent({
        kind: 'modified',
        documentId: dirtyAgain.documentId,
        file: { path: 'D:/notes/watched.md' },
        diskSnapshotHash: 'hash-newer-external',
      }),
    )

    expect(conflicted.externalChangeState).toBe('conflict')
    expect(conflicted.dirty).toBe(true)
    expect(getSaveSafety(conflicted).canSave).toBe(false)
  })
})

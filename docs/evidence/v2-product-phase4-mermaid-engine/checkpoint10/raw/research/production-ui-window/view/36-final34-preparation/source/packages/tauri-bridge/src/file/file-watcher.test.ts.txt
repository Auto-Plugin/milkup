import { ChangeSet, Selection } from '@milkup/core'
import { describe, expect, it } from 'vitest'

import { createDocumentSession, recordDocumentTransaction } from '../session/document-session'
import { applyFileWatchEvent } from '../session/document-session'
import { createFileWatchEvent } from './file-watcher'

const edit = {
  changes: ChangeSet.insert(0, 'x'),
  selection: Selection.cursor(1),
  origin: { type: 'input.type' as const },
}

describe('file watcher bridge contract', () => {
  it('marks clean documents as externally modified or deleted', () => {
    const session = createDocumentSession({
      documentId: 'doc-1',
      file: { path: 'D:/notes/a.md' },
      diskSnapshotHash: 'hash-a',
    })

    expect(
      applyFileWatchEvent(
        session,
        createFileWatchEvent({
          kind: 'modified',
          documentId: 'doc-1',
          file: { path: 'D:/notes/a.md' },
          diskSnapshotHash: 'hash-b',
        }),
      ).externalChangeState,
    ).toBe('modified-clean')
    expect(
      applyFileWatchEvent(
        session,
        createFileWatchEvent({
          kind: 'deleted',
          documentId: 'doc-1',
          file: { path: 'D:/notes/a.md' },
        }),
      ).externalChangeState,
    ).toBe('deleted-clean')
  })

  it('marks dirty documents as conflicts', () => {
    const dirty = recordDocumentTransaction(
      createDocumentSession({
        documentId: 'doc-1',
        file: { path: 'D:/notes/a.md' },
        diskSnapshotHash: 'hash-a',
      }),
      edit,
    )

    const watched = applyFileWatchEvent(
      dirty,
      createFileWatchEvent({
        kind: 'modified',
        documentId: 'doc-1',
        file: { path: 'D:/notes/a.md' },
        diskSnapshotHash: 'hash-b',
      }),
    )

    expect(watched.externalChangeState).toBe('conflict')
    expect(watched.dirty).toBe(true)
  })

  it('ignores modified events that match the current saved disk snapshot', () => {
    const clean = createDocumentSession({
      documentId: 'doc-1',
      file: { path: 'D:/notes/a.md' },
      diskSnapshotHash: 'hash-a',
    })
    const dirty = recordDocumentTransaction(clean, edit)

    expect(
      applyFileWatchEvent(
        clean,
        createFileWatchEvent({
          kind: 'modified',
          documentId: 'doc-1',
          file: { path: 'D:/notes/a.md' },
          diskSnapshotHash: 'hash-a',
        }),
      ),
    ).toBe(clean)
    expect(
      applyFileWatchEvent(
        dirty,
        createFileWatchEvent({
          kind: 'modified',
          documentId: 'doc-1',
          file: { path: 'D:/notes/a.md' },
          diskSnapshotHash: 'hash-a',
        }),
      ),
    ).toBe(dirty)
  })

  it('rejects events for a different document', () => {
    const session = createDocumentSession({
      documentId: 'doc-1',
      file: { path: 'D:/notes/a.md' },
    })

    expect(() =>
      applyFileWatchEvent(
        session,
        createFileWatchEvent({
          kind: 'modified',
          documentId: 'doc-2',
          file: { path: 'D:/notes/a.md' },
        }),
      ),
    ).toThrow('does not match session')
  })

  it('rejects stale path events after save-as changes the watched file', () => {
    const session = createDocumentSession({
      documentId: 'doc-1',
      file: { path: 'D:/notes/renamed.md' },
    })

    expect(() =>
      applyFileWatchEvent(
        session,
        createFileWatchEvent({
          kind: 'deleted',
          documentId: 'doc-1',
          file: { path: 'D:/notes/original.md' },
        }),
      ),
    ).toThrow('does not match session path')
  })

  it('rejects events for unsaved documents', () => {
    const session = createDocumentSession({ documentId: 'doc-1' })

    expect(() =>
      applyFileWatchEvent(
        session,
        createFileWatchEvent({
          kind: 'modified',
          documentId: 'doc-1',
          file: { path: 'D:/notes/a.md' },
        }),
      ),
    ).toThrow('unsaved session')
  })

  it('upgrades a reloadable external state to conflict when local editing resumes', () => {
    const session = createDocumentSession({
      documentId: 'doc-1',
      file: { path: 'D:/notes/a.md' },
      diskSnapshotHash: 'hash-a',
    })
    const externallyModified = applyFileWatchEvent(
      session,
      createFileWatchEvent({
        kind: 'modified',
        documentId: 'doc-1',
        file: { path: 'D:/notes/a.md' },
        diskSnapshotHash: 'hash-b',
      }),
    )

    const dirty = recordDocumentTransaction(externallyModified, edit)

    expect(externallyModified.externalChangeState).toBe('modified-clean')
    expect(dirty.externalChangeState).toBe('conflict')
    expect(dirty.dirty).toBe(true)
  })
})

import { ChangeSet, Selection, type Transaction } from '@milkup/core'
import { describe, expect, it } from 'vitest'

import {
  createDocumentSession,
  createDocumentSessionFromOpenResult,
  markExternalFileDeleted,
  markExternalFileModified,
  markSessionReadonly,
  recordDocumentTransaction,
  recordFileReloadResult,
  recordFileSave,
  recordFileSaveResult,
  recordModeChange,
  recordParserCacheUpdate,
  recordSelectionChange,
  recordThemeChange,
} from './document-session'

const editTransaction: Transaction = {
  changes: ChangeSet.insert(0, 'hello'),
  selection: Selection.cursor(5),
  origin: { type: 'input.type' },
}

describe('DocumentSession', () => {
  it('opens a file as a clean session with a stable document id', () => {
    const session = createDocumentSession({
      documentId: 'doc-1',
      file: { path: 'D:/notes/a.md' },
      diskSnapshotHash: 'hash-a',
    })

    expect(session).toMatchObject({
      documentId: 'doc-1',
      file: { path: 'D:/notes/a.md' },
      documentVersion: 0,
      savedVersion: 0,
      diskSnapshotHash: 'hash-a',
      dirty: false,
      readonly: false,
      externalChangeState: 'none',
      lineEnding: 'lf',
    })
  })

  it('creates a clean session from an open file result', () => {
    const session = createDocumentSessionFromOpenResult({
      documentId: 'doc-opened',
      file: { path: 'D:/notes/opened.md' },
      text: '# opened',
      diskSnapshotHash: 'hash-opened',
    })

    expect(session.documentId).toBe('doc-opened')
    expect(session.file?.path).toBe('D:/notes/opened.md')
    expect(session.diskSnapshotHash).toBe('hash-opened')
    expect(session.lineEnding).toBe('lf')
    expect(session.dirty).toBe(false)
    expect(session.documentVersion).toBe(0)
    expect(session.savedVersion).toBe(0)
  })

  it('detects CRLF line endings from an open file result', () => {
    const session = createDocumentSessionFromOpenResult({
      documentId: 'doc-opened',
      file: { path: 'D:/notes/opened.md' },
      text: '# opened\r\n\r\nbody\r\n',
      diskSnapshotHash: 'hash-opened',
    })

    expect(session.lineEnding).toBe('crlf')
  })

  it('marks document-changing transactions dirty and increments documentVersion', () => {
    const session = createDocumentSession({ documentId: 'doc-1' })
    const next = recordDocumentTransaction(session, editTransaction)

    expect(next.documentVersion).toBe(1)
    expect(next.savedVersion).toBe(0)
    expect(next.dirty).toBe(true)
  })

  it('does not mark selection-only transactions dirty', () => {
    const session = createDocumentSession({ documentId: 'doc-1' })
    const next = recordDocumentTransaction(session, {
      selection: Selection.cursor(1),
      origin: { type: 'command', id: 'view.clickSelection' },
      addToHistory: false,
    })

    expect(next).toBe(session)
    expect(next.dirty).toBe(false)
  })

  it('saving records the current version and clears dirty state', () => {
    const dirty = recordDocumentTransaction(
      createDocumentSession({ documentId: 'doc-1' }),
      editTransaction,
    )
    const saved = recordFileSave(dirty, {
      file: { path: 'D:/notes/saved.md' },
      diskSnapshotHash: 'hash-saved',
    })

    expect(saved.file?.path).toBe('D:/notes/saved.md')
    expect(saved.documentVersion).toBe(1)
    expect(saved.savedVersion).toBe(1)
    expect(saved.diskSnapshotHash).toBe('hash-saved')
    expect(saved.dirty).toBe(false)
    expect(saved.externalChangeState).toBe('none')
  })

  it('save as updates the file path and saved snapshot', () => {
    const opened = createDocumentSession({
      documentId: 'doc-1',
      file: { path: 'D:/notes/original.md' },
      diskSnapshotHash: 'hash-original',
    })
    const dirty = recordDocumentTransaction(opened, editTransaction)
    const savedAs = recordFileSave(dirty, {
      file: { path: 'D:/notes/renamed.md' },
      diskSnapshotHash: 'hash-renamed',
    })

    expect(savedAs.file?.path).toBe('D:/notes/renamed.md')
    expect(savedAs.diskSnapshotHash).toBe('hash-renamed')
    expect(savedAs.savedVersion).toBe(savedAs.documentVersion)
    expect(savedAs.dirty).toBe(false)
  })

  it('refuses to apply a save result for a different document', () => {
    const dirty = recordDocumentTransaction(
      createDocumentSession({ documentId: 'doc-1' }),
      editTransaction,
    )

    expect(() =>
      recordFileSaveResult(dirty, {
        documentId: 'doc-2',
        file: { path: 'D:/notes/wrong.md' },
        diskSnapshotHash: 'hash-wrong',
      }),
    ).toThrow('does not match session')
  })

  it('reloads a clean externally modified session from a matching open file result', () => {
    const opened = createDocumentSessionFromOpenResult({
      documentId: 'doc-1',
      file: { path: 'D:/notes/a.md' },
      text: 'old\n',
      diskSnapshotHash: 'hash-old',
    })
    const modified = markExternalFileModified(opened)
    const reloaded = recordFileReloadResult(modified, {
      documentId: 'doc-1',
      file: { path: 'D:/notes/a.md' },
      text: 'new\r\n',
      diskSnapshotHash: 'hash-new',
    })

    expect(reloaded.documentVersion).toBe(1)
    expect(reloaded.savedVersion).toBe(1)
    expect(reloaded.diskSnapshotHash).toBe('hash-new')
    expect(reloaded.externalChangeState).toBe('none')
    expect(reloaded.dirty).toBe(false)
    expect(reloaded.lineEnding).toBe('crlf')
  })

  it('refuses reload results that do not match the current session', () => {
    const modified = markExternalFileModified(
      createDocumentSession({
        documentId: 'doc-1',
        file: { path: 'D:/notes/a.md' },
      }),
    )

    expect(() =>
      recordFileReloadResult(modified, {
        documentId: 'doc-2',
        file: { path: 'D:/notes/a.md' },
        text: 'new',
        diskSnapshotHash: 'hash-new',
      }),
    ).toThrow('documentId')
    expect(() =>
      recordFileReloadResult(modified, {
        documentId: 'doc-1',
        file: { path: 'D:/notes/b.md' },
        text: 'new',
        diskSnapshotHash: 'hash-new',
      }),
    ).toThrow('path')
  })

  it('only reloads clean externally modified sessions', () => {
    const clean = createDocumentSession({
      documentId: 'doc-1',
      file: { path: 'D:/notes/a.md' },
    })
    const deleted = markExternalFileDeleted(clean)
    const dirty = recordDocumentTransaction(clean, editTransaction)
    const result = {
      documentId: 'doc-1',
      file: { path: 'D:/notes/a.md' },
      text: 'new',
      diskSnapshotHash: 'hash-new',
    }

    expect(() => recordFileReloadResult(clean, result)).toThrow('external state none')
    expect(() => recordFileReloadResult(deleted, result)).toThrow('external state deleted-clean')
    expect(() => recordFileReloadResult(markExternalFileModified(dirty), result)).toThrow(
      'external state conflict',
    )
  })

  it('view-only changes do not mark the session dirty', () => {
    const session = createDocumentSession({ documentId: 'doc-1' })
    const afterSelection = recordSelectionChange(session)
    const afterMode = recordModeChange(afterSelection, 'live')
    const afterTheme = recordThemeChange(afterMode, 'dark')
    const afterParserCache = recordParserCacheUpdate(afterTheme)

    expect(afterSelection).toBe(session)
    expect(afterMode.dirty).toBe(false)
    expect(afterTheme.dirty).toBe(false)
    expect(afterParserCache.dirty).toBe(false)
    expect(afterParserCache.documentVersion).toBe(0)
    expect(afterParserCache.savedVersion).toBe(0)
    expect(afterParserCache.viewMode).toBe('live')
    expect(afterParserCache.themeId).toBe('dark')
    expect(afterParserCache.parserCacheVersion).toBe(1)
  })

  it('tracks readonly without changing dirty state', () => {
    const session = createDocumentSession({ documentId: 'doc-1' })
    const readonly = markSessionReadonly(session, true)

    expect(readonly.readonly).toBe(true)
    expect(readonly.dirty).toBe(false)
    expect(readonly.documentVersion).toBe(0)
  })

  it('records clean external modifications as reloadable states', () => {
    const session = createDocumentSession({ documentId: 'doc-1' })

    expect(markExternalFileModified(session).externalChangeState).toBe('modified-clean')
    expect(markExternalFileDeleted(session).externalChangeState).toBe('deleted-clean')
  })

  it('records external changes against dirty documents as conflicts', () => {
    const dirty = recordDocumentTransaction(
      createDocumentSession({ documentId: 'doc-1' }),
      editTransaction,
    )

    expect(markExternalFileModified(dirty).externalChangeState).toBe('conflict')
    expect(markExternalFileDeleted(dirty).externalChangeState).toBe('conflict')
  })
})

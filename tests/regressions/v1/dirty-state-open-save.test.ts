import { ChangeSet, Selection } from '@milkup/core'
import {
  createDocumentSessionFromOpenResult,
  evaluateCloseProtection,
  recordDocumentTransaction,
  recordFileSaveResult,
  recordModeChange,
  recordParserCacheUpdate,
  recordSelectionChange,
  recordThemeChange,
} from '@milkup/tauri-bridge'
import { describe, expect, it } from 'vitest'

import { v1Issue } from './helpers/metadata'

const issue = v1Issue({
  area: 'file',
  lesson: 'Dirty state must be driven only by document-changing transactions.',
  risk: 'Opened files and saved documents in v1 could still show unsaved changes.',
  source: 'https://github.com/Auto-Plugin/milkup/issues/113',
})

describe('v1 regression: dirty state across open and save', () => {
  it('opens clean, ignores view-only changes, marks document edits dirty, and clears dirty on matching save', () => {
    expect(issue.source).toContain('/113')

    let session = createDocumentSessionFromOpenResult({
      documentId: 'file:D:/notes/opened.md',
      file: { path: 'D:/notes/opened.md' },
      text: '# Opened\r\n',
      diskSnapshotHash: 'hash-opened',
    })

    session = recordSelectionChange(session)
    session = recordModeChange(session, 'live')
    session = recordThemeChange(session, 'dark')
    session = recordParserCacheUpdate(session)

    expect(session).toMatchObject({
      documentVersion: 0,
      savedVersion: 0,
      dirty: false,
      lineEnding: 'crlf',
      externalChangeState: 'none',
    })

    session = recordDocumentTransaction(session, {
      changes: ChangeSet.insert(10, 'edited'),
      selection: Selection.cursor(16),
      origin: { type: 'input.type' },
    })

    expect(session.dirty).toBe(true)
    expect(session.documentVersion).toBe(1)
    expect(session.savedVersion).toBe(0)
    expect(evaluateCloseProtection([session], { scope: 'window' }).allowClose).toBe(false)

    expect(() =>
      recordFileSaveResult(session, {
        documentId: 'file:D:/notes/other.md',
        file: { path: 'D:/notes/other.md' },
        diskSnapshotHash: 'hash-other',
      }),
    ).toThrow('does not match session')

    const saved = recordFileSaveResult(session, {
      documentId: session.documentId,
      file: { path: 'D:/notes/opened.md' },
      diskSnapshotHash: 'hash-saved',
    })

    expect(saved).toMatchObject({
      documentVersion: 1,
      savedVersion: 1,
      dirty: false,
      diskSnapshotHash: 'hash-saved',
      externalChangeState: 'none',
    })
    expect(evaluateCloseProtection([saved], { scope: 'window' }).allowClose).toBe(true)
  })
})

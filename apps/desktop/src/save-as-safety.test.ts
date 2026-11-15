import { describe, expect, it } from 'vitest'
import {
  applyFileWatchEvent,
  createDocumentSession,
  getSaveSafety,
  markSessionReadonly,
  recordNativeDocumentMutation,
} from '@milkup/tauri-bridge'
import { getSaveAsDialogSafety } from './save-as-safety'

describe('Save As chooser in an external file conflict', () => {
  const opened = () =>
    createDocumentSession({
      documentId: 'rescue',
      file: { path: '/owned/source.md' },
      diskSnapshotHash: 'opened',
    })
  it.each(['modified', 'deleted'] as const)(
    'allows choosing a rescue for %s without clearing the conflict or source hash',
    (kind) => {
      const dirty = recordNativeDocumentMutation(opened())
      const conflict = applyFileWatchEvent(dirty, {
        kind,
        documentId: dirty.documentId,
        file: dirty.file!,
        diskSnapshotHash: 'outside',
      })
      expect(conflict.externalChangeState).toBe('conflict')
      expect(getSaveAsDialogSafety(conflict)).toEqual({ canSave: true })
      expect(getSaveSafety(conflict)).toMatchObject({
        canSave: false,
        reason: 'external-change',
      })
      expect(conflict.file).toEqual({ path: '/owned/source.md' })
      expect(conflict.diskSnapshotHash).toBe('opened')
      expect(conflict.dirty).toBe(true)
    },
  )
  it('does not bypass readonly even when the file also changed externally', () => {
    const session = markSessionReadonly(opened(), true)
    const conflict = applyFileWatchEvent(session, {
      kind: 'modified',
      documentId: session.documentId,
      file: session.file!,
      diskSnapshotHash: 'outside',
    })
    expect(getSaveAsDialogSafety(conflict)).toMatchObject({
      canSave: false,
      reason: 'readonly',
    })
  })
  it('preserves normal Save As availability', () => {
    expect(getSaveAsDialogSafety(opened())).toEqual({ canSave: true })
    expect(getSaveAsDialogSafety(recordNativeDocumentMutation(opened()))).toEqual({ canSave: true })
  })
})

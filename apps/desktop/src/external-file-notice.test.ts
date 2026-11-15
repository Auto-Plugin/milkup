import { describe, expect, it } from 'vitest'
import {
  recordNativeDocumentMutation,
  applyFileWatchEvent,
  createDocumentSession,
  getSaveSafety,
} from '@milkup/tauri-bridge'
import { externalFileNotice } from './external-file-notice'

describe('user-facing external-file warning', () => {
  const opened = () =>
    createDocumentSession({
      documentId: 'owned-fixture',
      file: { path: '/owned/fixture.md' },
      diskSnapshotHash: 'original',
    })
  it('does not label the acknowledged own-save snapshot as an external change', () => {
    const session = opened()
    const observed = applyFileWatchEvent(session, {
      kind: 'modified',
      documentId: session.documentId,
      file: session.file!,
      diskSnapshotHash: 'original',
    })
    expect(externalFileNotice(observed.externalChangeState, 'modified')).toBeUndefined()
    expect(getSaveSafety(observed).canSave).toBe(true)
  })
  it('offers reload only for a clean external change', () => {
    const session = opened()
    const observed = applyFileWatchEvent(session, {
      kind: 'modified',
      documentId: session.documentId,
      file: session.file!,
      diskSnapshotHash: 'outside',
    })
    expect(externalFileNotice(observed.externalChangeState, 'modified')).toContain('重新载入')
    expect(getSaveSafety(observed).canSave).toBe(false)
  })
  it('preserves dirty conflict guards and offers a rescue copy instead of reload', () => {
    const session = recordNativeDocumentMutation(opened())
    const observed = applyFileWatchEvent(session, {
      kind: 'modified',
      documentId: session.documentId,
      file: session.file!,
      diskSnapshotHash: 'outside',
    })
    expect(observed.externalChangeState).toBe('conflict')
    expect(externalFileNotice(observed.externalChangeState, 'modified')).toContain('先另存')
    expect(externalFileNotice(observed.externalChangeState, 'modified')).not.toContain('重新载入')
    expect(getSaveSafety(observed).canSave).toBe(false)
  })
  it.each(['conflict', 'deleted-clean'] as const)(
    'does not promise reload of a deleted file: %s',
    (state) => {
      const text = externalFileNotice(state, 'deleted')
      expect(text).toContain('删除')
      expect(text).toContain('另存')
      expect(text).not.toContain('重新载入')
    },
  )
})

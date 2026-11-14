import { createDocumentSession, recordFileSave } from '@milkup/tauri-bridge'
import type { FileWatchEvent } from '@milkup/tauri-bridge'
import { describe, expect, it } from 'vitest'
import { reconcileSaveWatchEvents } from './save-watch-reconciliation'

const saved = recordFileSave(
  createDocumentSession({ documentId: 'doc', file: { path: '/a.md' } }),
  { diskSnapshotHash: 'written' },
)
function event(kind: 'modified' | 'deleted', hash?: string): FileWatchEvent {
  return {
    documentId: 'doc',
    file: { path: '/a.md' },
    kind,
    ...(hash === undefined ? {} : { diskSnapshotHash: hash }),
  }
}
describe('save watcher reconciliation', () => {
  it('accepts a matching own-write hash', () => {
    expect(reconcileSaveWatchEvents(saved, [event('modified', 'written')])).toBe(saved)
  })
  it.each([event('modified'), event('modified', 'external'), event('deleted', 'written')])(
    'retains ambiguous or external event %j as a close-blocking conflict',
    (change) => {
      const next = reconcileSaveWatchEvents(saved, [change])
      expect(next.externalChangeState).toBe('conflict')
      expect(next.diskSnapshotHash).toBe('written')
    },
  )
  it('does not erase an earlier conflict when an own-save notification follows', () => {
    expect(
      reconcileSaveWatchEvents(saved, [event('modified', 'external'), event('modified', 'written')])
        .externalChangeState,
    ).toBe('conflict')
  })
  it('ignores events for an old path after Save As and for other documents', () => {
    expect(
      reconcileSaveWatchEvents(saved, [
        { ...event('deleted'), file: { path: '/old.md' } },
        { ...event('deleted'), documentId: 'other' },
      ]),
    ).toBe(saved)
  })
})

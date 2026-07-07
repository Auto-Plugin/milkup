import { createDocumentSession } from '@milkup/tauri-bridge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDesktopFileService } from './file-service'

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriMocks.invoke,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: tauriMocks.open,
  save: tauriMocks.save,
}))

describe('desktop file service', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
    vi.clearAllMocks()
  })

  it('uses the native save dialog for Tauri Save As when no test path override exists', async () => {
    tauriMocks.save.mockResolvedValue('D:/notes/chosen.md')
    tauriMocks.invoke.mockResolvedValue({
      documentId: 'doc-1',
      file: { path: 'D:/notes/chosen.md' },
      diskSnapshotHash: 'hash:chosen',
    })

    const service = createDesktopFileService()
    const session = createDocumentSession({
      documentId: 'doc-1',
      file: { path: 'D:/notes/source.md' },
    })

    await expect(service.saveFileAs(session, '# Saved\n')).resolves.toEqual({
      documentId: 'doc-1',
      file: { path: 'D:/notes/chosen.md' },
      diskSnapshotHash: 'hash:chosen',
    })

    expect(tauriMocks.save).toHaveBeenCalledWith({
      defaultPath: 'D:/notes/source.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }],
    })
    expect(tauriMocks.invoke).toHaveBeenCalledWith('save_markdown_file', {
      documentId: 'doc-1',
      path: 'D:/notes/chosen.md',
      text: '# Saved\n',
    })
  })
})

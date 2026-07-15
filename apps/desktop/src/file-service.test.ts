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

  it('reports open progress around native reads', async () => {
    const progress = vi.fn()
    tauriMocks.open.mockResolvedValue('D:/notes/chosen.md')
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === 'stat_text_file') {
        return Promise.resolve({
          path: 'D:/notes/chosen.md',
          sizeBytes: 9,
          readonly: false,
        })
      }

      return Promise.resolve({
        documentId: 'doc-1',
        file: { path: 'D:/notes/chosen.md' },
        text: '# Opened\n',
        diskSnapshotHash: 'hash:opened',
      })
    })

    const service = createDesktopFileService()
    await service.openFile({ onProgress: progress })

    expect(progress).toHaveBeenNthCalledWith(1, {
      phase: 'dialog-selected',
      path: 'D:/notes/chosen.md',
    })
    expect(progress).toHaveBeenNthCalledWith(2, {
      phase: 'metadata',
      path: 'D:/notes/chosen.md',
      metadata: {
        path: 'D:/notes/chosen.md',
        sizeBytes: 9,
        readonly: false,
      },
    })
    expect(progress).toHaveBeenNthCalledWith(3, {
      phase: 'read-start',
      path: 'D:/notes/chosen.md',
    })
    expect(progress).toHaveBeenNthCalledWith(4, {
      phase: 'read-end',
      path: 'D:/notes/chosen.md',
    })
    expect(tauriMocks.invoke).toHaveBeenCalledWith('stat_text_file', {
      path: 'D:/notes/chosen.md',
    })
  })

  it('reuses metadata supplied by the open policy caller', async () => {
    const metadata = {
      path: 'D:/notes/chosen.md',
      sizeBytes: 9,
      readonly: false,
    }
    tauriMocks.invoke.mockResolvedValue({
      documentId: 'doc-1',
      file: { path: metadata.path },
      text: '# Opened\n',
      diskSnapshotHash: 'hash:opened',
    })

    const service = createDesktopFileService()
    await service.openPath(metadata.path, { metadata })

    expect(tauriMocks.invoke).toHaveBeenCalledTimes(1)
    expect(tauriMocks.invoke).toHaveBeenCalledWith('open_markdown_file', {
      path: metadata.path,
    })
  })
})

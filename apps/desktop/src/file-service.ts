import type {
  DocumentSession,
  FileWatchEvent,
  OpenFileResult,
  SaveFileResult,
  RevealInFolderAction,
} from '@milkup/tauri-bridge'
import { createFileWatchEvent, FILE_WATCH_EVENT_NAME } from '@milkup/tauri-bridge'

export type FileWatchEventHandler = (event: FileWatchEvent) => void

export type OpenFileProgressPhase = 'dialog-selected' | 'metadata' | 'read-start' | 'read-end'

export interface DesktopTextFileMetadata {
  readonly path: string
  readonly sizeBytes: number
  readonly readonly: boolean
}

export interface OpenFileProgressEvent {
  readonly phase: OpenFileProgressPhase
  readonly path?: string
  readonly metadata?: DesktopTextFileMetadata
}

export interface OpenFileRequestOptions {
  readonly onProgress?: (event: OpenFileProgressEvent) => void
}

export interface DesktopFileService {
  selectOpenFile(additionalExtensions?: readonly string[]): Promise<string | undefined>
  openFile(options?: OpenFileRequestOptions): Promise<OpenFileResult | undefined>
  openPath(path: string, options?: OpenFileRequestOptions): Promise<OpenFileResult>
  getFileMetadata(path: string): Promise<DesktopTextFileMetadata>
  initialOpenFilePath(): Promise<string | undefined>
  reloadFile(session: DocumentSession): Promise<OpenFileResult | undefined>
  saveFile(session: DocumentSession, text: string): Promise<SaveFileResult | undefined>
  saveFileAs(session: DocumentSession, text: string): Promise<SaveFileResult | undefined>
  selectSaveFilePath(defaultPath: string): Promise<string | undefined>
  revealInFolder(action: RevealInFolderAction, path: string): Promise<boolean>
  watchFile(session: DocumentSession): Promise<void>
  unwatchFile(documentId: string): Promise<void>
  listenToFileWatchEvents(handler: FileWatchEventHandler): Promise<() => void>
}

export function createDesktopFileService(): DesktopFileService {
  return isTauriRuntime() ? createTauriFileService() : createMockFileService()
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function createMockFileService(): DesktopFileService {
  const sampleMetadata = Object.freeze({
    path: 'D:/notes/sample.md',
    sizeBytes: 58,
    readonly: false,
  })

  return {
    async selectOpenFile(): Promise<string> {
      return sampleMetadata.path
    },
    async openFile(options?: OpenFileRequestOptions): Promise<OpenFileResult | undefined> {
      const selected = await this.selectOpenFile()

      if (!selected) {
        return undefined
      }

      options?.onProgress?.({ phase: 'dialog-selected', path: selected })
      options?.onProgress?.({
        phase: 'metadata',
        path: sampleMetadata.path,
        metadata: sampleMetadata,
      })
      options?.onProgress?.({ phase: 'read-start', path: 'D:/notes/sample.md' })
      options?.onProgress?.({ phase: 'read-end', path: 'D:/notes/sample.md' })
      return {
        documentId: 'desktop-sample',
        file: { path: 'D:/notes/sample.md' },
        text: '# Sample\r\n\r\nOpened through the desktop file workflow shell.\r\n',
        diskSnapshotHash: 'sample:0',
      }
    },
    async openPath(path: string, options?: OpenFileRequestOptions): Promise<OpenFileResult> {
      const metadata = await this.getFileMetadata(path)
      options?.onProgress?.({ phase: 'dialog-selected', path })
      options?.onProgress?.({ phase: 'metadata', path, metadata })
      options?.onProgress?.({ phase: 'read-start', path })
      options?.onProgress?.({ phase: 'read-end', path })
      return {
        documentId: `file:${path}`,
        file: { path },
        text: '# Sample\r\n\r\nOpened through the desktop file workflow shell.\r\n',
        diskSnapshotHash: `sample:${path}`,
      }
    },
    async getFileMetadata(path: string): Promise<DesktopTextFileMetadata> {
      return {
        path,
        sizeBytes: path === sampleMetadata.path ? sampleMetadata.sizeBytes : 58,
        readonly: false,
      }
    },
    async initialOpenFilePath(): Promise<string | undefined> {
      return undefined
    },
    async reloadFile(session: DocumentSession): Promise<OpenFileResult | undefined> {
      if (!session.file) {
        return undefined
      }

      return {
        documentId: session.documentId,
        file: session.file,
        text: '# Sample reloaded\r\n\r\nExternal disk content accepted.\r\n',
        diskSnapshotHash: `reloaded:${session.documentVersion}:${session.file.path}`,
      }
    },
    async saveFile(session: DocumentSession, text: string): Promise<SaveFileResult> {
      if (!session.file) {
        return createMockSaveResult(session, text, { path: 'D:/notes/untitled.md' })
      }

      return createMockSaveResult(session, text, session.file)
    },
    async saveFileAs(session: DocumentSession, text: string): Promise<SaveFileResult> {
      const selected = await this.selectSaveFilePath(session.file?.path ?? 'D:/notes/untitled.md')
      const file = { path: selected ?? session.file?.path ?? 'D:/notes/untitled.md' }

      return createMockSaveResult(session, text, file)
    },
    async selectSaveFilePath(defaultPath: string): Promise<string> {
      return defaultPath
    },
    async revealInFolder(): Promise<boolean> {
      return true
    },
    async watchFile(): Promise<void> {
      return undefined
    },
    async unwatchFile(): Promise<void> {
      return undefined
    },
    async listenToFileWatchEvents(): Promise<() => void> {
      return () => undefined
    },
  }
}

function createTauriFileService(): DesktopFileService {
  return {
    async selectOpenFile(
      additionalExtensions: readonly string[] = [],
    ): Promise<string | undefined> {
      let selected = getNativeTestPath('open')

      if (!selected) {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const dialogSelection = await open({
          multiple: false,
          filters: [
            {
              name: 'Documents',
              extensions: [
                'md',
                'markdown',
                'mdown',
                'txt',
                ...additionalExtensions.map((item) => item.replace(/^\./, '')),
              ],
            },
          ],
        })

        selected = typeof dialogSelection === 'string' ? dialogSelection : undefined
      }

      return selected
    },
    async openFile(options?: OpenFileRequestOptions): Promise<OpenFileResult | undefined> {
      const { invoke } = await import('@tauri-apps/api/core')
      const selected = await this.selectOpenFile()

      if (!selected) {
        return undefined
      }

      options?.onProgress?.({ phase: 'dialog-selected', path: selected })
      const metadata = await this.getFileMetadata(selected)
      options?.onProgress?.({ phase: 'metadata', path: selected, metadata })
      options?.onProgress?.({ phase: 'read-start', path: selected })
      const result = await invoke<OpenFileResult>('open_markdown_file', { path: selected })
      options?.onProgress?.({ phase: 'read-end', path: selected })
      return result
    },
    async openPath(path: string, options?: OpenFileRequestOptions): Promise<OpenFileResult> {
      const { invoke } = await import('@tauri-apps/api/core')
      options?.onProgress?.({ phase: 'dialog-selected', path })
      const metadata = await this.getFileMetadata(path)
      options?.onProgress?.({ phase: 'metadata', path, metadata })
      options?.onProgress?.({ phase: 'read-start', path })
      const result = await invoke<OpenFileResult>('open_markdown_file', { path })
      options?.onProgress?.({ phase: 'read-end', path })
      return result
    },
    async getFileMetadata(path: string): Promise<DesktopTextFileMetadata> {
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<DesktopTextFileMetadata>('stat_text_file', { path })
    },
    async initialOpenFilePath(): Promise<string | undefined> {
      const { invoke } = await import('@tauri-apps/api/core')
      const path = await invoke<string | null>('initial_open_file_path')

      return path ?? undefined
    },
    async saveFile(session: DocumentSession, text: string): Promise<SaveFileResult | undefined> {
      if (!session.file) {
        return this.saveFileAs(session, text)
      }

      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<SaveFileResult>('save_markdown_file', {
        documentId: session.documentId,
        path: session.file.path,
        text,
      })
    },
    async reloadFile(session: DocumentSession): Promise<OpenFileResult | undefined> {
      if (!session.file) {
        return undefined
      }

      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<OpenFileResult>('reload_markdown_file', {
        documentId: session.documentId,
        path: session.file.path,
      })
    },
    async saveFileAs(session: DocumentSession, text: string): Promise<SaveFileResult | undefined> {
      const selected = await this.selectSaveFilePath(session.file?.path ?? 'untitled.md')

      if (!selected) {
        return undefined
      }

      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<SaveFileResult>('save_markdown_file', {
        documentId: session.documentId,
        path: selected,
        text,
      })
    },
    async selectSaveFilePath(defaultPath: string): Promise<string | undefined> {
      let selected = getNativeTestPath('saveAs')

      if (!selected) {
        const { save } = await import('@tauri-apps/plugin-dialog')
        const dialogSelection = await save({
          defaultPath,
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }],
        })

        selected = typeof dialogSelection === 'string' ? dialogSelection : undefined
      }

      return selected
    },
    async revealInFolder(_action: RevealInFolderAction, _path: string): Promise<boolean> {
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<boolean>('reveal_in_folder', { documentId: _action.documentId, path: _path })
    },
    async watchFile(session: DocumentSession): Promise<void> {
      if (!session.file) {
        return
      }

      const { invoke } = await import('@tauri-apps/api/core')
      await invoke<boolean>('watch_markdown_file', {
        documentId: session.documentId,
        path: session.file.path,
        diskSnapshotHash: session.diskSnapshotHash,
      })
    },
    async unwatchFile(documentId: string): Promise<void> {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke<boolean>('unwatch_markdown_file', { documentId })
    },
    async listenToFileWatchEvents(handler: FileWatchEventHandler): Promise<() => void> {
      const { listen } = await import('@tauri-apps/api/event')
      return listen<FileWatchEvent>(FILE_WATCH_EVENT_NAME, (event) => {
        handler(createFileWatchEvent(event.payload))
      })
    },
  }
}

function getNativeTestPath(kind: 'open' | 'saveAs'): string | undefined {
  const serialized = globalThis.localStorage?.getItem('milkup.desktop.nativeTestPaths')

  if (!serialized) {
    return undefined
  }

  try {
    const paths = JSON.parse(serialized) as Partial<Record<'open' | 'saveAs', unknown>>
    const path = paths[kind]

    return typeof path === 'string' && path.length > 0 ? path : undefined
  } catch {
    return undefined
  }
}

function createMockSaveResult(
  session: DocumentSession,
  text: string,
  file: { readonly path: string },
): SaveFileResult {
  return {
    documentId: session.documentId,
    file,
    diskSnapshotHash: `memory:${text.length}:${session.documentVersion}:${file.path}`,
  }
}

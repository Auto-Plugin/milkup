export interface DesktopLargeTextFileOpenResult {
  readonly documentId: string
  readonly path: string
  readonly version: number
  readonly sizeBytes: number
  readonly lineCount: number
}

export interface DesktopLargeTextFileChunk {
  readonly documentId: string
  readonly fromByte: number
  readonly toByte: number
  readonly fromUtf16: number
  readonly toUtf16: number
  readonly text: string
}

export interface DesktopLargeTextFileLine {
  readonly number: number
  readonly fromByte: number
  readonly toByte: number
  readonly fromUtf16: number
  readonly toUtf16: number
  readonly text: string
}

export interface DesktopLargeTextFileLineWindow {
  readonly documentId: string
  readonly fromLine: number
  readonly toLine: number
  readonly fromByte: number
  readonly toByte: number
  readonly fromUtf16: number
  readonly toUtf16: number
  readonly text: string
  readonly lines: readonly DesktopLargeTextFileLine[]
}

export interface DesktopLargeTextFileChange {
  readonly fromUtf16: number
  readonly toUtf16: number
  readonly insert: string
}

export interface DesktopLargeTextFileSnapshot {
  readonly documentId: string
  readonly path: string
  readonly version: number
  readonly sizeBytes: number
  readonly lineCount: number
}

export interface DesktopLargeTextFileService {
  open(documentId: string, path: string): Promise<DesktopLargeTextFileOpenResult>
  readChunk(
    documentId: string,
    fromByte: number,
    toByte: number,
  ): Promise<DesktopLargeTextFileChunk>
  readLineWindow(
    documentId: string,
    fromLine: number,
    toLine: number,
  ): Promise<DesktopLargeTextFileLineWindow>
  applyChanges(
    documentId: string,
    expectedVersion: number,
    changes: readonly DesktopLargeTextFileChange[],
  ): Promise<DesktopLargeTextFileSnapshot>
  flush(documentId: string, expectedVersion: number): Promise<DesktopLargeTextFileSnapshot>
  flushAs(
    documentId: string,
    expectedVersion: number,
    path: string,
  ): Promise<DesktopLargeTextFileSnapshot>
  close(documentId: string): Promise<boolean>
}

export interface DesktopLargeTextFileServiceConfig {
  readonly invoke?: DesktopLargeTextFileInvoke
}

export type DesktopLargeTextFileInvoke = <T>(command: string, args?: unknown) => Promise<T>

export function createDesktopLargeTextFileService(
  config: DesktopLargeTextFileServiceConfig = {},
): DesktopLargeTextFileService {
  const invoke = config.invoke ?? loadTauriInvoke

  return Object.freeze({
    open: (documentId: string, path: string) =>
      invoke<DesktopLargeTextFileOpenResult>('open_large_text_file', {
        documentId,
        path,
      }),
    readChunk: (documentId: string, fromByte: number, toByte: number) =>
      invoke<DesktopLargeTextFileChunk>('read_large_text_file_chunk', {
        documentId,
        fromByte,
        toByte,
      }),
    readLineWindow: (documentId: string, fromLine: number, toLine: number) =>
      invoke<DesktopLargeTextFileLineWindow>('read_large_text_file_line_window', {
        documentId,
        fromLine,
        toLine,
      }),
    applyChanges: (
      documentId: string,
      expectedVersion: number,
      changes: readonly DesktopLargeTextFileChange[],
    ) =>
      invoke<DesktopLargeTextFileSnapshot>('apply_large_text_file_changes', {
        documentId,
        expectedVersion,
        changes,
      }),
    flush: (documentId: string, expectedVersion: number) =>
      invoke<DesktopLargeTextFileSnapshot>('flush_large_text_file', {
        documentId,
        expectedVersion,
      }),
    flushAs: (documentId: string, expectedVersion: number, path: string) =>
      invoke<DesktopLargeTextFileSnapshot>('flush_large_text_file_as', {
        documentId,
        expectedVersion,
        path,
      }),
    close: (documentId: string) => invoke<boolean>('close_large_text_file', { documentId }),
  })
}

async function loadTauriInvoke<T>(command: string, args?: unknown): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args as never)
}

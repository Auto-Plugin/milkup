import type { OpenFileResult } from '@milkup/tauri-bridge'

import type { OpenFileProgressEvent, OpenFileRequestOptions } from './file-service'
import type { OpenStageTracker } from './open-stage-diagnostics'

export type DocumentLoadingPhase = 'idle' | 'opening' | 'indexing' | 'ready' | 'failed'

export interface DocumentLoadingState {
  readonly phase: DocumentLoadingPhase
  readonly path?: string
  readonly sizeBytes?: number
  readonly message?: string
}

export interface RunOpenDocumentFlowOptions {
  readonly open: (options?: OpenFileRequestOptions) => Promise<OpenFileResult | undefined>
  readonly tracker: OpenStageTracker
  readonly onLoadingState: (state: DocumentLoadingState) => void
  readonly onResult: (result: OpenFileResult, tracker: OpenStageTracker) => void | Promise<void>
  readonly onCancel: () => void
  readonly onError: (error: unknown) => void
}

export async function runOpenDocumentFlow(
  options: RunOpenDocumentFlowOptions,
): Promise<boolean> {
  let latestPath: string | undefined
  options.onLoadingState({ phase: 'opening' })

  try {
    const result = await options.open({
      onProgress: (event) => {
        latestPath = event.path ?? latestPath
        markOpenProgress(options.tracker, event)
        options.onLoadingState({
          phase: 'opening',
          ...(latestPath === undefined ? {} : { path: latestPath }),
        })
      },
    })

    if (!result) {
      options.onLoadingState({ phase: 'ready' })
      options.onCancel()
      return false
    }

    const path = result.file.path
    options.onLoadingState({
      phase: 'indexing',
      path,
      sizeBytes: estimateUtf8ByteSize(result.text),
    })
    await options.onResult(result, options.tracker)
    options.onLoadingState({ phase: 'ready', path, sizeBytes: estimateUtf8ByteSize(result.text) })
    return true
  } catch (error) {
    options.onLoadingState({
      phase: 'failed',
      ...(latestPath === undefined ? {} : { path: latestPath }),
      message: getErrorMessage(error),
    })
    options.onError(error)
    return false
  }
}

export function getDocumentLoadingLabel(state: DocumentLoadingState): string {
  switch (state.phase) {
    case 'idle':
    case 'ready':
      return '就绪'
    case 'opening':
      return '正在打开'
    case 'indexing':
      return '正在准备编辑器'
    case 'failed':
      return '打开失败'
  }
}

export function getDocumentLoadingDetail(state: DocumentLoadingState): string {
  if (state.message) {
    return state.message
  }

  const parts = [
    state.path ? getFileNameFromPath(state.path) : undefined,
    state.sizeBytes === undefined ? undefined : formatBytes(state.sizeBytes),
  ].filter((part): part is string => part !== undefined && part.length > 0)

  return parts.length > 0 ? parts.join(' · ') : '等待文件内容'
}

function markOpenProgress(tracker: OpenStageTracker, event: OpenFileProgressEvent): void {
  switch (event.phase) {
    case 'dialog-selected':
      tracker.mark('native-dialog-selected', event.path)
      return
    case 'metadata':
      if (event.metadata) {
        tracker.mark('file-metadata', `${event.metadata.sizeBytes} bytes`)
      }
      return
    case 'read-start':
      tracker.mark('file-read-start', event.path)
      return
    case 'read-end':
      tracker.mark('file-read-end', event.path)
      return
  }
}

function estimateUtf8ByteSize(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function getFileNameFromPath(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  const slashIndex = normalizedPath.lastIndexOf('/')

  return slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KiB', 'MiB', 'GiB'] as const
  let value = bytes / 1024

  for (const unit of units) {
    if (value < 1024 || unit === 'GiB') {
      return `${Math.round(value * 10) / 10} ${unit}`
    }

    value /= 1024
  }

  return `${Math.round(value * 10) / 10} GiB`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

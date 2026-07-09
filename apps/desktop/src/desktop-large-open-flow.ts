import type { DocumentLineWindow, LargeEditSession } from '@milkup/core'

import type {
  DesktopLargeTextFileOpenResult,
  DesktopLargeTextFileService,
} from './large-file-service'
import { LargeDocumentSource } from './large-document-source'

export interface LargeDocumentPreviewState {
  readonly documentId: string
  readonly path: string
  readonly version: number
  readonly sizeBytes: number
  readonly lineCount: number
  readonly source: LargeDocumentSource
  readonly window: DocumentLineWindow
  readonly editSession?: LargeEditSession
}

export interface OpenLargeDocumentPreviewOptions {
  readonly service: DesktopLargeTextFileService
  readonly documentId: string
  readonly path: string
  readonly previewLineCount: number
}

export async function openLargeDocumentPreview(
  options: OpenLargeDocumentPreviewOptions,
): Promise<LargeDocumentPreviewState> {
  const opened = await options.service.open(options.documentId, options.path)
  const source = new LargeDocumentSource({
    service: options.service,
    documentId: opened.documentId,
    path: opened.path,
    version: opened.version,
    sizeBytes: opened.sizeBytes,
    lineCount: opened.lineCount,
  })
  const firstWindow = await source.readLineWindow(1, Math.min(options.previewLineCount, opened.lineCount))

  return createLargeDocumentPreview(opened, source, firstWindow)
}

export function createLargeDocumentPreview(
  opened: DesktopLargeTextFileOpenResult,
  source: LargeDocumentSource,
  window: DocumentLineWindow,
  editSession?: LargeEditSession,
): LargeDocumentPreviewState {
  return Object.freeze({
    documentId: opened.documentId,
    path: opened.path,
    version: opened.version,
    sizeBytes: opened.sizeBytes,
    lineCount: opened.lineCount,
    source,
    window,
    ...(editSession === undefined ? {} : { editSession }),
  })
}

export function formatLargeDocumentPreviewText(preview: LargeDocumentPreviewState): string {
  const header = [
    `Large file preview: ${preview.path}`,
    `Size: ${formatBytes(preview.sizeBytes)} · Lines: ${preview.lineCount} · Version: ${preview.version}`,
    `Showing lines ${preview.window.fromLine}-${preview.window.toLine}. Visible-window editing is available in the source-backed view.`,
    '',
  ]

  return [...header, ...preview.window.lines.map((line) => line.text)].join('\n')
}

export function formatBytes(bytes: number): string {
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

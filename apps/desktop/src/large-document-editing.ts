import type { LargeTextEdit, LargeTextEditBatch } from '@milkup/core'

import type {
  DesktopLargeTextFileChange,
  DesktopLargeTextFileService,
  DesktopLargeTextFileSnapshot,
} from './large-file-service'

export interface ApplyLargeDocumentEditBatchOptions {
  readonly service: DesktopLargeTextFileService
  readonly documentId: string
  readonly expectedVersion: number
  readonly batch: LargeTextEditBatch
}

export async function applyLargeDocumentEditBatch(
  options: ApplyLargeDocumentEditBatchOptions,
): Promise<DesktopLargeTextFileSnapshot | undefined> {
  if (options.batch.edits.length === 0) {
    return undefined
  }

  return options.service.applyChanges(
    options.documentId,
    options.expectedVersion,
    mapLargeTextEditsToDesktopChanges(options.batch.edits),
  )
}

export function mapLargeTextEditsToDesktopChanges(
  edits: readonly LargeTextEdit[],
): readonly DesktopLargeTextFileChange[] {
  return Object.freeze(
    edits.map((edit) =>
      Object.freeze({
        fromUtf16: edit.from,
        toUtf16: edit.to,
        insert: edit.insert,
      }),
    ),
  )
}

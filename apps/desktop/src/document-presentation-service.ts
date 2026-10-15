import {
  copyDocumentPresentationAggregate,
  copyDocumentPresentationRequest,
  copyDocumentPresentationResult,
  DocumentPresentationError,
  type DocumentPresentationFragment,
  type DocumentPresentationRequest,
  type DocumentPresentationResult,
  type DocumentRendererDeclaration,
} from '@milkup/core'
import { createMarkdownWindowContextReader, type MarkdownContextSource } from '@milkup/markdown'
import type { DocumentPresentationConfig } from '@milkup/view-dom'

export interface DesktopDocumentRenderer extends DocumentRendererDeclaration {
  readonly pluginId: string
}
export interface DesktopDocumentPresentationOptions {
  readonly current: () =>
    { readonly source: MarkdownContextSource; readonly identity: object } | undefined
  readonly theme: () => 'light' | 'dark'
  readonly renderers: () => readonly DesktopDocumentRenderer[]
  readonly render: (
    pluginId: string,
    rendererId: string,
    request: DocumentPresentationRequest,
    options: { readonly signal: AbortSignal },
  ) => Promise<DocumentPresentationResult>
}

/** Business syntax belongs to plugins. This adapter supplies trusted, bounded context
 * and rejects late work before it reaches either editor view. No document writes. */
export function createDesktopDocumentPresentationService(
  options: DesktopDocumentPresentationOptions,
) {
  let revision = 0
  const context = createMarkdownWindowContextReader({ source: () => options.current()?.source })
  const provide: DocumentPresentationConfig['provide'] = async (window, operation) => {
    const initial = options.current()
    const generation = revision
    const capturedSource = initial?.source
    const capturedVersion = capturedSource?.version
    const capturedDocumentId = capturedSource?.documentId
    const assertCurrent = () => {
      const current = options.current()
      if (operation.signal.aborted) throw new DocumentPresentationError('aborted')
      if (
        !initial ||
        generation !== revision ||
        !current ||
        initial.identity !== current.identity ||
        window.sourceIdentity !== current.identity ||
        current.source !== capturedSource ||
        current.source.documentId !== capturedDocumentId ||
        current.source.version !== capturedVersion ||
        (window.documentVersion !== undefined && window.documentVersion !== capturedVersion)
      )
        throw new DocumentPresentationError('revoked')
    }
    assertCurrent()
    const input = { ...window, documentId: capturedDocumentId!, version: capturedVersion! }
    let trusted = await context.read(input, {
      ...operation,
      maxScanChars: 8 * 1024 * 1024,
      maxScanLines: 200_000,
    })
    assertCurrent()
    let scanned = trusted.scannedChars
    for (
      let batch = 1;
      trusted.pending &&
      batch < 128 &&
      scanned < 8 * 1024 * 1024 &&
      trusted.scannedThroughLine < 200_000;
      batch++
    ) {
      const previousLine = trusted.scannedThroughLine
      trusted = await context.read(input, {
        ...operation,
        maxScanChars: 8 * 1024 * 1024 - scanned,
        maxScanLines: 200_000 - trusted.scannedThroughLine,
      })
      scanned += trusted.scannedChars
      assertCurrent()
      if (
        trusted.pending &&
        trusted.scannedThroughLine === previousLine &&
        trusted.scannedChars === 0
      )
        break
    }
    const request = copyDocumentPresentationRequest({
      documentId: capturedDocumentId!,
      version: capturedVersion!,
      source: window.source,
      from: window.from,
      to: window.to,
      fromLine: window.fromLine,
      toLine: window.toLine,
      completeStart: window.completeStart,
      completeEnd: window.completeEnd,
      contextKnown: trusted.contextKnown,
      protectedRanges: trusted.protectedRanges,
      blocks: trusted.blocks,
      selection: window.selection,
      theme: options.theme(),
      target: 'screen',
      width: Math.min(8192, Math.max(1, window.width)),
    })
    const declarations = options.renderers().map((renderer) => ({ ...renderer }))
    if (!trusted.contextKnown)
      return { request, result: { fragments: [], complete: false }, declarations }
    const outcomes = await Promise.allSettled(
      declarations.map(async (declaration) => {
        const value = await options.render(declaration.pluginId, declaration.id, request, operation)
        assertCurrent()
        if (
          !options
            .renderers()
            .some(
              (active) => active.pluginId === declaration.pluginId && active.id === declaration.id,
            )
        )
          throw new DocumentPresentationError('revoked')
        return copyDocumentPresentationResult(value, request, declaration)
      }),
    )
    assertCurrent()
    let complete = true
    const candidates: DocumentPresentationFragment[] = []
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        complete = false
        continue
      }
      complete &&= outcome.value.complete
      candidates.push(...outcome.value.fragments)
    }
    candidates.sort((a, b) => a.from - b.from || a.to - b.to)
    // Conflicting independent providers cannot silently hide each other's source.
    const fragments = candidates.filter((candidate, index) => {
      const conflict = candidates.some(
        (other, otherIndex) =>
          index !== otherIndex && candidate.from < other.to && candidate.to > other.from,
      )
      if (conflict) complete = false
      return !conflict
    })
    // The view validates the aggregate again with these host-owned declarations.
    return {
      request,
      result: copyDocumentPresentationAggregate({ fragments, complete }, request, declarations),
      declarations,
    }
  }
  return Object.freeze({
    provide,
    invalidate: () => {
      revision++
    },
    clear: () => {
      revision++
      context.clear()
    },
  })
}

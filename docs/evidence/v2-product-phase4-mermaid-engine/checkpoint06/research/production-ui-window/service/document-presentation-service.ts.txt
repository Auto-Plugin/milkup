import {
  copyDocumentPresentationAggregate,
  copyDocumentPresentationRequest,
  copyDocumentPresentationResult,
  DocumentPresentationError,
  DOCUMENT_PRESENTATION_LIMITS,
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
    // Admission uses the original view preparation deadline. It is not a new
    // execution timeout: native queue/cleanup/frontend scheduling remain subject
    // to the unchanged view timeout and cancellation guards.
    const deadline = operation.deadline ?? performance.now() + 10_000
    const capturedTheme = options.theme()
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
        capturedTheme !== options.theme() ||
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
      theme: capturedTheme,
      target: 'screen',
      width: Math.min(8192, Math.max(1, window.width)),
    })
    const declarations = options.renderers().map((renderer) => ({ ...renderer }))
    if (!trusted.contextKnown)
      return { request, result: { fragments: [], complete: false }, declarations }
    const renderOne = async (
      declaration: DesktopDocumentRenderer,
      input: DocumentPresentationRequest,
    ) => {
      assertCurrent()
      const assertRendererActive = () => {
        if (
          !options
            .renderers()
            .some(
              (active) => active.pluginId === declaration.pluginId && active.id === declaration.id,
            )
        )
          throw new DocumentPresentationError('revoked')
      }
      assertRendererActive()
      const value = await options.render(declaration.pluginId, declaration.id, input, operation)
      assertCurrent()
      assertRendererActive()
      return copyDocumentPresentationResult(value, input, declaration)
    }
    // Text and mixed-context providers retain their full trusted window. Pure
    // fence providers receive one host-recognized complete fence per invocation.
    const whole = declarations.filter((d) => d.contexts.includes('text'))
    const outcomes = await Promise.allSettled(whole.map((d) => renderOne(d, request)))
    assertCurrent()
    let complete = true
    const wholeCandidates: DocumentPresentationFragment[] = []
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        complete = false
        continue
      }
      complete &&= outcome.value.complete
      wholeCandidates.push(...outcome.value.fragments)
    }
    const overlaps = (
      a: { readonly from: number; readonly to: number },
      b: { readonly from: number; readonly to: number },
    ) => a.from < b.to && a.to > b.from
    const conflictFree = (candidates: readonly DocumentPresentationFragment[]) =>
      candidates.filter((candidate, index) => {
        const conflict = candidates.some(
          (other, otherIndex) => index !== otherIndex && overlaps(candidate, other),
        )
        if (conflict) complete = false
        return !conflict
      })
    type Block = DocumentPresentationRequest['blocks'][number]
    interface Unit {
      readonly from: number
      readonly to: number
      readonly block?: Block
      readonly providers: readonly DesktopDocumentRenderer[]
      readonly candidates: readonly DocumentPresentationFragment[]
    }
    const fenceUnits: Unit[] = []
    for (const block of request.blocks) {
      if (block.kind !== 'fence' || !block.complete) continue
      const language = (block.info ?? '').trim().split(/\s+/u)[0] ?? ''
      const providers = declarations.filter(
        (d) =>
          !d.contexts.includes('text') &&
          d.contexts.includes('fence') &&
          d.fenceLanguages?.includes(language),
      )
      if (providers.length)
        fenceUnits.push({
          from: block.from,
          to: block.to,
          block,
          providers,
          // Do not discard competing mixed-provider output before this entire
          // fence's providers have been checked for conflicts.
          candidates: wholeCandidates.filter((candidate) => overlaps(candidate, block)),
        })
    }
    const textCandidates = wholeCandidates.filter(
      (candidate) => !fenceUnits.some((unit) => overlaps(candidate, unit)),
    )
    const units: Unit[] = [
      ...fenceUnits,
      ...conflictFree(textCandidates).map((candidate) => ({
        from: candidate.from,
        to: candidate.to,
        providers: [],
        candidates: [candidate],
      })),
    ]
    // These are host-only DOM viewport offsets, never plugin-supplied priority.
    const visibleFrom = Number.isSafeInteger(window.visibleFrom)
      ? Math.max(request.from, Math.min(request.to, window.visibleFrom!))
      : request.from
    const visibleTo = Number.isSafeInteger(window.visibleTo)
      ? Math.max(visibleFrom, Math.min(request.to, window.visibleTo!))
      : request.to
    const distance = (unit: Unit) =>
      unit.to <= visibleFrom
        ? visibleFrom - unit.to
        : unit.from >= visibleTo
          ? unit.from - visibleTo
          : 0
    units.sort(
      (a, b) =>
        distance(a) - distance(b) ||
        Math.abs(a.from - visibleFrom) - Math.abs(b.from - visibleFrom) ||
        a.from - b.from,
    )
    const fragments: DocumentPresentationFragment[] = []
    for (const unit of units) {
      assertCurrent()
      let candidates = [...unit.candidates]
      if (unit.block) {
        // Keep enough nominal time for one original2s task and local settlement.
        // This100ms reserve is admission policy, not a completion guarantee.
        // Do not restart or extend either the native or view watchdog.
        if (deadline - performance.now() < DOCUMENT_PRESENTATION_LIMITS.timeoutMs + 100) {
          complete = false
          break
        }
        const block = unit.block
        const source = request.source.slice(block.from - request.from, block.to - request.from)
        const fromLine =
          request.fromLine +
          request.source.slice(0, block.from - request.from).split('\n').length -
          1
        const input = copyDocumentPresentationRequest({
          ...request,
          source,
          from: block.from,
          to: block.to,
          fromLine,
          toLine: fromLine + source.split('\n').length - 1,
          completeStart: request.completeStart && block.from === request.from,
          completeEnd: request.completeEnd && block.to === request.to,
          blocks: [block],
          protectedRanges: request.protectedRanges
            .filter((range) => overlaps(range, block))
            .map((range) => ({
              from: Math.max(range.from, block.from),
              to: Math.min(range.to, block.to),
            })),
        })
        // A scheduling unit includes every competing provider. Budget pressure
        // must never choose a winner by silently omitting the other provider.
        const results = await Promise.allSettled(unit.providers.map((d) => renderOne(d, input)))
        assertCurrent()
        for (const outcome of results) {
          if (outcome.status === 'rejected') {
            complete = false
            continue
          }
          complete &&= outcome.value.complete
          candidates.push(...outcome.value.fragments)
        }
        candidates = conflictFree(candidates)
      }
      if (!candidates.length) continue
      const next = [...fragments, ...candidates].sort((a, b) => a.from - b.from || a.to - b.to)
      try {
        // Every provider result is independently valid above. Admission still
        // enforces the original shared canonical/JSON/node/raster budgets.
        copyDocumentPresentationAggregate({ fragments: next, complete }, request, declarations)
      } catch {
        complete = false
        break
      }
      fragments.splice(0, fragments.length, ...next)
    }
    assertCurrent()
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

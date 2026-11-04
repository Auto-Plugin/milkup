import {
  copyDocumentPresentationRequest,
  DocumentPresentationError,
  DOCUMENT_PRESENTATION_LIMITS,
  type DocumentPresentationFragment,
  type DocumentPresentationRequest,
  type DocumentPresentationResult,
  type DocumentRendererDeclaration,
} from '@milkup/core'
import {
  copyHostDocumentPresentationAggregate as copyDocumentPresentationAggregate,
  copyHostDocumentPresentationResult as copyDocumentPresentationResult,
  disposeDocumentPngImages,
  documentPngImages,
  documentPngImageByteLength,
  isDocumentPngImage,
  retainDocumentPngImages,
} from '@milkup/core/internal/document-png-image'
import { createMarkdownWindowContextReader, type MarkdownContextSource } from '@milkup/markdown'
import type { DocumentPresentationConfig } from '@milkup/view-dom'

export interface DesktopDocumentRenderer extends DocumentRendererDeclaration {
  readonly pluginId: string
}
export interface DesktopDocumentPresentationOptions {
  readonly current: () =>
    { readonly source: MarkdownContextSource; readonly identity: object } | undefined
  readonly theme: () => 'light' | 'dark'
  readonly target?: 'screen' | 'export'
  readonly renderers: () => readonly DesktopDocumentRenderer[]
  /** Host activation epoch; never supplied by the plugin. */
  readonly rendererGeneration?: (pluginId: string) => number
  /** Host-only attestation for a reviewed, context-independent inert PNG renderer.
   * Never derive this from a plugin declaration or a matching renderer name. */
  readonly cacheableFence?: (pluginId: string, rendererId: string) => boolean
  readonly render: (
    pluginId: string,
    rendererId: string,
    request: DocumentPresentationRequest,
    options: { readonly signal: AbortSignal; readonly deadline: number },
  ) => Promise<DocumentPresentationResult>
}

/** Business syntax belongs to plugins. This adapter supplies trusted, bounded context
 * and rejects late work before it reaches either editor view. No document writes. */
export function createDesktopDocumentPresentationService(
  options: DesktopDocumentPresentationOptions,
) {
  let revision = 0
  // A rendered fence can change the measured source window without changing
  // that fence. Retain completed, validated units across those layout passes.
  // The full request remains part of the key: ordinary plugins may depend on
  // selection, context boundaries and every other public input field.
  const fenceCache = new Map<
    string,
    { result: DocumentPresentationResult; cost: number; pure: boolean }
  >()
  let cacheCost = 0
  let cacheIdentity: object | undefined
  let cacheSource: MarkdownContextSource | undefined
  let cacheVersion: number | undefined
  let cacheScope = ''
  const evict = (key: string) => {
    const entry = fenceCache.get(key)
    if (!entry) return
    fenceCache.delete(key)
    cacheCost -= entry.cost
    disposeDocumentPngImages(entry.result)
  }
  const clearFenceCache = () => {
    for (const key of fenceCache.keys()) evict(key)
    cacheIdentity = undefined
    cacheSource = undefined
    cacheVersion = undefined
    cacheScope = ''
  }
  const context = createMarkdownWindowContextReader({ source: () => options.current()?.source })
  const provide: DocumentPresentationConfig['provide'] = async (window, operation) => {
    const owned = new Set<DocumentPresentationResult>()
    try {
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
        target: options.target ?? 'screen',
        width: Math.min(8192, Math.max(1, window.width)),
      })
      const declarations = options.renderers().map((renderer) => ({ ...renderer }))
      const generations = new Map(
        declarations.map((renderer) => [
          renderer.pluginId,
          options.rendererGeneration?.(renderer.pluginId),
        ]),
      )
      const scope = JSON.stringify([
        capturedDocumentId,
        capturedTheme,
        declarations.map((declaration) => [
          declaration,
          generations.get(declaration.pluginId),
          options.cacheableFence?.(declaration.pluginId, declaration.id) === true,
        ]),
      ])
      if (cacheIdentity !== initial!.identity || cacheScope !== scope) {
        clearFenceCache()
        cacheIdentity = initial!.identity
        cacheSource = capturedSource
        cacheVersion = capturedVersion
        cacheScope = scope
      }
      if (cacheSource !== capturedSource || cacheVersion !== capturedVersion) {
        for (const [key, entry] of fenceCache) if (!entry.pure) evict(key)
        cacheSource = capturedSource
        cacheVersion = capturedVersion
      }
      if (!trusted.contextKnown)
        return { request, result: { fragments: [], complete: false }, declarations }
      const acceptedRenderers = new Map<DesktopDocumentRenderer, () => void>()
      const renderOne = async (
        declaration: DesktopDocumentRenderer,
        input: DocumentPresentationRequest,
      ) => {
        assertCurrent()
        const pure =
          !declaration.contexts.includes('text') &&
          options.cacheableFence?.(declaration.pluginId, declaration.id) === true
        const assertRendererActive = () => {
          if (
            options.rendererGeneration?.(declaration.pluginId) !==
              generations.get(declaration.pluginId) ||
            !options
              .renderers()
              .some(
                (active) =>
                  active.pluginId === declaration.pluginId && active.id === declaration.id,
              ) ||
            (pure && options.cacheableFence?.(declaration.pluginId, declaration.id) !== true)
          )
            throw new DocumentPresentationError('revoked')
        }
        assertRendererActive()
        const cacheKey = !declaration.contexts.includes('text')
          ? JSON.stringify([
              declaration,
              pure ? [input.source, input.width, input.theme, input.target] : input,
            ])
          : undefined
        const cached = cacheKey === undefined ? undefined : fenceCache.get(cacheKey)
        if (cached) {
          // A separate reference belongs to this invocation, even if another
          // window invalidates/evicts the cache while later units are awaiting.
          const value = cached.pure
            ? {
                ...cached.result,
                fragments: cached.result.fragments.map((fragment) => ({
                  ...fragment,
                  from: input.from,
                  to: input.to,
                })),
              }
            : cached.result
          const result = copyDocumentPresentationResult(value, input, declaration)
          retainDocumentPngImages(result)
          owned.add(result)
          fenceCache.delete(cacheKey!)
          fenceCache.set(cacheKey!, cached)
          acceptedRenderers.set(declaration, assertRendererActive)
          return result
        }
        const value = await options.render(declaration.pluginId, declaration.id, input, {
          ...operation,
          deadline,
        })
        owned.add(value)
        assertCurrent()
        assertRendererActive()
        const result = copyDocumentPresentationResult(value, input, declaration)
        acceptedRenderers.set(declaration, assertRendererActive)
        if (
          cacheKey !== undefined &&
          result.complete &&
          !result.pending &&
          !result.fragments.some((fragment) => fragment.status === 'error') &&
          cacheIdentity === initial!.identity &&
          cacheScope === scope &&
          (!pure ||
            (result.fragments.length === 1 &&
              result.fragments[0]!.from === input.from &&
              result.fragments[0]!.to === input.to &&
              result.fragments[0]!.layout === 'block' &&
              isDocumentPngImage(result.fragments[0]!.content)))
        ) {
          // Charge actual encoded bytes plus intrinsic decoded pixel cost.
          // Accounting exposes neither the bytes nor a new image authority.
          const cost =
            (cacheKey.length + JSON.stringify(result).length) * 2 +
            documentPngImages(result).reduce(
              (sum, image) =>
                sum + documentPngImageByteLength(image) + image.width * image.height * 4,
              0,
            )
          const limit = 64 * 1024 * 1024
          if (cost <= limit) {
            evict(cacheKey)
            while (fenceCache.size >= 8 || cacheCost + cost > limit)
              evict(fenceCache.keys().next().value!)
            retainDocumentPngImages(result)
            fenceCache.set(cacheKey, { result, cost, pure })
            cacheCost += cost
          }
        }
        return result
      }
      // Text and mixed-context providers retain their full trusted window. Pure
      // fence providers receive one host-recognized complete fence per invocation.
      const whole = declarations.filter((d) => d.contexts.includes('text'))
      const outcomes = await Promise.allSettled(whole.map((d) => renderOne(d, request)))
      assertCurrent()
      let complete = true
      let pending = false
      const wholeCandidates: DocumentPresentationFragment[] = []
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          complete = false
          continue
        }
        complete &&= outcome.value.complete
        pending ||= outcome.value.pending === true
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
            pending ||= outcome.value.pending === true
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
      // Other providers and later fence units may have awaited after an earlier
      // provider completed. Recheck every accepted owner at publication as well.
      for (const assertActive of acceptedRenderers.values()) assertActive()
      const result = copyDocumentPresentationAggregate(
        { fragments, complete, ...(pending ? { pending: true as const } : {}) },
        request,
        declarations,
      )
      // Transfer only accepted images to the view. All provider results, including
      // conflicting/over-budget/stale candidates, release their initial ownership.
      retainDocumentPngImages(result)
      return {
        request,
        result,
        declarations,
      }
    } finally {
      for (const result of owned) disposeDocumentPngImages(result)
    }
  }
  return Object.freeze({
    provide,
    invalidate: () => {
      revision++
      clearFenceCache()
    },
    clear: () => {
      revision++
      clearFenceCache()
      context.clear()
    },
  })
}

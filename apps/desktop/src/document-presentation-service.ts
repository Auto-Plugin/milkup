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
import type { DocumentPresentationConfig, DocumentPresentationWindow } from '@milkup/view-dom'

export interface DesktopDocumentRenderer extends DocumentRendererDeclaration {
  readonly pluginId: string
}
export interface DesktopDocumentPresentationOptions {
  readonly current: () =>
    { readonly source: MarkdownContextSource; readonly identity: object } | undefined
  readonly theme: () => 'light' | 'dark'
  readonly target?: 'screen' | 'export'
  readonly getMermaidRenderMode?: () => 'source' | 'preview' | 'live'
  /** Opt in only for the authenticated host PNG renderer; never run generic plugins ahead. */
  readonly prefetch?: boolean
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
  const counters = {
    cacheHits: 0,
    renders: 0,
    prefetchRenders: 0,
    prefetchReady: 0,
    prefetchPasses: 0,
  }
  let prefetchController: AbortController | undefined
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined
  let prefetchIdentity: object | undefined
  let prefetchSignature = ''
  const prefetchKeys = new Set<string>()
  let foregroundKeys = new Set<string>()
  const stopPrefetch = () => {
    clearTimeout(prefetchTimer)
    prefetchTimer = undefined
    prefetchController?.abort()
    // A background-only owner has no visible consumer to protect.
    for (const key of prefetchKeys) {
      if (foregroundKeys.has(key)) continue
      const pending = pendingFences.get(key)
      if (pending) {
        pending.controller.abort()
        pendingFences.delete(key)
      }
    }
    prefetchController = undefined
    prefetchIdentity = undefined
    prefetchSignature = ''
    prefetchKeys.clear()
  }
  // A rendered fence can change the measured source window without changing
  // that fence. Retain completed, validated units across those layout passes.
  // The full request remains part of the key: ordinary plugins may depend on
  // selection, context boundaries and every other public input field.
  const fenceCache = new Map<
    string,
    { result: DocumentPresentationResult; cost: number; pure: boolean }
  >()
  interface PendingFence {
    readonly controller: AbortController
    task: Promise<DocumentPresentationResult>
    users: number
    settled: boolean
    output?: DocumentPresentationResult
  }
  const pendingFences = new Map<string, PendingFence>()
  const releasePending = (entry: PendingFence) => {
    if (entry.settled && entry.users === 0 && entry.output) {
      disposeDocumentPngImages(entry.output)
      delete entry.output
    }
  }
  const cancelPending = () => {
    for (const entry of pendingFences.values()) entry.controller.abort()
    pendingFences.clear()
  }
  const acquirePending = async (
    key: string,
    signal: AbortSignal,
    produce: (signal: AbortSignal) => Promise<DocumentPresentationResult>,
  ): Promise<DocumentPresentationResult> => {
    let entry = pendingFences.get(key)
    if (!entry) {
      if (pendingFences.size >= 8) throw new Error('Pending authenticated fence budget exceeded')
      entry = { controller: new AbortController(), task: undefined!, users: 0, settled: false }
      const created = entry
      pendingFences.set(key, created)
      created.task = Promise.resolve()
        .then(() => produce(created.controller.signal))
        .then((output) => {
          created.output = output
          return output
        })
        .finally(() => {
          created.settled = true
          if (pendingFences.get(key) === created) pendingFences.delete(key)
          releasePending(created)
        })
      void created.task.catch(() => undefined)
    }
    entry.users++
    let abort!: () => void
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new DocumentPresentationError('aborted'))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    try {
      const result = await Promise.race([entry.task, cancelled])
      if (signal.aborted) throw new DocumentPresentationError('aborted')
      retainDocumentPngImages(result)
      return result
    } finally {
      signal.removeEventListener('abort', abort)
      entry.users--
      releasePending(entry)
    }
  }
  let cacheCost = 0
  let cacheIdentity: object | undefined
  let cacheSource: MarkdownContextSource | undefined
  let cacheVersion: number | undefined
  let cacheScope = ''
  let continuationScope = ''
  let continuationPasses = 0
  const evict = (key: string) => {
    const entry = fenceCache.get(key)
    if (!entry) return
    fenceCache.delete(key)
    cacheCost -= entry.cost
    disposeDocumentPngImages(entry.result)
  }
  const clearFenceCache = () => {
    stopPrefetch()
    foregroundKeys.clear()
    cancelPending()
    for (const key of fenceCache.keys()) evict(key)
    cacheIdentity = undefined
    cacheSource = undefined
    cacheVersion = undefined
    cacheScope = ''
    continuationScope = ''
    continuationPasses = 0
  }
  const context = createMarkdownWindowContextReader({ source: () => options.current()?.source })
  const provideInternal = async (
    window: DocumentPresentationWindow,
    operation: Parameters<DocumentPresentationConfig['provide']>[1],
    background = false,
  ): Promise<Awaited<ReturnType<DocumentPresentationConfig['provide']>>> => {
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
      const assertSnapshot = () => {
        const current = options.current()
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
      const assertCurrent = () => {
        if (operation.signal.aborted) throw new DocumentPresentationError('aborted')
        assertSnapshot()
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
      const declarations = options
        .renderers()
        .filter(
          (renderer) =>
            !(
              options.getMermaidRenderMode?.() === 'source' &&
              renderer.pluginId === 'milkup.diagrams' &&
              renderer.id === 'diagrams.mermaid'
            ),
        )
        .map((renderer) => ({ ...renderer }))
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
        cancelPending()
        for (const [key, entry] of fenceCache) if (!entry.pure) evict(key)
        cacheSource = capturedSource
        cacheVersion = capturedVersion
      }
      if (!trusted.contextKnown)
        return { request, result: { fragments: [], complete: false }, declarations }
      // A native PNG helper owns startup, rendering and teardown. Do not admit
      // another uncached native unit using a legacy worker's nominal 2s reserve.
      // Publish one completed native unit, then continue in a separate view
      // preparation. Existing deadlines are never restarted within a request.
      const progressScope = JSON.stringify([
        scope,
        capturedVersion,
        window.sourceVersion,
        request.from,
        request.to,
        request.source,
        request.width,
        request.selection,
        window.visibleFrom,
        window.visibleTo,
      ])
      if (!background && continuationScope !== progressScope) {
        continuationScope = progressScope
        continuationPasses = 0
      }
      let nativeUnitAdmitted = false
      let nativeCacheProgress = false
      let deferredNativeUnit = false
      let resourceLimited = false
      const isPure = (declaration: DesktopDocumentRenderer) =>
        !declaration.contexts.includes('text') &&
        options.cacheableFence?.(declaration.pluginId, declaration.id) === true
      const fenceKey = (
        declaration: DesktopDocumentRenderer,
        input: DocumentPresentationRequest,
      ) =>
        !declaration.contexts.includes('text')
          ? JSON.stringify([
              declaration,
              isPure(declaration) ? [input.source, input.width, input.theme, input.target] : input,
            ])
          : undefined
      // Keep the current window's completed units alive across progressive paints.
      // Authenticated PNG history shares the original 64 MiB charge and aggregate
      // fragment ceiling, with at most 32 off-window authenticated entries. Do not
      // evict affordable visited diagrams just because another window has more than
      // eight images. Ordinary
      // selection-dependent plugin results keep their eight-entry off-window LRU.
      const activeFenceKeys = new Set<string>()
      for (const block of request.blocks) {
        if (block.kind !== 'fence' || !block.complete) continue
        const language = (block.info ?? '').trim().split(/\s+/u)[0] ?? ''
        for (const declaration of declarations) {
          if (!isPure(declaration) || !declaration.fenceLanguages?.includes(language)) continue
          activeFenceKeys.add(
            fenceKey(declaration, {
              ...request,
              source: request.source.slice(block.from - request.from, block.to - request.from),
            })!,
          )
        }
      }
      if (background) {
        for (const key of activeFenceKeys) prefetchKeys.add(key)
        for (const key of foregroundKeys) activeFenceKeys.add(key)
      } else {
        foregroundKeys = new Set(activeFenceKeys)
        for (const key of prefetchKeys) activeFenceKeys.add(key)
      }
      for (const [key, entry] of pendingFences) {
        if (!activeFenceKeys.has(key)) {
          entry.controller.abort()
          pendingFences.delete(key)
        }
      }
      const inactiveKeys = () => [...fenceCache.keys()].filter((key) => !activeFenceKeys.has(key))
      const trimHistory = () => {
        const inactive = inactiveKeys()
        // Retain modest visited history, not an unbounded document image cache.
        // Leave headroom under the shared 128-image authority limit for new work.
        for (const key of inactive.filter((key) => fenceCache.get(key)!.pure).slice(0, -32))
          evict(key)
        for (const key of inactive
          .filter((key) => fenceCache.get(key)?.pure === false)
          .slice(0, -8))
          evict(key)
      }
      trimHistory()
      const acceptedRenderers = new Map<DesktopDocumentRenderer, () => void>()
      const renderOne = async (
        declaration: DesktopDocumentRenderer,
        input: DocumentPresentationRequest,
      ) => {
        assertCurrent()
        const pure = isPure(declaration)
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
        const cacheKey = fenceKey(declaration, input)
        const cached = cacheKey === undefined ? undefined : fenceCache.get(cacheKey)
        if (cached) {
          if (!background) counters.cacheHits++
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
        const renderFresh = async (signal: AbortSignal) => {
          counters.renders++
          if (background) counters.prefetchRenders++
          const value = await options.render(declaration.pluginId, declaration.id, input, {
            signal,
            deadline,
          })
          try {
            if (signal.aborted) throw new DocumentPresentationError('aborted')
            assertSnapshot()
            assertRendererActive()
            const result = copyDocumentPresentationResult(value, input, declaration)
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
                for (const key of inactiveKeys()) {
                  if (
                    fenceCache.size < DOCUMENT_PRESENTATION_LIMITS.fragments &&
                    cacheCost + cost <= limit
                  )
                    break
                  evict(key)
                }
                if (
                  fenceCache.size < DOCUMENT_PRESENTATION_LIMITS.fragments &&
                  cacheCost + cost <= limit
                ) {
                  retainDocumentPngImages(result)
                  fenceCache.set(cacheKey, { result, cost, pure })
                  nativeCacheProgress ||= pure
                  cacheCost += cost
                  if (background) counters.prefetchReady++
                  trimHistory()
                } else resourceLimited = true
              } else resourceLimited = true
            }
            return result
          } catch (error) {
            disposeDocumentPngImages(value)
            throw error
          }
        }
        // A selection-dependent consumer may be cancelled without cancelling
        // this attested source-only computation. Its original deadline remains;
        // source identity/version, epoch changes and close still revoke it.
        const value =
          pure && cacheKey !== undefined
            ? await acquirePending(cacheKey, operation.signal, renderFresh)
            : await renderFresh(operation.signal)
        owned.add(value)
        assertCurrent()
        assertRendererActive()
        const rebound = pure
          ? {
              ...value,
              fragments: value.fragments.map((fragment) => ({
                ...fragment,
                from: input.from,
                to: input.to,
              })),
            }
          : value
        const result = copyDocumentPresentationResult(rebound, input, declaration)
        acceptedRenderers.set(declaration, assertRendererActive)
        nativeCacheProgress ||= pure && cacheKey !== undefined && fenceCache.has(cacheKey)
        return result
      }
      // Text and mixed-context providers retain their full trusted window. Pure
      // fence providers receive one host-recognized complete fence per invocation.
      const whole = background ? [] : declarations.filter((d) => d.contexts.includes('text'))
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
            (!background || isPure(d)) &&
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
      // Speculate on the nearest eight total units, including cache hits. Counting
      // only new renders lets every overlapping scroll window walk farther ahead,
      // fill the shared cache with distant speculative work and evict useful history
      // before the user reaches it. The eight-unit speculation limit is unchanged.
      const admittedUnits = background ? units.slice(0, 8) : units
      for (const unit of admittedUnits) {
        assertCurrent()
        let candidates = [...unit.candidates]
        if (unit.block) {
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
          const needsNative = unit.providers.some(
            (provider) => isPure(provider) && !fenceCache.has(fenceKey(provider, input)!),
          )
          if (needsNative && nativeUnitAdmitted) {
            complete = false
            deferredNativeUnit = true
            break
          }
          // Keep enough nominal time for one original2s task and local settlement.
          // This100ms reserve is admission policy, not a completion guarantee.
          // Do not restart or extend either the native or view watchdog.
          if (deadline - performance.now() < DOCUMENT_PRESENTATION_LIMITS.timeoutMs + 100) {
            complete = false
            break
          }
          nativeUnitAdmitted ||= needsNative
          // A scheduling unit includes every competing provider. Budget pressure
          // must never choose a winner by silently omitting the other provider.
          // Background preparation is an optimization, never a provider winner:
          // foreground aggregation still validates all competing declarations.
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
        // Progress is monotonic within this window: retained active units are
        // never evicted to admit another one. Each pass starts one new native
        // unit, and the existing fragment ceiling bounds the whole sequence.
        ...(deferredNativeUnit &&
        nativeCacheProgress &&
        (background || ++continuationPasses < DOCUMENT_PRESENTATION_LIMITS.fragments)
          ? { continueAfterPaint: true }
          : {}),
        ...(resourceLimited ? { resourceLimited: true } : {}),
      }
    } finally {
      for (const result of owned) disposeDocumentPngImages(result)
    }
  }
  const schedulePrefetch = (window: DocumentPresentationWindow) => {
    if (
      !options.prefetch ||
      options.target === 'export' ||
      options.getMermaidRenderMode?.() === 'source'
    )
      return
    const initial = options.current()
    if (
      !initial ||
      initial.identity !== window.sourceIdentity ||
      !options
        .renderers()
        .some(
          (r) =>
            !r.contexts.includes('text') && options.cacheableFence?.(r.pluginId, r.id) === true,
        )
    )
      return
    const signature = JSON.stringify([
      initial.source.version,
      window.fromLine,
      window.toLine,
      window.width,
      options.theme(),
    ])
    if (prefetchIdentity === initial.identity && prefetchSignature === signature) return
    stopPrefetch()
    prefetchIdentity = initial.identity
    prefetchSignature = signature
    const controller = new AbortController()
    prefetchController = controller
    const source = initial.source,
      version = source.version,
      generation = revision
    const current = () =>
      !controller.signal.aborted &&
      revision === generation &&
      options.current()?.identity === initial.identity &&
      options.current()?.source === source &&
      source.version === version
    // Let visible output paint first. No idle callback: hidden WebView/iframe idle
    // throttling must not postpone nearby diagrams until they enter the viewport.
    prefetchTimer = setTimeout(() => {
      prefetchTimer = undefined
      void (async () => {
        try {
          if (!current()) return
          const fromLine = Math.max(1, window.toLine - 48)
          const slice = await source.readLineWindow(
            fromLine,
            Math.min(source.lineCount, fromLine + 255),
            DOCUMENT_PRESENTATION_LIMITS.inputUtf16,
          )
          if (
            !current() ||
            !slice.lines.length ||
            slice.text.length > DOCUMENT_PRESENTATION_LIMITS.inputUtf16 ||
            slice.lines.length > 256
          )
            return
          const first = slice.lines[0]!,
            last = slice.lines.at(-1)!
          const nearby: DocumentPresentationWindow = {
            ...window,
            source: slice.text,
            from: slice.from,
            to: slice.to,
            fromLine: first.number,
            toLine: last.number,
            completeStart: slice.from === 0,
            completeEnd: last.number === source.lineCount,
          }
          const started = counters.prefetchRenders
          // Each pass admits at most one new authenticated fence. The shared
          // byte/fragment ceilings remain in force, plus a strict eight-fence
          // speculation ceiling independent of document size or continuation.
          for (
            let pass = 0;
            pass < 8 && current() && counters.prefetchRenders - started < 8;
            pass++
          ) {
            counters.prefetchPasses++
            const response = await provideInternal(
              nearby,
              {
                signal: controller.signal,
                deadline: performance.now() + 10_000,
              },
              true,
            )
            const again = response.continueAfterPaint === true && !response.resourceLimited
            disposeDocumentPngImages(response.result)
            if (!again) break
            await new Promise((resolve) => setTimeout(resolve, 0))
          }
        } catch {
          // Prefetch never replaces source, reports renderer failure, or retries
          // endlessly. The normal visible request remains authoritative.
        } finally {
          if (prefetchController === controller) {
            prefetchController = undefined
            prefetchKeys.clear()
          }
        }
      })()
    }, 0)
  }
  const provide: DocumentPresentationConfig['provide'] = async (window, operation) => {
    const response = await provideInternal(window, operation)
    if (!operation.signal.aborted) schedulePrefetch(window)
    return response
  }
  return Object.freeze({
    provide,
    pausePrefetch: stopPrefetch,
    diagnostics: () =>
      Object.freeze({
        ...counters,
        cacheEntries: fenceCache.size,
        cacheBytes: cacheCost,
        pending: pendingFences.size,
        prefetchActive: !!prefetchController,
        maxCacheBytes: 64 * 1024 * 1024,
        maxPrefetchFences: 8,
        maxPrefetchLines: 256,
      }),
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

import {
  DocumentPresentationError,
  copyDocumentPresentationRequest,
  type DocumentPresentationRequest,
  type DocumentPresentationResult,
} from '@milkup/core'
import {
  createDocumentPngImage,
  disposeDocumentPngImages,
} from '@milkup/core/internal/document-png-image'

/** Desktop-only adapter. Neither this interface nor its native commands enter plugin RPC. */
export type PrivateMermaidInvoke = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>

interface NativeImage {
  leaseId: string
  requestId: string
  ownerId: string
  pngBase64: string
  width: number
  height: number
  sha256: string
  engine: string
}
const token = () => crypto.randomUUID().replaceAll('-', '')
const opaque = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

export function isNativePngBase64(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 22_369_624 ||
    value.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(value)
  )
    return false
  const padding = value.indexOf('=')
  return padding === -1 || (padding >= value.length - 2 && /^={1,2}$/.test(value.slice(padding)))
}

/** One exact, published catalog activation owns this adapter. */
export function createPrivateMermaidOwner(invoke: PrivateMermaidInvoke) {
  const ownerId = token()
  const controller = new AbortController()
  const leases = new Set<() => void>()
  const active = new Map<Promise<void>, number>()
  const cleanup = new Set<Promise<unknown>>()
  const failedCleanup = new Map<() => Promise<unknown>, unknown>()
  let requestSequence = 0
  let contentSequence = 0
  const contentIds = new Map<string, number>()
  let retired = false
  let nativeBusy = false
  const waiting = new Set<{ start(): boolean; reject(error: Error): void }>()
  const reserveNative = (
    assertActive: () => void,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      // One admitted native frame plus at most seven waiting consumers, matching
      // the native job budget. Aborted waiting consumers leave immediately.
      if (waiting.size >= 7) {
        reject(new Error('Mermaid pending request budget exceeded'))
        return
      }
      let timer: ReturnType<typeof setTimeout>
      const clear = () => {
        waiting.delete(item)
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      }
      const item = {
        start: () => {
          clear()
          try {
            assertActive()
          } catch (error) {
            reject(error)
            return false
          }
          nativeBusy = true
          resolve()
          return true
        },
        reject: (error: Error) => {
          clear()
          reject(error)
        },
      }
      const abort = () => item.reject(new DocumentPresentationError('aborted'))
      waiting.add(item)
      signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(
        () => item.reject(new DocumentPresentationError('timeout')),
        Math.max(0, deadline - performance.now()),
      )
      if (signal?.aborted) abort()
    })
  const releaseNative = () => {
    nativeBusy = false
    for (const item of waiting) if (item.start()) break
  }
  const track = (action: () => Promise<unknown>) => {
    const promise = Promise.resolve().then(action)
    // Keep cleanup failures observable to the manager's existing retirement chain.
    cleanup.add(promise)
    void promise.then(
      () => {
        cleanup.delete(promise)
        failedCleanup.delete(action)
      },
      (error: unknown) => {
        cleanup.delete(promise)
        failedCleanup.set(action, error)
      },
    )
    return promise
  }
  const retire = async ({ cancelActive = true }: { readonly cancelActive?: boolean } = {}) => {
    if (!retired) {
      retired = true
      for (const item of waiting) item.reject(new DocumentPresentationError('revoked'))
      for (const release of [...leases]) release()
    }
    // Plugin changes revoke publication immediately but let the fixed engine
    // finish within its existing deadline. Application shutdown can still
    // escalate an already draining owner to immediate cancellation.
    if (cancelActive) controller.abort()
    for (const action of failedCleanup.keys()) track(action)
    if (cancelActive) track(() => invoke('private_mermaid_retire_owner', { ownerId }))
    // Cancellation acknowledgement is not process/output settlement. Wait for
    // every owned render to finish and enqueue any late output release. Keep
    // the original deadlines; uncertainty remains a retirement failure.
    if (active.size) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.all([...active.keys()]),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error('Mermaid cleanup did not settle by its original deadline')),
              Math.max(0, Math.max(...active.values()) - performance.now()),
            )
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    }
    if (!cancelActive) track(() => invoke('private_mermaid_retire_owner', { ownerId }))
    while (cleanup.size) await Promise.allSettled([...cleanup])
    const errors = [...failedCleanup.values()]
    if (errors.length) throw new AggregateError(errors, 'Mermaid owner cleanup failed')
  }
  const render = async (
    value: DocumentPresentationRequest,
    options: { readonly signal?: AbortSignal; readonly deadline?: number },
  ): Promise<DocumentPresentationResult> => {
    const request = copyDocumentPresentationRequest(value)
    const deadline = options.deadline ?? performance.now() + 10_000
    const assertActive = () => {
      if (retired) throw new DocumentPresentationError('revoked')
      if (options.signal?.aborted) throw new DocumentPresentationError('aborted')
      if (performance.now() >= deadline) throw new DocumentPresentationError('timeout')
    }
    assertActive()
    if (request.target !== 'screen' || !request.contextKnown || request.blocks.length !== 1)
      throw new DocumentPresentationError('invalid-input')
    const block = request.blocks[0]!
    if (
      block.kind !== 'fence' ||
      !block.complete ||
      block.info?.trim() !== 'mermaid' ||
      block.contentRanges.length !== 1
    )
      throw new DocumentPresentationError('invalid-input')
    const body = block.contentRanges[0]!
    const source = request.source.slice(body.from - request.from, body.to - request.from)
    const requestId = token()
    const sequence = ++requestSequence
    const contentKey = JSON.stringify([source, request.width, request.theme, request.target])
    let contentId = contentIds.get(contentKey)
    if (contentId === undefined) {
      contentId = ++contentSequence
      if (contentIds.size >= 8) contentIds.delete(contentIds.keys().next().value!)
      contentIds.set(contentKey, contentId)
    }
    const events: { phase: string; tickMs: number }[] = []
    const trace = (phase: string) => {
      if (!events.some((event) => event.phase === phase))
        events.push({ phase, tickMs: Math.round(performance.now()) })
    }
    trace('created')
    const viewAborted = () => trace('view-aborted')
    options.signal?.addEventListener('abort', viewAborted, { once: true })
    let settle!: () => void
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    active.set(settled, deadline)
    let cancelSent = false
    let nativeStarted = false
    let nativeReserved = false
    const cancel = (reason = 'settlement-cancel') => {
      if (cancelSent || !nativeStarted) return
      cancelSent = true
      trace(reason)
      track(() => invoke('private_mermaid_cancel', { ownerId, requestId }))
    }
    // A view invalidation is not native retirement: stopping a healthy helper
    // mid-frame makes the strict protocol incomplete. Revoke this consumer's
    // output immediately via assertActive, but drain admitted native work under
    // its original deadline. Close and deadline cancellation stay explicit.
    const ownerCancelled = () => cancel('owner-cancel')
    controller.signal.addEventListener('abort', ownerCancelled, { once: true })
    const timeout = setTimeout(
      () => cancel('deadline-cancel'),
      Math.max(0, deadline - performance.now()),
    )
    let release: (() => void) | undefined
    let transferred = false
    try {
      if (nativeBusy) {
        trace('queued')
        await reserveNative(assertActive, options.signal, deadline)
      } else nativeBusy = true
      nativeReserved = true
      assertActive()
      nativeStarted = true
      trace('native-dispatched')
      const response = (await invoke('private_mermaid_render', {
        request: {
          requestId,
          ownerId,
          source,
          width: request.width,
          theme: request.theme === 'dark' ? 'dark' : 'default',
          look: 'classic',
          remainingMs: Math.max(1, Math.floor(deadline - performance.now())),
        },
      })) as NativeImage
      trace('native-settled')
      // A recognizable owned lease must be released even if the rest is invalid.
      if (response && response.ownerId === ownerId && opaque(response.leaseId)) {
        let released = false
        release = () => {
          if (released) return
          released = true
          leases.delete(release!)
          track(() => invoke('private_mermaid_release', { ownerId, leaseId: response.leaseId }))
        }
        leases.add(release)
      }
      assertActive()
      if (
        !release ||
        response.requestId !== requestId ||
        response.engine !== '12.2.0' ||
        !Number.isSafeInteger(response.width) ||
        !Number.isSafeInteger(response.height) ||
        response.width < 1 ||
        response.height < 1 ||
        response.width > 8192 ||
        response.height > 8192 ||
        response.width * response.height > 16_777_216 ||
        !isNativePngBase64(response.pngBase64) ||
        typeof response.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(response.sha256)
      )
        throw new DocumentPresentationError('invalid-output')
      const bytes = Uint8Array.from(atob(response.pngBase64), (char) => char.charCodeAt(0))
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      assertActive()
      if (digest !== response.sha256) throw new DocumentPresentationError('invalid-output')
      const content = createDocumentPngImage({
        bytes,
        width: response.width,
        height: response.height,
        title: 'Mermaid 图表',
        release,
      })
      try {
        assertActive()
      } catch (error) {
        disposeDocumentPngImages(content)
        throw error
      }
      transferred = true
      return {
        complete: true,
        fragments: [
          {
            from: block.from,
            to: block.to,
            layout: 'block',
            status: 'ready',
            accessibleText: 'Mermaid 图表',
            content,
          },
        ],
      }
    } finally {
      clearTimeout(timeout)
      controller.signal.removeEventListener('abort', ownerCancelled)
      options.signal?.removeEventListener('abort', viewAborted)
      if (nativeStarted) trace('native-settled')
      if (!transferred) {
        // Even a malformed response can correspond to an allocated native
        // output. Cancellation uses only our known request/owner identities.
        cancel()
        release?.()
      }
      trace('finished')
      track(() =>
        invoke('private_mermaid_trace', {
          trace: {
            requestId,
            ownerId,
            sequence,
            contentSequence: contentId,
            sourceVersion: request.version,
            selectionAnchor: request.selection.anchor,
            selectionHead: request.selection.head,
            published: transferred,
            events,
          },
        }),
      )
      active.delete(settled)
      settle()
      if (nativeReserved) releaseNative()
    }
  }
  return Object.freeze({ render, retire })
}

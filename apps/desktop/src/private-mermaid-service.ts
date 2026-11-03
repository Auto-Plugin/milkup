import {
  DocumentPresentationError,
  copyDocumentPresentationRequest,
  type DocumentPresentationRequest,
  type DocumentPresentationResult,
} from '@milkup/core'
import { createDocumentPngImage } from '@milkup/core/internal/document-png-image'

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

/** One exact, published catalog activation owns this adapter. */
export function createPrivateMermaidOwner(invoke: PrivateMermaidInvoke) {
  const ownerId = token()
  const controller = new AbortController()
  const leases = new Set<() => void>()
  const cleanup = new Set<Promise<unknown>>()
  const failedCleanup = new Map<() => Promise<unknown>, unknown>()
  let retired = false
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
  const retire = async () => {
    if (!retired) {
      retired = true
      controller.abort()
      for (const release of [...leases]) release()
    }
    for (const action of failedCleanup.keys()) track(action)
    track(() => invoke('private_mermaid_retire_owner', { ownerId }))
    await Promise.allSettled([...cleanup])
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
    let cancelSent = false
    const cancel = () => {
      if (cancelSent) return
      cancelSent = true
      track(() => invoke('private_mermaid_cancel', { ownerId, requestId }))
    }
    options.signal?.addEventListener('abort', cancel, { once: true })
    controller.signal.addEventListener('abort', cancel, { once: true })
    const timeout = setTimeout(cancel, Math.max(0, deadline - performance.now()))
    let release: (() => void) | undefined
    let transferred = false
    try {
      assertActive()
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
        typeof response.pngBase64 !== 'string' ||
        response.pngBase64.length > 22_369_624 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          response.pngBase64,
        ) ||
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
      options.signal?.removeEventListener('abort', cancel)
      controller.signal.removeEventListener('abort', cancel)
      if (!transferred) release?.()
    }
  }
  return Object.freeze({ render, retire })
}

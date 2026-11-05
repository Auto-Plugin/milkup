import {
  copyDocumentPresentationRequest,
  DocumentPresentationError,
  type DocumentPresentationRequest,
  type DocumentPresentationResult,
} from '@milkup/core'
import { createDocumentPngImage } from '@milkup/core/internal/document-png-image'
import engineAsset from '../src-tauri/mermaid-engine/assets/mermaid-12.2.0.min.js?url'
import frameAsset from './frontend-mermaid/frame.js?url'

export interface FrontendMermaidOwner {
  render(
    request: DocumentPresentationRequest,
    options: { readonly signal?: AbortSignal; readonly deadline?: number },
  ): Promise<DocumentPresentationResult>
  retire(options?: { readonly cancelActive?: boolean }): Promise<void>
}
type GuardInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>
type Message = {
  kind: string
  nonce: string
  reason?: string
  stage?: string
  requestId?: string
  width?: number
  height?: number
  bytes?: ArrayBuffer
  bridge?: Record<string, boolean>
}
const token = () => crypto.randomUUID().replaceAll('-', '')
const escape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

/** Only the pinned host engine runs in this owner. Plugins cannot provide code,
 * HTML, URLs, callbacks, config objects or image authority. */
export function createFrontendMermaidOwner(
  options: { readonly nativeGuard?: GuardInvoke } = {},
): FrontendMermaidOwner {
  const nonce = token()
  let retired = false
  let failed = false
  let frame: HTMLIFrameElement | undefined
  let port: MessagePort | undefined
  let connection: Promise<void> | undefined
  let busy = false
  let awaiting:
    | { test(value: Message): boolean; resolve(value: Message): void; reject(error: unknown): void }
    | undefined
  let removeHandshake: (() => void) | undefined
  const pending = new Set<{ start(): Promise<void>; reject(error: unknown): void }>()
  const assertActive = (deadline: number, signal?: AbortSignal) => {
    if (retired || failed) throw new DocumentPresentationError('revoked')
    if (signal?.aborted) throw new DocumentPresentationError('aborted')
    if (performance.now() >= deadline) throw new DocumentPresentationError('timeout')
  }
  const disposeFrame = () => {
    removeHandshake?.()
    removeHandshake = undefined
    port?.close()
    port = undefined
    frame?.remove()
    frame = undefined
  }
  const wait = (test: (value: Message) => boolean, deadline: number): Promise<Message> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          failed = true
          disposeFrame()
          finish(new DocumentPresentationError('timeout'))
        },
        Math.max(0, deadline - performance.now()),
      )
      const finish = (error?: unknown, value?: Message) => {
        clearTimeout(timer)
        awaiting = undefined
        error ? reject(error) : resolve(value!)
      }
      awaiting = {
        test,
        resolve: (value) => finish(undefined, value),
        reject: (error) => finish(error),
      }
    })
  const guardedInvoke = (
    command: string,
    args: Record<string, unknown> | undefined,
    deadline: number,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new DocumentPresentationError('timeout')),
        Math.max(0, deadline - performance.now()),
      )
      options.nativeGuard!(command, args).then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  const connect = (deadline: number) =>
    (connection ??= (async () => {
      if (options.nativeGuard) {
        // Fail closed while the native frame guard is being installed. It only
        // enforces the boundary; it never receives diagram text or renders.
        while (true) {
          assertActive(deadline)
          const status = (await guardedInvoke(
            'frontend_mermaid_guard_status',
            undefined,
            deadline,
          )) as {
            ready?: boolean
            failed?: boolean
          }
          if (status.failed) throw new Error('Frontend frame guard unavailable')
          if (status.ready) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }
      assertActive(deadline)
      const connected = wait((value) => value.kind === 'connected', deadline)
      frame = document.createElement('iframe')
      frame.name = `milkup-mermaid-${nonce}`
      frame.sandbox.add('allow-scripts')
      frame.setAttribute('aria-hidden', 'true')
      frame.tabIndex = -1
      frame.inert = true
      frame.title = '内部 Mermaid 渲染器'
      frame.dataset.milkupMermaidRenderer = '12.2.0'
      frame.style.cssText =
        'position:fixed;left:0;top:0;width:8192px;height:8192px;opacity:0;pointer-events:none;z-index:-2147483648;border:0'
      const handshake = (event: MessageEvent) => {
        if (
          event.source !== frame?.contentWindow ||
          event.origin !== 'null' ||
          event.data?.kind !== 'milkup-mermaid-ready' ||
          event.data.nonce !== nonce ||
          port
        )
          return
        const channel = new MessageChannel()
        port = channel.port1
        port.onmessage = ({ data }: MessageEvent<Message>) => {
          if (!data || data.nonce !== nonce || retired || failed) return
          if (awaiting?.test(data)) awaiting.resolve(data)
        }
        port.start()
        // Only the one-use channel/nonce crosses the wildcard handshake. Source
        // text is sent after the exact opaque document authenticates the port.
        frame!.contentWindow!.postMessage({ kind: 'milkup-mermaid-port', nonce }, '*', [
          channel.port2,
        ])
        removeHandshake?.()
      }
      addEventListener('message', handshake)
      removeHandshake = () => removeEventListener('message', handshake)
      const policy = `default-src 'none'; script-src 'nonce-${nonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src blob:; font-src 'none'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
      const engine = new URL(engineAsset, location.href).href
      const bootstrap = new URL(frameAsset, location.href).href
      frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><style>html,body{margin:0}#target{display:flow-root}</style></head><body><div id="target"></div><script nonce="${nonce}" src="${escape(engine)}"></script><script nonce="${nonce}" src="${escape(bootstrap)}" data-owner="${nonce}" data-parent-origin="${escape(location.origin)}"></script></body></html>`
      document.body.append(frame)
      const hello = await connected
      if (
        !hello.bridge ||
        hello.bridge.tauriInternals ||
        hello.bridge.tauriInvoke ||
        hello.bridge.wryIpc
      )
        throw new Error('Privileged bridge exposed to the renderer')
      if (options.nativeGuard) {
        if (!hello.bridge.chromeWebview) throw new Error('Native boundary probe unavailable')
        const positive = (await guardedInvoke('frontend_mermaid_probe', { nonce }, deadline)) as {
          dispatchedProbes: number
        }
        const sent = wait((value) => value.kind === 'probe-sent', deadline)
        port!.postMessage({ kind: 'boundary-probe', nonce })
        await sent
        while (true) {
          assertActive(deadline)
          const status = (await guardedInvoke(
            'frontend_mermaid_guard_status',
            undefined,
            deadline,
          )) as {
            ready: boolean
            dispatchedProbes: number
            lastBlockedNonce: string
          }
          if (!status.ready || status.dispatchedProbes !== positive.dispatchedProbes)
            throw new Error('Child native dispatch was not rejected')
          if (status.lastBlockedNonce === nonce) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      } else if (hello.bridge.chromeWebview) throw new Error('Unverified native frame')
    })().catch((error) => {
      failed = true
      awaiting?.reject(error)
      disposeFrame()
      throw error
    }))
  const drain = async () => {
    if (busy) return
    busy = true
    try {
      for (const entry of pending) {
        pending.delete(entry)
        await entry.start()
      }
    } finally {
      busy = false
    }
  }
  return {
    render(value, settings) {
      const request = copyDocumentPresentationRequest(value)
      const deadline = settings.deadline ?? performance.now() + 10_000
      try {
        assertActive(deadline, settings.signal)
      } catch (error) {
        return Promise.reject(error)
      }
      if (pending.size >= 7)
        return Promise.reject(new Error('Mermaid pending request budget exceeded'))
      return new Promise((resolve, reject) => {
        const queuedTimer = setTimeout(
          () => {
            pending.delete(entry)
            entry.reject(new DocumentPresentationError('timeout'))
          },
          Math.max(0, deadline - performance.now()),
        )
        const abort = () => {
          pending.delete(entry)
          entry.reject(new DocumentPresentationError('aborted'))
        }
        const entry = {
          reject(error: unknown) {
            clearTimeout(queuedTimer)
            settings.signal?.removeEventListener('abort', abort)
            reject(error)
          },
          start: async () => {
            clearTimeout(queuedTimer)
            try {
              assertActive(deadline, settings.signal)
              if (
                request.target !== 'screen' ||
                !request.contextKnown ||
                request.blocks.length !== 1
              )
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
              if (source.length > 50000 || source.split('\n').length > 256)
                throw new DocumentPresentationError('invalid-input')
              await connect(deadline)
              assertActive(deadline, settings.signal)
              const requestId = token()
              const response = wait(
                (data) => data.requestId === requestId && ['result', 'error'].includes(data.kind),
                deadline,
              )
              port!.postMessage({
                kind: 'render',
                nonce,
                requestId,
                source,
                width: Math.max(160, Math.min(8192, Math.round(request.width))),
                theme: request.theme === 'dark' ? 'dark' : 'default',
              })
              const result = await response
              assertActive(deadline, settings.signal)
              if (result.kind !== 'result' || !(result.bytes instanceof ArrayBuffer))
                throw new Error(
                  'Mermaid frontend render failed: ' + result.stage + '/' + result.reason,
                )
              const content = createDocumentPngImage({
                bytes: new Uint8Array(result.bytes),
                width: result.width!,
                height: result.height!,
                title: 'Mermaid 图表',
                release() {},
              })
              resolve({
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
              })
            } catch (error) {
              reject(error)
            } finally {
              settings.signal?.removeEventListener('abort', abort)
            }
          },
        }
        settings.signal?.addEventListener('abort', abort, { once: true })
        pending.add(entry)
        if (settings.signal?.aborted) abort()
        void drain()
      })
    },
    async retire() {
      retired = true
      const error = new DocumentPresentationError('revoked')
      awaiting?.reject(error)
      for (const entry of pending) entry.reject(error)
      pending.clear()
      disposeFrame()
      // Removal revokes output authority. It is not advertised as arbitrary-JS
      // hard termination or an operating-system memory quota.
    },
  }
}

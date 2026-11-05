import {
  copyDocumentPresentationRequest,
  DocumentPresentationError,
  type DocumentPresentationRequest,
  type DocumentPresentationResult,
} from '@milkup/core'
import {
  createDocumentPngImage,
  disposeDocumentPngImages,
} from '@milkup/core/internal/document-png-image'
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
  code?: string
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
  let drainTask: Promise<void> | undefined
  let retirement: Promise<void> | undefined
  let frameWasAppended = false
  let connectionStage = 'assets-read'
  let assetAbort: AbortController | undefined
  let auditing = false
  let auditChain = Promise.resolve()
  let renderingMessage: ((value: Message) => void) | undefined
  const digest = async (bytes: Uint8Array<ArrayBuffer>) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
  const audit = (event: Record<string, unknown>) => {
    if (!auditing) return Promise.resolve()
    auditChain = auditChain.then(async () => {
      await guardedInvoke('frontend_mermaid_audit', { event }, performance.now() + 2000)
    })
    void auditChain.catch(() => undefined)
    return auditChain
  }
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
    assetAbort?.abort()
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
  const fixedScript = async (
    asset: string,
    bytesExpected: number,
    shaExpected: string,
    deadline: number,
  ) => {
    assertActive(deadline)
    const controller = new AbortController()
    assetAbort = controller
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - performance.now()))
    let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined
    try {
      const url = new URL(asset, location.href)
      if (url.origin !== location.origin)
        throw new Error('Fixed script must be a packaged same-origin asset')
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        mode: 'same-origin',
      })
      if (!response.ok || !response.body) throw new Error('Fixed script response unavailable')
      reader = response.body.getReader()
      const bytes = new Uint8Array(bytesExpected)
      let size = 0
      while (true) {
        const part = await reader.read()
        if (part.done) break
        if (size + part.value.length > bytesExpected)
          throw new Error('Fixed script byte budget exceeded')
        bytes.set(part.value, size)
        size += part.value.length
      }
      assertActive(deadline)
      if (size !== bytesExpected || (await digest(bytes)) !== shaExpected)
        throw new Error('Fixed script bytes differ from the reviewed engine')
      assertActive(deadline)
      return bytes
    } finally {
      controller.abort()
      reader?.releaseLock()
      clearTimeout(timer)
      if (assetAbort === controller) assetAbort = undefined
    }
  }
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
            auditEnabled?: boolean
          }
          if (status.failed) throw new Error('Frontend frame guard unavailable')
          if (status.ready) {
            auditing = status.auditEnabled === true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }
      connectionStage = 'assets-read'
      await audit({ kind: 'connection', ownerId: nonce, stage: connectionStage, failed: false })
      const engine = await fixedScript(
        engineAsset,
        5494801,
        'a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f',
        deadline,
      )
      const bootstrap = new URL(frameAsset, location.href).href
      connectionStage = 'frame-load'
      await audit({ kind: 'connection', ownerId: nonce, stage: connectionStage, failed: false })
      assertActive(deadline)
      const connected = wait((value) => value.kind === 'bootstrap-connected', deadline)
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
        if (event.source === frame?.contentWindow && event.data?.kind === 'milkup-mermaid-ready') {
          void audit({
            kind: 'connection',
            ownerId: nonce,
            stage: 'frame-hello',
            failed: false,
            opaqueOrigin: event.origin === 'null',
            nonceMatches: event.data.nonce === nonce,
            portAlreadyAssigned: !!port,
          })
        }
        if (
          event.source !== frame?.contentWindow ||
          event.origin !== 'null' ||
          event.data?.kind !== 'milkup-mermaid-ready' ||
          event.data.nonce !== nonce ||
          port
        )
          return
        connectionStage = 'port-transfer'
        void audit({ kind: 'connection', ownerId: nonce, stage: connectionStage, failed: false })
        const channel = new MessageChannel()
        port = channel.port1
        port.onmessage = ({ data }: MessageEvent<Message>) => {
          if (!data || data.nonce !== nonce || retired || failed) return
          if (data.kind === 'rendering') renderingMessage?.(data)
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
      const policy = `default-src 'none'; script-src 'nonce-${nonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src blob: data:; font-src 'none'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
      frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><style>html,body{margin:0}#target{display:flow-root}</style></head><body><div id="target"></div><script nonce="${nonce}" src="${escape(bootstrap)}" data-owner="${nonce}" data-parent-origin="${escape(location.origin)}"></script></body></html>`
      document.body.append(frame)
      frameWasAppended = true
      await connected
      connectionStage = 'engine-load'
      await audit({ kind: 'connection', ownerId: nonce, stage: connectionStage, failed: false })
      const initialized = wait((value) => value.kind === 'connected', deadline)
      port!.postMessage({ kind: 'initialize-engine', nonce, bytes: engine.buffer }, [engine.buffer])
      const hello = await initialized
      connectionStage = 'bridge-inventory'
      await audit({
        kind: 'connection',
        ownerId: nonce,
        stage: connectionStage,
        ...hello.bridge,
        failed: false,
      })
      if (hello.bridge?.engineAvailable !== true || hello.bridge.engineScriptUrlRevoked !== true)
        throw new Error('Pinned Mermaid engine did not initialize')
      if (
        !hello.bridge ||
        hello.bridge.parentDomReadable !== false ||
        hello.bridge.tauriInternals ||
        hello.bridge.tauriInvoke ||
        hello.bridge.wryIpc
      )
        throw new Error('Privileged bridge exposed to the renderer')
      if (options.nativeGuard) {
        if (!hello.bridge.chromeWebview) throw new Error('Native boundary probe unavailable')
        connectionStage = 'main-probe'
        const positive = (await guardedInvoke('frontend_mermaid_probe', { nonce }, deadline)) as {
          dispatchedProbes: number
        }
        connectionStage = 'child-ipc'
        const sent = wait((value) => value.kind === 'probe-sent', deadline)
        port!.postMessage({ kind: 'boundary-probe', nonce })
        await sent
        let navigationSent = false
        while (true) {
          assertActive(deadline)
          const status = (await guardedInvoke(
            'frontend_mermaid_guard_status',
            undefined,
            deadline,
          )) as {
            ready: boolean
            dispatchedProbes: number
            frameProofs: Record<string, [number, number]>
            navigationProofs: Record<string, number>
          }
          if (!status.ready) throw new Error('Child native dispatch was not rejected')
          const proof = status.frameProofs[nonce]
          if (proof && proof[1] !== positive.dispatchedProbes)
            throw new Error('Child native dispatch was not rejected')
          if (proof && !navigationSent) {
            connectionStage = 'child-navigation'
            port!.postMessage({ kind: 'navigation-probe', nonce })
            navigationSent = true
          }
          if (proof && (status.navigationProofs[nonce] ?? 0) > 0) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      } else if (hello.bridge.chromeWebview) throw new Error('Unverified native frame')
      connectionStage = 'ready'
      await audit({ kind: 'connection', ownerId: nonce, stage: connectionStage, failed: false })
    })().catch(async (error) => {
      try {
        await audit({ kind: 'connection', ownerId: nonce, stage: connectionStage, failed: true })
      } catch {}
      failed = true
      awaiting?.reject(error)
      disposeFrame()
      throw error
    }))
  const drain = () =>
    (drainTask ??= (async () => {
      try {
        for (const entry of pending) {
          pending.delete(entry)
          await entry.start()
        }
      } finally {
        drainTask = undefined
      }
    })())
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
            let base: Record<string, unknown> | undefined
            let finish: Record<string, unknown> = { status: 'error', errorCode: 'render-failed' }
            let output: DocumentPresentationResult | undefined
            let failure: unknown
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
              const sourceSha256 = await digest(new TextEncoder().encode(source))
              const admission = { ownerId: nonce, requestId, sourceSha256 }
              await audit({ ...admission, phase: 'admitted' })
              base = admission
              assertActive(deadline, settings.signal)
              let started = false
              renderingMessage = (value) => {
                if (value.requestId !== requestId || started) return
                started = true
                void audit({ ...base, phase: 'started' })
              }
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
              if (result.kind === 'error') {
                finish = {
                  status: 'error',
                  errorCode:
                    result.code === 'unknown-diagram' ? 'unknown-diagram' : 'render-failed',
                  errorStage: result.stage,
                }
                throw new Error(
                  'Mermaid frontend render failed: ' + result.stage + '/' + result.reason,
                )
              }
              assertActive(deadline, settings.signal)
              if (!started || !(result.bytes instanceof ArrayBuffer))
                throw new DocumentPresentationError('invalid-output')
              const bytes = new Uint8Array(result.bytes)
              const content = createDocumentPngImage({
                bytes,
                width: result.width!,
                height: result.height!,
                title: 'Mermaid 图表',
                release() {},
              })
              output = {
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
              finish = {
                status: 'ready',
                pngSha256: await digest(bytes),
                pngBytes: bytes.length,
                width: result.width,
                height: result.height,
              }
            } catch (error) {
              failure = error
              if (retired || settings.signal?.aborted) finish = { status: 'cancelled' }
              else if (error instanceof DocumentPresentationError && error.code === 'timeout')
                finish = { status: 'timeout' }
            } finally {
              renderingMessage = undefined
              if (base) {
                try {
                  await audit({
                    ...base,
                    phase: 'finished',
                    ...finish,
                    consumerAborted: settings.signal?.aborted === true || retired,
                  })
                } catch (error) {
                  failure = error
                }
              }
              settings.signal?.removeEventListener('abort', abort)
            }
            try {
              assertActive(deadline, settings.signal)
            } catch (error) {
              failure ??= error
            }
            if (failure || !output) {
              if (output) disposeDocumentPngImages(output)
              reject(failure ?? new DocumentPresentationError('invalid-output'))
            } else resolve(output)
          },
        }
        settings.signal?.addEventListener('abort', abort, { once: true })
        pending.add(entry)
        if (settings.signal?.aborted) abort()
        void drain()
      })
    },
    retire() {
      return (retirement ??= (async () => {
        retired = true
        const error = new DocumentPresentationError('revoked')
        awaiting?.reject(error)
        for (const entry of pending) entry.reject(error)
        pending.clear()
        disposeFrame()
        await drainTask
        if (auditing && frameWasAppended) {
          await auditChain
          const retirementDeadline = performance.now() + 2500
          while (true) {
            const status = (await guardedInvoke(
              'frontend_mermaid_guard_status',
              undefined,
              retirementDeadline,
            )) as { frames: Record<string, boolean> }
            if (status.frames[nonce] === false) break
            if (performance.now() >= retirementDeadline)
              throw new Error('Frontend frame destruction was not observed')
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          await guardedInvoke(
            'frontend_mermaid_audit_flush',
            { ownerId: nonce },
            retirementDeadline,
          )
        }
        // Removal revokes output authority. It is not advertised as arbitrary-JS
        // hard termination or an operating-system memory quota.
      })())
    },
  }
}

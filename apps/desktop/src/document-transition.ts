import { shouldPromptBeforeClose, type DocumentSession } from '@milkup/tauri-bridge'

export type DocumentTransitionKind = 'new' | 'open' | 'close' | 'window' | 'update'
export interface DocumentTransitionPrompt {
  readonly kind: DocumentTransitionKind
  readonly phase: 'confirming' | 'saving'
  readonly error?: string
}

export type DocumentTransitionResult =
  | { readonly status: 'completed' }
  | {
      readonly status: 'cancelled'
      readonly reason: 'cancel' | 'abort' | 'document-changed' | 'busy'
    }

interface TransitionRequest {
  readonly kind: DocumentTransitionKind
  readonly documentId: string
  phase: 'preparing' | 'confirming' | 'saving' | 'executing'
  readonly proceed: (signal: AbortSignal, commit: () => void) => void | Promise<void>
  committed: boolean
  readonly abort: AbortController
  readonly detachAbort: () => void
  readonly completion?: {
    resolve: (result: DocumentTransitionResult) => void
    reject: (error: unknown) => void
  }
}

/** Serializes destructive navigation and keeps cancellation authoritative across async saves. */
export function createDocumentTransitionController(options: {
  readonly session: () => DocumentSession
  readonly busy: () => boolean
  readonly flushEdits: () => Promise<void>
  readonly save: () => Promise<boolean>
  readonly saveFailureMessage: () => string
  readonly show: (prompt: DocumentTransitionPrompt) => void
  readonly hide: () => void
  readonly onError: (error: unknown) => void
}) {
  let pending: TransitionRequest | undefined
  // Cancellation settles the caller immediately, but an action must unwind
  // before another navigation can start. Actions check their signal at commit.
  let executing: TransitionRequest | undefined

  function release(request: TransitionRequest): boolean {
    if (pending !== request) return false
    pending = undefined
    request.detachAbort()
    return true
  }

  function cancelRequest(
    request: TransitionRequest,
    reason: Extract<DocumentTransitionResult, { status: 'cancelled' }>['reason'],
  ): void {
    if (!release(request)) return
    options.hide()
    request.abort.abort()
    request.completion?.resolve({ status: 'cancelled', reason })
  }

  function fail(request: TransitionRequest, error: unknown): void {
    // A synchronous document commit is final; later rendering errors still
    // reach the host, but cannot turn an opened document into cancellation.
    if (request.committed) {
      options.onError(error)
      return
    }
    if (!release(request)) return
    if (request.phase === 'confirming' || request.phase === 'saving') options.hide()
    if (request.completion) request.completion.reject(error)
    else options.onError(error)
  }

  function commit(request: TransitionRequest): void {
    if (!release(request)) return
    request.committed = true
    request.completion?.resolve({ status: 'completed' })
  }

  function cancelChangedDocument(request: TransitionRequest): boolean {
    // Legacy save failures retain their existing retry prompt. Awaited callers
    // need a terminal result when the document they intended to leave is gone.
    if (request.completion && options.session().documentId !== request.documentId) {
      cancelRequest(request, 'document-changed')
      return true
    }
    return false
  }

  async function proceed(request: TransitionRequest): Promise<void> {
    if (pending !== request || cancelChangedDocument(request)) return
    request.phase = 'executing'
    executing = request
    try {
      options.hide()
      if (pending !== request) return
      await request.proceed(request.abort.signal, () => commit(request))
      commit(request)
    } catch (error) {
      fail(request, error)
    } finally {
      if (executing === request) executing = undefined
    }
  }

  async function begin(
    kind: DocumentTransitionKind,
    action: TransitionRequest['proceed'],
    signal?: AbortSignal,
    completion?: TransitionRequest['completion'],
  ): Promise<void> {
    if (signal?.aborted) {
      completion?.resolve({ status: 'cancelled', reason: 'abort' })
      return
    }
    if (pending || executing || options.busy()) {
      completion?.resolve({ status: 'cancelled', reason: 'busy' })
      return
    }
    const onAbort = () => cancelRequest(request, 'abort')
    const request: TransitionRequest = {
      kind,
      documentId: options.session().documentId,
      phase: 'preparing',
      proceed: action,
      committed: false,
      abort: new AbortController(),
      detachAbort: () => signal?.removeEventListener('abort', onAbort),
      ...(completion ? { completion } : {}),
    }
    pending = request
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    try {
      await options.flushEdits()
      if (pending !== request) return
      if (options.session().documentId !== request.documentId) {
        cancelRequest(request, 'document-changed')
        return
      }
      if (kind !== 'update' && !shouldPromptBeforeClose(options.session())) {
        await proceed(request)
        return
      }
      request.phase = 'confirming'
      options.show({ kind, phase: 'confirming' })
    } catch (error) {
      if (pending === request) fail(request, error)
    }
  }

  return {
    /** Preserves the legacy promise: a dirty document resolves after showing its prompt. */
    request(kind: DocumentTransitionKind, action: () => void | Promise<void>): Promise<void> {
      return begin(kind, action)
    },
    /** Check signal before replacing the document, then call commit synchronously.
     * Post-commit UI work keeps the execution lock and reports errors via onError. */
    requestAndWait(
      kind: DocumentTransitionKind,
      action: (signal: AbortSignal, commit: () => void) => void | Promise<void>,
      requestOptions: { readonly signal?: AbortSignal } = {},
    ): Promise<DocumentTransitionResult> {
      return new Promise((resolve, reject) => {
        void begin(kind, action, requestOptions.signal, { resolve, reject }).catch(reject)
      })
    },
    cancel(): void {
      if (pending) cancelRequest(pending, 'cancel')
      else options.hide()
    },
    async discard(): Promise<void> {
      if (pending?.phase !== 'confirming') return
      // Application updates never offer to throw away an unsaved document.
      if (pending.kind === 'update') return
      await proceed(pending)
    },
    async save(): Promise<void> {
      if (pending?.phase !== 'confirming') return
      const request = pending
      if (cancelChangedDocument(request)) return
      if (request.kind === 'update' && !shouldPromptBeforeClose(options.session())) {
        await proceed(request)
        return
      }
      request.phase = 'saving'
      options.show({ kind: request.kind, phase: 'saving' })
      let error: string | undefined
      try {
        const saved = await options.save()
        if (pending !== request) return
        if (cancelChangedDocument(request)) return
        if (
          saved &&
          options.session().documentId === request.documentId &&
          !shouldPromptBeforeClose(options.session())
        ) {
          await proceed(request)
          return
        }
        error = options.saveFailureMessage() || '文档仍有未保存的更改，请重试。'
      } catch (cause) {
        error = `保存失败：${cause instanceof Error ? cause.message : String(cause)}`
      }
      if (pending !== request) return
      if (cancelChangedDocument(request)) return
      request.phase = 'confirming'
      options.show({ kind: request.kind, phase: 'confirming', error })
    },
  }
}

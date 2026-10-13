import { shouldPromptBeforeClose, type DocumentSession } from '@milkup/tauri-bridge'

export type DocumentTransitionKind = 'new' | 'open' | 'close' | 'window'
export interface DocumentTransitionPrompt {
  readonly kind: DocumentTransitionKind
  readonly phase: 'confirming' | 'saving'
  readonly error?: string
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
  let pending:
    | {
        kind: DocumentTransitionKind
        documentId: string
        phase: 'preparing' | 'confirming' | 'saving'
        proceed: () => void | Promise<void>
      }
    | undefined

  async function proceed(request: NonNullable<typeof pending>): Promise<void> {
    if (pending !== request) return
    pending = undefined
    options.hide()
    try {
      await request.proceed()
    } catch (error) {
      options.onError(error)
    }
  }

  return {
    async request(kind: DocumentTransitionKind, action: () => void | Promise<void>): Promise<void> {
      if (pending || options.busy()) return
      const request = {
        kind,
        documentId: options.session().documentId,
        phase: 'preparing' as const,
        proceed: action,
      }
      pending = request
      try {
        await options.flushEdits()
        if (pending !== request) return
        if (options.session().documentId !== request.documentId) {
          pending = undefined
          return
        }
        if (!shouldPromptBeforeClose(options.session())) {
          await proceed(request)
          return
        }
        pending.phase = 'confirming'
        options.show({ kind, phase: 'confirming' })
      } catch (error) {
        if (pending !== request) return
        pending = undefined
        options.onError(error)
      }
    },
    cancel(): void {
      pending = undefined
      options.hide()
    },
    async discard(): Promise<void> {
      if (pending?.phase !== 'confirming') return
      await proceed(pending)
    },
    async save(): Promise<void> {
      if (pending?.phase !== 'confirming') return
      const request = pending
      request.phase = 'saving'
      options.show({ kind: request.kind, phase: 'saving' })
      let error: string | undefined
      try {
        const saved = await options.save()
        if (pending !== request) return
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
      request.phase = 'confirming'
      options.show({ kind: request.kind, phase: 'confirming', error })
    },
  }
}

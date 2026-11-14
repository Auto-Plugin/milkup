/** Generic trusted restart/install boundary. A feature plugin cannot supply UI,
 * skip confirmation, discard a draft or keep a request alive after revocation. */
export function createProtectedInstallGate(options: {
  busy: () => boolean
  requestTransition: (proceed: () => Promise<void>) => Promise<void>
  cancelTransition: () => void
  prepareDocument: () => Promise<void>
  setInstalling: (value: boolean) => void
  returnFocus?: () => void
  timeoutMs?: number
}) {
  let pending: { version: string; cancel: () => void; fail: (error: unknown) => void } | undefined
  return {
    get version() {
      return pending?.version
    },
    cancel() {
      pending?.cancel()
    },
    fail(error: unknown) {
      pending?.fail(error)
    },
    request(request: {
      version: string
      signal: AbortSignal
      install: () => Promise<void>
    }): Promise<{ status: 'cancelled' | 'installing' }> {
      if (request.signal.aborted) return Promise.resolve({ status: 'cancelled' })
      if (pending || options.busy()) return Promise.reject(Error('请先完成当前文档操作'))
      return new Promise((resolve, reject) => {
        let committed = false
        let proceeding = false
        const cleanup = () => {
          clearTimeout(timer)
          request.signal.removeEventListener('abort', cancel)
          if (pending === current) pending = undefined
        }
        const cancel = () => {
          if (committed || pending !== current) return
          cleanup()
          options.cancelTransition()
          options.setInstalling(false)
          options.returnFocus?.()
          resolve({ status: 'cancelled' })
        }
        const fail = (error: unknown) => {
          if (committed || pending !== current) return
          cleanup()
          options.cancelTransition()
          options.setInstalling(false)
          options.returnFocus?.()
          reject(error)
        }
        const current = { version: request.version, cancel, fail }
        pending = current
        const timer = setTimeout(cancel, options.timeoutMs ?? 9 * 60_000)
        request.signal.addEventListener('abort', cancel, { once: true })
        try {
          void options
            .requestTransition(async () => {
              if (pending !== current || request.signal.aborted) return cancel()
              if (proceeding) return
              proceeding = true
              options.setInstalling(true)
              try {
                await options.prepareDocument()
                if (pending !== current || request.signal.aborted) return cancel()
                committed = true
                await request.install()
                cleanup()
                resolve({ status: 'installing' })
              } catch (error) {
                committed = false
                fail(error)
              }
            })
            .catch(fail)
        } catch (error) {
          fail(error)
        }
      })
    },
  }
}

import { describe, expect, it, vi } from 'vitest'
import { ChangeSet } from '@milkup/core'
import {
  createDocumentSession,
  recordDocumentTransaction,
  recordFileSave,
  markExternalFileModified,
} from '@milkup/tauri-bridge'
import { createDocumentTransitionController } from './document-transition'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
function fixture() {
  let session = recordDocumentTransaction(createDocumentSession({ documentId: 'draft' }), {
    changes: ChangeSet.insert(0, '草稿'),
  })
  const options = {
    session: () => session,
    busy: () => false,
    flushEdits: vi.fn(async () => {}),
    save: vi.fn(async () => {
      session = recordFileSave(session, {})
      return true
    }),
    saveFailureMessage: () => '已取消保存',
    show: vi.fn(),
    hide: vi.fn(),
    onError: vi.fn(),
  }
  return {
    options,
    controller: createDocumentTransitionController(options),
    setSession: (next: typeof session) => {
      session = next
    },
  }
}

describe('document transition protection', () => {
  it('forces trusted confirmation even for a clean update and does not save an empty document', async () => {
    const { controller, options, setSession } = fixture()
    setSession(createDocumentSession({ documentId: 'clean' }))
    const install = vi.fn()
    await controller.request('update', install)
    expect(install).not.toHaveBeenCalled()
    expect(options.show).toHaveBeenCalledWith({ kind: 'update', phase: 'confirming' })
    await controller.save()
    expect(options.save).not.toHaveBeenCalled()
    expect(install).toHaveBeenCalledOnce()
  })

  it('requires a successful save for an update and never discards the draft', async () => {
    const { controller, options } = fixture()
    const install = vi.fn()
    await controller.request('update', install)
    await controller.discard()
    expect(install).not.toHaveBeenCalled()
    options.save.mockResolvedValueOnce(false)
    await controller.save()
    expect(install).not.toHaveBeenCalled()
    expect(options.session().dirty).toBe(true)
    await controller.save()
    expect(install).toHaveBeenCalledTimes(1)
    expect(options.session().dirty).toBe(false)
  })
  it('cancelling an update while its save finishes never installs or restarts', async () => {
    const { controller, options, setSession } = fixture()
    const disk = deferred<boolean>(),
      install = vi.fn()
    options.save.mockImplementation(() => disk.promise)
    await controller.request('update', install)
    const saving = controller.save()
    controller.cancel()
    setSession(recordFileSave(options.session(), {}))
    disk.resolve(true)
    await saving
    expect(install).not.toHaveBeenCalled()
  })
  it.each(['new', 'open', 'close', 'window'] as const)(
    'protects dirty %s and allows explicit discard',
    async (kind) => {
      const { controller, options } = fixture()
      const proceed = vi.fn()
      await controller.request(kind, proceed)
      expect(proceed).not.toHaveBeenCalled()
      expect(options.show).toHaveBeenCalledWith({ kind, phase: 'confirming' })
      await controller.discard()
      await controller.discard()
      expect(proceed).toHaveBeenCalledTimes(1)
    },
  )
  it('cancellation preserves the document and drops the pending intent', async () => {
    const { controller, options } = fixture()
    const proceed = vi.fn()
    await controller.request('new', proceed)
    controller.cancel()
    await controller.save()
    await controller.discard()
    expect(proceed).not.toHaveBeenCalled()
    expect(options.session().dirty).toBe(true)
  })
  it('saves before continuing and ignores duplicate requests and saves', async () => {
    const { controller, options, setSession } = fixture()
    const disk = deferred<boolean>()
    options.save.mockImplementation(() => disk.promise)
    const proceed = vi.fn(),
      duplicate = vi.fn()
    await controller.request('open', proceed)
    await controller.request('new', duplicate)
    const saving = controller.save()
    await controller.save()
    await controller.discard()
    expect(proceed).not.toHaveBeenCalled()
    setSession(recordFileSave(options.session(), {}))
    disk.resolve(true)
    await saving
    expect(options.save).toHaveBeenCalledTimes(1)
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(duplicate).not.toHaveBeenCalled()
  })
  it('cancel while saving never resumes navigation or reopens the prompt', async () => {
    const { controller, options, setSession } = fixture()
    const disk = deferred<boolean>()
    options.save.mockImplementation(() => disk.promise)
    const proceed = vi.fn()
    await controller.request('window', proceed)
    const saving = controller.save()
    controller.cancel()
    options.show.mockClear()
    setSession(recordFileSave(options.session(), {}))
    disk.resolve(true)
    await saving
    expect(proceed).not.toHaveBeenCalled()
    expect(options.show).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'error', 'edited', 'conflict', 'identity'] as const)(
    'does not navigate after save %s',
    async (outcome) => {
      const { controller, options, setSession } = fixture()
      options.save.mockImplementation(async () => {
        if (outcome === 'error') throw new Error('disk full')
        if (outcome === 'conflict') setSession(markExternalFileModified(options.session()))
        if (outcome === 'identity') setSession(createDocumentSession({ documentId: 'different' }))
        return outcome !== 'cancel'
      })
      const proceed = vi.fn()
      await controller.request('open', proceed)
      await controller.save()
      expect(proceed).not.toHaveBeenCalled()
      expect(options.show).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: 'confirming', error: expect.any(String) }),
      )
    },
  )
  it('flushes pending source edits before checking dirty state and recovers from failure', async () => {
    const { controller, options, setSession } = fixture()
    const clean = createDocumentSession({ documentId: 'draft' })
    setSession(clean)
    options.flushEdits.mockRejectedValueOnce(new Error('pending edit failed'))
    const proceed = vi.fn()
    await controller.request('new', proceed)
    expect(proceed).not.toHaveBeenCalled()
    expect(options.onError).toHaveBeenCalled()
    options.flushEdits.mockImplementationOnce(async () => {
      setSession(recordDocumentTransaction(clean, { changes: ChangeSet.insert(0, 'x') }))
    })
    await controller.request('new', proceed)
    expect(proceed).not.toHaveBeenCalled()
    expect(options.show).toHaveBeenCalled()
  })
  it('allows clean navigation and reports action errors without locking future requests', async () => {
    const { controller, options, setSession } = fixture()
    setSession(createDocumentSession({ documentId: 'draft' }))
    await controller.request('open', async () => {
      throw new Error('unreadable')
    })
    const proceed = vi.fn()
    await controller.request('new', proceed)
    expect(options.onError).toHaveBeenCalled()
    expect(proceed).toHaveBeenCalledOnce()
    expect(options.show).not.toHaveBeenCalled()
  })
  it('a cancelled flush rejection cannot erase a newer pending transition', async () => {
    const { controller, options } = fixture()
    let reject!: (error: Error) => void
    options.flushEdits.mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail
        }),
    )
    const oldAction = vi.fn(),
      newAction = vi.fn()
    const first = controller.request('new', oldAction)
    controller.cancel()
    await controller.request('open', newAction)
    reject(new Error('late failure'))
    await first
    await controller.discard()
    expect(oldAction).not.toHaveBeenCalled()
    expect(newAction).toHaveBeenCalledOnce()
  })
})

describe('awaited document transitions', () => {
  it('makes commit final before post-commit rendering while keeping the execution lock', async () => {
    const { controller, options, setSession } = fixture()
    setSession(createDocumentSession({ documentId: 'draft' }))
    const abort = new AbortController()
    const paint = deferred<void>()
    let actionSignal!: AbortSignal
    const result = controller.requestAndWait(
      'open',
      async (signal, commit) => {
        actionSignal = signal
        setSession(createDocumentSession({ documentId: 'opened' }))
        commit()
        await paint.promise
      },
      { signal: abort.signal },
    )
    await expect(result).resolves.toEqual({ status: 'completed' })
    abort.abort()
    controller.cancel()
    expect(actionSignal.aborted).toBe(false)
    expect(options.session().documentId).toBe('opened')
    await expect(controller.requestAndWait('new', vi.fn())).resolves.toEqual({
      status: 'cancelled',
      reason: 'busy',
    })
    paint.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await expect(controller.requestAndWait('new', vi.fn())).resolves.toEqual({
      status: 'completed',
    })
  })

  it('reports a post-commit render error once without rejecting completed navigation', async () => {
    const { controller, options, setSession } = fixture()
    setSession(createDocumentSession({ documentId: 'draft' }))
    const paint = deferred<void>()
    const result = controller.requestAndWait('open', async (_signal, commit) => {
      commit()
      await paint.promise
    })
    await expect(result).resolves.toEqual({ status: 'completed' })
    const error = new Error('render failed')
    paint.reject(error)
    await Promise.resolve()
    await Promise.resolve()
    expect(options.onError).toHaveBeenCalledExactlyOnceWith(error)
    await expect(controller.requestAndWait('new', vi.fn())).resolves.toEqual({
      status: 'completed',
    })
  })

  it('does not revive a cancelled request through a late commit callback', async () => {
    const { controller, options, setSession } = fixture()
    setSession(createDocumentSession({ documentId: 'draft' }))
    const prepare = deferred<void>()
    const abort = new AbortController()
    const result = controller.requestAndWait(
      'open',
      async (_signal, commit) => {
        await prepare.promise
        commit()
      },
      { signal: abort.signal },
    )
    await Promise.resolve()
    abort.abort()
    await expect(result).resolves.toEqual({ status: 'cancelled', reason: 'abort' })
    prepare.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(options.onError).not.toHaveBeenCalled()
    await expect(controller.requestAndWait('new', vi.fn())).resolves.toEqual({
      status: 'completed',
    })
  })
  it('returns immediately for pre-aborted and busy requests without changing the prompt', async () => {
    const { controller, options } = fixture()
    const abort = new AbortController()
    abort.abort()
    const proceed = vi.fn()
    await expect(
      controller.requestAndWait('open', proceed, { signal: abort.signal }),
    ).resolves.toEqual({ status: 'cancelled', reason: 'abort' })
    options.busy = () => true
    await expect(controller.requestAndWait('open', proceed)).resolves.toEqual({
      status: 'cancelled',
      reason: 'busy',
    })
    expect(options.flushEdits).not.toHaveBeenCalled()
    expect(options.show).not.toHaveBeenCalled()
    expect(options.hide).not.toHaveBeenCalled()
    expect(proceed).not.toHaveBeenCalled()
  })

  it('preserves an existing request when another request is rejected as busy', async () => {
    const { controller, options } = fixture()
    const firstAction = vi.fn()
    const secondAction = vi.fn()
    const first = controller.requestAndWait('open', firstAction)
    await Promise.resolve()
    await expect(controller.requestAndWait('new', secondAction)).resolves.toEqual({
      status: 'cancelled',
      reason: 'busy',
    })
    expect(options.hide).not.toHaveBeenCalled()
    await controller.discard()
    await expect(first).resolves.toEqual({ status: 'completed' })
    expect(firstAction).toHaveBeenCalledOnce()
    expect(secondAction).not.toHaveBeenCalled()
  })

  it('returns explicit cancellation and removes the external abort listener', async () => {
    const { controller, options } = fixture()
    const abort = new AbortController()
    const remove = vi.spyOn(abort.signal, 'removeEventListener')
    const first = controller.requestAndWait('open', vi.fn(), { signal: abort.signal })
    await Promise.resolve()
    controller.cancel()
    await expect(first).resolves.toEqual({ status: 'cancelled', reason: 'cancel' })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    const nextAction = vi.fn()
    const next = controller.requestAndWait('new', nextAction)
    await Promise.resolve()
    options.hide.mockClear()
    abort.abort()
    expect(options.hide).not.toHaveBeenCalled()
    await controller.discard()
    await expect(next).resolves.toEqual({ status: 'completed' })
    expect(nextAction).toHaveBeenCalledOnce()
  })

  it('waits through confirmation and action completion', async () => {
    const { controller, options } = fixture()
    const action = deferred<void>()
    const proceed = vi.fn(() => action.promise)
    const settled = vi.fn()
    const result = controller.requestAndWait('open', proceed).then(settled)
    await Promise.resolve()
    expect(options.show).toHaveBeenCalledWith({ kind: 'open', phase: 'confirming' })
    expect(settled).not.toHaveBeenCalled()
    const discarding = controller.discard()
    expect(proceed).toHaveBeenCalledOnce()
    expect(settled).not.toHaveBeenCalled()
    action.resolve()
    await discarding
    await result
    expect(settled).toHaveBeenCalledExactlyOnceWith({ status: 'completed' })
  })

  it('returns cancellation and prevents navigation when aborted during save', async () => {
    const { controller, options, setSession } = fixture()
    const signal = new AbortController()
    const disk = deferred<boolean>()
    options.save.mockImplementation(() => disk.promise)
    const proceed = vi.fn()
    const result = controller.requestAndWait('open', proceed, { signal: signal.signal })
    await Promise.resolve()
    const saving = controller.save()
    signal.abort()
    await expect(result).resolves.toEqual({ status: 'cancelled', reason: 'abort' })
    setSession(recordFileSave(options.session(), {}))
    disk.resolve(true)
    await saving
    expect(proceed).not.toHaveBeenCalled()
  })

  it.each(['false', 'error'] as const)(
    'continues waiting after save %s and completes after a successful retry',
    async (outcome) => {
      const { controller, options } = fixture()
      if (outcome === 'error') options.save.mockRejectedValueOnce(new Error('disk full'))
      else options.save.mockResolvedValueOnce(false)
      const proceed = vi.fn()
      const settled = vi.fn()
      const result = controller.requestAndWait('open', proceed).then(settled)
      await Promise.resolve()
      await controller.save()
      expect(settled).not.toHaveBeenCalled()
      expect(proceed).not.toHaveBeenCalled()
      expect(options.show).toHaveBeenLastCalledWith({
        kind: 'open',
        phase: 'confirming',
        error: expect.any(String),
      })
      expect(options.onError).not.toHaveBeenCalled()
      await controller.save()
      await result
      expect(settled).toHaveBeenCalledExactlyOnceWith({ status: 'completed' })
      expect(proceed).toHaveBeenCalledOnce()
    },
  )

  it('does not let an aborted flush rejection disturb a newer prompt', async () => {
    const { controller, options } = fixture()
    const flush = deferred<void>()
    options.flushEdits.mockImplementationOnce(() => flush.promise)
    const abort = new AbortController()
    const oldAction = vi.fn()
    const first = controller.requestAndWait('open', oldAction, { signal: abort.signal })
    abort.abort()
    await expect(first).resolves.toEqual({ status: 'cancelled', reason: 'abort' })
    const nextAction = vi.fn()
    const next = controller.requestAndWait('new', nextAction)
    await Promise.resolve()
    options.hide.mockClear()
    flush.reject(new Error('late flush error'))
    await Promise.resolve()
    expect(options.hide).not.toHaveBeenCalled()
    expect(options.onError).not.toHaveBeenCalled()
    await controller.discard()
    await expect(next).resolves.toEqual({ status: 'completed' })
    expect(oldAction).not.toHaveBeenCalled()
    expect(nextAction).toHaveBeenCalledOnce()
  })

  it.each(['resolve', 'reject'] as const)(
    'holds the navigation lock until an aborted action unwinds with %s',
    async (outcome) => {
      const { controller, options, setSession } = fixture()
      setSession(createDocumentSession({ documentId: 'draft' }))
      const work = deferred<void>()
      const abort = new AbortController()
      const commit = vi.fn()
      let actionSignal!: AbortSignal
      const result = controller.requestAndWait(
        'open',
        async (signal) => {
          actionSignal = signal
          await work.promise
          if (!signal.aborted) commit()
        },
        { signal: abort.signal },
      )
      await Promise.resolve()
      abort.abort()
      await expect(result).resolves.toEqual({ status: 'cancelled', reason: 'abort' })
      expect(actionSignal.aborted).toBe(true)
      const nextAction = vi.fn()
      await expect(controller.requestAndWait('new', nextAction)).resolves.toEqual({
        status: 'cancelled',
        reason: 'busy',
      })
      await controller.request('new', nextAction)
      expect(nextAction).not.toHaveBeenCalled()
      if (outcome === 'reject') work.reject(new Error('late action error'))
      else work.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await expect(controller.requestAndWait('new', nextAction)).resolves.toEqual({
        status: 'completed',
      })
      expect(nextAction).toHaveBeenCalledOnce()
      expect(commit).not.toHaveBeenCalled()
      expect(options.onError).not.toHaveBeenCalled()
    },
  )

  it('detaches a completed request before an external signal can affect a later prompt', async () => {
    const { controller, options, setSession } = fixture()
    setSession(createDocumentSession({ documentId: 'draft' }))
    const abort = new AbortController()
    const remove = vi.spyOn(abort.signal, 'removeEventListener')
    await controller.requestAndWait('open', vi.fn(), { signal: abort.signal })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    setSession(
      recordDocumentTransaction(options.session(), { changes: ChangeSet.insert(0, '草稿') }),
    )
    const result = controller.requestAndWait('new', vi.fn())
    await Promise.resolve()
    options.hide.mockClear()
    abort.abort()
    expect(options.hide).not.toHaveBeenCalled()
    await controller.discard()
    await expect(result).resolves.toEqual({ status: 'completed' })
  })

  it('rejects flush errors once while legacy requests retain their single onError report', async () => {
    const { controller, options } = fixture()
    const error = new Error('flush failed')
    options.flushEdits.mockRejectedValueOnce(error)
    await expect(controller.requestAndWait('open', vi.fn())).rejects.toBe(error)
    expect(options.onError).not.toHaveBeenCalled()
    options.flushEdits.mockRejectedValueOnce(error)
    await controller.request('open', vi.fn())
    expect(options.onError).toHaveBeenCalledExactlyOnceWith(error)
  })

  it('rejects action failures without also reporting them through legacy onError', async () => {
    const { controller, options, setSession } = fixture()
    setSession(createDocumentSession({ documentId: 'draft' }))
    const error = new Error('unreadable')
    const result = controller.requestAndWait('open', async () => {
      throw error
    })
    await expect(result).rejects.toBe(error)
    expect(options.onError).not.toHaveBeenCalled()
    await expect(controller.requestAndWait('new', vi.fn())).resolves.toEqual({
      status: 'completed',
    })
  })

  it('cancels a changed document instead of leaving an awaited request pending', async () => {
    const { controller, options, setSession } = fixture()
    options.save.mockImplementation(async () => {
      setSession(createDocumentSession({ documentId: 'different' }))
      return true
    })
    const proceed = vi.fn()
    const result = controller.requestAndWait('open', proceed)
    await Promise.resolve()
    await controller.save()
    await expect(result).resolves.toEqual({ status: 'cancelled', reason: 'document-changed' })
    expect(proceed).not.toHaveBeenCalled()
    expect(options.hide).toHaveBeenCalledOnce()
  })

  it.each(['flush', 'discard', 'save'] as const)(
    'cancels a changed document before %s can continue navigation',
    async (stage) => {
      const { controller, options, setSession } = fixture()
      const changeDocument = () => setSession(createDocumentSession({ documentId: 'different' }))
      if (stage === 'flush') options.flushEdits.mockImplementationOnce(async () => changeDocument())
      const proceed = vi.fn()
      const result = controller.requestAndWait('open', proceed)
      await Promise.resolve()
      if (stage !== 'flush') {
        changeDocument()
        await controller[stage]()
      }
      await expect(result).resolves.toEqual({ status: 'cancelled', reason: 'document-changed' })
      expect(proceed).not.toHaveBeenCalled()
      expect(options.save).not.toHaveBeenCalled()
    },
  )

  it('keeps update confirmation and discard protection for awaited requests', async () => {
    const { controller, options, setSession } = fixture()
    setSession(createDocumentSession({ documentId: 'draft' }))
    const install = vi.fn()
    const result = controller.requestAndWait('update', install)
    await Promise.resolve()
    expect(options.show).toHaveBeenCalledWith({ kind: 'update', phase: 'confirming' })
    await controller.discard()
    expect(install).not.toHaveBeenCalled()
    await controller.save()
    await expect(result).resolves.toEqual({ status: 'completed' })
    expect(options.save).not.toHaveBeenCalled()
    expect(install).toHaveBeenCalledOnce()
  })
})

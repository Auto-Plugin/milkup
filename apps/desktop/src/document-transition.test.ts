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
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
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

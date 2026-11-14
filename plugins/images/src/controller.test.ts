import { describe, expect, it, vi } from 'vitest'
import { createController, POLICY_KEY } from './controller'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const asset = {
  id: 'asset-1',
  reference: 'assets/image.png',
  mimeType: 'image/png',
  width: 10,
  height: 10,
  sizeBytes: 100,
}
function fixture() {
  const order: string[] = []
  const host = {
    resources: {
      prepareDocument: vi.fn(async () => {
        order.push('prepare')
        return { status: 'ready', id: 'intent-1' }
      }),
      choose: vi.fn(async () => {
        order.push('choose')
        return { id: 'source-1', name: '图片.png', mimeType: 'image/png', sizeBytes: 100 }
      }),
      stage: vi.fn(async () => {
        order.push('stage')
        return asset
      }),
      abort: vi.fn(async () => {}),
    },
    editing: {
      capture: vi.fn(async () => {
        order.push('capture')
        return {
          id: 'snapshot-1',
          documentId: 'document-1',
          version: 3,
          selection: { anchor: 8, head: 3 },
        }
      }),
      apply: vi.fn(async () => {
        order.push('apply')
        return { documentId: 'document-1', version: 4 }
      }),
      release: vi.fn(async () => {}),
    },
  }
  const storage = {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  }
  const changed = vi.fn()
  const controller = createController(storage, changed)
  return { host, storage, controller, changed, order }
}
describe('independent image import workflow', () => {
  it('prepares Save As before snapshot/chooser and stages before one CAS edit', async () => {
    const f = fixture()
    await f.controller.ready
    f.controller.change('alt', '示例 [图]')
    await f.controller.choose(f.host)
    expect(f.order).toEqual(['prepare', 'capture', 'choose', 'stage', 'apply'])
    expect(f.host.editing.apply).toHaveBeenCalledWith(
      {
        snapshotId: 'snapshot-1',
        changes: [{ from: 3, to: 8, insert: '![示例 \\[图\\]](assets/image.png)' }],
        selection: {
          anchor: 3 + '![示例 \\[图\\]](assets/image.png)'.length,
          head: 3 + '![示例 \\[图\\]](assets/image.png)'.length,
        },
        assetIds: ['asset-1'],
      },
      expect.anything(),
    )
    expect(f.controller.state.phase).toBe('done')
    expect(f.host.editing.release).toHaveBeenCalledWith('snapshot-1')
  })
  it('cancelled first save does not choose, stage or insert', async () => {
    const f = fixture()
    await f.controller.ready
    f.host.resources.prepareDocument.mockResolvedValue({ status: 'cancelled' })
    await f.controller.choose(f.host)
    expect(f.host.resources.choose).not.toHaveBeenCalled()
    expect(f.host.editing.capture).not.toHaveBeenCalled()
    expect(f.host.editing.apply).not.toHaveBeenCalled()
    expect(f.controller.state.phase).toBe('cancelled')
  })
  it('cancelled chooser releases intent and snapshot without a resource', async () => {
    const f = fixture()
    await f.controller.ready
    f.host.resources.choose.mockResolvedValue(null)
    await f.controller.choose(f.host)
    expect(f.host.resources.stage).not.toHaveBeenCalled()
    expect(f.host.resources.abort).toHaveBeenCalledWith('intent-1')
    expect(f.host.editing.release).toHaveBeenCalledWith('snapshot-1')
  })
  it('passes only the opaque clipboard grant to document preparation', async () => {
    const f = fixture()
    await f.controller.ready
    await f.controller.paste(f.host, { grantId: 'paste-grant' })
    expect(f.host.resources.prepareDocument).toHaveBeenCalledWith(
      { pasteId: 'paste-grant' },
      expect.anything(),
    )
    expect(f.controller.state.phase).toBe('done')
  })
  it.each([undefined, {}, { grantId: '' }, { grantId: 1 }, { files: ['/etc/image.png'] }])(
    'rejects ungranted paste input %j',
    async (input) => {
      const f = fixture()
      await f.controller.ready
      await f.controller.paste(f.host, input)
      expect(f.host.resources.prepareDocument).not.toHaveBeenCalled()
      expect(f.controller.state.phase).toBe('error')
    },
  )
  it('keeps document unchanged if staging fails and hides raw system paths', async () => {
    const f = fixture()
    await f.controller.ready
    f.host.resources.stage.mockRejectedValue(
      Object.assign(new Error('/private/secret EACCES'), { code: 'unavailable' }),
    )
    await f.controller.choose(f.host)
    expect(f.host.editing.apply).not.toHaveBeenCalled()
    expect(f.host.resources.abort).toHaveBeenCalledWith('source-1')
    expect(f.controller.state.error).not.toMatch(/private|secret|EACCES/)
  })
  it('cleans up staged bytes when content or save location invalidates the snapshot', async () => {
    const f = fixture()
    await f.controller.ready
    f.host.editing.apply.mockRejectedValue(Object.assign(new Error(), { code: 'invalidated' }))
    await f.controller.choose(f.host)
    expect(f.host.resources.abort).toHaveBeenCalledWith('asset-1')
    expect(f.controller.state.error).toMatch(/文档|保存位置/)
    expect(f.controller.state.phase).toBe('error')
  })
  it('does not request deletion of accepted assets, including dispose after success', async () => {
    const f = fixture()
    await f.controller.ready
    await f.controller.choose(f.host)
    await f.controller.dispose()
    expect(f.host.resources.abort).not.toHaveBeenCalledWith('asset-1')
  })
  it('ignores and releases a late prepared intent after cancellation', async () => {
    const f = fixture()
    await f.controller.ready
    const gate = deferred<{ status: string; id: string }>()
    f.host.resources.prepareDocument.mockReturnValue(gate.promise)
    const work = f.controller.choose(f.host)
    await f.controller.cancel()
    gate.resolve({ status: 'ready', id: 'late-intent' })
    await work
    expect(f.host.resources.abort).toHaveBeenCalledWith('late-intent')
    expect(f.host.editing.capture).not.toHaveBeenCalled()
    expect(f.controller.state.phase).toBe('cancelled')
  })
  it('close cancels staging, discards late asset, and never inserts', async () => {
    const f = fixture()
    await f.controller.ready
    const gate = deferred<typeof asset>()
    f.host.resources.stage.mockReturnValue(gate.promise)
    const work = f.controller.choose(f.host)
    await vi.waitFor(() => expect(f.host.resources.stage).toHaveBeenCalled())
    await f.controller.close()
    gate.resolve(asset)
    await work
    expect(f.host.resources.abort).toHaveBeenCalledWith('asset-1')
    expect(f.host.editing.apply).not.toHaveBeenCalled()
    expect(f.host.resources.stage.mock.calls[0][1].signal.aborted).toBe(true)
  })
  it('dispose stops updates and cleans a late chooser result', async () => {
    const f = fixture()
    await f.controller.ready
    const gate = deferred<unknown>()
    f.host.resources.choose.mockReturnValue(gate.promise)
    const work = f.controller.choose(f.host)
    await vi.waitFor(() => expect(f.host.resources.choose).toHaveBeenCalled())
    await f.controller.dispose()
    const count = f.changed.mock.calls.length
    gate.resolve({ id: 'late-source', name: 'late.png', mimeType: 'image/png', sizeBytes: 8 })
    await work
    expect(f.host.resources.abort).toHaveBeenCalledWith('late-source')
    expect(f.host.resources.stage).not.toHaveBeenCalled()
    expect(f.changed).toHaveBeenCalledTimes(count)
  })
  it('blocks concurrent imports while a native dialog is open', async () => {
    const f = fixture()
    await f.controller.ready
    const gate = deferred<null>()
    f.host.resources.choose.mockReturnValue(gate.promise)
    const work = f.controller.choose(f.host)
    await vi.waitFor(() => expect(f.host.resources.choose).toHaveBeenCalled())
    await f.controller.choose(f.host)
    expect(f.host.resources.prepareDocument).toHaveBeenCalledTimes(1)
    gate.resolve(null)
    await work
  })
  it('allows a deliberate fresh retry after failure', async () => {
    const f = fixture()
    await f.controller.ready
    f.host.resources.stage.mockRejectedValueOnce(new Error('failed'))
    await f.controller.choose(f.host)
    await f.controller.choose(f.host)
    expect(f.host.resources.prepareDocument).toHaveBeenCalledTimes(2)
    expect(f.host.editing.apply).toHaveBeenCalledTimes(1)
  })
  it('does not insert malformed host references', async () => {
    const f = fixture()
    await f.controller.ready
    f.host.resources.stage.mockResolvedValue({ ...asset, reference: 'https://bad/image.png' })
    await f.controller.choose(f.host)
    expect(f.host.editing.apply).not.toHaveBeenCalled()
    expect(f.host.resources.abort).toHaveBeenCalledWith('asset-1')
  })
  it('rejects invalid alternative text before opening a native dialog', async () => {
    const f = fixture()
    await f.controller.ready
    f.controller.change('alt', 'x'.repeat(513))
    await f.controller.choose(f.host)
    expect(f.host.resources.prepareDocument).not.toHaveBeenCalled()
    expect(f.controller.state.invalidAlt).toBeTruthy()
  })
  it('reports unavailable public capabilities without throwing out of command', async () => {
    const f = fixture()
    await f.controller.ready
    await f.controller.choose(undefined)
    expect(f.controller.state.phase).toBe('error')
  })
  it('stores only the fixed policy in a valid namespaced storage key', async () => {
    const f = fixture()
    await f.controller.ready
    f.controller.change('policy', 'document-assets')
    await f.controller.flushPreferences()
    expect(POLICY_KEY).toMatch(/^[A-Za-z0-9._-]{1,128}$/)
    expect(f.storage.setItem).toHaveBeenCalledWith(POLICY_KEY, 'document-assets')
    await f.controller.choose(f.host)
    expect(f.host.resources.stage).toHaveBeenCalledWith(
      { sourceId: 'source-1', snapshotId: 'snapshot-1', strategy: 'document-assets' },
      expect.anything(),
    )
  })
  it('retains defaults on unreadable storage and displays a plain warning', async () => {
    const storage = {
      getItem: vi.fn(async () => {
        throw new Error('/secret')
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    const controller = createController(storage, vi.fn())
    await controller.ready
    expect(controller.state.policy).toBe('assets')
    expect(controller.state.warning).toBeTruthy()
    expect(controller.state.warning).not.toContain('/secret')
  })
  it('keeps current-session policy when persistence fails', async () => {
    const f = fixture()
    await f.controller.ready
    f.storage.setItem.mockRejectedValue(new Error('quota'))
    f.controller.change('policy', 'document-assets')
    await f.controller.flushPreferences()
    expect(f.controller.state.policy).toBe('document-assets')
    expect(f.controller.state.warning).toMatch(/未能保存/)
  })
  it('does not let delayed storage hydration overwrite a user choice', async () => {
    const gate = deferred<string | null>()
    const storage = {
      getItem: () => gate.promise,
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(),
    }
    const controller = createController(storage, vi.fn())
    controller.change('policy', 'document-assets')
    gate.resolve('assets')
    await controller.ready
    expect(controller.state.policy).toBe('document-assets')
  })
  it('reports a failed background paste with bounded plain text, without opening UI', async () => {
    const f = fixture()
    const notify = vi.fn(async () => {})
    const controller = createController(f.storage, vi.fn(), notify)
    await controller.ready
    f.host.resources.stage.mockRejectedValue(new Error('/private/path'))
    await controller.paste(f.host, { grantId: 'paste-1' })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).not.toContain('/private')
    expect(notify.mock.calls[0][0]).toContain('图片导入未完成')
  })
  it('does not notify or steal focus on successful or cancelled paste', async () => {
    const f = fixture()
    const notify = vi.fn(async () => {})
    const controller = createController(f.storage, vi.fn(), notify)
    await controller.ready
    await controller.paste(f.host, { grantId: 'paste-1' })
    f.host.resources.prepareDocument.mockResolvedValue({ status: 'cancelled' })
    await controller.paste(f.host, { grantId: 'paste-2' })
    expect(notify).not.toHaveBeenCalled()
  })
  it('uses the restored policy even if clipboard import starts while storage is loading', async () => {
    const f = fixture()
    const gate = deferred<string | null>()
    const controller = createController({ ...f.storage, getItem: () => gate.promise }, vi.fn())
    const work = controller.paste(f.host, { grantId: 'paste-1' })
    await vi.waitFor(() => expect(f.host.resources.choose).toHaveBeenCalled())
    expect(f.host.resources.stage).not.toHaveBeenCalled()
    gate.resolve('document-assets')
    await work
    expect(f.host.resources.stage.mock.calls[0][0].strategy).toBe('document-assets')
  })
  it('releases a second paste grant without interrupting an import already in progress', async () => {
    const f = fixture()
    await f.controller.ready
    const gate = deferred<null>()
    f.host.resources.choose.mockReturnValue(gate.promise)
    const first = f.controller.paste(f.host, { grantId: 'first-grant' })
    await vi.waitFor(() => expect(f.host.resources.choose).toHaveBeenCalled())
    await f.controller.paste(f.host, { grantId: 'second-grant' })
    expect(f.host.resources.abort).toHaveBeenCalledWith('second-grant')
    expect(f.controller.state.phase).toBe('choosing')
    expect(f.host.resources.prepareDocument).toHaveBeenCalledTimes(1)
    gate.resolve(null)
    await first
  })
  it('releases a grant rejected before preparation because the draft is invalid', async () => {
    const f = fixture()
    await f.controller.ready
    f.controller.change('alt', 'x'.repeat(513))
    await f.controller.paste(f.host, { grantId: 'rejected-grant' })
    expect(f.host.resources.prepareDocument).not.toHaveBeenCalled()
    expect(f.host.resources.abort).toHaveBeenCalledWith('rejected-grant')
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { PluginEditingSnapshot } from '@milkup/plugin'
import {
  createDesktopResourceService,
  isManagedResourceReference,
  type DesktopResourceDocument,
  type DesktopResourceTransport,
} from './resource-service'

function fixture() {
  let document: DesktopResourceDocument = {
    documentId: 'doc',
    version: 3,
    selectionRevision: 2,
    saveLocationGeneration: 1,
    path: '/notes/a.md',
  }
  const calls = vi.fn(async (command: string) => {
    if (command === 'resources_choose_image')
      return { id: 'source-1', name: 'photo.png', mimeType: 'image/png', sizeBytes: 100 }
    if (command === 'resources_stage_image')
      return {
        id: 'transaction-1',
        assets: [
          {
            id: 'asset-1',
            relativePath: 'assets/image.png',
            mimeType: 'image/png',
            width: 3,
            height: 2,
          },
        ],
      }
    if (command === 'resources_resolve_image')
      return { data: [1, 2, 3], mimeType: 'image/png', width: 3, height: 2 }
    return true
  })
  const ensureDocumentSaved = vi.fn(async () => true)
  const onError = vi.fn()
  const service = createDesktopResourceService({
    currentDocument: () => document,
    ensureDocumentSaved,
    transport: calls as DesktopResourceTransport,
    onError,
  })
  const owner = service.adapterForPlugin('test.images')
  const snapshot = (): PluginEditingSnapshot => ({
    ...document,
    id: 'snapshot-1',
    from: 0,
    to: 0,
    text: '',
    selection: { anchor: 0, head: 0 },
    startLine: 0,
    lineCount: 1,
    lineEnding: 'lf',
    mode: 'memory',
  })
  async function choose() {
    const intent = await owner.adapter.prepareDocument()
    if (intent.status !== 'ready') throw Error('cancelled')
    return owner.adapter.choose(intent.id)
  }
  async function stage() {
    const source = await choose()
    return owner.adapter.stage(
      { sourceId: source!.id, snapshotId: 'snapshot-1', strategy: 'assets' },
      snapshot(),
    )
  }
  return {
    service,
    owner,
    calls,
    ensureDocumentSaved,
    onError,
    snapshot,
    choose,
    stage,
    change: (
      next: Partial<Omit<DesktopResourceDocument, 'path'>> & { path?: string | undefined },
    ) => {
      const merged = { ...document, ...next }
      const { path, ...rest } = merged
      document = { ...rest, ...(path === undefined ? {} : { path }) }
    },
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('desktop host-owned resource transactions', () => {
  it('finishes the ordinary first Save As before allowing the native chooser', async () => {
    const f = fixture()
    f.change({ path: undefined, saveLocationGeneration: 0 })
    f.ensureDocumentSaved.mockImplementation(async () => {
      f.change({ path: '/notes/new.md', saveLocationGeneration: 1 })
      return true
    })
    expect(await f.choose()).toMatchObject({ id: 'source-1' })
    expect(f.ensureDocumentSaved).toHaveBeenCalledOnce()
    expect(f.calls.mock.calls[0]?.[0]).toBe('resources_choose_image')
  })
  it('cancelled first save creates no native resource or chooser grant', async () => {
    const f = fixture()
    f.change({ path: undefined })
    f.ensureDocumentSaved.mockResolvedValue(false)
    expect(await f.owner.adapter.prepareDocument()).toEqual({ status: 'cancelled' })
    expect(f.calls).not.toHaveBeenCalled()
  })
  it('a new save location invalidates a staged source before disk writes', async () => {
    const f = fixture()
    const source = await f.choose()
    const snapshot = f.snapshot()
    f.change({ saveLocationGeneration: 2 })
    await expect(
      f.owner.adapter.stage(
        { sourceId: source!.id, snapshotId: snapshot.id, strategy: 'assets' },
        snapshot,
      ),
    ).rejects.toMatchObject({ code: 'stale' })
    expect(f.calls.mock.calls.some(([name]) => name === 'resources_stage_image')).toBe(false)
  })
  it('binds source handles to their plugin instance', async () => {
    const f = fixture()
    const source = await f.choose()
    const other = f.service.adapterForPlugin('test.images')
    await expect(
      other.adapter.stage(
        { sourceId: source!.id, snapshotId: 'snapshot-1', strategy: 'assets' },
        f.snapshot(),
      ),
    ).rejects.toMatchObject({ code: 'invalid-token' })
    other.dispose()
    f.owner.dispose()
    await Promise.resolve()
    expect(f.calls).toHaveBeenCalledWith('resources_release_source', { sourceId: 'source-1' })
  })
  it('disposal rejects and releases a chooser result arriving after disable', async () => {
    const f = fixture()
    const pending = deferred<unknown>()
    f.calls.mockImplementation(async () => pending.promise as never)
    const choice = f.choose()
    await vi.waitFor(() => expect(f.calls).toHaveBeenCalledOnce())
    f.owner.dispose()
    pending.resolve({ id: 'source-1', name: 'photo.png', mimeType: 'image/png', sizeBytes: 100 })
    await expect(choice).rejects.toMatchObject({ code: 'aborted' })
    expect(f.calls).toHaveBeenCalledWith('resources_release_source', { sourceId: 'source-1' })
  })
  it('rolls back a stage arriving after document selection changed', async () => {
    const f = fixture()
    const source = await f.choose()
    const snapshot = f.snapshot()
    const pending = deferred<unknown>()
    f.calls.mockImplementation(async (command) =>
      command === 'resources_stage_image' ? (pending.promise as never) : (true as never),
    )
    const stage = f.owner.adapter.stage(
      { sourceId: source!.id, snapshotId: snapshot.id, strategy: 'assets' },
      snapshot,
    )
    f.change({ selectionRevision: 3 })
    pending.resolve({
      id: 'transaction-1',
      assets: [
        { id: 'asset-1', relativePath: 'assets/a.png', mimeType: 'image/png', width: 3, height: 2 },
      ],
    })
    await expect(stage).rejects.toMatchObject({ code: 'stale' })
    expect(f.calls).toHaveBeenCalledWith('resources_abort', { transactionId: 'transaction-1' })
  })
  it('rechecks document CAS after native asset verification', async () => {
    const f = fixture()
    const asset = await f.stage()
    const snapshot = f.snapshot()
    f.calls.mockImplementation(async () => {
      f.change({ version: 4 })
      return true as never
    })
    await expect(f.service.assertAssets(snapshot, [asset.id])).rejects.toMatchObject({
      code: 'stale',
    })
  })
  it('accepted resources survive abort/disposal even if the native ACK throws', async () => {
    const f = fixture()
    const asset = await f.stage()
    await f.service.assertAssets(f.snapshot(), [asset.id])
    f.calls.mockImplementation(() => {
      throw Error('offline')
    })
    expect(() => f.service.acceptAssets([asset.id])).not.toThrow()
    f.owner.dispose()
    await f.owner.adapter.abort(asset.id)
    await vi.waitFor(() => expect(f.onError).toHaveBeenCalledOnce())
    expect(f.calls.mock.calls.some(([name]) => name === 'resources_abort')).toBe(false)
  })
  it('disposing an unaccepted asset cleans only its native transaction once', async () => {
    const f = fixture()
    const asset = await f.stage()
    f.owner.dispose()
    f.owner.dispose()
    await f.owner.adapter.abort(asset.id)
    expect(f.calls.mock.calls.filter(([name]) => name === 'resources_abort')).toHaveLength(1)
  })
  it('pins a native commit against worker disposal until successful adoption', async () => {
    const f = fixture()
    const asset = await f.stage()
    await f.service.assertAssets(f.snapshot(), [asset.id])
    f.service.pinAssets([asset.id])
    f.owner.dispose()
    await f.owner.adapter.abort(asset.id)
    expect(f.calls.mock.calls.some(([name]) => name === 'resources_abort')).toBe(false)
    f.service.acceptAssets([asset.id])
    await f.service.releasePins([asset.id])
    await f.service.releaseDocument('doc')
    expect(f.calls.mock.calls.some(([name]) => name === 'resources_abort')).toBe(false)
  })
  it('defers worker-disposal cleanup until a failed native commit releases its pin', async () => {
    const f = fixture()
    const asset = await f.stage()
    f.service.pinAssets([asset.id])
    f.owner.dispose()
    expect(f.calls.mock.calls.some(([name]) => name === 'resources_abort')).toBe(false)
    await f.service.releasePins([asset.id])
    expect(f.calls.mock.calls.filter(([name]) => name === 'resources_abort')).toHaveLength(1)
    await f.service.releasePins([asset.id])
    expect(f.calls.mock.calls.filter(([name]) => name === 'resources_abort')).toHaveLength(1)
  })
  it('never resolves network, traversal or arbitrary local paths', async () => {
    const f = fixture()
    for (const url of [
      'https://example.test/image.png',
      'file:///image.png',
      '../image.png',
      'assets/../../image.png',
      'assets/%2e%2e',
      'assets/a.png?x',
      'assets/a%3ab.png',
    ])
      expect(await f.service.resolveImage('doc', url)).toBeUndefined()
    expect(f.calls).not.toHaveBeenCalled()
    expect(isManagedResourceReference('%E4%B8%AD.assets/a%20b.png')).toBe(true)
  })
  it('revokes its object URL on abort and disposal is idempotent', async () => {
    const f = fixture()
    const signal = new AbortController()
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const image = await f.service.resolveImage('doc', 'assets/a.png', { signal: signal.signal })
    expect(image?.url).toMatch(/^blob:/)
    signal.abort()
    image?.dispose()
    expect(revoke).toHaveBeenCalledOnce()
    revoke.mockRestore()
  })
  it('rejects a forged clipboard event before creating any grant', () => {
    const f = fixture()
    expect(() =>
      f.service.grantPaste(
        new File(['x'], 'x.png', { type: 'image/png' }),
        new Event('paste'),
        'test.images',
      ),
    ).toThrow()
    expect(f.calls).not.toHaveBeenCalled()
  })
})

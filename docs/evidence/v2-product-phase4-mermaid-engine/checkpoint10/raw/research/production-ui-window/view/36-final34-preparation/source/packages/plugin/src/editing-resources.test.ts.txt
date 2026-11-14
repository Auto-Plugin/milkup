import { describe, it, expect, vi } from 'vitest'
import {
  createPluginEditingBroker,
  copyPluginEditingSnapshot,
  copyPluginEditingApplyRequest,
  type PluginEditingSnapshot,
} from './editing-broker'
import { createPluginResourcesBroker } from './resources-broker'
import { createRpcPluginEditingBroker, createPluginEditingRpcServer } from './editing-rpc'
import { createRpcPluginResourcesBroker, createPluginResourcesRpcServer } from './resources-rpc'
import { pair, deferred, flush } from './settings-test-helpers'
export const snap: PluginEditingSnapshot = {
  id: 'snap-1',
  documentId: 'doc:one',
  version: 2,
  selectionRevision: 1,
  saveLocationGeneration: 3,
  from: 4,
  to: 7,
  text: 'abc',
  selection: { anchor: 0, head: 3 },
  startLine: 2,
  lineCount: 1,
  lineEnding: 'lf',
  mode: 'memory',
  context: { kind: 'text', complete: true },
}
const manifest = {
  id: 'edit-test',
  name: 'Edit',
  version: '1.0.0',
  permissions: ['document:read', 'document:write', 'images:import'] as const,
}
function setup() {
  let next = 0
  const edit = {
    capture: vi.fn(async () => ({ ...snap, id: `snap-${++next}` })),
    apply: vi.fn(async () => ({ documentId: snap.documentId, version: 3 })),
    table: vi.fn(async () => ({ documentId: snap.documentId, version: 3 })),
    release: vi.fn(async () => {}),
  }
  const resource = {
    prepareDocument: vi.fn(async () => ({ status: 'ready' as const, id: 'intent-1' })),
    choose: vi.fn(async () => ({
      id: 'source-1',
      name: 'image.png',
      mimeType: 'image/png' as const,
      sizeBytes: 32,
    })),
    stage: vi.fn(async () => ({
      id: 'asset-1',
      reference: 'assets/image.png',
      mimeType: 'image/png' as const,
      sizeBytes: 32,
      width: 1,
      height: 1,
    })),
    abort: vi.fn(async () => {}),
  }
  let resources: ReturnType<typeof createPluginResourcesBroker>
  const editing = createPluginEditingBroker({
    manifest,
    adapter: edit,
    validateAssets: (ids, s) => resources.assertAssets(ids, s),
    acceptAssets: (ids, s) => resources.acceptAssets(ids, s),
  })
  resources = createPluginResourcesBroker({
    manifest,
    adapter: resource,
    getSnapshot: (id) => editing.getSnapshot(id),
    consumeGesture: (proof) => proof === 'trusted',
  })
  return { edit, resource, editing, resources }
}
describe('bounded editing and resources', () => {
  it('freezes bounded snapshots and preserves direction', async () => {
    const t = setup()
    const s = await t.editing.capture({ extent: 'lines' })
    expect(Object.isFrozen(s.selection)).toBe(true)
    expect(s.selection).toEqual({ anchor: 0, head: 3 })
    await t.editing.apply({
      snapshotId: s.id,
      changes: [{ from: 0, to: 3, insert: 'x' }],
      selection: { anchor: 1, head: 1 },
    })
    await expect(t.editing.apply({ snapshotId: s.id, changes: [] })).rejects.toMatchObject({
      code: 'invalid-snapshot',
    })
    t.editing.dispose()
  })
  it.each([
    { ...snap, text: 'x'.repeat(65537), to: 65541 },
    { ...snap, selection: { anchor: 4, head: 0 } },
    {
      ...snap,
      syntax: { nodes: [{ type: 'script', status: 'valid', from: 0, to: 1, markerRanges: [] }] },
    },
  ])('rejects invalid host snapshot %#', (s) => {
    expect(() => copyPluginEditingSnapshot(s)).toThrow()
  })
  it.each([
    {
      changes: [
        { from: 2, to: 3, insert: '' },
        { from: 1, to: 2, insert: '' },
      ],
    },
    { changes: [{ from: 0, to: 4, insert: '' }] },
    { changes: [{ from: 0, to: 0, insert: 'x' }], url: 'file:///tmp/x' },
    { changes: [], assetIds: ['x', 'x'] },
  ])('rejects malformed relative edit %j', (input) =>
    expect(() => copyPluginEditingApplyRequest({ snapshotId: 'snap-1', ...input }, snap)).toThrow(),
  )
  it('rejects foreign handles, extra keys, revoked permissions and snapshot quota', async () => {
    const t = setup()
    await expect(t.editing.apply({ snapshotId: 'foreign', changes: [] })).rejects.toMatchObject({
      code: 'invalid-snapshot',
    })
    await expect(
      t.editing.capture({ extent: 'lines', path: '/tmp' } as never),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    for (let i = 0; i < 8; i++) await t.editing.capture({ extent: 'selection' })
    await expect(t.editing.capture({ extent: 'selection' })).rejects.toMatchObject({ code: 'busy' })
    t.editing.dispose()
    await expect(t.editing.capture({ extent: 'selection' })).rejects.toMatchObject({
      code: 'revoked',
    })
    expect(t.edit.release).toHaveBeenCalledTimes(8)
  })
  it('cleans a late capture after abort and cannot reuse its handle', async () => {
    const t = setup(),
      wait = deferred<PluginEditingSnapshot>()
    t.edit.capture.mockImplementationOnce(() => wait.promise)
    const c = new AbortController()
    const promise = t.editing.capture({ extent: 'selection' }, { signal: c.signal })
    await flush()
    c.abort()
    await expect(promise).rejects.toMatchObject({ code: 'aborted' })
    wait.resolve(snap)
    await flush()
    expect(t.edit.release).toHaveBeenCalledWith(snap.id)
    expect(() => t.editing.getSnapshot(snap.id)).toThrow()
  })
  it('requires trusted prepare, consumes clipboard once and cleans late intents', async () => {
    const t = setup()
    await expect(t.resources.prepareDocument()).rejects.toMatchObject({ code: 'gesture-required' })
    await expect(t.resources.prepareDocument({ pasteId: 'forged' })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    t.resources.grantPaste('paste-1')
    await t.resources.prepareDocument({ pasteId: 'paste-1' })
    await expect(t.resources.prepareDocument({ pasteId: 'paste-1' })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    expect(t.resource.abort).toHaveBeenCalledWith('paste-1')
    t.resources.dispose()
    expect(t.resource.abort).toHaveBeenCalledWith('intent-1')
  })
  it('binds assets to owning snapshot and preserves accepted resources on disable', async () => {
    const t = setup()
    const s = await t.editing.capture({ extent: 'selection' })
    await t.resources.prepareDocument({}, { gesture: 'trusted' })
    const source = await t.resources.choose('intent-1')
    const asset = await t.resources.stage({
      sourceId: source!.id,
      snapshotId: s.id,
      strategy: 'assets',
    })
    await expect(
      t.editing.apply({ snapshotId: s.id, changes: [], assetIds: ['foreign'] }),
    ).rejects.toMatchObject({ code: 'invalid-token' })
    await t.editing.apply({
      snapshotId: s.id,
      changes: [{ from: 0, to: 0, insert: '![](assets/image.png)' }],
      assetIds: [asset.id],
    })
    await t.resources.abort(asset.id)
    t.resources.dispose()
    expect(t.resource.abort.mock.calls.flat()).not.toContain(asset.id)
    expect(t.resource.stage).toHaveBeenCalledWith(
      expect.anything(),
      s,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
  it('cleans aborted stage response without publishing the grant', async () => {
    const t = setup()
    const s = await t.editing.capture({ extent: 'selection' })
    await t.resources.prepareDocument({}, { gesture: 'trusted' })
    await t.resources.choose('intent-1')
    const wait = deferred<Awaited<ReturnType<typeof t.resource.stage>>>()
    t.resource.stage.mockImplementationOnce(() => wait.promise)
    const c = new AbortController()
    const promise = t.resources.stage(
      { sourceId: 'source-1', snapshotId: s.id, strategy: 'assets' },
      { signal: c.signal },
    )
    await flush()
    c.abort()
    await expect(promise).rejects.toMatchObject({ code: 'aborted' })
    wait.resolve({
      id: 'late',
      reference: 'assets/x.png',
      mimeType: 'image/png',
      sizeBytes: 32,
      width: 1,
      height: 1,
    })
    await flush()
    expect(t.resource.abort).toHaveBeenCalledWith('late')
    expect(() => t.resources.assertAssets(['late'], s.id)).toThrow()
  })
  it('cleans a prepare response cancelled during delivery', async () => {
    const t = setup(),
      c = new AbortController(),
      wait = deferred<{ status: 'ready'; id: string }>()
    t.resource.prepareDocument.mockImplementationOnce(() => wait.promise)
    const pending = t.resources.prepareDocument({}, { gesture: 'trusted', signal: c.signal })
    await flush()
    wait.resolve({ status: 'ready', id: 'racing-intent' })
    queueMicrotask(() => c.abort())
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    await flush()
    expect(t.resource.abort).toHaveBeenCalledWith('racing-intent')
    await expect(t.resources.choose('racing-intent')).rejects.toMatchObject({
      code: 'invalid-token',
    })
  })
  it('closed permission cannot revive after reapproval', async () => {
    let allowed = true
    const t = setup()
    const broker = createPluginEditingBroker({ manifest, adapter: t.edit, isActive: () => allowed })
    allowed = false
    await expect(broker.capture({ extent: 'selection' })).rejects.toMatchObject({ code: 'revoked' })
    allowed = true
    await expect(broker.capture({ extent: 'selection' })).rejects.toMatchObject({ code: 'revoked' })
  })
})
describe('editing/resources strict RPC', () => {
  it('roundtrips, rejects forged method/fields and revokes unfinished calls', async () => {
    const t = setup(),
      p = pair()
    const server = createPluginEditingRpcServer(p.main, t.editing),
      client = createRpcPluginEditingBroker(p.worker)
    const s = await client.capture({ extent: 'selection' })
    await client.apply({ snapshotId: s.id, changes: [{ from: 0, to: 0, insert: 'X' }] })
    p.worker.postMessage({
      protocol: 'milkup.plugin.editing.rpc.v1',
      type: 'request',
      id: 'forged',
      method: 'exec',
      payload: { path: '/tmp' },
    })
    p.worker.postMessage({
      protocol: 'milkup.plugin.editing.rpc.v1',
      type: 'request',
      id: 'extra',
      method: 'capture',
      payload: { request: { extent: 'selection' }, path: '/tmp' },
    })
    await flush()
    expect(t.edit.capture).toHaveBeenCalledTimes(1)
    expect(p.main.sent).toContainEqual(
      expect.objectContaining({ id: 'forged', ok: false, error: { code: 'invalid-input' } }),
    )
    const wait = deferred<PluginEditingSnapshot>()
    t.edit.capture.mockImplementationOnce(() => wait.promise)
    const pending = client.capture({ extent: 'selection' })
    await flush()
    server.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'revoked' })
    wait.resolve({ ...snap, id: 'late' })
    await flush()
    expect(t.edit.release).toHaveBeenCalledWith('late')
    client.dispose()
  })
  it('resource RPC uses only issued IDs and disposes unaccepted grants', async () => {
    const t = setup(),
      p = pair()
    const server = createPluginResourcesRpcServer(p.main, t.resources),
      client = createRpcPluginResourcesBroker(p.worker)
    await expect(client.prepareDocument()).rejects.toMatchObject({ code: 'gesture-required' })
    t.resources.grantPaste('paste-1')
    const intent = await client.prepareDocument({ pasteId: 'paste-1' })
    expect(intent.status).toBe('ready')
    await expect(
      client.stage({ sourceId: 'forged', snapshotId: 'snap-1', strategy: 'assets' }),
    ).rejects.toMatchObject({ code: 'invalid-token' })
    client.dispose()
    await flush()
    expect(t.resource.abort).toHaveBeenCalledWith(
      'intent-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    server.dispose()
  })
})

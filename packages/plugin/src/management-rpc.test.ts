import { expect, it, vi } from 'vitest'
import {
  createPluginManagementBroker,
  type PluginManagementBrokerAdapter,
} from './management-broker'
import { createPluginManagementRpcServer, createRpcPluginManagementBroker } from './management-rpc'
import { copyPluginManagementDetails, type PluginManagementDetails } from './management-schema'
import { pair, flush, deferred } from './settings-test-helpers'
const summary = { id: 'example.item', title: 'Item', description: 'Description' }
const difference = {
  declared: ['document:read'],
  approved: [],
  added: ['document:read'],
  removed: [],
}
const details: PluginManagementDetails = {
  pluginId: summary.id,
  revision: 2,
  entryRevision: 1,
  title: summary.title,
  description: summary.description,
  version: '1.0.0',
  host: 'worker',
  state: 'pending',
  candidate: { fingerprint: 'abc123', version: '1.1.0' },
  compatibility: { compatible: true, hostVersion: '2.0.0-beta.1', sdkVersion: '0.3.7' },
  permissions: difference,
  networkOrigins: { declared: [], approved: [], added: [], removed: [] },
  diagnostics: [],
}
function setup() {
  const endpoint = pair(),
    proofs = new Set(['one'])
  const adapter: PluginManagementBrokerAdapter = {
    snapshot: vi.fn(async () => ({ revision: 2, items: [summary] })),
    describe: vi.fn(async () => details),
    requestHostView: vi.fn(async (_input, context) => {
      context.assertActive()
      return { status: 'opened' as const }
    }),
  }
  const broker = createPluginManagementBroker({
    manifest: {
      id: 'example.manager',
      name: 'Manager',
      version: '1.0.0',
      permissions: ['app:plugins'],
    },
    adapter,
    consumeGesture: (proof) => proof !== undefined && proofs.delete(proof),
  })
  const server = createPluginManagementRpcServer(endpoint.main, broker),
    client = createRpcPluginManagementBroker(endpoint.worker, 1000)
  return {
    ...endpoint,
    adapter,
    broker,
    server,
    client,
    close() {
      client.dispose()
      server.dispose()
      broker.dispose()
    },
  }
}
it('roundtrips immutable catalog/details and consumes navigation proof exactly once', async () => {
  const s = setup()
  expect(await s.client.snapshot()).toEqual({ revision: 2, items: [summary] })
  expect(await s.client.describe({ pluginId: summary.id, revision: 2 })).toEqual(details)
  const input = { pluginId: summary.id, revision: 2, view: 'details' as const }
  await expect(s.client.requestHostView(input, { gesture: 'one' })).resolves.toEqual({
    status: 'opened',
  })
  await expect(s.client.requestHostView(input, { gesture: 'one' })).rejects.toMatchObject({
    code: 'gesture-required',
  })
  expect(s.adapter.requestHostView).toHaveBeenCalledTimes(1)
  s.close()
})
it('rejects stale detail identity and path-bearing or inconsistent host metadata', async () => {
  const s = setup()
  await expect(s.client.describe({ pluginId: summary.id, revision: 3 })).rejects.toMatchObject({
    code: 'stale',
  })
  for (const value of [
    { ...details, path: '/private' },
    { ...details, permissions: { ...difference, added: [] } },
    {
      ...details,
      settings: {
        schema: { secret: { type: 'boolean' } },
        defaults: { secret: false },
        values: { secret: true },
      },
    },
  ])
    expect(() => copyPluginManagementDetails(value)).toThrow()
  s.close()
})
it('aborts queued navigation before adapter side effects and ignores late snapshot results', async () => {
  const s = setup(),
    controller = new AbortController()
  const opening = s.client.requestHostView(
    { pluginId: summary.id, revision: 2, view: 'settings' },
    { gesture: 'one', signal: controller.signal },
  )
  const rejected = expect(opening).rejects.toMatchObject({ code: 'aborted' })
  controller.abort()
  await rejected
  await flush()
  expect(s.adapter.requestHostView).not.toHaveBeenCalled()
  const later = deferred<{ revision: number; items: (typeof summary)[] }>()
  vi.mocked(s.adapter.snapshot).mockImplementationOnce(() => later.promise)
  const reading = s.client.snapshot(),
    revoked = expect(reading).rejects.toMatchObject({ code: 'revoked' })
  await flush()
  s.server.dispose()
  await revoked
  later.resolve({ revision: 2, items: [summary] })
  await flush()
  s.close()
})
it('rejects forbidden RPC methods without invoking the adapter', async () => {
  const s = setup()
  s.worker.postMessage({
    protocol: 'milkup.plugin.management.rpc.v1',
    type: 'request',
    id: 'bad',
    method: 'approve',
    payload: { pluginId: summary.id },
  })
  await flush()
  expect(s.main.sent).toContainEqual({
    protocol: 'milkup.plugin.management.rpc.v1',
    type: 'response',
    id: 'bad',
    ok: false,
    error: { code: 'invalid-input' },
  })
  expect(s.adapter.requestHostView).not.toHaveBeenCalled()
  s.close()
})
it('duplicate active RPC request IDs cannot dispatch another navigation', async () => {
  const s = setup(),
    hold = deferred<{ status: 'opened' }>()
  vi.mocked(s.adapter.requestHostView).mockImplementationOnce(() => hold.promise)
  const message = {
    protocol: 'milkup.plugin.management.rpc.v1',
    type: 'request',
    id: 'same',
    method: 'requestHostView',
    payload: { input: { pluginId: summary.id, revision: 2, view: 'details' }, gesture: 'one' },
  }
  s.worker.postMessage(message)
  s.worker.postMessage(message)
  await flush()
  expect(s.adapter.requestHostView).toHaveBeenCalledTimes(1)
  hold.resolve({ status: 'opened' })
  await flush()
  s.close()
})
it('broker disables read and navigation capabilities after lifetime revocation', async () => {
  const s = setup(),
    hold = deferred<{ revision: number; items: (typeof summary)[] }>()
  vi.mocked(s.adapter.snapshot).mockImplementationOnce(() => hold.promise)
  const reading = s.client.snapshot(),
    rejected = expect(reading).rejects.toMatchObject({ code: 'revoked' })
  await flush()
  s.broker.dispose()
  await rejected
  hold.resolve({ revision: 2, items: [summary] })
  await flush()
  s.close()
})
it('missing sensitive permission cannot expose the adapter', async () => {
  const s = setup(),
    broker = createPluginManagementBroker({
      manifest: { id: 'example.unapproved', name: 'No', version: '1.0.0', permissions: [] },
      adapter: s.adapter,
    })
  await expect(broker.snapshot()).rejects.toMatchObject({ code: 'revoked' })
  expect(s.adapter.snapshot).not.toHaveBeenCalled()
  s.close()
})

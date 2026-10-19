import { expect, it, vi } from 'vitest'
import {
  createPluginManagementBroker,
  createPluginManagementHostCapabilities,
} from './management-broker'
import { copyPluginManagementSnapshot } from './management-schema'

const manifest = {
  id: 'example.management',
  name: 'Management',
  version: '1.0.0',
  permissions: ['app:plugins'] as const,
}
const snapshot = {
  revision: 7,
  items: [{ id: 'example.other', title: 'Other', description: 'A plugin' }],
}
const input = { pluginId: 'example.other', revision: 7, view: 'details' as const }
function setup() {
  const adapter = {
    snapshot: vi.fn(async () => snapshot),
    describe: vi.fn(),
    requestHostView: vi.fn(async () => ({ status: 'opened' as const })),
  }
  const consumeGesture = vi.fn((proof: string | undefined) => proof === 'trusted')
  const broker = createPluginManagementBroker({ manifest, adapter, consumeGesture })
  return { adapter, broker, consumeGesture }
}
it('provides a bounded read-only catalog and no mutation capability', async () => {
  const { broker } = setup()
  expect(await broker.snapshot()).toEqual(snapshot)
  expect(Object.keys(createPluginManagementHostCapabilities(broker))).toEqual([
    'snapshot',
    'describe',
    'requestHostView',
  ])
  expect(Object.isFrozen(await broker.snapshot())).toBe(true)
})
it('navigation requires caller-bound trusted gesture and cannot smuggle an action or path', async () => {
  const { broker, adapter } = setup()
  await expect(broker.requestHostView(input)).rejects.toMatchObject({ code: 'gesture-required' })
  await expect(
    broker.requestHostView({ ...input, path: '/private' } as never, { gesture: 'trusted' }),
  ).rejects.toMatchObject({ code: 'invalid-input' })
  expect(adapter.requestHostView).not.toHaveBeenCalled()
  await expect(broker.requestHostView(input, { gesture: 'trusted' })).resolves.toEqual({
    status: 'opened',
  })
})
it('revokes all subsequent calls when the plugin is disposed', async () => {
  const { broker, adapter } = setup()
  broker.dispose()
  await expect(broker.snapshot()).rejects.toMatchObject({ code: 'revoked' })
  expect(adapter.snapshot).not.toHaveBeenCalled()
})
it('rejects duplicate catalog IDs, unknown data and oversized responses', () => {
  for (const value of [
    { ...snapshot, items: [snapshot.items[0], snapshot.items[0]] },
    { ...snapshot, path: '/private' },
    { ...snapshot, items: [{ ...snapshot.items[0], description: 'x'.repeat(1001) }] },
  ])
    expect(() => copyPluginManagementSnapshot(value)).toThrow()
})

it('rejects invalid navigation cancellation options before consuming the gesture', async () => {
  const { broker, adapter, consumeGesture } = setup()
  for (const signal of [false, null, {}, 'signal'])
    await expect(
      broker.requestHostView(input, { gesture: 'trusted', signal } as never),
    ).rejects.toMatchObject({ code: 'invalid-input' })
  expect(consumeGesture).not.toHaveBeenCalled()
  expect(adapter.requestHostView).not.toHaveBeenCalled()
})

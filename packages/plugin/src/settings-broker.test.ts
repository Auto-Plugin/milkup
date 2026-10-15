import { describe, expect, it } from 'vitest'
import {
  createPluginSettingsBroker,
  copyPluginSettingsDescriptor,
  copyPluginSettingsValues,
  PluginSettingsError,
  type PluginSettingsTransaction,
} from './settings-broker'
import { parsePluginManifest } from './manifest'
import { PluginRuntime } from './runtime'
import { adapter, descriptor, snapshot, manifest, deferred, flush } from './settings-test-helpers'
function setup() {
  const host = adapter()
  return { host, broker: createPluginSettingsBroker({ manifest, adapter: host }) }
}
describe('settings scope and transactions', () => {
  it('cancel rolls back despite a pre-aborted caller and keeps failed rollback retryable', async () => {
    const { host, broker } = setup()
    const tx = await broker.begin('application')
    const abort = new AbortController()
    abort.abort()
    await expect(broker.cancel(tx.id, { signal: abort.signal })).rejects.toMatchObject({
      code: 'aborted',
    })
    expect(host.cancel).toHaveBeenCalledWith(tx.id)
    const another = await broker.begin('application')
    host.cancel
      .mockRejectedValueOnce(new Error('apply failed'))
      .mockRejectedValueOnce(new Error('retry failed'))
    await expect(broker.cancel(another.id)).rejects.toMatchObject({ code: 'unavailable' })
    await broker.cancel(another.id)
    expect(host.cancel).toHaveBeenLastCalledWith(another.id, expect.anything())
    broker.dispose()
  })

  it('offers application and caller-only plugin schema, preview/reset/commit and issued IDs', async () => {
    const { host, broker } = setup()
    expect(await broker.describe('application')).toEqual(descriptor)
    expect(await broker.get('plugin')).toEqual(snapshot)
    const app = await broker.begin('application'),
      own = await broker.begin('plugin')
    expect((await broker.preview(app.id, { size: 20 })).values.size).toBe(20)
    expect((await broker.preview(app.id, descriptor.defaults)).values).toEqual(descriptor.defaults)
    expect((await broker.commit(app.id)).revision).toBe(1)
    await expect(broker.commit(app.id)).rejects.toMatchObject({ code: 'invalid-transaction' })
    await broker.cancel(own.id)
    await broker.cancel(own.id)
    await expect(broker.cancel('foreign-id')).rejects.toMatchObject({ code: 'invalid-transaction' })
    expect(host.cancel).toHaveBeenCalledTimes(1)
    broker.dispose()
  })
  it('rejects absent permissions, undeclared plugin schema and forged scopes before dispatch', async () => {
    const host = adapter()
    const denied = createPluginSettingsBroker({
      manifest: { ...manifest, permissions: [] },
      adapter: host,
    })
    await expect(denied.get('application')).rejects.toMatchObject({ code: 'revoked' })
    const plain = createPluginSettingsBroker({
      manifest: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        permissions: ['settings:write'],
      },
      adapter: host,
    })
    await expect(plain.begin('plugin')).rejects.toMatchObject({ code: 'invalid-scope' })
    await expect(plain.get('another-plugin' as never)).rejects.toMatchObject({
      code: 'invalid-scope',
    })
    expect(host.get).not.toHaveBeenCalled()
    expect(host.begin).not.toHaveBeenCalled()
  })
  it.each([
    { size: 11 },
    { size: 33 },
    { size: 14.5 },
    { size: NaN },
    { size: '14' },
    { theme: 'file:///private' },
    { enabled: 1 },
    { extra: true },
    {},
    JSON.parse('{"__proto__":true}'),
    { size: 14, pluginId: 'other' },
  ])('rejects invalid patch %j before host mutation', async (patch) => {
    const { host, broker } = setup()
    const tx = await broker.begin('application')
    await expect(broker.preview(tx.id, patch as never)).rejects.toMatchObject({
      code: 'invalid-input',
    })
    expect(host.preview).not.toHaveBeenCalled()
    broker.dispose()
  })
  it('enforces one transaction per scope, ownership and in-flight mutation serialization', async () => {
    const { host, broker } = setup()
    const tx = await broker.begin('application')
    await expect(broker.begin('application')).rejects.toMatchObject({ code: 'busy' })
    const other = createPluginSettingsBroker({
      manifest: { ...manifest, id: 'other' },
      adapter: host,
    })
    await expect(other.preview(tx.id, { size: 20 })).rejects.toMatchObject({
      code: 'invalid-transaction',
    })
    const slow = deferred<typeof snapshot>()
    host.preview.mockReturnValueOnce(slow.promise)
    const preview = broker.preview(tx.id, { size: 20 })
    await flush()
    await expect(broker.commit(tx.id)).rejects.toMatchObject({ code: 'busy' })
    await expect(broker.preview(tx.id, { size: 21 })).rejects.toMatchObject({ code: 'busy' })
    const rejected = expect(preview).rejects.toMatchObject({ code: 'aborted' })
    await broker.cancel(tx.id)
    await rejected
    expect(host.preview.mock.calls[0]![2]!.signal!.aborted).toBe(true)
    slow.resolve(snapshot)
    await flush()
    broker.dispose()
    other.dispose()
  })
  it('cleans late begin results and rejects stale methods after disable/re-enable', async () => {
    const host = adapter()
    let enabled = true
    const broker = createPluginSettingsBroker({ manifest, adapter: host, isActive: () => enabled })
    const late = deferred<PluginSettingsTransaction>()
    host.begin.mockReturnValueOnce(late.promise)
    const result = broker.begin('application')
    const rejected = expect(result).rejects.toMatchObject({ code: 'revoked' })
    await flush()
    enabled = false
    await expect(broker.get('application')).rejects.toMatchObject({ code: 'revoked' })
    enabled = true
    await rejected
    late.resolve({ id: 'late', snapshot })
    await flush()
    expect(host.cancel).toHaveBeenCalledWith('late')
    await expect(broker.get('application')).rejects.toMatchObject({ code: 'revoked' })
  })
  it('retains a failed commit for retry and sanitizes adapter errors', async () => {
    const { host, broker } = setup()
    const tx = await broker.begin('application')
    host.commit.mockRejectedValueOnce(new Error('secret /private/storage'))
    await expect(broker.commit(tx.id)).rejects.toEqual(new PluginSettingsError('unavailable'))
    expect((await broker.commit(tx.id)).revision).toBe(1)
    broker.dispose()
  })
  it('does not publish data after queued disposal between native completion and outer return', async () => {
    const host = adapter()
    let done = false,
      queued = false
    const broker = createPluginSettingsBroker({
      manifest,
      adapter: host,
      isActive: () => {
        if (done && !queued) {
          queued = true
          queueMicrotask(() => broker.dispose())
        }
        return true
      },
    })
    host.begin.mockImplementationOnce(async () => {
      done = true
      return { id: 'late', snapshot }
    })
    await expect(broker.begin('application')).rejects.toMatchObject({ code: 'revoked' })
    expect(host.cancel).toHaveBeenCalledWith('late')
  })
  it('rejects plugin namespace schema substitution and rolls back its invalid begin', async () => {
    const { host, broker } = setup()
    host.begin.mockResolvedValueOnce({
      id: 'bad-schema',
      snapshot: { ...snapshot, defaults: { ...snapshot.defaults, size: 20 } },
    })
    await expect(broker.begin('plugin')).rejects.toMatchObject({ code: 'invalid-input' })
    expect(host.cancel).toHaveBeenCalledWith('bad-schema')
    broker.dispose()
  })
  it('validates manifest schema and numeric exceptions without arbitrary strings', () => {
    expect(parsePluginManifest(manifest).settings).toEqual(descriptor)
    for (const settings of [
      { ...descriptor, path: '/private' },
      { ...descriptor, schema: { size: { type: 'string' } } },
      { ...descriptor, defaults: { ...descriptor.defaults, size: 99 } },
      { schema: {}, defaults: {} },
    ])
      expect(() => parsePluginManifest({ ...manifest, settings })).toThrow()
    const width = copyPluginSettingsDescriptor({
      schema: { width: { type: 'number', minimum: 480, maximum: 1200, allowZero: true } },
      defaults: { width: 0 },
    })
    expect(copyPluginSettingsValues({ width: 0 }, width.schema)).toEqual({ width: 0 })
    expect(() => copyPluginSettingsValues({ width: 1 }, width.schema)).toThrow()
  })
  it('runtime grants only declared settings and seals captured capabilities', async () => {
    const host = adapter()
    let captured: any
    const runtime = new PluginRuntime({
      allowedPermissions: ['settings:write'],
      allowInProcessModules: true,
      settingsBroker: host,
    })
    const module = {
      activate: ({ host }: { host: any }) => {
        captured = host.settings
      },
    }
    runtime.loadPlugin({ manifest, module })
    await runtime.enablePlugin(manifest.id)
    await captured.get('application')
    await runtime.disablePlugin(manifest.id)
    await expect(captured.get('application')).rejects.toMatchObject({ code: 'revoked' })
    runtime.loadPlugin({ manifest: { ...manifest, id: 'denied', permissions: [] }, module })
    await runtime.enablePlugin('denied')
    expect(captured).toBeUndefined()
    await runtime.disablePlugin('denied')
  })
})

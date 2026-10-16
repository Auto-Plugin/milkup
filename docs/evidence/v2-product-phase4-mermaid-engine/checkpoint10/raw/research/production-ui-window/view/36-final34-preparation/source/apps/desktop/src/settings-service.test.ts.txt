import { describe, expect, it, vi } from 'vitest'
import type { PluginSettingsValues } from '@milkup/plugin'
import {
  createDesktopSettingsService,
  desktopSettingsStorageKey,
  legacyAppearanceStorageKey,
} from './settings-service'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function tick() {
  for (let index = 0; index < 20; index++) await Promise.resolve()
}

function fixture(initial: Readonly<Record<string, string>> = {}) {
  const data = new Map(Object.entries(initial))
  const storage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value)
    }),
  }
  let visible: PluginSettingsValues = {}
  const applyView = vi.fn(async (settings: PluginSettingsValues, _signal?: AbortSignal) => {
    visible = settings
  })
  const onError = vi.fn()
  const service = createDesktopSettingsService({ storage, applyView, onError })
  const client = service.adapterForPlugin('milkup.preferences')
  return { data, storage, applyView, onError, service, client, visible: () => visible }
}

describe('desktop scoped settings transactions', () => {
  it('keeps the existing editor defaults and migrates appearance without writing during startup', async () => {
    const f = fixture({
      [legacyAppearanceStorageKey]: JSON.stringify({ theme: 'dark', zoom: 1.5 }),
    })
    await f.service.ready
    const snapshot = await f.client.adapter.get('application')
    expect(snapshot.values).toEqual({
      'editor.fontFamily': 'monospace',
      'editor.fontSize': 14,
      'editor.lineWidth': 0,
      'editor.lineHeight': 1.5,
      'editor.indentSize': 2,
      'editor.indentStyle': 'spaces',
      'appearance.theme': 'dark',
      'appearance.zoom': 1.5,
    })
    expect(f.visible()).toEqual(snapshot.values)
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })

  it('previews only the view and restores committed values on cancellation', async () => {
    const f = fixture()
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    const preview = await f.client.adapter.preview(tx.id, {
      'editor.fontSize': 20,
      'appearance.zoom': 1.25,
    })
    expect(preview.values['editor.fontSize']).toBe(20)
    expect(f.visible()['appearance.zoom']).toBe(1.25)
    expect(f.storage.setItem).not.toHaveBeenCalled()
    await f.client.adapter.cancel(tx.id)
    expect(f.visible()['editor.fontSize']).toBe(14)
    expect(f.visible()['appearance.zoom']).toBe(1)
    expect(f.storage.setItem).not.toHaveBeenCalled()
    await f.client.adapter.cancel(tx.id)
  })

  it('persists only committed values and restores them before allowing further transactions', async () => {
    const f = fixture({
      [legacyAppearanceStorageKey]: JSON.stringify({ theme: 'dark', zoom: 1.5 }),
    })
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    await f.client.adapter.preview(tx.id, { 'editor.fontSize': 18, 'appearance.theme': 'light' })
    const committed = await f.client.adapter.commit(tx.id)
    expect(committed.revision).toBe(tx.snapshot.revision + 1)
    expect(f.storage.setItem).toHaveBeenCalledOnce()
    expect(f.data.has(legacyAppearanceStorageKey)).toBe(true)
    const next = fixture(Object.fromEntries(f.data))
    await next.service.ready
    expect(next.visible()).toEqual(committed.values)
    expect(next.visible()['appearance.theme']).toBe('light')
    expect(next.visible()['appearance.zoom']).toBe(1.5)
    expect(next.storage.setItem).not.toHaveBeenCalled()
  })

  it('keeps a failed persistence attempt retryable without changing restart state', async () => {
    const f = fixture()
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    await f.client.adapter.preview(tx.id, { 'editor.fontSize': 24 })
    f.storage.setItem.mockImplementationOnce(() => {
      throw new Error('disk quota')
    })
    await expect(f.client.adapter.commit(tx.id)).rejects.toMatchObject({ code: 'unavailable' })
    expect(f.visible()['editor.fontSize']).toBe(24)
    expect(f.data.has(desktopSettingsStorageKey)).toBe(false)
    const restarted = fixture(Object.fromEntries(f.data))
    await restarted.service.ready
    expect(restarted.visible()['editor.fontSize']).toBe(14)
    const saved = await f.client.adapter.commit(tx.id)
    expect(saved.values['editor.fontSize']).toBe(24)
    expect(saved.revision).toBe(1)
  })

  it('restores the previous successful preview after a partial native apply failure', async () => {
    const f = fixture()
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    await f.client.adapter.preview(tx.id, { 'editor.fontSize': 18 })
    const normalApply = f.applyView.getMockImplementation()!
    f.applyView.mockImplementationOnce(async (values, signal) => {
      await normalApply(values, signal)
      throw new Error('native zoom rejected after partial application')
    })
    await expect(f.client.adapter.preview(tx.id, { 'appearance.zoom': 2 })).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(f.visible()['editor.fontSize']).toBe(18)
    expect(f.visible()['appearance.zoom']).toBe(1)
    const snapshot = await f.client.adapter.get('application')
    expect(snapshot.values).toEqual(f.visible())
    await f.client.adapter.cancel(tx.id)
    expect(f.visible()['editor.fontSize']).toBe(14)
  })

  it('uses a shared application preview lock for plugins and host shortcuts', async () => {
    const f = fixture()
    await f.service.ready
    const other = f.service.adapterForPlugin('other.preferences')
    const tx = await f.client.adapter.begin('application')
    await expect(other.adapter.begin('application')).rejects.toMatchObject({ code: 'busy' })
    await expect(f.service.changeApplication({ 'appearance.zoom': 1.25 })).rejects.toMatchObject({
      code: 'busy',
    })
    await expect(other.adapter.cancel(tx.id)).rejects.toMatchObject({ code: 'invalid-transaction' })
    await f.client.adapter.cancel(tx.id)
    await f.service.changeApplication({ 'appearance.zoom': 1.25 })
    expect(f.service.getApplicationSnapshot().values['appearance.zoom']).toBe(1.25)
  })

  it.each([
    { 'editor.fontSize': Number.NaN },
    { 'editor.fontSize': Infinity },
    { 'editor.fontSize': 33 },
    { 'editor.fontSize': 12.5 },
    { 'editor.lineWidth': 479 },
    { 'editor.lineWidth': 1201 },
    { 'editor.lineHeight': 1.1 },
    { 'editor.indentSize': 3 },
    { 'editor.fontFamily': 'url(evil)' },
    { 'appearance.theme': 'unknown' },
    { 'appearance.zoom': 1.1 },
    { 'unknown.key': true },
    { 'editor.fontFamily': 'x'.repeat(257) },
    {},
    JSON.parse('{"__proto__":true}'),
    Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key${index}`, true])),
  ])('rejects invalid or oversized patches without touching view or storage: %j', async (patch) => {
    const f = fixture()
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    f.applyView.mockClear()
    await expect(f.client.adapter.preview(tx.id, patch)).rejects.toMatchObject({
      code: 'invalid-input',
    })
    expect(f.applyView).not.toHaveBeenCalled()
    expect(f.storage.setItem).not.toHaveBeenCalled()
    await f.client.adapter.cancel(tx.id)
  })

  it('accepts the explicitly supported width, spacing, theme and zoom boundaries', async () => {
    const f = fixture()
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    await f.client.adapter.preview(tx.id, {
      'editor.fontFamily': 'serif',
      'editor.fontSize': 32,
      'editor.lineWidth': 1200,
      'editor.lineHeight': 2.4,
      'editor.indentSize': 4,
      'editor.indentStyle': 'tabs',
      'appearance.theme': 'light',
      'appearance.zoom': 2,
    })
    await f.client.adapter.preview(tx.id, { 'editor.lineWidth': 480, 'editor.lineHeight': 1.2 })
    const auto = await f.client.adapter.preview(tx.id, { 'editor.lineWidth': 0 })
    expect(auto.values['editor.lineWidth']).toBe(0)
    await f.client.adapter.cancel(tx.id)
  })

  it('isolates plugin namespaces and never persists an application preview through a plugin commit', async () => {
    const descriptor = {
      schema: { compact: { type: 'boolean' as const } },
      defaults: { compact: false },
    }
    const f = fixture()
    await f.service.ready
    const own = f.service.adapterForPlugin('plugin.one', descriptor)
    const other = f.service.adapterForPlugin('plugin.two', descriptor)
    const app = await own.adapter.begin('application')
    await own.adapter.preview(app.id, { 'appearance.theme': 'dark' })
    const plugin = await own.adapter.begin('plugin')
    await own.adapter.preview(plugin.id, { compact: true })
    const applyCount = f.applyView.mock.calls.length
    await own.adapter.commit(plugin.id)
    expect(f.applyView).toHaveBeenCalledTimes(applyCount)
    expect((await other.adapter.get('plugin')).values.compact).toBe(false)
    expect((await own.adapter.get('plugin')).values.compact).toBe(true)
    await expect(other.adapter.preview(plugin.id, { compact: false })).rejects.toMatchObject({
      code: 'invalid-transaction',
    })
    await expect(own.adapter.preview(app.id, { compact: true })).rejects.toMatchObject({
      code: 'invalid-input',
    })
    await expect(f.client.adapter.get('plugin')).rejects.toMatchObject({ code: 'invalid-scope' })
    await expect(own.adapter.get('plugin.two' as 'plugin')).rejects.toMatchObject({
      code: 'invalid-scope',
    })
    const persisted = JSON.parse(f.data.get(desktopSettingsStorageKey)!)
    expect(persisted.application.values['appearance.theme']).toBe('system')
    expect(persisted.plugins['plugin.one'].values.compact).toBe(true)
    await own.adapter.cancel(app.id)
    const restarted = fixture(Object.fromEntries(f.data))
    await restarted.service.ready
    expect(
      (await restarted.service.adapterForPlugin('plugin.one', descriptor).adapter.get('plugin'))
        .values.compact,
    ).toBe(true)
  })

  it('shares a plugin scope lock across adapters bound to the same plugin', async () => {
    const descriptor = {
      schema: { compact: { type: 'boolean' as const } },
      defaults: { compact: false },
    }
    const f = fixture()
    await f.service.ready
    const first = f.service.adapterForPlugin('plugin.one', descriptor)
    const second = f.service.adapterForPlugin('plugin.one', descriptor)
    const tx = await first.adapter.begin('plugin')
    await expect(second.adapter.begin('plugin')).rejects.toMatchObject({ code: 'busy' })
    await expect(second.adapter.cancel(tx.id)).rejects.toMatchObject({
      code: 'invalid-transaction',
    })
    await first.dispose()
    await expect(second.adapter.begin('plugin')).resolves.toMatchObject({
      snapshot: { values: { compact: false } },
    })
  })

  it('revokes immediately on disable and waits for an in-flight native preview before restoring the base', async () => {
    const f = fixture()
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    const native = deferred<void>()
    const normalApply = f.applyView.getMockImplementation()!
    let signal: AbortSignal | undefined
    f.applyView.mockImplementationOnce(async (values, requestSignal) => {
      signal = requestSignal
      await native.promise
      await normalApply(values, requestSignal)
    })
    const preview = f.client.adapter.preview(tx.id, { 'appearance.zoom': 2 })
    const rejected = expect(preview).rejects.toMatchObject({ code: 'aborted' })
    await tick()
    const disposal = f.client.dispose()
    expect(signal?.aborted).toBe(true)
    await expect(f.client.adapter.get('application')).rejects.toMatchObject({ code: 'revoked' })
    native.resolve()
    await rejected
    await disposal
    expect(f.visible()['appearance.zoom']).toBe(1)
    expect(f.storage.setItem).not.toHaveBeenCalled()
    const replacement = f.service.adapterForPlugin('new.preferences')
    await expect(replacement.adapter.begin('application')).resolves.toMatchObject({
      snapshot: { values: { 'appearance.zoom': 1 } },
    })
  })

  it('rolls back an externally aborted preview and leaves its transaction available for cancel', async () => {
    const f = fixture()
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    const native = deferred<void>()
    const normalApply = f.applyView.getMockImplementation()!
    f.applyView.mockImplementationOnce(async (values, signal) => {
      await native.promise
      await normalApply(values, signal)
    })
    const abort = new AbortController()
    const preview = f.client.adapter.preview(
      tx.id,
      { 'editor.fontSize': 28 },
      { signal: abort.signal },
    )
    const rejected = expect(preview).rejects.toMatchObject({ code: 'aborted' })
    await tick()
    abort.abort()
    native.resolve()
    await rejected
    expect(f.visible()['editor.fontSize']).toBe(14)
    await f.client.adapter.cancel(tx.id)
  })

  it('does not leave a permanent lock after a failed disable rollback', async () => {
    const f = fixture()
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    await f.client.adapter.preview(tx.id, { 'editor.fontSize': 18 })
    f.applyView.mockRejectedValueOnce(new Error('native renderer unavailable'))
    await expect(f.client.dispose()).rejects.toMatchObject({ code: 'unavailable' })
    expect(f.onError).toHaveBeenCalledOnce()
    expect(f.visible()['editor.fontSize']).toBe(18)
    await expect(f.client.adapter.commit(tx.id)).rejects.toMatchObject({ code: 'revoked' })
    const replacement = f.service.adapterForPlugin('new.preferences')
    const next = await replacement.adapter.begin('application')
    expect(next.snapshot.values['editor.fontSize']).toBe(14)
    expect(f.visible()['editor.fontSize']).toBe(14)
    await replacement.adapter.cancel(next.id)
  })

  it('does not claim a failed rollback is a valid preview that can be committed', async () => {
    const f = fixture()
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    f.applyView
      .mockRejectedValueOnce(new Error('apply failed'))
      .mockRejectedValueOnce(new Error('rollback failed'))
    await expect(f.client.adapter.preview(tx.id, { 'editor.fontSize': 20 })).rejects.toMatchObject({
      code: 'unavailable',
    })
    await expect(f.client.adapter.commit(tx.id)).rejects.toMatchObject({ code: 'unavailable' })
    expect(f.storage.setItem).not.toHaveBeenCalled()
    await f.client.adapter.cancel(tx.id)
    expect(f.visible()['editor.fontSize']).toBe(14)
  })

  it('rejects a stale revision and restores the newer committed base when the preview is cancelled', async () => {
    const f = fixture()
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    await f.client.adapter.preview(tx.id, { 'editor.fontSize': 20 })
    const external = createDesktopSettingsService({ storage: f.storage, applyView: async () => {} })
    await external.ready
    await external.changeApplication({ 'appearance.zoom': 1.5 })
    await expect(f.client.adapter.commit(tx.id)).rejects.toMatchObject({ code: 'conflict' })
    expect(f.visible()['editor.fontSize']).toBe(20)
    await f.client.adapter.cancel(tx.id)
    expect(f.visible()['editor.fontSize']).toBe(14)
    expect(f.visible()['appearance.zoom']).toBe(1.5)
    const next = await f.client.adapter.begin('application')
    expect(next.snapshot.revision).toBe(1)
    await f.client.adapter.preview(next.id, { 'editor.fontSize': 18 })
    expect((await f.client.adapter.commit(next.id)).revision).toBe(2)
  })

  it('restores an externally committed base on direct cancellation without requiring a failed commit first', async () => {
    const f = fixture()
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    await f.client.adapter.preview(tx.id, { 'editor.fontSize': 20 })
    const external = createDesktopSettingsService({ storage: f.storage, applyView: async () => {} })
    await external.ready
    await external.changeApplication({ 'appearance.zoom': 1.5 })
    await f.client.adapter.cancel(tx.id)
    expect(f.visible()['editor.fontSize']).toBe(14)
    expect(f.visible()['appearance.zoom']).toBe(1.5)
    expect((await f.client.adapter.get('application')).revision).toBe(1)
  })

  it('still removes a preview when cancellation cannot read the latest persisted record', async () => {
    const f = fixture()
    await f.service.ready
    const tx = await f.client.adapter.begin('application')
    await f.client.adapter.preview(tx.id, { 'appearance.zoom': 2 })
    f.storage.getItem.mockImplementationOnce(() => {
      throw new Error('storage blocked')
    })
    await expect(f.client.adapter.cancel(tx.id)).rejects.toMatchObject({ code: 'unavailable' })
    expect(f.visible()['appearance.zoom']).toBe(1)
    expect(f.onError).toHaveBeenCalledOnce()
    await f.client.adapter.cancel(tx.id)
    await expect(f.client.adapter.begin('application')).resolves.toMatchObject({
      snapshot: { values: { 'appearance.zoom': 1 } },
    })
  })

  it('restores a host shortcut after persistence failure instead of leaving an ownerless preview', async () => {
    const f = fixture()
    await f.service.ready
    f.storage.setItem.mockImplementationOnce(() => {
      throw new Error('quota')
    })
    await expect(f.service.changeApplication({ 'appearance.zoom': 2 })).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(f.visible()['appearance.zoom']).toBe(1)
    expect(f.service.getApplicationSnapshot().values['appearance.zoom']).toBe(1)
    await expect(f.client.adapter.begin('application')).resolves.toMatchObject({
      snapshot: { revision: 0 },
    })
  })

  it.each(['{broken', JSON.stringify({ version: 99 }), 'x'.repeat(256 * 1024 + 1)])(
    'does not overwrite malformed, unsupported or oversized persisted settings',
    async (raw) => {
      const f = fixture({
        [desktopSettingsStorageKey]: raw,
        [legacyAppearanceStorageKey]: JSON.stringify({ theme: 'dark', zoom: 2 }),
      })
      await expect(f.service.ready).rejects.toBeInstanceOf(Error)
      expect(f.storage.setItem).not.toHaveBeenCalled()
      expect(f.data.get(desktopSettingsStorageKey)).toBe(raw)
      expect(f.applyView).not.toHaveBeenCalled()
      expect(f.onError).toHaveBeenCalledOnce()
    },
  )

  it('rejects a storage read failure without replacing persisted appearance', async () => {
    const applyView = vi.fn(async () => {})
    const storage = {
      getItem: () => {
        throw new Error('storage blocked')
      },
      setItem: vi.fn(),
    }
    const service = createDesktopSettingsService({ storage, applyView })
    await expect(service.ready).rejects.toMatchObject({ code: 'unavailable' })
    expect(applyView).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('cannot report a saved commit when persistent storage is unavailable', async () => {
    const service = createDesktopSettingsService({ applyView: async () => {} })
    await service.ready
    const client = service.adapterForPlugin('milkup.preferences')
    const tx = await client.adapter.begin('application')
    await client.adapter.preview(tx.id, { 'editor.fontSize': 20 })
    await expect(client.adapter.commit(tx.id)).rejects.toMatchObject({ code: 'unavailable' })
    await client.adapter.cancel(tx.id)
  })

  it('keeps descriptors and snapshots immutable and rejects reused committed transaction IDs', async () => {
    const f = fixture()
    await f.service.ready
    const descriptor = await f.client.adapter.describe('application')
    expect(Object.isFrozen(descriptor.schema)).toBe(true)
    expect(Object.isFrozen(descriptor.defaults)).toBe(true)
    const tx = await f.client.adapter.begin('application')
    expect(Object.isFrozen(tx.snapshot.values)).toBe(true)
    await f.client.adapter.commit(tx.id)
    await expect(f.client.adapter.commit(tx.id)).rejects.toMatchObject({
      code: 'invalid-transaction',
    })
    await f.client.adapter.cancel(tx.id)
  })
})

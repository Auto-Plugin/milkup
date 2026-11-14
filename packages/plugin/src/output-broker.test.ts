import { describe, it, expect } from 'vitest'
import {
  createPluginOutputBroker,
  createPluginOutputHostCapabilities,
  copyPluginOutputCaptureRequest,
  copyPluginOutputSnapshot,
  PluginOutputError,
  type PluginOutputSnapshot,
} from './output-broker'
import {
  outputSetup,
  outputRequest,
  outputSnapshot,
  outputManifest,
  outputAdapter,
} from './output-test-helpers'
import { deferred, flush } from './settings-test-helpers'
import { validatePluginManifest } from './manifest'
const trusted = { gesture: 'trusted' }
describe('controlled output leases', () => {
  it('validates the public permission dependency in manifests', () => {
    expect(validatePluginManifest(outputManifest).ok).toBe(true)
    expect(validatePluginManifest({ ...outputManifest, permissions: ['document:output'] }).ok).toBe(
      false,
    )
  })
  it('requires both declared permissions and a trusted capture gesture', async () => {
    const t = outputSetup()
    await expect(t.broker.capture(outputRequest)).rejects.toMatchObject({
      code: 'gesture-required',
    })
    for (const permissions of [[], ['document:read'], ['document:output']] as const) {
      const broker = createPluginOutputBroker({
        manifest: { ...outputManifest, permissions },
        adapter: t.adapter,
        consumeGesture: () => true,
      })
      await expect(broker.capture(outputRequest, trusted)).rejects.toMatchObject({
        code: 'revoked',
      })
    }
    expect(t.adapter.capture).not.toHaveBeenCalled()
    t.broker.dispose()
  })
  it.each([
    { ...outputRequest, path: '/tmp/original.md' },
    { ...outputRequest, html: '<script/>' },
    { ...outputRequest, format: 'exe' },
    { ...outputRequest, scope: { from: 0, to: 1 } },
    { ...outputRequest, resources: 'network' },
    { ...outputRequest, pageSize: 'unlimited' },
    { ...outputRequest, landscape: 'true' },
  ])('rejects injected paths/options %#', (request) =>
    expect(() => copyPluginOutputCaptureRequest(request)).toThrow(),
  )
  it('copies bounded immutable metadata and rejects host paths or text', () => {
    const s = copyPluginOutputSnapshot({
      ...outputSnapshot,
      warnings: [{ code: 'image-omitted', message: 'A local image was omitted' }],
    })
    expect(Object.isFrozen(s.warnings[0])).toBe(true)
    expect(Object.isFrozen(s)).toBe(true)
    for (const extra of [
      { text: 'private' },
      { path: '/tmp/private' },
      { warnings: Array(65).fill({ code: 'x', message: 'x' }) },
      { to: -1 },
    ])
      expect(() => copyPluginOutputSnapshot({ ...outputSnapshot, ...extra })).toThrow()
  })
  it('binds format, prevents foreign handles and consumes an output intent once', async () => {
    const t = outputSetup()
    const s = await t.broker.capture(outputRequest, trusted)
    await expect(t.broker.print(s.id)).rejects.toMatchObject({ code: 'invalid-token' })
    await expect(t.broker.write('foreign')).rejects.toMatchObject({ code: 'invalid-token' })
    const target = await t.broker.chooseTarget({ snapshotId: s.id })
    if (target.status !== 'ready') throw Error('missing target')
    await expect(t.broker.chooseTarget({ snapshotId: s.id })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    expect(await t.broker.write(target.id)).toMatchObject({ status: 'written', bytes: 123 })
    await expect(t.broker.write(target.id)).rejects.toMatchObject({ code: 'invalid-token' })
    expect(t.adapter.release).toHaveBeenCalledWith(s.id)
    expect(t.adapter.release).toHaveBeenCalledWith(target.id)
    await t.broker.release(s.id)
    t.broker.dispose()
  })
  it('supports one print request and cleans cancellation', async () => {
    const t = outputSetup()
    const s = await t.broker.capture({ ...outputRequest, format: 'print' }, trusted)
    await expect(t.broker.chooseTarget({ snapshotId: s.id })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    t.adapter.print.mockResolvedValueOnce({ status: 'cancelled' })
    expect(await t.broker.print(s.id)).toEqual({ status: 'cancelled' })
    await expect(t.broker.print(s.id)).rejects.toMatchObject({ code: 'invalid-token' })
    expect(t.adapter.release).toHaveBeenCalledWith(s.id)
    t.broker.dispose()
  })
  it('releases snapshot and target leases on picker cancellation, release and revoke', async () => {
    const t = outputSetup()
    const a = await t.broker.capture(outputRequest, trusted)
    t.adapter.chooseTarget.mockResolvedValueOnce({ status: 'cancelled' })
    expect(await t.broker.chooseTarget({ snapshotId: a.id })).toEqual({ status: 'cancelled' })
    expect(t.adapter.release).toHaveBeenCalledWith(a.id)
    const b = await t.broker.capture(outputRequest, trusted)
    const target = await t.broker.chooseTarget({ snapshotId: b.id })
    await t.broker.release(b.id)
    if (target.status === 'ready') expect(t.adapter.release).toHaveBeenCalledWith(target.id)
    const c = await t.broker.capture(outputRequest, trusted)
    t.revoke()
    await expect(t.broker.capture(outputRequest, trusted)).rejects.toMatchObject({
      code: 'revoked',
    })
    await flush()
    expect(t.adapter.release).toHaveBeenCalledWith(c.id)
  })
  it.each(['abort', 'dispose'] as const)('cleans late capture after %s', async (kind) => {
    const t = outputSetup(),
      wait = deferred<PluginOutputSnapshot>(),
      controller = new AbortController()
    t.adapter.capture.mockImplementationOnce(() => wait.promise)
    const pending = t.broker.capture(outputRequest, { ...trusted, signal: controller.signal })
    await flush()
    if (kind === 'abort') controller.abort()
    else t.broker.dispose()
    await expect(pending).rejects.toMatchObject({ code: kind === 'abort' ? 'aborted' : 'revoked' })
    expect(t.adapter.capture.mock.calls[0]![1]!.signal!.aborted).toBe(true)
    wait.resolve(outputSnapshot)
    await flush()
    expect(t.adapter.release).toHaveBeenCalledWith(outputSnapshot.id)
    t.broker.dispose()
  })
  it('keeps ignoring-cancellation captures in the concurrent operation budget', async () => {
    const t = outputSetup(),
      wait = deferred<PluginOutputSnapshot>()
    t.adapter.capture.mockImplementation(() => wait.promise)
    for (let i = 0; i < 8; i++) {
      const controller = new AbortController()
      const promise = t.broker.capture(outputRequest, { ...trusted, signal: controller.signal })
      await flush()
      controller.abort()
      await expect(promise).rejects.toMatchObject({ code: 'aborted' })
    }
    await expect(t.broker.capture(outputRequest, trusted)).rejects.toMatchObject({ code: 'busy' })
    wait.resolve(outputSnapshot)
    await flush()
    t.broker.dispose()
  })
  it('reserves capacity for targets before asynchronous pickers complete', async () => {
    const t = outputSetup()
    const snapshots = []
    for (let i = 0; i < 7; i++) snapshots.push(await t.broker.capture(outputRequest, trusted))
    const wait = deferred<{ status: 'ready'; id: string; name: string }>()
    t.adapter.chooseTarget.mockImplementationOnce(() => wait.promise)
    const pending = t.broker.chooseTarget({ snapshotId: snapshots[0]!.id })
    await flush()
    await expect(t.broker.chooseTarget({ snapshotId: snapshots[1]!.id })).rejects.toMatchObject({
      code: 'busy',
    })
    wait.resolve({ status: 'ready', id: 'reserved-target', name: 'a.html' })
    await pending
    t.broker.dispose()
  })
  it('cleans late picker targets and aborts work on snapshot release', async () => {
    const t = outputSetup(),
      wait = deferred<{ status: 'ready'; id: string; name: string }>()
    const s = await t.broker.capture(outputRequest, trusted)
    t.adapter.chooseTarget.mockImplementationOnce(() => wait.promise)
    const pending = t.broker.chooseTarget({ snapshotId: s.id })
    const rejection = expect(pending).rejects.toMatchObject({ code: 'aborted' })
    await flush()
    await t.broker.release(s.id)
    await rejection
    wait.resolve({ status: 'ready', id: 'late-target', name: 'late.html' })
    await flush()
    expect(t.adapter.release).toHaveBeenCalledWith('late-target')
    t.broker.dispose()
  })
  it.each(['abort', 'dispose'] as const)(
    'preserves already committed write success after %s',
    async (kind) => {
      const t = outputSetup(),
        controller = new AbortController()
      const s = await t.broker.capture(outputRequest, trusted)
      const target = await t.broker.chooseTarget({ snapshotId: s.id })
      if (target.status !== 'ready') throw Error('missing target')
      t.adapter.write.mockImplementationOnce(async () => {
        if (kind === 'abort') controller.abort()
        else t.broker.dispose()
        return { status: 'written', name: 'committed.html', bytes: 100 }
      })
      expect(await t.broker.write(target.id, { signal: controller.signal })).toEqual({
        status: 'written',
        name: 'committed.html',
        bytes: 100,
      })
      t.broker.dispose()
    },
  )
  it('sanitizes adapter errors and rejects stale snapshots without retrying mixed content', async () => {
    const t = outputSetup()
    t.adapter.capture.mockRejectedValueOnce(new PluginOutputError('stale'))
    await expect(t.broker.capture(outputRequest, trusted)).rejects.toMatchObject({ code: 'stale' })
    t.adapter.capture.mockRejectedValueOnce(Error('/private/source.md'))
    await expect(t.broker.capture(outputRequest, trusted)).rejects.toThrow(
      'Output operation failed: unavailable',
    )
    t.broker.dispose()
  })
  it('does not let public host options forge a gesture or outlive the capability', async () => {
    const adapter = outputAdapter()
    const broker = createPluginOutputBroker({
      manifest: outputManifest,
      adapter,
      consumeGesture: (proof) => proof === 'trusted',
    })
    let active = true
    const host = createPluginOutputHostCapabilities(broker, () => active)
    await expect(
      host.capture(outputRequest, { gesture: 'trusted' } as never),
    ).rejects.toMatchObject({ code: 'gesture-required' })
    active = false
    await expect(async () => host.capture(outputRequest)).rejects.toMatchObject({ code: 'revoked' })
    broker.dispose()
  })
})

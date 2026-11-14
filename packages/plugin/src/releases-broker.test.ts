import { describe, expect, it, vi } from 'vitest'
import { createPluginReleasesBroker, type PluginReleasesHost } from './releases-broker'
import type { PluginManifest } from './manifest'
import { PluginRuntime } from './runtime'

const manifest: PluginManifest = {
  id: 'release-test',
  name: 'Release Test',
  version: '1.0.0',
  permissions: ['app:updates'],
}
function adapter() {
  return {
    check: vi.fn(async () => ({
      configured: true,
      channel: 'stable',
      currentVersion: '1.0.0',
      release: {
        id: 'host-release-1',
        version: '2.0.0',
        notes: 'Changes',
        date: null,
        url: 'private',
        signingKey: 'private',
      },
      privatePath: 'private',
    })),
    stage: vi.fn(async (_id: string) => {}),
    status: vi.fn(async (_id: string) => ({ phase: 'ready' as const, received: 1, total: 1 })),
    cancel: vi.fn(async (_id: string) => {}),
    requestInstall: vi.fn(async (_id: string) => ({ status: 'cancelled' as const })),
  }
}

describe('managed releases capability', () => {
  it('requires permission and IDs issued by check, and strips private metadata', async () => {
    const host = adapter()
    const denied = createPluginReleasesBroker({
      manifest: { ...manifest, permissions: [] },
      adapter: host,
    })
    await expect(denied.check()).rejects.toThrow('app:updates')
    expect(host.check).not.toHaveBeenCalled()
    const broker = createPluginReleasesBroker({ manifest, adapter: host })
    await expect(broker.stage('host-release-1')).rejects.toThrow('Unknown')
    for (const id of ['https://example.org', '/tmp/update', '../update', '', 'x'.repeat(129)])
      await expect(broker.requestInstall(id)).rejects.toThrow('opaque')
    const result = await broker.check()
    expect(Object.keys(result)).toEqual(['configured', 'channel', 'currentVersion', 'release'])
    expect(Object.keys(result.release!)).toEqual(['id', 'version', 'notes', 'date'])
    await broker.stage(result.release!.id)
    expect(await broker.status(result.release!.id)).toEqual({
      phase: 'ready',
      received: 1,
      total: 1,
    })
    await broker.cancel(result.release!.id)
    expect(await broker.requestInstall(result.release!.id)).toEqual({ status: 'cancelled' })
    expect(host.stage).toHaveBeenCalledWith('host-release-1')
    expect(host.requestInstall).toHaveBeenCalledWith('host-release-1')
  })

  it('rejects captured methods, late results and all subsequent calls after revocation', async () => {
    let active = true
    const host = adapter()
    const onDispose = vi.fn()
    const broker = createPluginReleasesBroker({
      manifest,
      adapter: host,
      isActive: () => active,
      onDispose,
    })
    const { check, stage, status, cancel, requestInstall } = broker
    await check()
    let finish!: (result: Awaited<ReturnType<typeof host.check>>) => void
    host.check.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = check()
    active = false
    finish({
      configured: true,
      channel: 'stable',
      currentVersion: '1.0.0',
      privatePath: '',
      release: { id: 'late', version: '2.0.0', notes: '', date: null, url: '', signingKey: '' },
    })
    await expect(pending).rejects.toThrow('revoked')
    for (const method of [stage, status, cancel, requestInstall])
      await expect(method('host-release-1')).rejects.toThrow('revoked')
    broker.dispose()
    broker.dispose()
    expect(onDispose).toHaveBeenCalledTimes(1)
    active = true
    await expect(check()).rejects.toThrow('disposed')
  })

  it('exposes capabilities only to permitted runtime activations and seals old handles on re-enable', async () => {
    const host = adapter()
    const broker = createPluginReleasesBroker({ manifest, adapter: host })
    const provider = vi.fn(() => broker)
    const captured: (PluginReleasesHost | undefined)[] = []
    const runtime = new PluginRuntime({
      allowedPermissions: ['app:updates'],
      allowInProcessModules: true,
      releasesBroker: provider,
    })
    runtime.loadPlugin({
      manifest: { ...manifest, id: 'unprivileged', permissions: [] },
      module: {
        activate: ({ host }) => {
          captured.push(host.releases)
        },
      },
    })
    await runtime.enablePlugin('unprivileged')
    expect(captured.pop()).toBeUndefined()
    expect(provider).not.toHaveBeenCalled()
    runtime.loadPlugin({
      manifest,
      module: {
        activate: ({ host }) => {
          captured.push(host.releases)
        },
      },
    })
    await runtime.enablePlugin(manifest.id)
    const old = captured[0]!
    await old.check()
    await runtime.disablePlugin(manifest.id)
    await expect(old.check()).rejects.toThrow('revoked')
    await runtime.enablePlugin(manifest.id)
    await expect(old.check()).rejects.toThrow('revoked')
    await expect(captured[1]!.check()).resolves.toMatchObject({ configured: true })
    await runtime.unloadPlugin(manifest.id)
    await expect(captured[1]!.check()).rejects.toThrow('revoked')
  })
})

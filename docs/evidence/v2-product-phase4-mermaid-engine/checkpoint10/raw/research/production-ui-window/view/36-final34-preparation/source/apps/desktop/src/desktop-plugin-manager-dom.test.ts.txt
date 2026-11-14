import { ActionRegistry, MemoryDocumentSource } from '@milkup/core'
import { describe, expect, it, vi } from 'vitest'
import {
  DesktopPluginManager,
  type DesktopLoadedPluginModule,
  type DesktopPluginManagerOptions,
  type DesktopPluginModuleCapabilities,
  type DesktopDomPluginModuleLoader,
  type DesktopPreparedDomPluginModule,
} from './desktop-plugin-manager'

const pluginId = 'example.presentation'
function manifest() {
  return {
    id: pluginId,
    name: 'Presentation',
    version: '1.0.0',
    host: 'dom',
    main: 'dist/plugin.js',
    permissions: ['document:read'],
    contributes: {
      documentRenderers: [
        { id: 'example.graph', contexts: ['fence'], fenceLanguages: ['example-graph'] },
      ],
    },
  }
}

function fixture(
  options: {
    missingBackend?: boolean
    legacyPrepared?: boolean
    missingPreparation?: boolean
    host?: 'worker' | 'dom'
    loading?: () => Promise<void>
    deactivating?: (generation: number) => Promise<void>
  } = {},
) {
  const callbacks: DesktopPluginModuleCapabilities[] = []
  const activationHosts: unknown[] = []
  const disposals: number[] = []
  const preparedDisposed = vi.fn()
  const prepared: DesktopPreparedDomPluginModule = Object.freeze({
    kind: 'dom',
    leaseId: 'native-issued-test-lease',
    dispose: preparedDisposed,
  })
  const legacyPrepared = Object.freeze({
    specifier: '/untrusted/raw-or-module-path.js',
    dispose: preparedDisposed,
  })
  const workerLoader = vi.fn(async (): Promise<DesktopLoadedPluginModule> => {
    throw new Error('DOM incorrectly routed to Worker')
  })
  const sidecarLoader = vi.fn(async (): Promise<DesktopLoadedPluginModule> => {
    throw new Error('DOM incorrectly routed to sidecar')
  })
  const domLoader = vi.fn<DesktopDomPluginModuleLoader>(async (_manifest, _prepared, captured) => {
    const generation = callbacks.length
    callbacks.push(captured!)
    await options.loading?.()
    return {
      module: {
        runtimeHost: 'isolated',
        activate(context) {
          activationHosts.push(context.host)
          return {
            documentRenderers: { 'example.graph': () => ({ fragments: [], complete: true }) },
          }
        },
        deactivate: () => options.deactivating?.(generation),
      },
      dispose: () => {
        disposals.push(generation)
      },
    }
  })
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return values.size
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
  }
  const config: DesktopPluginManagerOptions = {
    actionRegistry: new ActionRegistry(),
    manifestHost: {
      selectManifestPath: async () => undefined,
      readManifestText: async () => JSON.stringify({ ...manifest(), host: options.host ?? 'dom' }),
      ...(!options.missingPreparation
        ? {
            prepareModule: async () => (options.legacyPrepared ? legacyPrepared : prepared),
          }
        : {}),
    },
    permissions: ['document:read'],
    milkupVersion: '2.0.0',
    pluginSdkVersion: '0.3.3',
    storage,
    documentSource: () =>
      new MemoryDocumentSource({
        documentId: 'private-doc',
        version: 1,
        text: 'Not a DOM host broker grant',
      }),
    invalidateUi: vi.fn(),
    loadModule: workerLoader,
    loadSidecarModule: sidecarLoader,
    ...(!options.missingBackend ? { loadDomModule: domLoader } : {}),
  }
  const manager = new DesktopPluginManager(config)
  async function install(approve = true) {
    const installed = await manager.installManifestPath('/installed/example/plugin.json')
    expect(installed.errors).toEqual([])
    if (approve) manager.approve(pluginId)
  }
  return {
    manager,
    install,
    callbacks,
    activationHosts,
    disposals,
    prepared,
    preparedDisposed,
    workerLoader,
    sidecarLoader,
    domLoader,
  }
}

describe('DesktopPluginManager DOM host routing and lifetime', () => {
  it('requires explicit DOM approval before preparing or loading its execution host', async () => {
    const f = fixture()
    await f.install(false)
    const denied = await f.manager.enable(pluginId)
    expect(denied.enabled).toBe(false)
    expect(denied.errors.join(' ')).toContain('host:dom')
    expect(f.domLoader).not.toHaveBeenCalled()
    f.manager.approve(pluginId)
    expect((await f.manager.enable(pluginId)).state).toBe('enabled')
    await f.manager.disable(pluginId)
  })

  it('passes the native prepared object directly and only lifecycle callbacks, never Worker or host brokers', async () => {
    const f = fixture()
    await f.install()
    expect((await f.manager.enable(pluginId)).state).toBe('enabled')
    expect(f.domLoader).toHaveBeenCalledTimes(1)
    expect(f.domLoader.mock.calls[0]?.[1]).toBe(f.prepared)
    expect(Object.keys(f.callbacks[0]!).sort()).toEqual([
      'onDocumentRenderTimeout',
      'onIsolationError',
    ])
    expect(f.activationHosts).toEqual([{}])
    expect(f.workerLoader).not.toHaveBeenCalled()
    expect(f.sidecarLoader).not.toHaveBeenCalled()
    expect(f.manager.state().contributions.documentRenderers).toMatchObject([
      { pluginId, id: 'example.graph' },
    ])
    await f.manager.remove(pluginId)
    expect(f.manager.state().records).toEqual([])
    expect(f.disposals).toEqual([0])
    expect(f.preparedDisposed).toHaveBeenCalledTimes(1)
  })

  it('reports an unavailable native DOM backend without falling back to another host', async () => {
    const f = fixture({ missingBackend: true })
    await f.install()
    const failed = await f.manager.enable(pluginId)
    expect(failed.state).toBe('failed')
    expect(failed.errors.join(' ')).toMatch(/DOM.*(?:not available|unavailable)/i)
    expect(f.workerLoader).not.toHaveBeenCalled()
    expect(f.sidecarLoader).not.toHaveBeenCalled()
    expect(f.manager.state().contributions.documentRenderers).toEqual([])
    expect(f.preparedDisposed).toHaveBeenCalledTimes(1)
  })

  it.each([{ legacyPrepared: true }, { missingPreparation: true }])(
    'never guesses a native lease from a specifier: %j',
    async (options) => {
      const f = fixture(options)
      await f.install()
      const failed = await f.manager.enable(pluginId)
      expect(failed.state).toBe('failed')
      expect(failed.errors.join(' ')).toMatch(/DOM|installed|lease/i)
      expect(f.domLoader).not.toHaveBeenCalled()
      expect(f.workerLoader).not.toHaveBeenCalled()
    },
  )

  it('rejects a native DOM lease returned for a Worker manifest before invoking either loader', async () => {
    const f = fixture({ host: 'worker' })
    await f.install()
    const failed = await f.manager.enable(pluginId)
    expect(failed.state).toBe('failed')
    expect(failed.errors.join(' ')).toMatch(/DOM prepared lease/)
    expect(f.domLoader).not.toHaveBeenCalled()
    expect(f.workerLoader).not.toHaveBeenCalled()
    expect(f.preparedDisposed).toHaveBeenCalledTimes(1)
  })

  it('serializes disable behind in-flight activation and disposes the prepared lease and resulting instance', async () => {
    let release!: () => void
    const loading = new Promise<void>((resolve) => {
      release = resolve
    })
    const f = fixture({ loading: () => loading })
    await f.install()
    const enabling = f.manager.enable(pluginId)
    await vi.waitFor(() => expect(f.domLoader).toHaveBeenCalledTimes(1))
    const disabling = f.manager.disable(pluginId)
    expect(f.disposals).toEqual([])
    release()
    await enabling
    await disabling
    expect(f.manager.state().records[0]?.enabled).toBe(false)
    expect(f.manager.state().contributions.documentRenderers).toEqual([])
    expect(f.disposals).toEqual([0])
    expect(f.preparedDisposed).toHaveBeenCalledTimes(1)
  })

  it.each(['onDocumentRenderTimeout', 'onIsolationError'] as const)(
    'ignores old %s after explicit re-enable',
    async (kind) => {
      const f = fixture()
      await f.install()
      await f.manager.enable(pluginId)
      const retired = f.callbacks[0]!
      await f.manager.disable(pluginId)
      await f.manager.enable(pluginId)
      if (kind === 'onIsolationError') retired[kind]!(new Error('old instance'))
      else retired[kind]!()
      expect(f.manager.state().records[0]?.state).toBe('enabled')
      expect(f.disposals).toEqual([0])
      await f.manager.disable(pluginId)
      expect(f.disposals).toEqual([0, 1])
    },
  )

  it('revokes a timed-out instance immediately and waits for its teardown before manual retry', async () => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    const teardown = vi.fn()
    const f = fixture({
      deactivating: async (generation) => {
        if (generation === 0) {
          teardown()
          await wait
        }
      },
    })
    await f.install()
    await f.manager.enable(pluginId)
    f.callbacks[0]!.onDocumentRenderTimeout!()
    expect(f.manager.state().records[0]?.state).toBe('failed')
    expect(f.manager.state().contributions.documentRenderers).toEqual([])
    await vi.waitFor(() => expect(teardown).toHaveBeenCalledTimes(1))
    const retry = f.manager.enable(pluginId)
    await Promise.resolve()
    expect(f.domLoader).toHaveBeenCalledTimes(1)
    release()
    expect((await retry).state).toBe('enabled')
    expect(f.disposals).toEqual([0])
    await f.manager.disable(pluginId)
  })
})

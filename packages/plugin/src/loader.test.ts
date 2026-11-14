import { describe, expect, it, vi } from 'vitest'

import { loadLocalPlugin } from './loader'
import { PluginRuntime } from './runtime'

describe('local plugin loader', () => {
  it('loads a manifest and imports the manifest main module through the host adapter', async () => {
    const command = vi.fn()
    const importModule = vi.fn(() => ({
      default: {
        commands: {
          'example.sayHello': command,
        },
      },
    }))

    const plugin = await loadLocalPlugin(
      {
        manifestPath: '/plugins/example/plugin.json',
      },
      {
        readText: (path) => {
          expect(path).toBe('/plugins/example/plugin.json')
          return JSON.stringify({
            id: 'example-plugin',
            name: 'Example Plugin',
            version: '1.0.0',
            main: './dist/plugin.js',
            permissions: ['document:read'],
            contributes: {
              commands: [
                {
                  id: 'example.sayHello',
                  title: 'Say Hello',
                  action: 'example.sayHello',
                },
              ],
            },
          })
        },
        importModule,
      },
    )

    expect(plugin).toMatchObject({
      manifestPath: '/plugins/example/plugin.json',
      moduleSpecifier: './dist/plugin.js',
      manifest: {
        id: 'example-plugin',
        main: './dist/plugin.js',
      },
    })
    expect(plugin.module?.commands?.['example.sayHello']).toBe(command)
    expect(importModule).toHaveBeenCalledWith('./dist/plugin.js', {
      manifest: plugin.manifest,
      manifestPath: '/plugins/example/plugin.json',
      moduleSpecifier: './dist/plugin.js',
    })
  })

  it('allows callers to override the module specifier for development reloads', async () => {
    const plugin = await loadLocalPlugin(
      {
        manifestPath: 'plugin.json',
        moduleSpecifier: 'http://127.0.0.1:5173/plugin.js',
      },
      {
        readText: () =>
          JSON.stringify({
            id: 'dev-plugin',
            name: 'Dev Plugin',
            version: '1.0.0',
            main: './dist/plugin.js',
          }),
        importModule: () => ({
          commands: {},
        }),
      },
    )

    expect(plugin.moduleSpecifier).toBe('http://127.0.0.1:5173/plugin.js')
  })

  it('loads manifest-only plugins when no module loader is supplied', async () => {
    const plugin = await loadLocalPlugin(
      {
        manifestPath: 'plugin.json',
      },
      {
        readText: () =>
          JSON.stringify({
            id: 'manifest-only',
            name: 'Manifest Only',
            version: '1.0.0',
          }),
      },
    )

    expect(plugin.manifest.id).toBe('manifest-only')
    expect(plugin.module).toBeUndefined()
    expect(plugin.moduleSpecifier).toBeUndefined()
  })

  it('does not import sidecar-hosted plugins through the local JS loader by default', async () => {
    const importModule = vi.fn(() => ({ commands: {} }))

    await expect(
      loadLocalPlugin(
        {
          manifestPath: 'plugin.json',
        },
        {
          readText: () =>
            JSON.stringify({
              id: 'sidecar-plugin',
              name: 'Sidecar Plugin',
              version: '1.0.0',
              host: 'sidecar',
              main: './dist/plugin.js',
            }),
          importModule,
        },
      ),
    ).rejects.toThrow('Plugin host is not supported by local loader: sidecar')
    expect(importModule).not.toHaveBeenCalled()
  })

  it('allows sidecar-hosted local imports only when the caller explicitly allows that host', async () => {
    const importModule = vi.fn(() => ({ commands: {} }))

    const plugin = await loadLocalPlugin(
      {
        manifestPath: 'plugin.json',
        allowedHosts: ['sidecar'],
      },
      {
        readText: () =>
          JSON.stringify({
            id: 'sidecar-plugin',
            name: 'Sidecar Plugin',
            version: '1.0.0',
            host: 'sidecar',
            main: './dist/plugin.js',
          }),
        importModule,
      },
    )

    expect(plugin.manifest.host).toBe('sidecar')
    expect(plugin.moduleSpecifier).toBe('./dist/plugin.js')
    expect(importModule).toHaveBeenCalledTimes(1)
  })

  it('reports invalid manifest JSON with the manifest path', async () => {
    await expect(
      loadLocalPlugin(
        {
          manifestPath: '/bad/plugin.json',
        },
        {
          readText: () => '{bad',
        },
      ),
    ).rejects.toThrow('Invalid plugin manifest JSON at /bad/plugin.json')
  })
})

describe('plugin host capabilities', () => {
  it('exposes only host capabilities declared by the plugin manifest', async () => {
    const runtime = new PluginRuntime({
      allowInProcessModules: true,
      allowedPermissions: ['file:read', 'network:access'],
      host: {
        readText: () => 'file',
        writeText: () => undefined,
        fetch: () => 'network',
      },
    })
    const activate = vi.fn()

    runtime.loadPlugin({
      manifest: {
        id: 'capability-plugin',
        name: 'Capability Plugin',
        version: '1.0.0',
        permissions: ['file:read'],
      },
      module: {
        activate,
      },
    })

    await runtime.enablePlugin('capability-plugin')

    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate.mock.calls[0]?.[0].host.readText).toBeTypeOf('function')
    expect(activate.mock.calls[0]?.[0].host.writeText).toBeUndefined()
    expect(activate.mock.calls[0]?.[0].host.fetch).toBeUndefined()
  })
})

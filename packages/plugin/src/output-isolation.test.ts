import { describe, it, expect } from 'vitest'
import { createBrowserWorkerPluginHost, initializePluginWorkerRealm } from './isolation-worker'
import { createSidecarPluginModule } from './isolation-sidecar'
import { createPluginIsolationRpcServer } from './isolation-rpc'
import { PluginRuntime, type PluginCommandContext } from './runtime'
import { type PluginOutputHost, createPluginOutputBroker } from './output-broker'
import { createRpcPluginOutputBroker } from './output-rpc'
import { outputManifest, outputAdapter, outputRequest } from './output-test-helpers'
import { pair, flush } from './settings-test-helpers'
describe('output isolation wiring', () => {
  it.each([true, false])(
    'worker capability declared=%s, with trusted command transport and revoke',
    async (allowed) => {
      const p = pair(),
        adapter = outputAdapter()
      const manifest = {
        ...outputManifest,
        permissions: allowed ? outputManifest.permissions : [],
        contributes: {
          commands: [{ id: 'output.capture', action: 'output.capture', title: 'Capture' }],
        },
      }
      const broker = createPluginOutputBroker({
        manifest,
        adapter,
        consumeGesture: (proof) => proof === 'trusted',
      })
      let captured: { output?: PluginOutputHost } | undefined
      const realm = initializePluginWorkerRealm(p.worker, {
        timeoutMs: 5,
        importModule: async () => ({
          activate: ({ host }: { host: typeof captured }) => {
            captured = host
          },
          commands: {
            'output.capture': (context: PluginCommandContext) =>
              context.host.output?.capture(outputRequest),
          },
        }),
      })
      const host = createBrowserWorkerPluginHost({
        worker: p.main,
        manifest,
        moduleSpecifier: './output.js',
        outputBroker: broker,
      })
      await host.ready
      await host.host.activate({
        pluginId: manifest.id,
        manifest,
        permissions: manifest.permissions,
        hostCapabilities: ['document:output'],
      })
      if (allowed) {
        await expect(captured!.output!.capture(outputRequest)).rejects.toMatchObject({
          code: 'gesture-required',
        })
        // The realm's five-millisecond generic timeout must not shorten output RPC.
        adapter.capture.mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          return {
            id: 'snapshot-1',
            documentId: 'doc:1',
            version: 1,
            title: 'A',
            from: 0,
            to: 1,
            lineCount: 1,
            warnings: [],
          }
        })
        const result = await host.host.runCommand({
          pluginId: manifest.id,
          command: manifest.contributes.commands[0]!,
          input: {},
          permissions: manifest.permissions,
          hostCapabilities: ['document:output'],
          workspaceGesture: 'trusted',
        })
        expect(result.value).toMatchObject({ id: 'snapshot-1' })
        await host.host.deactivate({ pluginId: manifest.id })
        await expect(async () => captured!.output!.capture(outputRequest)).rejects.toMatchObject({
          code: 'revoked',
        })
      } else {
        expect(captured!.output).toBeUndefined()
        p.worker.postMessage({
          protocol: 'milkup.plugin.output.rpc.v1',
          type: 'request',
          id: 'forged',
          method: 'capture',
          payload: { request: outputRequest, gesture: 'trusted' },
        })
        await flush()
        expect(adapter.capture).not.toHaveBeenCalled()
      }
      host.dispose()
      realm.dispose()
      broker.dispose()
      await flush()
      expect(p.main.listeners.size + p.worker.listeners.size).toBe(0)
    },
  )
  it('sidecar shutdown closes the output RPC and releases leases', async () => {
    const p = pair(),
      adapter = outputAdapter(),
      manifest = { ...outputManifest, host: 'sidecar' as const }
    const broker = createPluginOutputBroker({ manifest, adapter, consumeGesture: () => true })
    const server = createPluginIsolationRpcServer(p.worker, {
      activate: () => ({}),
      deactivate: () => {},
      runCommand: () => ({}),
      render: () => '',
      dispose: () => {},
    })
    const runtime = new PluginRuntime({
      allowedHosts: ['sidecar'],
      allowedPermissions: manifest.permissions,
      outputBroker: broker,
    })
    runtime.loadPlugin({
      manifest,
      module: createSidecarPluginModule({
        manifest,
        process: { start: () => p.main },
        outputBroker: broker,
      }),
    })
    await runtime.enablePlugin(manifest.id)
    const client = createRpcPluginOutputBroker(p.worker)
    const s = await client.capture(outputRequest, { gesture: 'trusted' })
    await runtime.unloadPlugin(manifest.id)
    await flush()
    expect(adapter.release).toHaveBeenCalledWith(s.id)
    await expect(client.capture(outputRequest, { gesture: 'trusted' })).rejects.toMatchObject({
      code: 'revoked',
    })
    client.dispose()
    server.dispose()
    broker.dispose()
  })
})

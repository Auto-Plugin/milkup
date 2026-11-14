import { describe, it, expect, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { copyDocumentPresentationRequest, serializeDocumentPresentationNode } from '@milkup/core'
import { createDocumentRenderRpcClient, createDocumentRenderRpcServer } from './document-render-rpc'
import { createPluginModuleIsolationHost } from './isolation-module-host'
import { createBrowserWorkerPluginHost } from './isolation-worker'
import { createSidecarPluginModule } from './isolation-sidecar'
import { createPluginIsolationRpcServer } from './isolation-rpc'
import { createIsolatedPluginModule } from './isolation'
import { PluginRuntime } from './runtime'
import { parsePluginManifest } from './manifest'
import { PluginRegistry, parsePluginRegistrySnapshot, serializePluginRegistry } from './registry'
function input() {
  return copyDocumentPresentationRequest({
    documentId: 'doc',
    version: 1,
    from: 0,
    to: 5,
    source: 'hello',
    fromLine: 1,
    toLine: 1,
    completeStart: true,
    completeEnd: true,
    contextKnown: true,
    protectedRanges: [],
    blocks: [],
    selection: { anchor: 0, head: 0 },
    theme: 'light',
    target: 'screen',
    width: 400,
  })
}
function output() {
  return {
    fragments: [
      {
        from: 0,
        to: 5,
        layout: 'inline' as const,
        content: { type: 'text' as const, text: 'hello' },
        accessibleText: 'hello',
      },
    ],
    complete: true,
  }
}
const manifest = parsePluginManifest({
  id: 'test.renderer',
  name: 'Renderer',
  version: '1.0.0',
  permissions: ['document:read'],
  contributes: { documentRenderers: [{ id: 'test', contexts: ['text'] }] },
})
const payload = () => ({ pluginId: manifest.id, rendererId: 'test', request: input() })
function pair() {
  const a = new Set<(v: unknown) => void>(),
    b = new Set<(v: unknown) => void>()
  return {
    main: {
      postMessage: (v: unknown) => {
        for (const f of b) f(v)
      },
      on: (_: string, f: (v: unknown) => void) => {
        a.add(f)
      },
      off: (_: string, f: (v: unknown) => void) => {
        a.delete(f)
      },
    },
    worker: {
      postMessage: (v: unknown) => {
        for (const f of a) f(v)
      },
      on: (_: string, f: (v: unknown) => void) => {
        b.add(f)
      },
      off: (_: string, f: (v: unknown) => void) => {
        b.delete(f)
      },
    },
  }
}
const activation = {
  pluginId: manifest.id,
  manifest,
  permissions: manifest.permissions ?? [],
  hostCapabilities: [],
}
describe('bounded document render isolation', () => {
  it('roundtrips through a declared provider and rejects late completion after deactivate', async () => {
    let finish!: () => void
    const host = createPluginModuleIsolationHost({
      manifest,
      module: {
        documentRenderers: {
          test: async () => {
            await new Promise<void>((r) => (finish = r))
            return output()
          },
        },
      },
    })
    await host.activate(activation)
    const p = host.renderDocument!(payload())
    await host.deactivate({ pluginId: manifest.id })
    finish()
    await expect(p).rejects.toMatchObject({ code: 'revoked' })
  })
  it('requires both declaration and read permission', async () => {
    const host = createPluginModuleIsolationHost({
      manifest,
      module: { documentRenderers: { evil: () => output() } },
    })
    await host.activate(activation)
    await expect(host.renderDocument!({ ...payload(), rendererId: 'evil' })).rejects.toMatchObject({
      code: 'unavailable',
    })
  })
  it('cancels with realm-local signal and waits for remote settlement before advancing queue', async () => {
    const endpoints = pair()
    let signal: AbortSignal | undefined, finish!: () => void
    const fn = vi.fn(async (_r: unknown, o?: { signal?: AbortSignal }) => {
      signal = o?.signal
      await new Promise<void>((r) => (finish = r))
      return output()
    })
    const server = createDocumentRenderRpcServer(endpoints.worker, {
      activate: () => ({}),
      deactivate: () => {},
      runCommand: () => ({}),
      render: () => null,
      renderDocument: fn,
    })
    const timeout = vi.fn(),
      client = createDocumentRenderRpcClient(endpoints.main, timeout),
      abort = new AbortController()
    const first = client.render(payload(), { signal: abort.signal })
    await Promise.resolve()
    const second = client.render(payload())
    abort.abort()
    await expect(first).rejects.toMatchObject({ code: 'aborted' })
    expect(signal?.aborted).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
    finish()
    await new Promise((r) => setTimeout(r, 0))
    expect(fn).toHaveBeenCalledTimes(2)
    finish()
    await expect(second).resolves.toEqual(output())
    expect(timeout).not.toHaveBeenCalled()
    client.dispose()
    server.dispose()
  })
  it('bounds queued work and disposes outstanding callers', async () => {
    const endpoints = pair(),
      client = createDocumentRenderRpcClient(endpoints.main, () => {})
    const pending = [client.render(payload()), client.render(payload()), client.render(payload())]
    const rejected = pending.map((p) => expect(p).rejects.toMatchObject({ code: 'revoked' }))
    await expect(client.render(payload())).rejects.toMatchObject({ code: 'busy' })
    client.dispose()
    await Promise.all(rejected)
  })
  it('retains watchdog after caller cancellation of uncooperative work', async () => {
    vi.useFakeTimers()
    try {
      const endpoints = pair(),
        stop = vi.fn(),
        client = createDocumentRenderRpcClient(endpoints.main, stop),
        controller = new AbortController()
      const job = client.render(payload(), { signal: controller.signal })
      controller.abort()
      await expect(job).rejects.toMatchObject({ code: 'aborted' })
      await vi.advanceTimersByTimeAsync(2000)
      expect(stop).toHaveBeenCalledTimes(1)
      await expect(client.render(payload())).rejects.toMatchObject({ code: 'revoked' })
      client.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
  it('rejects malformed method payload without dispatch', async () => {
    const endpoints = pair(),
      render = vi.fn(async () => output()),
      server = createDocumentRenderRpcServer(endpoints.worker, {
        activate: () => ({}),
        deactivate: () => {},
        runCommand: () => ({}),
        render: () => null,
        renderDocument: render,
      })
    endpoints.main.postMessage({
      protocol: 'milkup.plugin.document-render.v1',
      type: 'render',
      id: 'x',
      payload: { ...payload(), method: 'exec' },
    })
    await Promise.resolve()
    expect(render).not.toHaveBeenCalled()
    server.dispose()
  })
  it('terminates an actual CPU-blocked worker, revokes capabilities and marks runtime disabled', async () => {
    const worker = new Worker(
      `const {parentPort}=require('node:worker_threads');parentPort.on('message',m=>{if(m.protocol==='milkup.plugin.worker.init.v1')parentPort.postMessage({protocol:m.protocol,type:'ready'});else if(m.protocol==='milkup.plugin.isolation.rpc.v1')parentPort.postMessage({protocol:m.protocol,type:'response',id:m.id,ok:true,value:m.method==='activate'?{documentRenderers:['test']}:undefined});else if(m.protocol==='milkup.plugin.document-render.v1'&&m.type==='render'){while(true){}}});`,
      { eval: true },
    )
    let stopped = false
    const endpoint = {
      postMessage: (m: unknown) => worker.postMessage(m),
      on: (_: 'message', f: (m: unknown) => void) => {
        worker.on('message', f)
      },
      off: (_: 'message', f: (m: unknown) => void) => {
        worker.off('message', f)
      },
      terminate: () => {
        stopped = true
        void worker.terminate()
      },
    }
    const callback = vi.fn(),
      browser = createBrowserWorkerPluginHost({
        worker: endpoint,
        manifest,
        moduleSpecifier: 'unused',
        onDocumentRenderTimeout: callback,
      })
    try {
      await browser.ready
      const runtime = new PluginRuntime({ allowedPermissions: ['document:read'] })
      runtime.loadPlugin({
        manifest,
        module: createIsolatedPluginModule({ manifest, host: browser.host }),
      })
      await runtime.enablePlugin(manifest.id)
      await expect(runtime.renderDocument(manifest.id, 'test', input())).rejects.toMatchObject({
        code: 'timeout',
      })
      expect(stopped).toBe(true)
      expect(callback).toHaveBeenCalledOnce()
      await expect(runtime.renderDocument(manifest.id, 'test', input())).rejects.toMatchObject({
        code: 'unavailable',
      })
      await expect(browser.host.activate(activation)).rejects.toThrow('disposed')
    } finally {
      browser.dispose()
      await worker.terminate()
    }
  }, 6000)
  it('stops an unresponsive owned sidecar and revokes the host on watchdog timeout', async () => {
    vi.useFakeTimers()
    const endpoints = pair(),
      stop = vi.fn(),
      notify = vi.fn()
    const remote = createPluginModuleIsolationHost({
      manifest,
      module: { documentRenderers: { test: () => new Promise(() => {}) } },
    })
    const server = createPluginIsolationRpcServer(endpoints.worker, remote)
    const module = createSidecarPluginModule({
      manifest,
      process: { start: () => endpoints.main, stop },
      onDocumentRenderTimeout: notify,
    })
    const runtime = new PluginRuntime({ allowedPermissions: ['document:read'] })
    try {
      runtime.loadPlugin({ manifest, module })
      await runtime.enablePlugin(manifest.id)
      const pending = runtime.renderDocument(manifest.id, 'test', input())
      const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' })
      await vi.advanceTimersByTimeAsync(2000)
      await rejected
      expect(stop).toHaveBeenCalledOnce()
      expect(notify).toHaveBeenCalledOnce()
      expect(runtime.getPlugin(manifest.id)?.state).toBe('disabled')
    } finally {
      server.dispose()
      vi.useRealTimers()
    }
  })
  it('serializes inert MathML/vectors and escapes text without plugin markup', () => {
    expect(
      serializeDocumentPresentationNode({
        type: 'math',
        tree: { tag: 'math', children: [{ tag: 'mi', text: '<x>' }] },
      }),
    ).toContain('&lt;x&gt;')
    expect(() =>
      serializeDocumentPresentationNode({
        type: 'math',
        tree: { tag: 'math', attributes: { onclick: 'evil' } },
      }),
    ).toThrow()
    expect(
      serializeDocumentPresentationNode(
        {
          type: 'reference',
          label: '<a>',
          target: { documentId: 'doc', version: 1, from: 20, to: 22 },
        },
        input(),
      ),
    ).toBe('<span data-source-from="20" data-source-to="22">&lt;a&gt;</span>')
  })
  it.each(['outline', 'updates', 'workspace', 'preferences', 'shortcuts', 'formatting', 'images'])(
    'restores installed %s from 0.3.2 into 0.3.3 unchanged',
    (name) => {
      const manifest = JSON.parse(
        readFileSync(new URL(`../../../plugins/${name}/plugin.json`, import.meta.url), 'utf8'),
      )
      for (const enabled of [false, true]) {
        const old = new PluginRegistry({
          compatibility: { milkupVersion: '2.0.0-beta.1', pluginSdkVersion: '0.3.2' },
          now: () => 1,
        })
        old.installLocalPlugin({ manifest, manifestPath: `/plugins/${name}/plugin.json` })
        if (enabled) {
          old.approve(manifest.id)
          old.markEnabled(manifest.id)
        }
        const before = parsePluginRegistrySnapshot(serializePluginRegistry(old))
        const upgraded = new PluginRegistry({
          compatibility: { milkupVersion: '2.0.0-beta.1', pluginSdkVersion: '0.3.3' },
          now: () => 2,
        })
        upgraded.restore(before)
        expect(upgraded.get(manifest.id)).toEqual(old.get(manifest.id))
      }
    },
  )
})

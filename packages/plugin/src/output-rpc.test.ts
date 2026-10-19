import { describe, it, expect, vi } from 'vitest'
import { createPluginOutputRpcServer, createRpcPluginOutputBroker } from './output-rpc'
import { PluginOutputError, type PluginOutputSnapshot } from './output-broker'
import { outputSetup, outputRequest, outputSnapshot } from './output-test-helpers'
import { pair, deferred, flush } from './settings-test-helpers'
function setup(timeout?: number) {
  const p = pair(),
    t = outputSetup()
  const server = createPluginOutputRpcServer(p.main, t.broker)
  const client = createRpcPluginOutputBroker(p.worker, timeout)
  const close = () => {
    client.dispose()
    server.dispose()
    t.broker.dispose()
  }
  return { ...p, ...t, server, client, close }
}
describe('output RPC', () => {
  it('reclaims a lease when cancellation races with an already sent response', async () => {
    const t = setup(),
      controller = new AbortController()
    const send = t.main.postMessage.bind(t.main)
    let delayed: unknown
    t.main.postMessage = (value) => {
      delayed = value
    }
    const pending = t.client.capture(outputRequest, {
      gesture: 'trusted',
      signal: controller.signal,
    })
    await flush()
    expect(delayed).toBeDefined()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    await flush()
    expect(t.adapter.release).toHaveBeenCalledWith(outputSnapshot.id)
    send(delayed)
    t.main.postMessage = send
    t.close()
  })
  it('roundtrips closed metadata and controlled targets, never paths or HTML', async () => {
    const t = setup()
    const s = await t.client.capture(outputRequest, { gesture: 'trusted' })
    expect(s).toEqual(outputSnapshot)
    const target = await t.client.chooseTarget({ snapshotId: s.id })
    if (target.status !== 'ready') throw Error('target missing')
    expect(await t.client.write(target.id)).toMatchObject({ status: 'written' })
    await t.client.release(s.id)
    expect(t.main.sent.some((v) => JSON.stringify(v).includes('snapshot-1'))).toBe(true)
    t.close()
    await flush()
    expect(t.main.listeners.size + t.worker.listeners.size).toBe(0)
  })
  it.each(['abort', 'timeout', 'dispose'] as const)(
    '%s cancels real capture and cleans a late snapshot',
    async (kind) => {
      vi.useFakeTimers()
      try {
        const t = setup(50),
          wait = deferred<PluginOutputSnapshot>(),
          controller = new AbortController()
        t.adapter.capture.mockImplementationOnce(() => wait.promise)
        const pending = t.client.capture(outputRequest, {
          gesture: 'trusted',
          signal: controller.signal,
        })
        const rejected = expect(pending).rejects.toMatchObject({
          code: kind === 'dispose' ? 'revoked' : 'aborted',
        })
        await flush()
        if (kind === 'abort') controller.abort()
        else if (kind === 'dispose') t.client.dispose()
        else await vi.advanceTimersByTimeAsync(51)
        await rejected
        await flush()
        expect(t.adapter.capture.mock.calls[0]![1]!.signal!.aborted).toBe(true)
        wait.resolve(outputSnapshot)
        await flush()
        expect(t.adapter.release).toHaveBeenCalledWith(outputSnapshot.id)
        t.close()
      } finally {
        vi.useRealTimers()
      }
    },
  )
  it.each(['abort', 'timeout'] as const)(
    'waits for committed write acknowledgement after %s',
    async (kind) => {
      vi.useFakeTimers()
      try {
        const t = setup(50),
          wait = deferred<{ status: 'written'; name: string; bytes: number }>(),
          controller = new AbortController()
        const s = await t.client.capture(outputRequest, { gesture: 'trusted' })
        const target = await t.client.chooseTarget({ snapshotId: s.id })
        if (target.status !== 'ready') throw Error('target missing')
        t.adapter.write.mockImplementationOnce(() => wait.promise)
        const pending = t.client.write(target.id, { signal: controller.signal })
        await flush()
        if (kind === 'abort') controller.abort()
        else await vi.advanceTimersByTimeAsync(51)
        await flush()
        expect(t.adapter.write.mock.calls[0]![1]!.signal!.aborted).toBe(true)
        wait.resolve({ status: 'written', name: 'done.html', bytes: 500 })
        expect(await pending).toEqual({ status: 'written', name: 'done.html', bytes: 500 })
        t.close()
      } finally {
        vi.useRealTimers()
      }
    },
  )
  it('returns a confirmed precommit abort rather than waiting forever for a suppressed error', async () => {
    const t = setup(),
      controller = new AbortController()
    const s = await t.client.capture({ ...outputRequest, format: 'print' }, { gesture: 'trusted' })
    t.adapter.print.mockImplementationOnce(
      (_id, options) =>
        new Promise((_, reject) => {
          options!.signal!.addEventListener(
            'abort',
            () => reject(new PluginOutputError('aborted')),
            { once: true },
          )
        }),
    )
    const pending = t.client.print(s.id, { signal: controller.signal })
    await flush()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    t.close()
  })
  it('rejects forged envelopes before invoking adapters and strips private errors', async () => {
    const t = setup()
    t.worker.postMessage({
      protocol: 'milkup.plugin.output.rpc.v1',
      type: 'request',
      id: 'forged',
      method: 'capture',
      payload: { request: { ...outputRequest, path: '/private.md' }, gesture: 'trusted' },
    })
    await flush()
    expect(t.adapter.capture).not.toHaveBeenCalled()
    expect(t.main.sent).toContainEqual({
      protocol: 'milkup.plugin.output.rpc.v1',
      type: 'response',
      id: 'forged',
      ok: false,
      error: { code: 'invalid-input' },
    })
    t.adapter.capture.mockRejectedValueOnce(Error('secret path'))
    await expect(t.client.capture(outputRequest, { gesture: 'trusted' })).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(JSON.stringify(t.main.sent)).not.toContain('secret path')
    t.close()
  })
  it('server shutdown releases returned snapshot and target leases and revokes the client', async () => {
    const t = setup()
    const s = await t.client.capture(outputRequest, { gesture: 'trusted' })
    const target = await t.client.chooseTarget({ snapshotId: s.id })
    t.server.dispose()
    await flush()
    expect(t.adapter.release).toHaveBeenCalledWith(s.id)
    if (target.status === 'ready') expect(t.adapter.release).toHaveBeenCalledWith(target.id)
    await expect(t.client.capture(outputRequest, { gesture: 'trusted' })).rejects.toMatchObject({
      code: 'revoked',
    })
    t.close()
  })
})

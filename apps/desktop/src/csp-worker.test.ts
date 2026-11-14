import { afterEach, expect, it, vi } from 'vitest'
import { assertPluginWorkerCsp, createCspWorker } from './csp-worker'
afterEach(() => vi.unstubAllGlobals())
it('fails closed unless both actual dynamic-code probes throw EvalError', () => {
  const blocked = () => {
    throw new EvalError('CSP')
  }
  expect(() => assertPluginWorkerCsp(blocked, blocked)).not.toThrow()
  expect(() => assertPluginWorkerCsp(() => 1, blocked)).toThrow('requires CSP')
  expect(() => assertPluginWorkerCsp(blocked, () => 1)).toThrow('requires CSP')
  expect(() =>
    assertPluginWorkerCsp(() => {
      throw new Error('unrelated')
    }, blocked),
  ).toThrow('requires CSP')
})
it('starts only the trusted bootstrap in a blob module and revokes its URL once on termination', async () => {
  const blobs: Blob[] = [],
    revoked: string[] = [],
    terminated = vi.fn()
  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      blobs.push(blob)
      return 'blob:trusted'
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  })
  const options: unknown[] = []
  vi.stubGlobal(
    'Worker',
    class {
      constructor(...args: unknown[]) {
        options.push(args)
      }
      terminate = terminated
    },
  )
  const worker = createCspWorker('https://app.test/assets/bootstrap.js', 'trial')
  expect(options).toEqual([['blob:trusted', { type: 'module', name: 'trial' }]])
  expect(await blobs[0]!.text()).toBe('import "https://app.test/assets/bootstrap.js";')
  worker.terminate()
  worker.terminate()
  expect(terminated).toHaveBeenCalledOnce()
  expect(revoked).toEqual(['blob:trusted'])
})
it('reclaims the blob URL if Worker construction fails', () => {
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:failed', revokeObjectURL: revoke })
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw new Error('denied')
      }
    },
  )
  expect(() => createCspWorker('https://app.test/bootstrap.js', 'trial')).toThrow('denied')
  expect(revoke).toHaveBeenCalledWith('blob:failed')
})

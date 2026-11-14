import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Replay the exact private harness functions with fake /proc and process.kill.
// Importing the entry-point module itself would launch the native acceptance run.
const source = readFileSync(
  new URL('../native/tauri-beta7-appearance-check.mjs', import.meta.url),
  'utf8',
)
const alive = source.slice(
  source.indexOf('  const alive = async'),
  source.indexOf('  const findExactLaunchProcesses = async'),
)
const signal = source.slice(
  source.indexOf('  const signalExactLaunch = async'),
  source.indexOf('  const closeSession = async'),
)
const binary = '/tmp/owned-test/milkup',
  documentPath = '/tmp/owned-test/fixture.md'
const argv = [binary, documentPath, '']
const stat = (state = 'S', birth = '100') =>
  `123 (owned process) ${[state, ...Array(18).fill('0'), birth].join(' ')}`
const gone = () => Object.assign(new Error('gone'), { code: 'ENOENT' })
function setup(states: Array<string | Error>, cmdline: string | Error = '') {
  const identity = { pid: 123, birth: '100', argv: [...argv] }
  const cleanup: Array<Record<string, unknown>> = []
  const kill = vi.fn()
  let reads = 0
  const readFile = vi.fn(async (file: string) => {
    if (file.endsWith('/cmdline')) {
      if (cmdline instanceof Error) throw cmdline
      return cmdline
    }
    expect(file).toBe('/proc/123/stat')
    const value = states[Math.min(reads++, states.length - 1)]!
    if (value instanceof Error) throw value
    return value
  })
  const make = new Function(
    'readFile',
    'assert',
    'binary',
    'documentPath',
    'process',
    'cleanup',
    'setTimeout',
    'Date',
    alive + signal + '\nreturn signalExactLaunch;',
  )
  const run: (target: typeof identity, signal: string) => Promise<void> = make(
    readFile,
    assert,
    binary,
    documentPath,
    { kill },
    cleanup,
    setTimeout,
    Date,
  )
  return { identity, cleanup, kill, readFile, run: () => run(identity, 'SIGTERM') }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it.each(['Z', 'X'])(
  'waits read-only for empty cmdline to become exited state %s',
  async (state) => {
    const test = setup([stat(), stat('R'), stat(state)])
    const done = test.run()
    await vi.advanceTimersByTimeAsync(49)
    expect(test.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(test.kill).not.toHaveBeenCalled()
    expect(test.cleanup.map((row) => row.phase)).toEqual([
      'empty-cmdline-exit-observation',
      'owned-generation-ended-without-signal',
    ])
  },
)
it.each(['disappeared', 'different birth'])(
  'does not signal when the original generation is %s during the wait',
  async (change) => {
    const test = setup([stat(), stat(), change === 'disappeared' ? gone() : stat('S', '101')])
    const done = test.run()
    await vi.advanceTimersByTimeAsync(50)
    await done
    expect(test.kill).not.toHaveBeenCalled()
    expect(test.cleanup.at(-1)?.phase).toBe('owned-generation-ended-without-signal')
  },
)
it('fails after the one-second bound if empty cmdline remains live, with no signal', async () => {
  const test = setup([stat()])
  const result = test.run().then(
    () => null,
    (error) => error as Error,
  )
  await vi.advanceTimersByTimeAsync(999)
  expect(test.kill).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(await result).toBeInstanceOf(Error)
  expect((await result)?.message).toContain('same process generation remains live after 1000ms')
  expect(test.kill).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  expect(test.cleanup.map((row) => row.phase)).toEqual(['empty-cmdline-exit-observation'])
})
it('still refuses a nonempty unexpected argv immediately', async () => {
  const test = setup([stat()], '/tmp/unowned\0other.md\0')
  await expect(test.run()).rejects.toThrow('Recheck exact owned launch argv')
  expect(test.kill).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  expect(test.cleanup).toEqual([])
})
it('preserves the exact argv and birth checks before the ordinary signal path', async () => {
  const test = setup([stat()], argv.join('\0'))
  await test.run()
  expect(test.kill).toHaveBeenCalledExactlyOnceWith(123, 'SIGTERM')
  expect(test.cleanup[0]).toMatchObject({ pid: 123, birth: '100', signal: 'SIGTERM' })
  expect(vi.getTimerCount()).toBe(0)
})
it('skips a different generation before reading argv and handles vanished cmdline without signalling', async () => {
  const reused = setup([stat('S', '101')], argv.join('\0'))
  await reused.run()
  expect(reused.readFile).toHaveBeenCalledTimes(1)
  expect(reused.kill).not.toHaveBeenCalled()
  const vanished = setup([stat()], gone())
  await vanished.run()
  expect(vanished.kill).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

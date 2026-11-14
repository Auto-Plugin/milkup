import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  tree: '',
  vanished: false,
  treeRaces: 0,
  identities: new Map<number, string>(),
}))
vi.mock('node:child_process', () => ({
  execFileSync: (command: string, args: string[]) => {
    if (command === 'xwininfo') {
      if (mock.treeRaces-- > 0)
        throw Object.assign(new Error('tree changed'), { stderr: 'Bad Drawable' })
      return mock.tree
    }
    if (mock.vanished) throw Object.assign(new Error('xprop failed'), { stderr: 'BadWindow' })
    return `_NET_WM_PID(CARDINAL) = ${parseInt(args[1]!, 16)}`
  },
}))
vi.mock('node:fs', () => ({
  readFileSync: (path: string) => {
    const pid = Number(path.split('/')[2])
    if (path.endsWith('/cmdline')) return '/test/milkup\0'
    return `${pid} (milkup with spaces) ${['S', ...Array(18).fill('0'), mock.identities.get(pid)].join(' ')}`
  },
}))
import {
  beginNativeStartup,
  waitForNativeWindow,
  cleanupNativeApplication,
  nativeRequestTimeout,
} from './native-startup.mjs'
const window = (pid: number) =>
  `0x${pid.toString(16)} "milkup": ("milkup-desktop" "milkup-desktop")`
let kill: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  mock.tree = ''
  mock.vanished = false
  mock.treeRaces = 0
  mock.identities.clear()
  vi.stubEnv('MILKUP_NATIVE_EXCLUSIVE_DISPLAY', '1')
  kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('keeps startup and normal interaction deadlines separate', () => {
  expect(nativeRequestTimeout('POST', '/session')).toBe(60000)
  expect(nativeRequestTimeout('POST', '/session/id/execute/sync')).toBe(20000)
})
it('only cleans a new process with the same executable and birth time', async () => {
  mock.tree = window(100)
  const started = beginNativeStartup()
  mock.tree = `0x64 "hidden": ("milkup-desktop" "milkup-desktop")\n${window(200)}`
  mock.identities.set(200, 'birth1')
  await waitForNativeWindow(started)
  cleanupNativeApplication('/test/milkup')
  expect(kill).toHaveBeenCalledExactlyOnceWith(200, 'SIGTERM')
})
it('never kills automatically on a shared display', async () => {
  const started = beginNativeStartup()
  mock.tree = window(200)
  mock.identities.set(200, 'birth1')
  await waitForNativeWindow(started)
  vi.stubEnv('MILKUP_NATIVE_EXCLUSIVE_DISPLAY', '')
  cleanupNativeApplication('/test/milkup')
  expect(kill).not.toHaveBeenCalled()
})
it('does not signal a reused PID or an unexpected executable', async () => {
  const started = beginNativeStartup()
  mock.tree = window(200)
  mock.identities.set(200, 'birth1')
  await waitForNativeWindow(started)
  cleanupNativeApplication('/other/milkup')
  mock.identities.set(200, 'birth2')
  cleanupNativeApplication('/test/milkup')
  expect(kill).not.toHaveBeenCalled()
})

it('ignores only a window which vanished during the initial snapshot', () => {
  mock.tree = window(200)
  mock.vanished = true
  expect(() => beginNativeStartup()).not.toThrow()
  cleanupNativeApplication('/test/milkup')
  expect(kill).not.toHaveBeenCalled()
})

it('retries only bounded non-atomic X11 tree observations', () => {
  mock.treeRaces = 2
  expect(() => beginNativeStartup()).not.toThrow()
  mock.treeRaces = 3
  expect(() => beginNativeStartup()).toThrow('tree changed')
})

import { unwrapWebDriverValue } from './native-production.mjs'
it('preserves null and false WebDriver results instead of turning them into truthy envelopes', () => {
  expect(unwrapWebDriverValue({ value: null })).toBeNull()
  expect(unwrapWebDriverValue({ value: false })).toBe(false)
  expect(unwrapWebDriverValue({ value: 0 })).toBe(0)
  expect(unwrapWebDriverValue({ sessionId: 's' })).toEqual({ sessionId: 's' })
})

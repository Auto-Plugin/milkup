import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync }))
import { x } from './native-updates-fixture.mjs'

const args = ['search', '--onlyvisible', '--class', 'milkup-desktop']
const stderr = [
  'X Error of failed request:  BadWindow (invalid Window parameter)',
  '  Major opcode of failed request:  15 (X_QueryTree)',
  '  Resource id in failed request:  0x100488e',
  '  Serial number of failed request:  275',
  '  Current serial number in output stream:  275',
  '',
].join('\n')
const race = (overrides = {}) =>
  Object.assign(new Error('query tree race'), { status: 1, signal: null, stderr }, overrides)
let logged: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  execFileSync.mockReset()
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

it('returns a successful exact query without repeating it', () => {
  execFileSync.mockReturnValue('  123\n')
  expect(x(...args)).toBe('123')
  expect(execFileSync).toHaveBeenCalledTimes(1)
  expect(logged).not.toHaveBeenCalled()
})
it('rechecks at most twice and logs both original stderr values before success', () => {
  execFileSync
    .mockImplementationOnce(() => {
      throw race()
    })
    .mockImplementationOnce(() => {
      throw race()
    })
    .mockReturnValue('456\n')
  expect(x(...args)).toBe('456')
  expect(execFileSync).toHaveBeenCalledTimes(3)
  expect(logged).toHaveBeenCalledTimes(2)
  for (const [index, call] of logged.mock.calls.entries()) {
    expect(call[0]).toContain(`attempt=${index + 1}/3 retrying`)
    expect(call[0]).toContain(stderr)
  }
  for (const call of execFileSync.mock.calls) expect(call.slice(0, 2)).toEqual(['xdotool', args])
})
it('throws the third original error and retains all three stderr records', () => {
  const failure = race()
  execFileSync.mockImplementation(() => {
    throw failure
  })
  expect(() => x(...args)).toThrow(failure)
  expect(execFileSync).toHaveBeenCalledTimes(3)
  expect(logged).toHaveBeenCalledTimes(3)
  expect(logged.mock.calls[2]?.[0]).toContain('attempt=3/3 exhausted')
  expect(logged.mock.calls.every((call) => String(call[0]).includes(stderr))).toBe(true)
})
it.each([
  ['click', '1'],
  [...args, 'windowactivate'],
  ['search', '--class', 'milkup-desktop'],
  ['search', '--onlyvisible', '--name', '^Open File$'],
  ['getwindowgeometry', '--shell', '123'],
])('never repeats other commands: %j', (...command) => {
  const failure = race()
  execFileSync.mockImplementation(() => {
    throw failure
  })
  expect(() => x(...command)).toThrow(failure)
  expect(execFileSync).toHaveBeenCalledTimes(1)
  expect(logged).not.toHaveBeenCalled()
})
it.each([
  { stderr: stderr.replace('15 (X_QueryTree)', '3 (X_GetWindowAttributes)') },
  { stderr: stderr.replace('BadWindow', 'BadDrawable') },
  { stderr: 'cannot open display' },
  { status: 2 },
  { signal: 'SIGTERM' },
])('never repeats a different failure: %j', (overrides) => {
  const failure = race(overrides)
  execFileSync.mockImplementation(() => {
    throw failure
  })
  expect(() => x(...args)).toThrow(failure)
  expect(execFileSync).toHaveBeenCalledTimes(1)
  expect(logged).not.toHaveBeenCalled()
})

import { expect, it, vi } from 'vitest'
import { createAppearanceController, readAppearance, type AppearanceState } from './appearance'
function fixture(value = '{}') {
  let dark = false
  const states: AppearanceState[] = []
  const storage = { getItem: () => value, setItem: vi.fn() }
  const applyTheme = vi.fn(async () => {})
  const applyZoom = vi.fn(async () => {})
  const controller = createAppearanceController({
    storage,
    isSystemDark: () => dark,
    applyTheme,
    applyZoom,
    onState: (s) => states.push(s),
  })
  return {
    controller,
    storage,
    applyTheme,
    applyZoom,
    states,
    systemDark: (v: boolean) => {
      dark = v
      controller.refreshSystemTheme()
    },
  }
}
it('rejects malformed persisted preferences and unsupported zoom values', () => {
  expect(readAppearance({ getItem: () => '{bad' })).toEqual({ theme: 'system', zoom: 1 })
  expect(readAppearance({ getItem: () => '{"theme":"unsafe","zoom":99}' })).toEqual({
    theme: 'system',
    zoom: 1,
  })
})
it('restores native settings before enabling controls and follows system only when selected', async () => {
  const f = fixture('{"theme":"system","zoom":1.5}')
  await f.controller.ready
  expect(f.applyZoom).toHaveBeenCalledWith(1.5)
  f.systemDark(true)
  expect(f.states.at(-1)?.resolvedTheme).toBe('dark')
  await f.controller.changeTheme('light')
  f.systemDark(true)
  expect(f.states.at(-1)?.resolvedTheme).toBe('light')
  expect(f.storage.setItem).toHaveBeenLastCalledWith(
    expect.any(String),
    '{"theme":"light","zoom":1.5}',
  )
})
it('keeps the confirmed scale and persisted preference after native zoom rejection', async () => {
  const f = fixture()
  await f.controller.ready
  await f.controller.changeZoom(1.25)
  f.applyZoom.mockRejectedValueOnce(Error('denied'))
  await f.controller.changeZoom(2)
  expect(f.states.at(-1)).toMatchObject({
    zoom: 1.25,
    busy: false,
    error: expect.stringContaining('denied'),
  })
  expect(f.storage.setItem).toHaveBeenCalledTimes(1)
})
it('does not claim a failed startup zoom was applied', async () => {
  const states: AppearanceState[] = []
  const controller = createAppearanceController({
    storage: { getItem: () => '{"zoom":2}', setItem: vi.fn() },
    isSystemDark: () => false,
    applyTheme: async () => {},
    applyZoom: async () => {
      throw Error('unavailable')
    },
    onState: (s) => states.push(s),
  })
  await controller.ready
  expect(states.at(-1)).toMatchObject({ zoom: 1, error: expect.stringContaining('100%') })
})
it('does not let overlapping zoom commands race or exceed supported bounds', async () => {
  const f = fixture()
  await f.controller.ready
  let resolve!: () => void
  f.applyZoom.mockImplementationOnce(() => new Promise<void>((r) => (resolve = r)))
  const first = f.controller.changeZoom(1.25)
  await f.controller.changeZoom(2)
  resolve()
  await first
  expect(f.states.at(-1)?.zoom).toBe(1.25)
  await f.controller.stepZoom(-1)
  await f.controller.stepZoom(-1)
  expect(f.states.at(-1)?.zoom).toBe(1)
})

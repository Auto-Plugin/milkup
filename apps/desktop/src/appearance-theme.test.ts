import { expect, it, vi } from 'vitest'
import { createThemeStyleController, type ThemeBackend, type ThemeFile } from './appearance-theme'
import defaultCss from './appearance-default.css?raw'
vi.mock('./appearance-default.css?raw', async () => ({
  default: (await import('node:fs')).readFileSync(
    new URL('./appearance-default.css', import.meta.url),
    'utf8',
  ),
}))
const file = (extra: Partial<ThemeFile> = {}): ThemeFile => ({
  revision: 'r1',
  name: '系统默认主题',
  text: defaultCss,
  defaultText: defaultCss,
  path: '/tmp/default.css',
  isDefault: true,
  ...extra,
})
function fixture() {
  const backend: ThemeBackend = {
    load: vi.fn(async () => file()),
    readCandidate: vi.fn(async () => ({
      name: 'Ocean',
      text: ':root{--text:navy}',
      sourceDigest: 'sha',
    })),
    commitCandidate: vi.fn(async () =>
      file({ revision: 'r2', name: 'Ocean', text: ':root{--text:navy}', isDefault: false }),
    ),
    reset: vi.fn(async () => file({ revision: 'r3' })),
    openCurrent: vi.fn(async () => ({ status: 'requested' as const, path: '/tmp/default.css' })),
  }
  const apply = vi.fn()
  const controller = createThemeStyleController({ backend, supports: () => true, apply })
  return { backend, apply, controller }
}
it('cancel does not read or write files and import revalidates before digest+revision commit', async () => {
  const f = fixture()
  await f.controller.ready
  await f.controller.importFile(null)
  expect(f.backend.readCandidate).not.toHaveBeenCalled()
  await f.controller.importFile('/tmp/有 空格&x.css')
  expect(f.backend.commitCandidate).toHaveBeenCalledWith({
    path: '/tmp/有 空格&x.css',
    expectedDigest: 'sha',
    expectedRevision: 'r1',
  })
  expect(f.controller.getState()).toMatchObject({ name: 'Ocean', busy: false, isDefault: false })
})
it('bad CSS never commits and keeps the last working style and document-independent state', async () => {
  const f = fixture()
  await f.controller.ready
  const before = f.controller.getState().css
  vi.mocked(f.backend.readCandidate).mockResolvedValue({
    text: 'p{background:url(https://example.invalid)}',
    name: 'bad',
    sourceDigest: 'x',
  })
  await f.controller.importFile('/tmp/bad.css')
  expect(f.backend.commitCandidate).not.toHaveBeenCalled()
  expect(f.controller.getState()).toMatchObject({
    css: before,
    name: '系统默认主题',
    error: expect.stringContaining('url'),
  })
})
it('commit failure preserves the active theme and permits a later retry', async () => {
  const f = fixture()
  await f.controller.ready
  vi.mocked(f.backend.commitCandidate).mockRejectedValueOnce(Error('changed candidate'))
  await f.controller.importFile('/tmp/test.css')
  expect(f.controller.getState().isDefault).toBe(true)
  await f.controller.importFile('/tmp/test.css')
  expect(f.controller.getState().name).toBe('Ocean')
})
it('missing/corrupt persisted CSS is never installed; explicit default recovery uses observed revision', async () => {
  const f = fixture()
  vi.mocked(f.backend.load).mockResolvedValue(
    file({ revision: 'broken', text: null, warning: 'missing' }),
  )
  // Construct after changing the backend: startup is eager.
  const controller = createThemeStyleController({
    backend: f.backend,
    supports: () => true,
    apply: f.apply,
  })
  await controller.ready
  expect(controller.getState().error).toContain('missing')
  await controller.reset()
  expect(f.backend.reset).toHaveBeenCalledWith('broken')
})
it('does not let concurrent imports race or apply a response after disposal', async () => {
  const f = fixture()
  await f.controller.ready
  let finish!: (value: ThemeFile) => void
  vi.mocked(f.backend.commitCandidate).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = f.controller.importFile('/tmp/one.css')
  await vi.waitFor(() => expect(f.backend.commitCandidate).toHaveBeenCalledTimes(1))
  await f.controller.importFile('/tmp/two.css')
  expect(f.backend.readCandidate).toHaveBeenCalledTimes(1)
  const count = f.apply.mock.calls.length
  f.controller.dispose()
  finish(file({ name: 'late' }))
  await pending
  expect(f.apply).toHaveBeenCalledTimes(count)
})

it('waits for initial and imported theme layout before reporting readiness', async () => {
  const f = fixture()
  let finish!: () => void
  const layout = vi.fn(async () => {})
  layout.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const c = createThemeStyleController({ backend: f.backend, supports: () => true, apply: layout })
  expect(c.getState().busy).toBe(true)
  finish()
  await c.ready
  let finishImport!: () => void
  layout.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishImport = resolve
      }),
  )
  const operation = c.importFile('/tmp/theme.css')
  await vi.waitFor(() => expect(layout).toHaveBeenCalledTimes(3))
  expect(c.getState().busy).toBe(true)
  expect(c.getState().name).toBe('系统默认主题')
  finishImport()
  await operation
  expect(c.getState()).toMatchObject({ busy: false, name: 'Ocean' })
})
it('retains working CSS on layout failure and uses the committed revision for explicit recovery', async () => {
  const f = fixture()
  await f.controller.ready
  const previous = f.controller.getState().css
  f.apply.mockRejectedValueOnce(Error('layout failed; disk selection committed'))
  await f.controller.importFile('/tmp/theme.css')
  expect(f.controller.getState()).toMatchObject({
    css: previous,
    name: '系统默认主题',
    busy: false,
    error: expect.stringContaining('disk selection committed'),
  })
  await f.controller.reset()
  expect(f.backend.reset).toHaveBeenCalledWith('r2')
})

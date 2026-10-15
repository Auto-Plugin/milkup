import { describe, expect, it, vi } from 'vitest'
import type {
  SdkSettingsSchema,
  SdkSettingsValues,
  SdkPluginActivationContext,
  SdkRendererOutput,
} from '@milkup/plugin-sdk'
import { createController, parse } from './controller'
import plugin, { fields, render } from './plugin'

const schema: SdkSettingsSchema = {
  'editor.fontFamily': { type: 'enum', options: ['monospace', 'system', 'serif'] },
  'editor.fontSize': { type: 'number', minimum: 10, maximum: 40, step: 1 },
  'editor.lineWidth': { type: 'number', minimum: 320, maximum: 1600, step: 1, allowZero: true },
  'editor.lineHeight': { type: 'number', minimum: 1, maximum: 3, step: 0.1 },
  'editor.indentSize': { type: 'number', minimum: 1, maximum: 8, step: 1 },
  'editor.indentStyle': { type: 'enum', options: ['spaces', 'tabs'] },
  'appearance.theme': { type: 'enum', options: ['system', 'light', 'dark'] },
  'appearance.zoom': { type: 'enum', options: [1, 1.25, 1.5, 2] },
}
const defaults: SdkSettingsValues = {
  'editor.fontFamily': 'monospace',
  'editor.fontSize': 14,
  'editor.lineWidth': 0,
  'editor.lineHeight': 1.5,
  'editor.indentSize': 2,
  'editor.indentStyle': 'spaces',
  'appearance.theme': 'system',
  'appearance.zoom': 1,
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function backend() {
  let saved = { ...defaults },
    effective = { ...saved },
    revision = 0,
    active: string | undefined,
    next = 0
  const snapshot = () => ({ schema, defaults, revision, values: { ...effective } })
  const check = (id: string) => {
    if (id !== active) throw Object.assign(new Error(), { code: 'invalid-transaction' })
  }
  const host = {
    describe: vi.fn(async () => ({ schema, defaults })),
    get: vi.fn(async () => snapshot()),
    begin: vi.fn(async () => {
      if (active) throw Object.assign(new Error(), { code: 'busy' })
      active = `t${++next}`
      effective = { ...saved }
      return { id: active, snapshot: snapshot() }
    }),
    preview: vi.fn(async (id: string, patch: SdkSettingsValues) => {
      check(id)
      effective = { ...effective, ...patch }
      return snapshot()
    }),
    commit: vi.fn(async (id: string) => {
      check(id)
      saved = { ...effective }
      active = undefined
      revision++
      return snapshot()
    }),
    cancel: vi.fn(async (id: string) => {
      check(id)
      effective = { ...saved }
      active = undefined
    }),
  }
  return { host, snapshot, saved: () => saved, active: () => active }
}
function setup() {
  const b = backend()
  const changed = vi.fn()
  return { ...b, changed, controller: createController(b.host, changed) }
}
function nodes(output: SdkRendererOutput): Exclude<SdkRendererOutput, string | number | boolean>[] {
  if (!output || typeof output !== 'object') return []
  return [output, ...('children' in output ? (output.children ?? []).flatMap(nodes) : [])]
}

describe('validated preference drafts', () => {
  it('loads application schema, values, and defaults through a transaction', async () => {
    const { controller, host } = setup()
    await controller.open()
    expect(host.begin).toHaveBeenCalledWith('application', { signal: expect.any(AbortSignal) })
    expect(controller.state.drafts['editor.fontSize']).toBe('14')
    expect(controller.state.phase).toBe('ready')
  })
  it('previews a valid number without persisting it', async () => {
    const { controller, snapshot, saved } = setup()
    await controller.open()
    await controller.change('editor.fontSize', '18')
    expect(snapshot().values['editor.fontSize']).toBe(18)
    expect(saved()['editor.fontSize']).toBe(14)
  })
  it.each(['', 'NaN', 'Infinity', '9', '41', '14.5'])(
    'keeps invalid raw number %j out of the host',
    async (raw) => {
      const { controller, host } = setup()
      await controller.open()
      await controller.change('editor.fontSize', raw)
      expect(controller.state.drafts['editor.fontSize']).toBe(raw)
      expect(controller.state.invalid['editor.fontSize']).toBeTruthy()
      expect(host.preview).not.toHaveBeenCalled()
      await controller.save()
      expect(host.commit).not.toHaveBeenCalled()
    },
  )
  it('allows auto width zero but rejects the gap below the minimum', () => {
    expect(parse(schema['editor.lineWidth']!, '0')).toBe(0)
    expect(() => parse(schema['editor.lineWidth']!, '319')).toThrow()
    expect(parse(schema['editor.lineHeight']!, '1.7')).toBe(1.7)
  })
  it('rejects enum injection and preserves numeric enum types', async () => {
    const { controller, host } = setup()
    await controller.open()
    await controller.change('appearance.theme', '<script>')
    expect(host.preview).not.toHaveBeenCalled()
    await controller.change('appearance.zoom', '1.25')
    expect(host.preview).toHaveBeenLastCalledWith(
      't1',
      { 'appearance.zoom': 1.25 },
      { signal: expect.any(AbortSignal) },
    )
  })
  it('ignores unknown keys', async () => {
    const { controller, host } = setup()
    await controller.open()
    await controller.change('filesystem.path', '/private')
    expect(host.preview).not.toHaveBeenCalled()
    expect(controller.state.drafts).not.toHaveProperty('filesystem.path')
  })
  it('recovers from empty drafts with a valid value', async () => {
    const { controller } = setup()
    await controller.open()
    await controller.change('editor.fontSize', '')
    await controller.change('editor.fontSize', '20')
    expect(controller.state.invalid).toEqual({})
    expect(controller.state.drafts['editor.fontSize']).toBe('20')
  })
})
describe('transaction ordering and persistence', () => {
  it('serializes rapid previews and retains the newest raw input', async () => {
    const { controller, host } = setup()
    await controller.open()
    const wait = deferred<ReturnType<ReturnType<typeof backend>['snapshot']>>()
    host.preview.mockReturnValueOnce(wait.promise)
    const a = controller.change('editor.fontSize', '18')
    await Promise.resolve()
    await Promise.resolve()
    const b = controller.change('editor.fontSize', '19')
    expect(controller.state.drafts['editor.fontSize']).toBe('19')
    expect(host.preview).toHaveBeenCalledTimes(1)
    wait.resolve({ schema, defaults, revision: 0, values: { ...defaults, 'editor.fontSize': 18 } })
    await a
    await b
    expect(host.preview).toHaveBeenLastCalledWith(
      't1',
      { 'editor.fontSize': 19 },
      expect.anything(),
    )
    expect(controller.state.drafts['editor.fontSize']).toBe('19')
  })
  it('commits displayed values and reloads saved preferences in a new activation', async () => {
    const b = backend()
    const c = createController(b.host, vi.fn())
    await c.open()
    await c.change('editor.fontSize', '20')
    await c.save()
    await c.dispose()
    const next = createController(b.host, vi.fn())
    await next.open()
    expect(next.state.drafts['editor.fontSize']).toBe('20')
  })
  it('cancels unsaved preview and retains previously committed values', async () => {
    const { controller, snapshot } = setup()
    await controller.open()
    await controller.change('editor.fontSize', '20')
    await controller.save()
    await controller.change('editor.fontSize', '24')
    await controller.cancel()
    expect(snapshot().values['editor.fontSize']).toBe(20)
    expect(controller.state.drafts['editor.fontSize']).toBe('20')
  })
  it('retries begin instead of falsely reporting saved after a post-commit begin failure', async () => {
    const { controller, host, saved } = setup()
    await controller.open()
    await controller.change('editor.fontSize', '20')
    await controller.save()
    host.begin.mockRejectedValueOnce(Object.assign(new Error(), { code: 'busy' }))
    await controller.change('editor.fontSize', '24')
    expect(controller.state.phase).toBe('error')
    expect(saved()['editor.fontSize']).toBe(20)
    await controller.save()
    expect(saved()['editor.fontSize']).toBe(24)
    expect(controller.state.message).toBe('偏好已保存。')
  })
  it('a late valid preview does not leave a newer empty draft permanently busy', async () => {
    const { controller, host } = setup()
    await controller.open()
    const wait = deferred<ReturnType<ReturnType<typeof backend>['snapshot']>>()
    host.preview.mockReturnValueOnce(wait.promise)
    const pending = controller.change('editor.fontSize', '18')
    await vi.waitFor(() => expect(host.preview).toHaveBeenCalledTimes(1))
    void controller.change('editor.fontSize', '')
    wait.resolve({ schema, defaults, revision: 0, values: { ...defaults, 'editor.fontSize': 18 } })
    await pending
    expect(controller.state.drafts['editor.fontSize']).toBe('')
    expect(controller.state.phase).toBe('ready')
    expect(controller.state.invalid['editor.fontSize']).toBeTruthy()
  })
  it('reset is a cancellable preview rather than an immediate write', async () => {
    const { controller, saved, snapshot } = setup()
    await controller.open()
    await controller.change('appearance.theme', 'dark')
    await controller.save()
    await controller.reset()
    expect(snapshot().values['appearance.theme']).toBe('system')
    expect(saved()['appearance.theme']).toBe('dark')
    await controller.cancel()
    expect(snapshot().values['appearance.theme']).toBe('dark')
  })
  it('reapplies drafts before commit after a failed preview', async () => {
    const { controller, host, saved } = setup()
    await controller.open()
    host.preview.mockRejectedValueOnce(
      Object.assign(new Error('private OS message'), { code: 'unavailable' }),
    )
    await controller.change('editor.fontSize', '22')
    expect(controller.state.phase).toBe('error')
    await controller.save()
    expect(saved()['editor.fontSize']).toBe(22)
  })
  it('keeps failed commits retryable and does not leak host exception details', async () => {
    const { controller, host, saved } = setup()
    await controller.open()
    await controller.change('editor.fontSize', '22')
    host.commit.mockRejectedValueOnce(
      Object.assign(new Error('/secret/path'), { code: 'conflict' }),
    )
    await controller.save()
    expect(saved()['editor.fontSize']).toBe(14)
    expect(controller.state.error).toContain('其他操作')
    expect(controller.state.error).not.toContain('/secret')
    await controller.save()
    expect(saved()['editor.fontSize']).toBe(22)
  })
  it('retains the transaction when cancellation fails so the user can retry', async () => {
    const { controller, host, snapshot } = setup()
    await controller.open()
    await controller.change('editor.fontSize', '22')
    host.cancel.mockRejectedValueOnce(Object.assign(new Error(), { code: 'unavailable' }))
    await controller.cancel()
    expect(controller.state.phase).toBe('error')
    await controller.cancel()
    expect(snapshot().values['editor.fontSize']).toBe(14)
  })
})
describe('lifecycle and public controlled UI', () => {
  it('closing the view rolls back and reopening starts a new transaction', async () => {
    const { controller, host, snapshot } = setup()
    await controller.open()
    await controller.change('editor.fontSize', '18')
    await controller.close()
    expect(snapshot().values['editor.fontSize']).toBe(14)
    await controller.open()
    expect(host.begin).toHaveBeenCalledTimes(2)
  })
  it('dispose rolls back and prevents future calls', async () => {
    const { controller, host, snapshot } = setup()
    await controller.open()
    await controller.change('editor.fontSize', '18')
    await controller.dispose()
    await controller.open()
    await controller.change('editor.fontSize', '25')
    expect(snapshot().values['editor.fontSize']).toBe(14)
    expect(host.begin).toHaveBeenCalledTimes(1)
  })
  it('cancels a late begin after the view closes', async () => {
    const { controller, host } = setup()
    const wait = deferred<{
      id: string
      snapshot: ReturnType<ReturnType<typeof backend>['snapshot']>
    }>()
    host.begin.mockReturnValueOnce(wait.promise)
    const opening = controller.open()
    await vi.waitFor(() => expect(host.begin).toHaveBeenCalledTimes(1))
    const closing = controller.close()
    host.cancel.mockResolvedValueOnce()
    wait.resolve({ id: 'late', snapshot: { schema, defaults, revision: 0, values: defaults } })
    await opening
    await closing
    expect(host.cancel).toHaveBeenCalledWith('late')
    expect(controller.state.phase).toBe('closed')
  })
  it('surfaces unavailable and busy services without crashing', async () => {
    const c = createController(undefined, vi.fn())
    await c.open()
    expect(c.state.error).toContain('暂不可用')
    const { controller, host } = setup()
    host.begin.mockRejectedValueOnce(Object.assign(new Error(), { code: 'busy' }))
    await controller.open()
    expect(controller.state.error).toContain('另一处')
    await controller.retry()
    expect(controller.state.phase).toBe('ready')
  })
  it('renders eight stable labelled controlled fields with associated help', async () => {
    const { controller } = setup()
    await controller.open()
    const form = nodes(render(controller.state))
    const inputs = form.filter((n) => n.type === 'field')
    expect(inputs.map((n) => n.key)).toEqual(fields.map(([key]) => key))
    expect(
      inputs.every((n) => n.label && n.help && n.onChange.command === 'preferences.change'),
    ).toBe(true)
    await controller.change('editor.fontSize', '')
    const invalid = nodes(render(controller.state)).find(
      (n) => n.type === 'field' && n.key === 'editor.fontSize',
    )
    expect(invalid).toMatchObject({ value: '', invalid: true, help: '请输入数值。' })
  })
  it('announces only the active operation instead of an obsolete preview status', async () => {
    const { controller } = setup()
    await controller.open()
    controller.state.phase = 'saving'
    controller.state.message = '正在预览，尚未保存。'
    const statuses = nodes(render(controller.state)).filter(
      (node) => node.type === 'element' && node.attributes?.role === 'status',
    )
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toMatchObject({ text: '正在保存偏好…' })
  })
  it('commands return immediately; hidden views cancel while blur preserves the session', async () => {
    const b = backend(),
      requestUpdate = vi.fn(async () => {})
    const activation = plugin.activate({
      host: { settings: b.host, ui: { requestUpdate } },
    } as unknown as SdkPluginActivationContext)
    plugin.renderers['preferences-panel']({ node: { phase: 'mount', visible: true } })
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(
      plugin.commands['preferences.change']({}, { field: 'editor.fontSize', value: '18' }),
    ).toBeUndefined()
    plugin.renderers['preferences-panel']({ node: { phase: 'blur', visible: true } })
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(b.host.cancel).not.toHaveBeenCalled()
    plugin.renderers['preferences-panel']({ node: { phase: 'update', visible: false } })
    await activation.dispose()
    expect(b.host.cancel).toHaveBeenCalled()
    expect(b.snapshot().values['editor.fontSize']).toBe(14)
  })
})

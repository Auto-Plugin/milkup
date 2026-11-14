import { describe, expect, it, vi } from 'vitest'
import type {
  SdkPluginKeymapHost,
  SdkKeymapSnapshot,
  SdkPluginActivationContext,
  SdkPluginRendererContext,
} from '@milkup/plugin-sdk'
import { createController } from './controller'
import plugin from './plugin'
const snapshot: SdkKeymapSnapshot = {
  revision: 3,
  commands: [
    {
      id: 'file.save',
      title: '<img src=x onerror=alert(1)>',
      category: 'file',
      defaultKeys: ['Mod+S'],
      keys: ['Mod+S'],
      available: true,
      bindable: true,
    },
    {
      id: 'required',
      title: 'Required',
      category: 'test',
      defaultKeys: [],
      keys: [],
      available: true,
      bindable: false,
      input: 'Needs parameters',
    },
  ],
  fixedShortcuts: [{ keys: 'F6', title: 'Focus', description: 'Reserved' }],
}
const backend = () =>
  ({
    snapshot: vi.fn(async () => snapshot),
    update: vi.fn(async () => ({ ...snapshot, revision: 4 })),
    reset: vi.fn(async () => ({ ...snapshot, revision: 5 })),
  }) satisfies SdkPluginKeymapHost
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
describe('independent public SDK shortcuts plugin', () => {
  it('drafts and cancels without changing host; save is one revisioned transaction', async () => {
    const api = backend(),
      controller = createController(api, vi.fn())
    await controller.load()
    controller.edit({ field: 'file.save', value: 'Mod+K Mod+Shift+K' })
    expect(api.update).not.toHaveBeenCalled()
    controller.cancel()
    expect(controller.state.draft).toEqual({})
    controller.edit({ field: 'file.save', value: '' })
    await controller.save()
    expect(api.update).toHaveBeenCalledWith(
      { revision: 3, bindings: [{ command: 'file.save', keys: [] }] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(controller.state.message).toBe('快捷键已保存。')
    expect(controller.state.draft).toEqual({})
    controller.dispose()
  })
  it.each(['冲突', '过期', '持久化失败', '非法或保留键'])(
    'keeps draft and previous snapshot on %s',
    async (message) => {
      const api = backend(),
        controller = createController(api, vi.fn())
      await controller.load()
      controller.edit({ field: 'file.save', value: 'Mod+O' })
      api.update.mockRejectedValueOnce(new Error(message))
      await controller.save()
      expect(controller.state.error).toBe(message)
      expect(controller.state.snapshot?.revision).toBe(3)
      expect(controller.state.draft['file.save']).toBe('Mod+O')
      controller.dispose()
    },
  )
  it('restores defaults explicitly, ignores forged/parameterized fields and handles missing permission', async () => {
    const api = backend(),
      controller = createController(api, vi.fn())
    await controller.load()
    controller.edit({ field: 'required', value: 'Mod+K' })
    controller.edit({ field: 'unknown', value: 'Mod+J' })
    expect(controller.state.draft).toEqual({})
    await controller.reset()
    expect(api.reset).toHaveBeenCalledWith({ revision: 3 }, expect.anything())
    const denied = createController(undefined, vi.fn())
    await denied.load()
    expect(denied.state.error).toContain('app:keymap')
    controller.dispose()
    denied.dispose()
  })
  it('disposal aborts in-flight save and prevents late UI state publication', async () => {
    const api = backend(),
      changed = vi.fn(),
      controller = createController(api, changed)
    await controller.load()
    controller.edit({ field: 'file.save', value: 'Mod+K' })
    let resolve!: (value: SdkKeymapSnapshot) => void
    api.update.mockReturnValueOnce(
      new Promise((yes) => {
        resolve = yes
      }),
    )
    const saving = controller.save(),
      before = changed.mock.calls.length
    controller.dispose()
    expect(
      (api.update.mock.calls as unknown as [[unknown, { signal: AbortSignal }]])[0][1].signal
        .aborted,
    ).toBe(true)
    resolve(snapshot)
    await saving
    expect(changed).toHaveBeenCalledTimes(before)
    expect(controller.state.snapshot).toBeUndefined()
  })
  it('renders only controlled fields/text through public host and supports lifecycle', async () => {
    const api = backend()
    const context = {
      host: { keymap: api, ui: { requestUpdate: vi.fn(async () => {}) } },
    } as unknown as SdkPluginActivationContext
    const lease = await plugin.activate?.(context)
    await flush()
    expect(api.snapshot).not.toHaveBeenCalled()
    const renderer = plugin.renderers?.['shortcuts-modal']
    renderer?.({ node: { phase: 'render' } } as unknown as SdkPluginRendererContext)
    await flush()
    expect(api.snapshot).toHaveBeenCalledTimes(1)
    const rendered = renderer?.({
      node: { phase: 'render' },
    } as unknown as SdkPluginRendererContext)
    const serialized = JSON.stringify(rendered)
    expect(serialized).toContain('"type":"field"')
    expect(serialized).toContain('shortcuts.field')
    expect(serialized).toContain('上下文固定快捷键')
    expect(serialized).toContain('Needs parameters')
    expect(serialized).not.toContain('innerHTML')
    renderer?.({ node: { phase: 'dispose' } } as unknown as SdkPluginRendererContext)
    if (lease && typeof lease === 'object' && 'dispose' in lease) await lease.dispose()
    await plugin.deactivate?.(context)
  })
})

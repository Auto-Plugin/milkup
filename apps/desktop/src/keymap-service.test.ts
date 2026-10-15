import { describe, expect, it, vi } from 'vitest'
import {
  createKeymapService,
  desktopKeymapDefaults,
  normalizeKeymapKey,
  type KeymapCommandDefinition,
  type KeymapContext,
} from './keymap-service'
const context: KeymapContext = {
  platform: 'linux',
  editorFocus: true,
  documentOpen: true,
  sourceMode: true,
  liveMode: false,
}
const event = (key: string, extra = {}) => ({
  key,
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  keyCode: 0,
  ...extra,
})
function setup() {
  let raw: string | null = null
  const storage = {
    getItem: vi.fn(() => raw),
    setItem: vi.fn((_key: string, value: string) => {
      raw = value
    }),
  }
  const commands: KeymapCommandDefinition[] = Object.keys(desktopKeymapDefaults).map((id) => ({
    id,
    title: id,
    category: 'test',
    available: true,
    bindable: true,
  }))
  const service = createKeymapService({ storage, commands: () => commands })
  return { service, storage, commands }
}
describe('application keymap service', () => {
  it('publishes all defaults and matches precise platform/chord modifiers', async () => {
    const { service } = setup()
    expect((await service.snapshot()).commands).toHaveLength(
      Object.keys(desktopKeymapDefaults).length,
    )
    expect(service.match(event('s'), context)).toEqual({ id: 'file.save' })
    expect(service.match(event('s', { shiftKey: true }), context)).toEqual({ id: 'file.saveAs' })
    expect(service.match(event('n', { shiftKey: true }), context)).toBeUndefined()
    expect(service.match(event('F3', { ctrlKey: false, shiftKey: true }), context)).toEqual({
      id: 'search.previous',
    })
    expect(service.match(event('s'), { ...context, platform: 'macos' })).toBeUndefined()
    expect(
      service.match(event('s', { ctrlKey: false, metaKey: true }), {
        ...context,
        platform: 'macos',
      }),
    ).toEqual({ id: 'file.save' })
  })
  it.each([
    { isComposing: true },
    { keyCode: 229 },
    { altKey: true },
    { metaKey: true },
    { getModifierState: () => true },
  ])('preserves input composition/system combinations %j', (flags) => {
    expect(setup().service.match(event('s', flags), context)).toBeUndefined()
  })
  it('keeps search controls native for history while allowing existing global commands', () => {
    const { service } = setup()
    const search = { ...context, inputFocus: true, searchFocus: true }
    expect(service.match(event('s'), search)?.id).toBe('file.save')
    expect(service.match(event('1'), search)?.id).toBe('view.source')
    expect(service.match(event('F3', { ctrlKey: false }), search)?.id).toBe('search.next')
    for (const key of ['a', 'z', 'y']) expect(service.match(event(key), search)).toBeUndefined()
  })
  it('matches shifted printable symbols by their portable base key', async () => {
    const { service } = setup()
    await service.update({
      revision: 0,
      bindings: [{ command: 'file.save', keys: ['Mod+Shift+/'] }],
    })
    expect(service.match(event('?', { shiftKey: true }), context)?.id).toBe('file.save')
    expect(service.match(event('+', { shiftKey: true }), context)?.id).toBe('appearance.zoomIn')
  })
  it('preserves all native input controls and fixed navigation keys', () => {
    const { service } = setup()
    expect(service.match(event('s'), { ...context, inputFocus: true })).toBeUndefined()
    for (const key of ['F6', 'Tab', 'Escape', 'Enter', 'Backspace', 'ArrowLeft', 'c', 'x', 'v'])
      expect(service.match(event(key), context)).toBeUndefined()
  })
  it('atomically swaps bindings, persists, reloads and resets including disabled plugins', async () => {
    const { service, storage, commands } = setup()
    await service.update({
      revision: 0,
      bindings: [
        { command: 'file.save', keys: ['Mod+O'] },
        { command: 'file.open', keys: ['Mod+S'] },
      ],
    })
    expect(service.match(event('o'), context)?.id).toBe('file.save')
    const restarted = createKeymapService({ storage, commands: () => commands })
    expect(restarted.match(event('o'), context)?.id).toBe('file.save')
    await restarted.reset({ revision: (await restarted.snapshot()).revision })
    expect(restarted.match(event('s'), context)?.id).toBe('file.save')
    expect(storage.setItem).toHaveBeenCalledTimes(2)
  })
  it('rejects collisions/stale/unknown/required-input with no writes', async () => {
    const { service, storage, commands } = setup()
    await expect(
      service.update({ revision: 0, bindings: [{ command: 'file.save', keys: ['Mod+O'] }] }),
    ).rejects.toMatchObject({ code: 'conflict' })
    await expect(service.reset({ revision: 42 })).rejects.toMatchObject({ code: 'stale' })
    await expect(
      service.update({ revision: 0, bindings: [{ command: 'unknown', keys: ['Mod+K'] }] }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    commands.push({
      id: 'with.input',
      title: 'Input',
      category: 'test',
      bindable: false,
      available: true,
      input: 'Required input',
    })
    const snapshot = await service.snapshot()
    expect(snapshot.revision).toBe(1)
    await expect(
      service.update({
        revision: snapshot.revision,
        bindings: [{ command: 'with.input', keys: ['Mod+K'] }],
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it.each(['Mod+C', 'F6', 'Shift+Tab', 'Escape', 'Mod+Home', 'Enter'])(
    'rejects reserved %s',
    async (key) => {
      await expect(
        setup().service.update({ revision: 0, bindings: [{ command: 'file.save', keys: [key] }] }),
      ).rejects.toMatchObject({ code: 'reserved' })
    },
  )
  it.each(['Mod+K Mod+S', 'Alt+K', 'K', 'Mod+Mod+K', '', 'Mod+Shift+Shift+K'])(
    'rejects malformed chord %s',
    (key) => {
      expect(() => normalizeKeymapKey(key)).toThrow()
    },
  )
  it('does not allow taking editor history or selection keys for unrelated actions', async () => {
    await expect(
      setup().service.update({
        revision: 0,
        bindings: [{ command: 'file.save', keys: ['Mod+Z'] }],
      }),
    ).rejects.toMatchObject({ code: 'reserved' })
  })
  it('failure or cancellation never publishes changed runtime bindings/revision', async () => {
    const { service, storage } = setup()
    storage.setItem.mockImplementation(() => {
      throw new Error('/private/profile')
    })
    await expect(
      service.update({ revision: 0, bindings: [{ command: 'file.save', keys: ['Mod+K'] }] }),
    ).rejects.toMatchObject({ code: 'persist-failed' })
    expect(service.match(event('s'), context)?.id).toBe('file.save')
    expect((await service.snapshot()).revision).toBe(0)
    await expect(
      service.reset({ revision: 0 }, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: 'aborted' })
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })
  it('reports corrupt persistence and keeps core editing and save usable', async () => {
    const { commands } = setup()
    const service = createKeymapService({
      commands: () => commands,
      storage: { getItem: () => '{bad', setItem: () => {} },
    })
    expect((await service.snapshot()).error).toContain('默认')
    expect(service.match(event('s'), context)?.id).toBe('file.save')
    expect(service.match(event('z'), context)?.id).toBe('core.undo')
    expect((await service.reset({ revision: 0 })).error).toBeUndefined()
  })
  it('keeps a shadowed default inactive while retaining its context on a persisted replacement', async () => {
    const { commands, storage } = setup()
    commands.push({
      id: 'shadow.first',
      title: 'First',
      category: 'plugin',
      available: true,
      bindable: true,
      defaultKeys: ['Mod+K'],
      defaultBindings: [{ key: 'Mod+K', when: 'editorFocus && sourceMode' }],
    })
    commands.push({
      id: 'shadow.second',
      title: 'Second',
      category: 'plugin',
      available: true,
      bindable: true,
      defaultKeys: [],
      defaultBindings: [{ key: 'Mod+K', when: 'editorFocus && sourceMode' }],
    })
    const service = createKeymapService({ storage, commands: () => commands })
    expect(
      (await service.snapshot()).commands.find((item) => item.id === 'shadow.second')?.defaultKeys,
    ).toEqual([])
    expect(service.match(event('k'), context)?.id).toBe('shadow.first')
    await service.update({ revision: 0, bindings: [{ command: 'shadow.second', keys: ['F2'] }] })
    const restarted = createKeymapService({ storage, commands: () => commands })
    const f2 = event('F2', { ctrlKey: false })
    expect(restarted.match(f2, { ...context, editorFocus: false })).toBeUndefined()
    expect(restarted.match(f2, { ...context, sourceMode: false, liveMode: true })).toBeUndefined()
    expect(restarted.match(f2, context)?.id).toBe('shadow.second')
    expect(restarted.match(event('k'), context)?.id).toBe('shadow.first')
  })
  it('disabled/uninstalled plugin does not execute; retained customization resumes with guarded context', async () => {
    const { service, commands } = setup()
    const plugin = {
      id: 'plugin.test',
      title: 'Test',
      category: 'plugin',
      available: true,
      bindable: true,
      defaultBindings: [{ key: 'Mod+K', when: 'editorFocus && sourceMode' }],
    }
    commands.push(plugin)
    let snapshot = await service.snapshot()
    await service.update({
      revision: snapshot.revision,
      bindings: [{ command: plugin.id, keys: ['Mod+J'] }],
    })
    expect(service.match(event('j'), context)?.id).toBe(plugin.id)
    expect(service.match(event('j'), { ...context, editorFocus: false })).toBeUndefined()
    plugin.available = false
    expect(service.match(event('j'), context)).toBeUndefined()
    snapshot = await service.snapshot()
    commands.pop()
    expect(service.match(event('j'), context)).toBeUndefined()
    commands.push({ ...plugin, available: true })
    expect(service.match(event('j'), context)?.id).toBe(plugin.id)
    await expect(service.reset({ revision: snapshot.revision })).rejects.toMatchObject({
      code: 'stale',
    })
  })
})

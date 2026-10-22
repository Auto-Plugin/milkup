import { afterEach, describe, expect, it, vi } from 'vitest'
import { createController, recentStorageKey } from './controller'
import plugin, { render } from './plugin'

const root = { id: 'root-1', key: 'stable-key', label: 'Project' }
const entry = (id: string, name = `${id}.md`, kind: 'file' | 'directory' = 'file') => ({
  id,
  name,
  kind,
  relativePath: name,
})
function backend() {
  return {
    chooseRoot: vi.fn(async () => root as typeof root | null),
    listChildren: vi.fn(async () => ({
      entries: [entry('a'), entry('dir', 'docs', 'directory'), entry('plain', 'note.txt')],
      nextCursor: null as string | null,
    })),
    refreshRoot: vi.fn(async () => ({ ...root, id: 'root-refreshed' })),
    resolveEntry: vi.fn(
      async (_root: string, relativePath: string) =>
        ({ ...entry('resolved'), relativePath }) as ReturnType<typeof entry> | null,
    ),
    requestOpen: vi.fn(async () => ({ status: 'opened' as 'opened' | 'cancelled' })),
    releaseRoot: vi.fn(async () => {}),
  }
}
function storage() {
  const check = (key: string) => {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(key)) throw new Error('Invalid plugin storage key')
  }
  return {
    getItem: vi.fn(async (key: string) => {
      check(key)
      return null as string | null
    }),
    setItem: vi.fn(async (key: string, _value: string) => {
      check(key)
    }),
    removeItem: vi.fn(async () => {}),
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const active: ReturnType<typeof createController>[] = []
function setup(api = backend(), store = storage()) {
  const changed = vi.fn()
  const controller = createController(api, store, changed)
  active.push(controller)
  return { api, store, controller, changed }
}
afterEach(async () => {
  await plugin.deactivate()
  await Promise.all(active.splice(0).map((controller) => controller.dispose()))
})
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
type Node = {
  tag?: string
  text?: string
  attributes?: Record<string, string>
  children?: Node[]
  action?: { command: string; input?: unknown }
}
const nodes = (value: unknown): Node[] => {
  if (!value || typeof value !== 'object') return []
  const node = value as Node
  return [node, ...(node.children || []).flatMap(nodes)]
}

describe('workspace lifecycle and bounded reads', () => {
  it('restores the host remembered root only once and loads its recent files', async () => {
    const api = { ...backend(), restoreRoot: vi.fn(async () => root) }
    const { controller, store } = setup(api)
    store.getItem.mockResolvedValueOnce('["a.md"]')
    await controller.restore()
    await controller.restore()
    expect(api.restoreRoot).toHaveBeenCalledTimes(1)
    expect(api.chooseRoot).not.toHaveBeenCalled()
    expect(controller.state.root).toEqual(root)
    expect(controller.state.recent).toEqual(['a.md'])
    expect(api.listChildren).toHaveBeenCalledTimes(1)
  })
  it('shows failed restoration and permits an explicit picker retry', async () => {
    const api = {
      ...backend(),
      restoreRoot: vi.fn(async () => {
        throw Error('invalidated')
      }),
    }
    const { controller } = setup(api)
    await controller.restore()
    await controller.restore()
    expect(api.restoreRoot).toHaveBeenCalledTimes(1)
    expect(controller.state.phase).toBe('error')
    expect(controller.state.error).toContain('重新选择')
    await controller.choose(api)
    expect(controller.state.root).toEqual(root)
    expect(controller.state.phase).toBe('idle')
  })
  it('releases a late restored root after cancellation without resurrecting state', async () => {
    const late = deferred<typeof root | null>()
    const api = { ...backend(), restoreRoot: vi.fn(() => late.promise) }
    const { controller } = setup(api)
    const restoring = controller.restore()
    controller.cancel()
    late.resolve(root)
    await restoring
    expect(api.releaseRoot).toHaveBeenCalledWith(root.id)
    expect(api.listChildren).not.toHaveBeenCalled()
    expect(controller.state.root).toBeUndefined()
    expect(controller.state.phase).toBe('cancelled')
    expect(
      nodes(render(controller.state)).some(
        (node) => node.text === '操作已取消，可重新选择文件夹。',
      ),
    ).toBe(true)
  })

  it('starts without authority or reads and loads only the chosen root page', async () => {
    const { api, controller } = setup()
    expect(controller.state.root).toBeUndefined()
    expect(api.listChildren).not.toHaveBeenCalled()
    await controller.choose(api)
    expect(api.listChildren).toHaveBeenCalledTimes(1)
    expect(api.listChildren).toHaveBeenCalledWith(root.id, {
      limit: 100,
      signal: expect.any(AbortSignal),
    })
    expect(controller.state.directories.size).toBe(1)
    await controller.toggle('dir')
    expect(api.listChildren).toHaveBeenLastCalledWith(root.id, {
      directoryId: 'dir',
      limit: 100,
      signal: expect.any(AbortSignal),
    })
    await controller.toggle('dir')
    await controller.toggle('dir')
    expect(api.listChildren).toHaveBeenCalledTimes(2)
  })
  it('keeps the previous root when the native chooser is cancelled', async () => {
    const { api, controller } = setup()
    await controller.choose(api)
    api.chooseRoot.mockResolvedValueOnce(null)
    await controller.choose(api)
    expect(controller.state.root).toEqual(root)
    expect(api.releaseRoot).not.toHaveBeenCalled()
  })
  it('loads a next cursor even when the previous native page has no entries', async () => {
    const { api, controller } = setup()
    api.listChildren.mockResolvedValueOnce({ entries: [], nextCursor: 'page-two' })
    await controller.choose(api)
    await controller.more()
    expect(api.listChildren).toHaveBeenLastCalledWith(root.id, {
      cursor: 'page-two',
      limit: 100,
      signal: expect.any(AbortSignal),
    })
    await controller.more()
    expect(api.listChildren).toHaveBeenCalledTimes(2)
  })
  it('refreshes authority and removes every old entry and page cursor', async () => {
    const { api, controller } = setup()
    await controller.choose(api)
    api.listChildren.mockResolvedValueOnce({ entries: [entry('new')], nextCursor: null })
    await controller.refresh()
    expect(controller.state.root?.id).toBe('root-refreshed')
    expect(controller.state.directories.get('')?.entries.map((item) => item.id)).toEqual(['new'])
    await controller.open(api, { id: 'a' })
    expect(api.requestOpen).not.toHaveBeenCalled()
  })
  it('aborts list requests and ignores their late successful response', async () => {
    const { api, controller } = setup()
    await controller.choose(api)
    const wait = deferred<Awaited<ReturnType<typeof api.listChildren>>>()
    api.listChildren.mockReturnValueOnce(wait.promise)
    const operation = controller.toggle('dir')
    await flush()
    const options = api.listChildren.mock.calls.at(-1)![1] as { signal: AbortSignal }
    controller.cancel()
    expect(options.signal.aborted).toBe(true)
    wait.resolve({ entries: [entry('late')], nextCursor: null })
    await operation
    expect(controller.state.directories.get('dir')?.entries).toEqual([])
    expect(controller.state.phase).toBe('cancelled')
  })
  it('reports enumeration errors and retries through refresh', async () => {
    const { api, controller } = setup()
    api.listChildren.mockRejectedValueOnce(new Error('permission revoked'))
    await controller.choose(api)
    expect(controller.state.error).toBe('permission revoked')
    await controller.refresh()
    expect(controller.state.phase).toBe('idle')
    expect(controller.state.error).toBeUndefined()
  })
  it.each(['cancel', 'failure'])(
    'restarts a consumed page cursor after %s without duplicate rows',
    async (ending) => {
      const { api, controller } = setup()
      const oldRows = [entry('old-a'), entry('old-b')]
      const wait = deferred<Awaited<ReturnType<typeof api.listChildren>>>()
      const used = new Set<string>()
      let firstPages = 0
      api.listChildren.mockImplementation(async (_id, options) => {
        if (options.cursor) {
          if (used.has(options.cursor)) throw new Error('invalidated single-use cursor')
          used.add(options.cursor)
          if (options.cursor === 'cursor-old') return wait.promise
          return { entries: [entry('fresh-next')], nextCursor: null }
        }
        firstPages++
        return firstPages === 1
          ? { entries: oldRows, nextCursor: 'cursor-old' }
          : { entries: [entry('fresh-first')], nextCursor: 'cursor-new' }
      })
      await controller.choose(api)
      const continuation = controller.more()
      await flush()
      if (ending === 'cancel') {
        controller.cancel()
        wait.resolve({ entries: [entry('late')], nextCursor: 'unusable' })
      } else wait.reject(new Error('enumeration failed after cursor consumption'))
      await continuation
      expect(controller.state.root).toEqual(root)
      expect(controller.state.directories.get('')?.entries).toEqual(oldRows)
      expect(controller.state.directories.get('')?.cursor).toBeNull()
      expect(nodes(render(controller.state)).some((node) => node.text === '重新加载目录')).toBe(
        true,
      )
      await controller.more()
      expect(controller.state.directories.get('')?.entries.map((entry) => entry.id)).toEqual([
        'fresh-first',
      ])
      expect(api.listChildren.mock.calls.at(-1)![1]).not.toHaveProperty('cursor')
      await controller.more()
      expect(controller.state.directories.get('')?.entries.map((entry) => entry.id)).toEqual([
        'fresh-first',
        'fresh-next',
      ])
      expect([...used]).toEqual(['cursor-old', 'cursor-new'])
    },
  )
  it('releases old roots on replacement and clears session-only state on disposal', async () => {
    const { api, controller } = setup()
    await controller.choose(api)
    api.chooseRoot.mockResolvedValueOnce({ ...root, id: 'second' })
    await controller.choose(api)
    expect(api.releaseRoot).toHaveBeenCalledWith('root-1')
    await controller.dispose()
    await controller.dispose()
    expect(api.releaseRoot).toHaveBeenCalledTimes(2)
    expect(controller.state.root).toBeUndefined()
    expect(controller.state.directories.size).toBe(0)
  })
  it('releases a root returned after disposal instead of retaining authority', async () => {
    const { api, controller } = setup()
    const wait = deferred<typeof root | null>()
    api.chooseRoot.mockReturnValueOnce(wait.promise)
    const operation = controller.choose(api)
    await controller.dispose()
    wait.resolve(root)
    await operation
    expect(api.releaseRoot).toHaveBeenCalledWith(root.id)
    expect(controller.state.root).toBeUndefined()
  })
  it('drops a revoked previous root when a cancelled replacement arrives late', async () => {
    const { api, controller } = setup()
    await controller.choose(api)
    const wait = deferred<typeof root | null>()
    api.chooseRoot.mockReturnValueOnce(wait.promise)
    const operation = controller.choose(api)
    controller.cancel()
    wait.resolve({ ...root, id: 'late-root' })
    await operation
    expect(controller.state.root).toBeUndefined()
    expect(controller.state.directories.size).toBe(0)
    expect(api.releaseRoot).toHaveBeenCalledWith('late-root')
  })
  it('does not retain invalid old handles after refresh cancellation', async () => {
    const { api, controller } = setup()
    await controller.choose(api)
    const wait = deferred<typeof root>()
    api.refreshRoot.mockReturnValueOnce(wait.promise)
    const operation = controller.refresh()
    controller.cancel()
    expect(controller.state.root).toBeUndefined()
    wait.resolve({ ...root, id: 'late-refresh' })
    await operation
    expect(controller.state.root).toBeUndefined()
    expect(api.releaseRoot).toHaveBeenCalledWith('late-refresh')
  })
})

describe('recent files and trusted opens', () => {
  it('resolves a fresh handle on each tree click after an atomic save invalidates the listed ID', async () => {
    const { api, controller } = setup()
    await controller.choose(api)
    api.requestOpen.mockImplementation(async (id) => {
      if (id === 'a') throw Object.assign(new Error('invalidated'), { code: 'invalidated' })
      return { status: 'opened' }
    })
    await controller.open(api, { id: 'a' })
    expect(controller.state.phase).toBe('idle')
    expect(api.resolveEntry).toHaveBeenCalledWith(root.id, 'a.md', {
      signal: expect.any(AbortSignal),
    })
    expect(api.requestOpen).toHaveBeenCalledWith('resolved', { signal: expect.any(AbortSignal) })
    expect(controller.state.current).toBe('a.md')
    api.resolveEntry.mockResolvedValueOnce({ ...entry('after-second-save'), relativePath: 'a.md' })
    await controller.open(api, { id: 'a' })
    expect(api.requestOpen).toHaveBeenLastCalledWith('after-second-save', {
      signal: expect.any(AbortSignal),
    })
    expect(controller.state.recent).toEqual(['a.md'])
  })
  it('does not open a freshly resolved tree entry after cancellation', async () => {
    const { api, controller, store } = setup()
    await controller.choose(api)
    const wait = deferred<ReturnType<typeof entry> | null>()
    api.resolveEntry.mockReturnValueOnce(wait.promise)
    const operation = controller.open(api, { id: 'a' })
    controller.cancel()
    wait.resolve(entry('late'))
    await operation
    expect(api.requestOpen).not.toHaveBeenCalled()
    expect(store.setItem).not.toHaveBeenCalled()
  })
  it('uses bounded public storage keys for opaque root keys of any spelling', async () => {
    for (const opaque of ['native:root/key', '汉字'.repeat(128), 'x'.repeat(128)]) {
      const key = await recentStorageKey(opaque)
      expect(key).toMatch(/^[A-Za-z0-9._-]{1,128}$/)
      expect(key).toHaveLength(74)
      expect(await recentStorageKey(opaque)).toBe(key)
      const { api, controller, store } = setup()
      api.chooseRoot.mockResolvedValueOnce({ ...root, key: opaque })
      await controller.choose(api)
      await controller.open(api, { id: 'a' })
      expect(controller.state.error).toBeUndefined()
      expect(store.setItem).toHaveBeenLastCalledWith(key, '["a.md"]')
    }
    expect(await recentStorageKey('one')).not.toBe(await recentStorageKey('two'))
  })
  it('writes only successful opened files, deduplicated and capped at twenty', async () => {
    const { api, controller, store } = setup()
    await controller.choose(api)
    api.requestOpen.mockResolvedValueOnce({ status: 'cancelled' })
    await controller.open(api, { id: 'a' })
    expect(store.setItem).not.toHaveBeenCalled()
    for (let n = 0; n < 23; n++) await controller.open(api, { path: `notes/${n}.md` })
    await controller.open(api, { path: 'notes/21.md' })
    expect(controller.state.recent).toHaveLength(20)
    expect(controller.state.recent.slice(0, 2)).toEqual(['notes/21.md', 'notes/22.md'])
    expect(store.setItem).toHaveBeenLastCalledWith(
      await recentStorageKey('stable-key'),
      JSON.stringify(controller.state.recent),
    )
    expect(
      store.setItem.mock.calls.every(
        ([, value]) => !value.includes('root-1') && !value.includes('resolved'),
      ),
    ).toBe(true)
  })
  it('requires renewed root selection before loading persisted relative paths', async () => {
    const store = storage()
    store.getItem.mockResolvedValue(
      JSON.stringify(['old.md', '../secret', '/absolute', 2, 'old.md']),
    )
    const { api, controller } = setup(backend(), store)
    expect(store.getItem).not.toHaveBeenCalled()
    expect(controller.state.recent).toEqual([])
    await controller.choose(api)
    expect(controller.state.recent).toEqual(['old.md'])
    await controller.open(api, { path: 'old.md' })
    expect(api.resolveEntry).toHaveBeenCalledWith(root.id, 'old.md', {
      signal: expect.any(AbortSignal),
    })
    expect(api.requestOpen).toHaveBeenCalledWith('resolved', { signal: expect.any(AbortSignal) })
  })
  it('keeps recent records scoped to each root key', async () => {
    const { api, controller, store } = setup()
    store.getItem.mockResolvedValueOnce('["first.md"]').mockResolvedValueOnce('["second.md"]')
    await controller.choose(api)
    api.chooseRoot.mockResolvedValueOnce({ ...root, id: 'new', key: 'other-key' })
    await controller.choose(api)
    expect(controller.state.recent).toEqual(['second.md'])
    expect(store.getItem).toHaveBeenLastCalledWith(await recentStorageKey('other-key'))
  })
  it('does not remember missing, rejected, or cancelled late opens', async () => {
    const { api, controller, store } = setup()
    await controller.choose(api)
    api.resolveEntry.mockResolvedValueOnce(null)
    await controller.open(api, { path: 'missing.md' })
    expect(api.requestOpen).not.toHaveBeenCalled()
    api.requestOpen.mockRejectedValueOnce(new Error('Save cancelled'))
    await controller.open(api, { id: 'a' })
    const wait = deferred<{ status: 'opened' | 'cancelled' }>()
    api.requestOpen.mockReturnValueOnce(wait.promise)
    const operation = controller.open(api, { id: 'a' })
    await flush()
    controller.cancel()
    wait.resolve({ status: 'opened' })
    await operation
    expect(store.setItem).not.toHaveBeenCalled()
    expect(controller.state.recent).toEqual([])
  })
  it('surfaces a storage failure without claiming the file failed to open', async () => {
    const { api, controller, store } = setup()
    await controller.choose(api)
    store.setItem.mockRejectedValueOnce(new Error('quota'))
    await controller.open(api, { id: 'a' })
    expect(controller.state.error).toContain('文件已打开')
    expect(controller.state.current).toBe('a.md')
  })
})

describe('controlled workspace UI', () => {
  it('attempts restoration only on first visible render and keeps explicit selection available after failure', async () => {
    const api = {
      ...backend(),
      restoreRoot: vi.fn(async () => {
        throw Error('permission denied')
      }),
    }
    const requestUpdate = vi.fn(async () => {})
    plugin.activate({
      pluginId: 'milkup.workspace',
      permissions: ['workspace:read'],
      host: {
        workspace: api,
        storage: storage(),
        ui: { requestUpdate, revealLine: async () => {} },
      },
    })
    plugin.renderers['workspace-panel']({ node: { phase: 'mount', visible: false } })
    expect(api.restoreRoot).not.toHaveBeenCalled()
    plugin.renderers['workspace-panel']({ node: { phase: 'update', visible: true } })
    await flush()
    const failed = nodes(
      plugin.renderers['workspace-panel']({ node: { phase: 'update', visible: true } }),
    )
    expect(
      failed.some((node) => node.attributes?.role === 'alert' && node.text?.includes('重新选择')),
    ).toBe(true)
    expect(api.restoreRoot).toHaveBeenCalledTimes(1)
    plugin.commands['workspace.choose']({ host: { workspace: api } })
    await vi.waitFor(() => expect(api.listChildren).toHaveBeenCalledTimes(1))
    const restored = nodes(
      plugin.renderers['workspace-panel']({ node: { phase: 'update', visible: true } }),
    )
    expect(restored.some((node) => node.text === 'Project')).toBe(true)
    expect(api.restoreRoot).toHaveBeenCalledTimes(1)
  })

  it('uses stable complete relative-path tree labels and plain text names', async () => {
    const { api, controller } = setup()
    const literal = '<img src=x onerror=alert(1)>.md'
    api.listChildren.mockResolvedValueOnce({
      entries: [entry('unsafe', literal), entry('dir', 'docs', 'directory')],
      nextCursor: 'next',
    })
    await controller.choose(api)
    const tree = nodes(render(controller.state)).filter(
      (node) => node.attributes?.role === 'treeitem',
    )
    expect(tree.map((node) => node.attributes?.['aria-label'])).toEqual([literal, 'docs'])
    expect(tree[0]?.text).toBe(literal)
    expect(tree[1]?.attributes?.['aria-expanded']).toBe('false')
    expect(
      tree.every((node) => node.tag === 'button' && node.attributes?.['aria-level'] === '1'),
    ).toBe(true)
  })
  it('returns immediately from trusted commands and aborts when the UI closes', async () => {
    const api = backend()
    const wait = deferred<typeof root | null>()
    api.chooseRoot.mockReturnValueOnce(wait.promise)
    const requestUpdate = vi.fn(async () => {})
    plugin.activate({
      pluginId: 'milkup.workspace',
      permissions: ['workspace:read'],
      host: {
        workspace: api,
        storage: storage(),
        ui: { requestUpdate, revealLine: async () => {} },
      },
    })
    plugin.renderers['workspace-panel']({ node: { phase: 'mount' } })
    expect(plugin.commands['workspace.choose']({ host: { workspace: api } })).toBeUndefined()
    expect(api.chooseRoot).toHaveBeenCalledTimes(1)
    const signal = (api.chooseRoot.mock.calls[0]![0] as { signal: AbortSignal }).signal
    plugin.renderers['workspace-panel']({ node: { phase: 'dispose' } })
    expect(signal.aborted).toBe(true)
    const calls = requestUpdate.mock.calls.length
    wait.resolve(root)
    await flush()
    expect(requestUpdate.mock.calls.length).toBe(calls)
    expect(api.releaseRoot).toHaveBeenCalledWith(root.id)
  })
  it('rejects commands with no trusted workspace scope', async () => {
    const { controller, api } = setup()
    await controller.choose(undefined)
    expect(api.chooseRoot).not.toHaveBeenCalled()
    expect(controller.state.phase).toBe('error')
  })
  it('pauses a hidden sidebar without destroying the root and ignores late pages', async () => {
    const api = backend()
    const requestUpdate = vi.fn(async () => {})
    plugin.activate({
      pluginId: 'milkup.workspace',
      permissions: ['workspace:read'],
      host: { workspace: api, ui: { requestUpdate, revealLine: async () => {} } },
    })
    plugin.renderers['workspace-panel']({ node: { phase: 'mount', visible: true } })
    plugin.commands['workspace.choose']({ host: { workspace: api } })
    await vi.waitFor(() => expect(api.listChildren).toHaveBeenCalledTimes(1))
    const wait = deferred<Awaited<ReturnType<typeof api.listChildren>>>()
    api.listChildren.mockReturnValueOnce(wait.promise)
    plugin.commands['workspace.toggle']({}, { id: 'dir' })
    await flush()
    const signal = (api.listChildren.mock.calls.at(-1)![1] as { signal: AbortSignal }).signal
    plugin.renderers['workspace-panel']({ node: { phase: 'blur', visible: true } })
    expect(signal.aborted).toBe(false)
    plugin.renderers['workspace-panel']({ node: { phase: 'update', visible: false } })
    expect(signal.aborted).toBe(true)
    expect(api.releaseRoot).not.toHaveBeenCalled()
    wait.resolve({ entries: [entry('late')], nextCursor: null })
    await flush()
    const tree = nodes(
      plugin.renderers['workspace-panel']({ node: { phase: 'update', visible: true } }),
    )
    expect(tree.some((node) => node.text === 'Project')).toBe(true)
    expect(tree.some((node) => node.attributes?.['aria-label'] === 'late.md')).toBe(false)
    expect(tree.some((node) => node.attributes?.['aria-label'] === 'a.md')).toBe(true)
  })
})

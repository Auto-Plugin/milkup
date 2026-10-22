import type {
  SdkPluginStorage,
  SdkPluginWorkspaceReadHost,
  SdkPluginWorkspaceHost,
  SdkWorkspaceEntry,
  SdkWorkspaceRoot,
} from '@milkup/plugin-sdk'

export interface Directory {
  entries: SdkWorkspaceEntry[]
  cursor: string | null
  loaded: boolean
  expanded: boolean
}
export interface State {
  root?: SdkWorkspaceRoot
  directories: Map<string, Directory>
  recent: string[]
  current?: string
  phase: 'idle' | 'choosing' | 'loading' | 'opening' | 'cancelled' | 'error'
  error?: string
}
const empty = (): Directory => ({ entries: [], cursor: null, loaded: false, expanded: true })
// Public storage keys are restricted to 128 ASCII letters/digits/._-.
// Root keys are opaque, so hash rather than embedding their spelling or length.
export async function recentStorageKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return `recent.v1.${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
const validPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.startsWith('/') &&
  !value.includes('\\') &&
  !value.split('/').some((part) => part === '..' || part === '.')

export function createController(
  host: SdkPluginWorkspaceReadHost | undefined,
  storage: SdkPluginStorage | undefined,
  changed: () => void,
) {
  const state: State = { directories: new Map(), recent: [], phase: 'idle' }
  let disposed = false
  let restoreAttempted = false
  let generation = 0
  let pending: AbortController | undefined
  let storageWrites = Promise.resolve()
  const emit = () => {
    if (!disposed) changed()
  }
  const release = async (id: string) => {
    try {
      await host?.releaseRoot(id)
    } catch {
      /* already revoked */
    }
  }
  const cancel = (notify = true) => {
    generation++
    pending?.abort()
    pending = undefined
    if (state.phase !== 'idle') state.phase = 'cancelled'
    delete state.error
    if (notify) emit()
  }
  async function run(
    phase: State['phase'],
    task: (signal: AbortSignal, current: () => boolean) => Promise<void>,
  ) {
    if (disposed || pending) return
    const token = ++generation
    const abort = new AbortController()
    pending = abort
    state.phase = phase
    delete state.error
    emit()
    const current = () => !disposed && token === generation && !abort.signal.aborted
    try {
      if (!host) throw new Error('请先批准 workspace:read 能力并启用插件。')
      await task(abort.signal, current)
      if (current()) state.phase = 'idle'
    } catch (error) {
      if (current()) {
        state.phase = 'error'
        state.error = error instanceof Error ? error.message : String(error)
      }
    } finally {
      if (token === generation) {
        pending = undefined
        emit()
      }
    }
  }
  async function page(directoryId: string, signal: AbortSignal, current: () => boolean) {
    const root = state.root
    if (!root || !host) return
    const directory = state.directories.get(directoryId) ?? empty()
    state.directories.set(directoryId, directory)
    const cursor = directory.loaded ? directory.cursor : null
    // Cursors are single use. A cancelled/failed continuation must restart this
    // directory rather than replaying the consumed cursor. Keep cached rows
    // visible until that first page succeeds, then replace them atomically.
    directory.loaded = false
    directory.cursor = null
    const result = await host.listChildren(root.id, {
      ...(directoryId ? { directoryId } : {}),
      ...(cursor ? { cursor } : {}),
      limit: 100,
      signal,
    })
    if (!current()) return
    if (cursor) {
      const ids = new Set(directory.entries.map((entry) => entry.id))
      directory.entries.push(...result.entries.filter((entry) => !ids.has(entry.id)))
    } else {
      const forget = (entries: readonly SdkWorkspaceEntry[]) => {
        for (const entry of entries) {
          const nested = state.directories.get(entry.id)
          if (nested) {
            forget(nested.entries)
            state.directories.delete(entry.id)
          }
        }
      }
      forget(directory.entries)
      directory.entries = [...result.entries]
    }
    directory.cursor = result.nextCursor
    directory.loaded = true
  }
  function choose(scope: SdkPluginWorkspaceHost | undefined, restoring = false) {
    return run(restoring ? 'loading' : 'choosing', async (signal, current) => {
      if (!scope && !restoring) throw new Error('请使用工作区中的选择按钮授权文件夹。')
      const previous = state.root
      const root = await (restoring
        ? host?.restoreRoot?.({ signal }).catch(() => {
            throw new Error('上次选择的文件夹已失效或无法访问，请重新选择文件夹。')
          })
        : scope!.chooseRoot({ signal }))
      if (!current()) {
        if (root) {
          await release(root.id)
          if (state.root === previous) {
            delete state.root
            state.directories.clear()
            state.recent = []
            delete state.current
            emit()
          }
        }
        return
      }
      if (!root) return
      state.root = root
      state.directories = new Map([['', empty()]])
      state.recent = []
      delete state.current
      if (previous && previous.id !== root.id) void release(previous.id)
      try {
        const key = await recentStorageKey(root.key)
        const saved: unknown = JSON.parse((await storage?.getItem(key)) || '[]')
        if (current() && Array.isArray(saved))
          state.recent = [...new Set(saved.filter(validPath))].slice(0, 20)
      } catch {
        /* corrupt preferences must not prevent folder access */
      }
      if (current()) await page('', signal, current)
    })
  }
  function refresh() {
    return run('loading', async (signal, current) => {
      if (!state.root || !host) return
      const previous = state.root
      // Refresh revokes the previous generation. Never offer its stale buttons
      // after cancellation or failure, even if the host reply arrives late.
      delete state.root
      state.directories.clear()
      delete state.current
      emit()
      const root = await host.refreshRoot(previous.id, { signal })
      if (!current()) {
        await release(root.id)
        return
      }
      state.root = root
      state.directories = new Map([['', empty()]])
      delete state.current
      await page('', signal, current)
    })
  }
  function more(id = '') {
    return run('loading', async (signal, current) => {
      const directory = state.directories.get(id)
      if (directory?.loaded && !directory.cursor) return
      await page(id, signal, current)
    })
  }
  function find(id: string) {
    return [...state.directories.values()]
      .flatMap((directory) => directory.entries)
      .find((entry) => entry.id === id)
  }
  async function toggle(id: string) {
    const entry = find(id)
    if (entry?.kind !== 'directory') return
    const directory = state.directories.get(id)
    if (directory) {
      directory.expanded = !directory.expanded
      emit()
      if (!directory.expanded || directory.loaded) return
    } else state.directories.set(id, empty())
    await more(id)
  }
  function open(scope: SdkPluginWorkspaceHost | undefined, input: { id?: string; path?: string }) {
    return run('opening', async (signal, current) => {
      const root = state.root
      if (!root || !host || !scope) throw new Error('请重新选择文件夹，然后使用文件按钮打开。')
      const selected = input.path ? undefined : find(input.id || '')
      const relativePath =
        input.path || (selected?.kind === 'file' ? selected.relativePath : undefined)
      if (!relativePath) throw new Error('文件已不存在或不可访问；请刷新文件夹。')
      // A previous save may atomically replace the file and invalidate its old
      // listing handle. Each explicit click resolves the already displayed path
      // afresh under this root; the host still validates it before opening.
      const entry = await host.resolveEntry(root.id, relativePath, { signal })
      if (!current()) return
      if (!entry || entry.kind !== 'file') throw new Error('文件已不存在或不可访问；请刷新文件夹。')
      const result = await scope.requestOpen(entry.id, { signal })
      if (!current() || result.status !== 'opened') return
      state.current = entry.relativePath
      state.recent = [
        entry.relativePath,
        ...state.recent.filter((item) => item !== entry.relativePath),
      ].slice(0, 20)
      const key = await recentStorageKey(root.key)
      const value = JSON.stringify(state.recent)
      storageWrites = storageWrites
        .catch(() => {})
        .then(async () => {
          await storage?.setItem(key, value)
        })
      try {
        await storageWrites
      } catch {
        if (current()) throw new Error('文件已打开，但最近文件记录未能保存。')
      }
    })
  }
  return {
    state,
    choose,
    restore() {
      if (disposed || pending || restoreAttempted || state.root) return Promise.resolve()
      restoreAttempted = true
      if (!host?.restoreRoot) return Promise.resolve()
      return choose(undefined, true)
    },
    refresh,
    more,
    toggle,
    open,
    cancel,
    async dispose() {
      if (disposed) return
      disposed = true
      cancel(false)
      const root = state.root
      delete state.root
      state.directories.clear()
      if (root) await release(root.id)
      await storageWrites.catch(() => {})
    },
  }
}

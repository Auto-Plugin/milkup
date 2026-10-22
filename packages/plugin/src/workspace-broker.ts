import type { PluginManifest } from './manifest'
import { consumePluginCommandGesture, revokePluginCommandGestures } from './workspace-gesture'

export interface PluginWorkspaceRoot {
  readonly id: string
  /** Stable metadata key, not an authorization token. */
  readonly key: string
  readonly label: string
}
export interface PluginWorkspaceEntry {
  readonly id: string
  readonly name: string
  readonly kind: 'file' | 'directory'
  readonly relativePath: string
}
export interface PluginWorkspacePage {
  readonly entries: readonly PluginWorkspaceEntry[]
  readonly nextCursor: string | null
}
export interface PluginWorkspaceOperationOptions {
  readonly signal?: AbortSignal
}
export interface PluginWorkspaceListOptions extends PluginWorkspaceOperationOptions {
  readonly directoryId?: string
  readonly cursor?: string
  readonly limit?: number
}
export interface PluginWorkspaceReadHost {
  /** Restore only the host-owned last selection, once per activation. No paths authorize access. */
  restoreRoot?(options?: PluginWorkspaceOperationOptions): Promise<PluginWorkspaceRoot | null>
  listChildren(rootId: string, options?: PluginWorkspaceListOptions): Promise<PluginWorkspacePage>
  resolveEntry(
    rootId: string,
    relativePath: string,
    options?: PluginWorkspaceOperationOptions,
  ): Promise<PluginWorkspaceEntry | null>
  refreshRoot(
    rootId: string,
    options?: PluginWorkspaceOperationOptions,
  ): Promise<PluginWorkspaceRoot>
  releaseRoot(rootId: string): Promise<void>
}
export interface PluginWorkspaceHost extends PluginWorkspaceReadHost {
  chooseRoot(options?: PluginWorkspaceOperationOptions): Promise<PluginWorkspaceRoot | null>
  requestOpen(
    fileId: string,
    options?: PluginWorkspaceOperationOptions,
  ): Promise<{ readonly status: 'opened' | 'cancelled' }>
}
/** Native adapter owns path containment, descriptor-based reads and the protected
 * document transition. Honor signal before committing grants or document changes. */
export interface PluginWorkspaceBrokerAdapter extends PluginWorkspaceHost {}
export interface PluginWorkspaceGestureOptions extends PluginWorkspaceOperationOptions {
  readonly gesture?: string
}
export interface PluginWorkspaceBroker extends PluginWorkspaceReadHost {
  chooseRoot(options?: PluginWorkspaceGestureOptions): Promise<PluginWorkspaceRoot | null>
  requestOpen(
    fileId: string,
    options?: PluginWorkspaceGestureOptions,
  ): Promise<{ readonly status: 'opened' | 'cancelled' }>
}
export interface RevocablePluginWorkspaceBroker extends PluginWorkspaceBroker {
  dispose(): void
}
export interface PluginWorkspaceBrokerConfig {
  readonly manifest: PluginManifest
  readonly adapter: PluginWorkspaceBrokerAdapter
  readonly isActive?: () => boolean
  readonly onDispose?: () => void
  /** Trusted host test/embedding seam; never exposed in the SDK or RPC. */
  readonly consumeGesture?: (proof: string | undefined, pluginId: string) => boolean
}
export type PluginWorkspaceErrorCode =
  | 'revoked'
  | 'invalid-token'
  | 'invalid-path'
  | 'invalidated'
  | 'gesture-required'
  | 'quota'
  | 'busy'
  | 'aborted'
  | 'unavailable'
export class PluginWorkspaceError extends Error {
  constructor(readonly code: PluginWorkspaceErrorCode) {
    super(`Workspace operation failed: ${code}`)
    this.name = 'PluginWorkspaceError'
  }
}
export function workspaceFailure(code: PluginWorkspaceErrorCode): never {
  throw new PluginWorkspaceError(code)
}
export function assertWorkspaceId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    workspaceFailure('invalid-token')
}
export function assertWorkspaceRelativePath(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    /[\\\x00-\x1f\x7f:]/.test(value)
  )
    workspaceFailure('invalid-path')
  const parts = value.split('/')
  if (
    parts.length > 64 ||
    parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))
  )
    workspaceFailure('invalid-path')
}
export function assertWorkspaceLimit(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 200)
    workspaceFailure('quota')
}
function copyRoot(root: PluginWorkspaceRoot): PluginWorkspaceRoot {
  assertWorkspaceId(root.id)
  assertWorkspaceId(root.key)
  if (typeof root.label !== 'string' || root.label.length > 1024) workspaceFailure('unavailable')
  return Object.freeze({ id: root.id, key: root.key, label: root.label })
}
function copyEntry(entry: PluginWorkspaceEntry): PluginWorkspaceEntry {
  assertWorkspaceId(entry.id)
  assertWorkspaceRelativePath(entry.relativePath)
  if (
    typeof entry.name !== 'string' ||
    entry.name.length === 0 ||
    entry.name.length > 1024 ||
    !['file', 'directory'].includes(entry.kind)
  )
    workspaceFailure('unavailable')
  return Object.freeze({
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    relativePath: entry.relativePath,
  })
}

export function createPluginWorkspaceBroker(
  config: PluginWorkspaceBrokerConfig,
): RevocablePluginWorkspaceBroker {
  let disposed = false
  let choosing = false
  let restoreAttempted = false
  const roots = new Map<string, PluginWorkspaceRoot>()
  const entries = new Map<string, { rootId: string; entry: PluginWorkspaceEntry }>()
  const cursors = new Map<string, { rootId: string; directoryId?: string; generation: number }>()
  const enumerations = new Map<string, number>()
  const pending = new Map<AbortController, string | undefined>()
  const active = () => {
    if (disposed) workspaceFailure('revoked')
    if (config.isActive?.() === false || !config.manifest.permissions?.includes('workspace:read')) {
      dispose()
      workspaceFailure('revoked')
    }
  }
  const root = (id: string) => {
    active()
    assertWorkspaceId(id)
    if (!roots.has(id)) workspaceFailure('invalid-token')
  }
  const gesture = (proof?: string) => {
    active()
    if (!(config.consumeGesture ?? consumePluginCommandGesture)(proof, config.manifest.id))
      workspaceFailure('gesture-required')
  }
  const retire = (rootId: string) => {
    roots.delete(rootId)
    for (const [id, value] of entries) if (value.rootId === rootId) entries.delete(id)
    for (const [id, value] of cursors) if (value.rootId === rootId) cursors.delete(id)
    for (const key of enumerations.keys())
      if (key.startsWith(`${rootId}:`)) enumerations.delete(key)
    for (const [controller, id] of pending) if (id === rootId) controller.abort()
  }
  const remember = (rootId: string, entry: PluginWorkspaceEntry) => {
    if (!entries.has(entry.id) && entries.size >= 8192) workspaceFailure('quota')
    const previous = entries.get(entry.id)
    if (
      previous &&
      (previous.rootId !== rootId ||
        previous.entry.relativePath !== entry.relativePath ||
        previous.entry.kind !== entry.kind)
    )
      workspaceFailure('invalid-token')
    entries.set(entry.id, { rootId, entry })
    return entry
  }
  async function run<T>(
    rootId: string | undefined,
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    active()
    if (signal?.aborted) workspaceFailure('aborted')
    if (pending.size >= 16) workspaceFailure('quota')
    const controller = new AbortController()
    pending.set(controller, rootId)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    let abortListener: (() => void) | undefined
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          active()
          if (controller.signal.aborted) workspaceFailure('aborted')
          return operation(controller.signal)
        }),
        new Promise<never>((_, reject) => {
          abortListener = () => reject(new PluginWorkspaceError(disposed ? 'revoked' : 'aborted'))
          controller.signal.addEventListener('abort', abortListener, { once: true })
        }),
      ])
      active()
      if (controller.signal.aborted) workspaceFailure('aborted')
      if (rootId && !roots.has(rootId)) workspaceFailure('invalidated')
      return result
    } catch (error) {
      if (error instanceof PluginWorkspaceError) throw error
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      const safeCodes: readonly PluginWorkspaceErrorCode[] = [
        'revoked',
        'invalid-token',
        'invalid-path',
        'invalidated',
        'gesture-required',
        'quota',
        'busy',
        'aborted',
        'unavailable',
      ]
      if (safeCodes.includes(code as PluginWorkspaceErrorCode))
        throw new PluginWorkspaceError(code as PluginWorkspaceErrorCode)
      // Do not expose native absolute paths or OS diagnostics to the plugin.
      return workspaceFailure('unavailable')
    } finally {
      pending.delete(controller)
      signal?.removeEventListener('abort', abort)
      if (abortListener) controller.signal.removeEventListener('abort', abortListener)
    }
  }
  function dispose(): void {
    if (disposed) return
    disposed = true
    revokePluginCommandGestures(config.manifest.id)
    for (const controller of pending.keys()) controller.abort()
    roots.clear()
    entries.clear()
    cursors.clear()
    enumerations.clear()
    config.onDispose?.()
  }
  async function acquireRoot(
    options: PluginWorkspaceOperationOptions | undefined,
    restoring: boolean,
  ) {
    if (choosing) workspaceFailure('busy')
    choosing = true
    try {
      const selected = await run(undefined, options?.signal, async (signal) => {
        const value = await (restoring
          ? (config.adapter.restoreRoot?.({ signal }) ?? Promise.resolve(null))
          : config.adapter.chooseRoot({ signal }))
        if (!value) return null
        try {
          if (signal.aborted) workspaceFailure('aborted')
          const selected = copyRoot(value)
          const previous = [...roots.keys()]
          if (previous.includes(selected.id)) workspaceFailure('invalidated')
          for (const id of previous) retire(id)
          for (const id of previous) await config.adapter.releaseRoot(id)
          if (signal.aborted) workspaceFailure('aborted')
          return selected
        } catch (error) {
          await config.adapter.releaseRoot(value.id).catch(() => undefined)
          throw error
        }
      })
      if (!selected) return null
      active()
      roots.set(selected.id, selected)
      return selected
    } finally {
      choosing = false
    }
  }
  return Object.freeze({
    restoreRoot: async (options?: PluginWorkspaceOperationOptions) => {
      active()
      if (restoreAttempted || roots.size) return Promise.resolve(null)
      restoreAttempted = true
      return acquireRoot(options, true)
    },
    chooseRoot: async (options?: PluginWorkspaceGestureOptions) => {
      gesture(options?.gesture)
      return acquireRoot(options, false)
    },
    listChildren: async (rootId: string, options: PluginWorkspaceListOptions = {}) => {
      root(rootId)
      const limit = options.limit ?? 100
      assertWorkspaceLimit(limit)
      if (options.directoryId !== undefined) {
        assertWorkspaceId(options.directoryId)
        const directory = entries.get(options.directoryId)
        if (directory?.rootId !== rootId || directory.entry.kind !== 'directory')
          workspaceFailure('invalid-token')
      }
      const key = `${rootId}:${options.directoryId ?? ''}`
      let generation = enumerations.get(key) ?? 0
      if (options.cursor !== undefined) {
        assertWorkspaceId(options.cursor)
        const cursor = cursors.get(options.cursor)
        if (
          !cursor ||
          cursor.rootId !== rootId ||
          cursor.directoryId !== options.directoryId ||
          cursor.generation !== generation
        )
          workspaceFailure('invalidated')
        cursors.delete(options.cursor)
      } else {
        generation++
        enumerations.set(key, generation)
        for (const [id, cursor] of cursors)
          if (cursor.rootId === rootId && cursor.directoryId === options.directoryId)
            cursors.delete(id)
      }
      const page = await run(rootId, options.signal, (signal) =>
        config.adapter.listChildren(rootId, {
          ...(options.directoryId !== undefined ? { directoryId: options.directoryId } : {}),
          ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
          limit,
          signal,
        }),
      )
      root(rootId)
      if (enumerations.get(key) !== generation) workspaceFailure('invalidated')
      if (!Array.isArray(page.entries) || page.entries.length > limit) workspaceFailure('quota')
      const copied = page.entries.map((entry) => remember(rootId, copyEntry(entry)))
      if (page.nextCursor !== null) {
        assertWorkspaceId(page.nextCursor)
        if (cursors.size >= 64) workspaceFailure('quota')
        cursors.set(page.nextCursor, {
          rootId,
          ...(options.directoryId !== undefined ? { directoryId: options.directoryId } : {}),
          generation,
        })
      }
      return Object.freeze({ entries: Object.freeze(copied), nextCursor: page.nextCursor })
    },
    resolveEntry: async (
      rootId: string,
      relativePath: string,
      options?: PluginWorkspaceOperationOptions,
    ) => {
      root(rootId)
      assertWorkspaceRelativePath(relativePath)
      const entry = await run(rootId, options?.signal, (signal) =>
        config.adapter.resolveEntry(rootId, relativePath, { signal }),
      )
      root(rootId)
      return entry ? remember(rootId, copyEntry(entry)) : null
    },
    refreshRoot: async (rootId: string, options?: PluginWorkspaceOperationOptions) => {
      root(rootId)
      const refreshed = copyRoot(
        await run(rootId, options?.signal, async (signal) => {
          const value = await config.adapter.refreshRoot(rootId, { signal })
          if (signal.aborted) {
            await config.adapter.releaseRoot(value.id)
            workspaceFailure('aborted')
          }
          return value
        }),
      )
      root(rootId)
      if (refreshed.id === rootId) workspaceFailure('invalidated')
      retire(rootId)
      roots.set(refreshed.id, refreshed)
      return refreshed
    },
    requestOpen: async (fileId: string, options?: PluginWorkspaceGestureOptions) => {
      active()
      assertWorkspaceId(fileId)
      const file = entries.get(fileId)
      if (!file || file.entry.kind !== 'file') workspaceFailure('invalid-token')
      root(file.rootId)
      gesture(options?.gesture)
      const result = await run(file.rootId, options?.signal, (signal) =>
        config.adapter.requestOpen(fileId, { signal }),
      )
      root(file.rootId)
      if (!['opened', 'cancelled'].includes(result.status)) workspaceFailure('unavailable')
      return Object.freeze({ status: result.status })
    },
    releaseRoot: async (rootId: string) => {
      root(rootId)
      retire(rootId)
      await run(undefined, undefined, () => config.adapter.releaseRoot(rootId))
    },
    dispose,
  })
}

export function createPluginWorkspaceHostCapabilities(
  broker: PluginWorkspaceBroker,
  isActive: () => boolean = () => true,
  command = false,
  proof?: string,
): PluginWorkspaceReadHost | PluginWorkspaceHost {
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (!isActive()) workspaceFailure('revoked')
    const result = await operation()
    if (!isActive()) workspaceFailure('revoked')
    return result
  }
  const read: PluginWorkspaceReadHost = {
    restoreRoot: (options) => run(() => broker.restoreRoot?.(options) ?? Promise.resolve(null)),
    listChildren: (rootId, options) => run(() => broker.listChildren(rootId, options)),
    resolveEntry: (rootId, relativePath, options) =>
      run(() => broker.resolveEntry(rootId, relativePath, options)),
    refreshRoot: (rootId, options) => run(() => broker.refreshRoot(rootId, options)),
    releaseRoot: (rootId) => run(() => broker.releaseRoot(rootId)),
  }
  if (!command) return Object.freeze(read)
  return Object.freeze({
    ...read,
    chooseRoot: (options?: PluginWorkspaceOperationOptions) =>
      run(() =>
        broker.chooseRoot({
          ...(options?.signal ? { signal: options.signal } : {}),
          ...(proof ? { gesture: proof } : {}),
        }),
      ),
    requestOpen: (fileId: string, options?: PluginWorkspaceOperationOptions) =>
      run(() =>
        broker.requestOpen(fileId, {
          ...(options?.signal ? { signal: options.signal } : {}),
          ...(proof ? { gesture: proof } : {}),
        }),
      ),
  })
}

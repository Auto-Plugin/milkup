import type { PluginManifest } from './manifest'
import {
  PluginEditingError,
  PLUGIN_EDITING_ERROR_CODES,
  copyPluginEditingCaptureRequest,
  copyPluginEditingSnapshot,
  copyPluginEditingApplyRequest,
  copyPluginEditingTableRequest,
  copyPluginEditingApplyResult,
  assertPluginEditingId,
  editingRecord,
  editingKeys,
  type PluginEditingHost,
  type PluginEditingSnapshot,
  type PluginEditingOperationOptions,
} from './editing-schema'
export * from './editing-schema'
export interface PluginEditingBroker extends PluginEditingHost {}
export interface PluginEditingBrokerAdapter extends PluginEditingHost {}
export interface RevocablePluginEditingBroker extends PluginEditingBroker {
  getSnapshot(id: string): PluginEditingSnapshot
  dispose(): void
}
export interface PluginEditingBrokerConfig {
  readonly manifest: PluginManifest
  readonly adapter: PluginEditingBrokerAdapter
  readonly isActive?: () => boolean
  readonly onDispose?: () => void
  readonly validateAssets?: (ids: readonly string[], snapshotId: string) => void
  readonly acceptAssets?: (ids: readonly string[], snapshotId: string) => void
}
export function createPluginEditingBroker(
  config: PluginEditingBrokerConfig,
): RevocablePluginEditingBroker {
  let disposed = false
  let capturing = 0
  const snapshots = new Map<string, PluginEditingSnapshot>()
  const busy = new Set<string>()
  const retired = new Set<string>()
  const pending = new Set<AbortController>()
  const cleanup = (id: string) => config.adapter.release(id).catch(() => undefined)
  function active() {
    if (
      !disposed &&
      (config.isActive?.() === false ||
        !config.manifest.permissions?.includes('document:read') ||
        !config.manifest.permissions?.includes('document:write'))
    )
      dispose()
    if (disposed) throw new PluginEditingError('revoked')
  }
  function getSnapshot(id: string) {
    active()
    assertPluginEditingId(id)
    const snapshot = snapshots.get(id)
    if (!snapshot) throw new PluginEditingError('invalid-snapshot')
    return snapshot
  }
  function retire(id: string) {
    snapshots.delete(id)
    retired.add(id)
    if (retired.size > 128) retired.delete(retired.values().next().value!)
  }
  async function run<T>(
    options: PluginEditingOperationOptions | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    active()
    const externalSignal = options?.signal
    if (
      options !== undefined &&
      (!editingRecord(options) ||
        !editingKeys(options, [], ['signal']) ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal)))
    )
      throw new PluginEditingError('invalid-input')
    if (externalSignal?.aborted) throw new PluginEditingError('aborted')
    if (pending.size >= 16) throw new PluginEditingError('busy')
    const controller = new AbortController()
    pending.add(controller)
    const abort = () => controller.abort()
    externalSignal?.addEventListener('abort', abort, { once: true })
    let onAbort: (() => void) | undefined
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          active()
          if (controller.signal.aborted) throw new PluginEditingError('aborted')
          return operation(controller.signal)
        }),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new PluginEditingError(disposed ? 'revoked' : 'aborted'))
          controller.signal.addEventListener('abort', onAbort, { once: true })
        }),
      ])
      active()
      if (controller.signal.aborted) throw new PluginEditingError('aborted')
      return result
    } catch (error) {
      const code = editingRecord(error) ? error.code : undefined
      throw new PluginEditingError(
        PLUGIN_EDITING_ERROR_CODES.includes(code as never)
          ? (code as PluginEditingError['code'])
          : 'unavailable',
      )
    } finally {
      pending.delete(controller)
      externalSignal?.removeEventListener('abort', abort)
      if (onAbort) controller.signal.removeEventListener('abort', onAbort)
    }
  }
  function dispose() {
    if (disposed) return
    disposed = true
    for (const c of pending) c.abort()
    for (const id of snapshots.keys()) void cleanup(id)
    snapshots.clear()
    config.onDispose?.()
  }
  return Object.freeze({
    async capture(request, options) {
      active()
      const input = copyPluginEditingCaptureRequest(request)
      if (snapshots.size + capturing >= 8) throw new PluginEditingError('busy')
      capturing++
      let issued: string | undefined
      try {
        const result = await run(options, async (signal) => {
          const raw = await config.adapter.capture(input, { signal })
          issued = raw.id
          if (signal.aborted || disposed) {
            await cleanup(raw.id)
            throw new PluginEditingError('aborted')
          }
          return copyPluginEditingSnapshot(raw)
        })
        if (snapshots.has(result.id) || retired.has(result.id))
          throw new PluginEditingError('invalid-snapshot')
        snapshots.set(result.id, result)
        return result
      } catch (error) {
        if (issued) void cleanup(issued)
        throw error
      } finally {
        capturing--
      }
    },
    async apply(request, options) {
      const snapshot = getSnapshot(request.snapshotId)
      const input = copyPluginEditingApplyRequest(request, snapshot)
      if (busy.has(snapshot.id)) throw new PluginEditingError('busy')
      if (input.assetIds?.length) {
        if (!config.validateAssets || !config.acceptAssets)
          throw new PluginEditingError('invalid-input')
        config.validateAssets(input.assetIds, snapshot.id)
      }
      busy.add(snapshot.id)
      try {
        const result = await run(options, async (signal) => {
          const value = copyPluginEditingApplyResult(await config.adapter.apply(input, { signal }))
          if (value.documentId !== snapshot.documentId) throw new PluginEditingError('stale')
          if (input.assetIds?.length) config.acceptAssets!(input.assetIds, snapshot.id)
          return value
        })
        retire(snapshot.id)
        return result
      } finally {
        busy.delete(snapshot.id)
      }
    },
    async table(request, options) {
      const input = copyPluginEditingTableRequest(request)
      const snapshot = getSnapshot(input.snapshotId)
      if (busy.has(snapshot.id)) throw new PluginEditingError('busy')
      busy.add(snapshot.id)
      try {
        const result = await run(options, async (signal) =>
          copyPluginEditingApplyResult(await config.adapter.table(input, { signal })),
        )
        if (result.documentId !== snapshot.documentId) throw new PluginEditingError('stale')
        retire(snapshot.id)
        return result
      } finally {
        busy.delete(snapshot.id)
      }
    },
    async release(id, options) {
      active()
      assertPluginEditingId(id)
      if (retired.has(id)) return
      getSnapshot(id)
      if (busy.has(id)) throw new PluginEditingError('busy')
      retire(id)
      await run(options, (signal) => config.adapter.release(id, { signal }))
    },
    getSnapshot,
    dispose,
  } satisfies RevocablePluginEditingBroker)
}
export function createPluginEditingHostCapabilities(
  broker: PluginEditingBroker,
  isActive: () => boolean = () => true,
): PluginEditingHost {
  const check = () => {
    if (!isActive()) throw new PluginEditingError('revoked')
  }
  return Object.freeze<PluginEditingHost>({
    capture: (request, options) => {
      check()
      return broker.capture(request, options)
    },
    apply: (request, options) => {
      check()
      return broker.apply(request, options)
    },
    table: (request, options) => {
      check()
      return broker.table(request, options)
    },
    release: (id, options) => {
      check()
      return broker.release(id, options)
    },
  })
}

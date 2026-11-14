import type { PluginManifest } from './manifest'
import type { PluginEditingSnapshot } from './editing-schema'
import { editingRecord, editingKeys } from './editing-schema'
import { consumePluginCommandGesture } from './workspace-gesture'
import {
  PluginResourcesError,
  PLUGIN_RESOURCES_ERROR_CODES,
  assertPluginResourcesId,
  copyPluginResourcesPrepareRequest,
  copyPluginResourcesPrepareResult,
  copyPluginResourcesSource,
  copyPluginResourcesStageRequest,
  copyPluginResourcesAsset,
  type PluginResourcesHost,
  type PluginResourcesPrepareRequest,
  type PluginResourcesPrepareResult,
  type PluginResourcesStageRequest,
  type PluginResourcesAsset,
  type PluginResourcesOperationOptions,
} from './resources-schema'
export * from './resources-schema'
export interface PluginResourcesGestureOptions extends PluginResourcesOperationOptions {
  readonly gesture?: string
}
export interface PluginResourcesBroker extends Omit<PluginResourcesHost, 'prepareDocument'> {
  prepareDocument(
    request?: PluginResourcesPrepareRequest,
    options?: PluginResourcesGestureOptions,
  ): Promise<PluginResourcesPrepareResult>
}
export interface PluginResourcesBrokerAdapter extends Omit<PluginResourcesHost, 'stage'> {
  stage(
    request: PluginResourcesStageRequest,
    snapshot: PluginEditingSnapshot,
    options?: PluginResourcesOperationOptions,
  ): Promise<PluginResourcesAsset>
}
export interface RevocablePluginResourcesBroker extends PluginResourcesBroker {
  grantPaste(id: string): void
  assertAssets(ids: readonly string[], snapshotId: string): void
  acceptAssets(ids: readonly string[], snapshotId: string): void
  dispose(): void
}
export interface PluginResourcesBrokerConfig {
  readonly manifest: PluginManifest
  readonly adapter: PluginResourcesBrokerAdapter
  readonly getSnapshot: (id: string) => PluginEditingSnapshot
  readonly isActive?: () => boolean
  readonly onDispose?: () => void
  readonly consumeGesture?: (proof: string | undefined, pluginId: string) => boolean
}
export function createPluginResourcesBroker(
  config: PluginResourcesBrokerConfig,
): RevocablePluginResourcesBroker {
  let disposed = false
  let preparing = false
  const pending = new Set<AbortController>()
  const grants = new Set<string>()
  const intents = new Set<string>()
  const sources = new Set<string>()
  const assets = new Map<string, string>()
  const retired = new Set<string>()
  const busy = new Set<string>()
  const cleanup = (id: string) => config.adapter.abort(id).catch(() => undefined)
  function active() {
    if (
      !disposed &&
      (config.isActive?.() === false || !config.manifest.permissions?.includes('images:import'))
    )
      dispose()
    if (disposed) throw new PluginResourcesError('revoked')
  }
  function own(id: string) {
    active()
    assertPluginResourcesId(id)
    if (
      !grants.has(id) &&
      !intents.has(id) &&
      !sources.has(id) &&
      !assets.has(id) &&
      !retired.has(id)
    )
      throw new PluginResourcesError('invalid-token')
  }
  function retire(id: string) {
    grants.delete(id)
    intents.delete(id)
    sources.delete(id)
    assets.delete(id)
    retired.add(id)
    if (retired.size > 128) retired.delete(retired.values().next().value!)
  }
  async function run<T>(
    options: PluginResourcesOperationOptions | undefined,
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
      throw new PluginResourcesError('invalid-input')
    if (externalSignal?.aborted) throw new PluginResourcesError('aborted')
    if (pending.size >= 16) throw new PluginResourcesError('busy')
    const c = new AbortController()
    pending.add(c)
    const abort = () => c.abort()
    externalSignal?.addEventListener('abort', abort, { once: true })
    let onAbort: (() => void) | undefined
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          active()
          if (c.signal.aborted) throw new PluginResourcesError('aborted')
          return operation(c.signal)
        }),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new PluginResourcesError(disposed ? 'revoked' : 'aborted'))
          c.signal.addEventListener('abort', onAbort, { once: true })
        }),
      ])
      active()
      if (c.signal.aborted) throw new PluginResourcesError('aborted')
      return result
    } catch (e) {
      const code = editingRecord(e) ? e.code : undefined
      throw new PluginResourcesError(
        PLUGIN_RESOURCES_ERROR_CODES.includes(code as never)
          ? (code as PluginResourcesError['code'])
          : 'unavailable',
      )
    } finally {
      pending.delete(c)
      externalSignal?.removeEventListener('abort', abort)
      if (onAbort) c.signal.removeEventListener('abort', onAbort)
    }
  }
  function assertAssets(ids: readonly string[], snapshotId: string) {
    active()
    if (ids.length > 16 || new Set(ids).size !== ids.length)
      throw new PluginResourcesError('invalid-input')
    for (const id of ids)
      if (assets.get(id) !== snapshotId) throw new PluginResourcesError('invalid-token')
  }
  function dispose() {
    if (disposed) return
    disposed = true
    for (const c of pending) c.abort()
    for (const id of [...grants, ...intents, ...sources, ...assets.keys()]) void cleanup(id)
    grants.clear()
    intents.clear()
    sources.clear()
    assets.clear()
    config.onDispose?.()
  }
  return Object.freeze({
    grantPaste(id) {
      active()
      assertPluginResourcesId(id)
      if (grants.size >= 16 || grants.has(id) || retired.has(id))
        throw new PluginResourcesError('busy')
      grants.add(id)
    },
    async prepareDocument(request, options) {
      active()
      const input = copyPluginResourcesPrepareRequest(request)
      const signal = options?.signal
      const gesture = options?.gesture
      if (
        options !== undefined &&
        (!editingRecord(options) ||
          !editingKeys(options, [], ['gesture', 'signal']) ||
          (options.gesture !== undefined && typeof options.gesture !== 'string'))
      )
        throw new PluginResourcesError('invalid-input')
      if (preparing || intents.size + sources.size + assets.size >= 16)
        throw new PluginResourcesError('busy')
      if (input.pasteId) {
        if (!grants.has(input.pasteId)) throw new PluginResourcesError('invalid-token')
        retire(input.pasteId)
      } else if (
        !(config.consumeGesture ?? consumePluginCommandGesture)(gesture, config.manifest.id)
      )
        throw new PluginResourcesError('gesture-required')
      preparing = true
      let issued: string | undefined
      try {
        return await run(signal ? { signal } : undefined, async (signal) => {
          const result = copyPluginResourcesPrepareResult(
            await config.adapter.prepareDocument(input, { signal }),
          )
          if (result.status === 'ready') {
            issued = result.id
            if (signal.aborted || disposed) {
              await cleanup(result.id)
              throw new PluginResourcesError('aborted')
            }
            if (intents.has(result.id) || retired.has(result.id))
              throw new PluginResourcesError('invalid-token')
            intents.add(result.id)
          }
          return result
        })
      } catch (error) {
        if (issued) {
          retire(issued)
          void cleanup(issued)
        }
        throw error
      } finally {
        preparing = false
        if (input.pasteId) void cleanup(input.pasteId)
      }
    },
    async choose(id, options) {
      own(id)
      if (!intents.has(id)) throw new PluginResourcesError('invalid-token')
      if (busy.has(id)) throw new PluginResourcesError('busy')
      busy.add(id)
      let issued: string | undefined
      try {
        return await run(options, async (signal) => {
          const result = copyPluginResourcesSource(await config.adapter.choose(id, { signal }))
          if (result) {
            issued = result.id
            if (signal.aborted || disposed) {
              await cleanup(result.id)
              throw new PluginResourcesError('aborted')
            }
            if (sources.has(result.id) || retired.has(result.id))
              throw new PluginResourcesError('invalid-token')
            sources.add(result.id)
          }
          retire(id)
          return result
        })
      } catch (error) {
        if (issued) {
          retire(issued)
          void cleanup(issued)
        }
        throw error
      } finally {
        busy.delete(id)
      }
    },
    async stage(request, options) {
      const input = copyPluginResourcesStageRequest(request)
      own(input.sourceId)
      if (!sources.has(input.sourceId)) throw new PluginResourcesError('invalid-token')
      if (busy.has(input.sourceId)) throw new PluginResourcesError('busy')
      const snapshot = config.getSnapshot(input.snapshotId)
      busy.add(input.sourceId)
      let issued: string | undefined
      try {
        return await run(options, async (signal) => {
          const result = copyPluginResourcesAsset(
            await config.adapter.stage(input, snapshot, { signal }),
          )
          issued = result.id
          if (signal.aborted || disposed) {
            await cleanup(result.id)
            throw new PluginResourcesError('aborted')
          }
          if (assets.has(result.id) || retired.has(result.id))
            throw new PluginResourcesError('invalid-token')
          assets.set(result.id, snapshot.id)
          retire(input.sourceId)
          return result
        })
      } catch (error) {
        if (issued) {
          retire(issued)
          void cleanup(issued)
        }
        throw error
      } finally {
        busy.delete(input.sourceId)
      }
    },
    async abort(id, options) {
      own(id)
      if (retired.has(id)) return
      if (busy.has(id)) throw new PluginResourcesError('busy')
      retire(id)
      await run(options, (signal) => config.adapter.abort(id, { signal }))
    },
    assertAssets,
    acceptAssets(ids, snapshotId) {
      assertAssets(ids, snapshotId)
      for (const id of ids) retire(id)
    },
    dispose,
  } satisfies RevocablePluginResourcesBroker)
}
export function createPluginResourcesHostCapabilities(
  broker: PluginResourcesBroker,
  isActive: () => boolean = () => true,
  gesture?: string,
): PluginResourcesHost {
  const check = () => {
    if (!isActive()) throw new PluginResourcesError('revoked')
  }
  return Object.freeze<PluginResourcesHost>({
    prepareDocument: (request, options) => {
      check()
      return broker.prepareDocument(request, {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(gesture ? { gesture } : {}),
      })
    },
    choose: (id, options) => {
      check()
      return broker.choose(id, options)
    },
    stage: (request, options) => {
      check()
      return broker.stage(request, options)
    },
    abort: (id, options) => {
      check()
      return broker.abort(id, options)
    },
  })
}

import type { PluginManifest } from './manifest'
import { editingKeys as keys, editingRecord as record } from './editing-schema'
import { consumePluginCommandGesture } from './workspace-gesture'
import {
  PluginOutputError,
  PLUGIN_OUTPUT_ERROR_CODES,
  PLUGIN_OUTPUT_LIMITS,
  assertPluginOutputId,
  copyPluginOutputCaptureRequest,
  copyPluginOutputSnapshot,
  copyPluginOutputChooseTargetRequest,
  copyPluginOutputTargetResult,
  copyPluginOutputWriteResult,
  copyPluginOutputPrintResult,
  type PluginOutputHost,
  type PluginOutputCaptureRequest,
  type PluginOutputOperationOptions,
  type PluginOutputSnapshot,
  type PluginOutputFormat,
} from './output-schema'
export * from './output-schema'

export interface PluginOutputGestureOptions extends PluginOutputOperationOptions {
  readonly gesture?: string
}
export interface PluginOutputBroker extends Omit<PluginOutputHost, 'capture'> {
  capture(
    request: PluginOutputCaptureRequest,
    options?: PluginOutputGestureOptions,
  ): Promise<PluginOutputSnapshot>
}
/** The adapter owns immutable bounded snapshots and native target/resource leases.
 * write/print must check cancellation before committing and return success after
 * a successful commit even if cancellation races with its acknowledgement. */
export interface PluginOutputBrokerAdapter extends PluginOutputHost {}
export interface RevocablePluginOutputBroker extends PluginOutputBroker {
  dispose(): void
}
export interface PluginOutputBrokerConfig {
  readonly manifest: PluginManifest
  readonly adapter: PluginOutputBrokerAdapter
  readonly isActive?: () => boolean
  readonly onDispose?: () => void
  readonly consumeGesture?: (proof: string | undefined, pluginId: string) => boolean
}
export function createPluginOutputBroker(
  config: PluginOutputBrokerConfig,
): RevocablePluginOutputBroker {
  let disposed = false
  let capturing = 0
  let choosing = 0
  const snapshots = new Map<string, { format: PluginOutputFormat; used: boolean }>()
  const targets = new Map<string, string>()
  const retired = new Set<string>()
  const pending = new Map<AbortController, string | undefined>()
  const busy = new Set<string>()
  const cleanup = (id: string) =>
    Promise.resolve()
      .then(() => config.adapter.release(id))
      .catch(() => undefined)
  function active() {
    if (
      !disposed &&
      (config.isActive?.() === false ||
        !config.manifest.permissions?.includes('document:output') ||
        !config.manifest.permissions?.includes('document:read'))
    )
      dispose()
    if (disposed) throw new PluginOutputError('revoked')
  }
  function retire(id: string) {
    snapshots.delete(id)
    targets.delete(id)
    retired.add(id)
    if (retired.size > 128) retired.delete(retired.values().next().value!)
  }
  function known(id: string) {
    active()
    assertPluginOutputId(id)
    if (!snapshots.has(id) && !targets.has(id) && !retired.has(id))
      throw new PluginOutputError('invalid-token')
  }
  function releaseOwned(id: string) {
    const ids = [
      id,
      ...[...targets].filter(([, snapshot]) => snapshot === id).map(([target]) => target),
    ]
    for (const [controller, owner] of pending) if (owner && ids.includes(owner)) controller.abort()
    for (const owned of ids) retire(owned)
    return Promise.all(ids.map(cleanup)).then(() => undefined)
  }
  function dispose() {
    if (disposed) return
    disposed = true
    for (const controller of pending.keys()) controller.abort()
    for (const id of [...snapshots.keys(), ...targets.keys()]) void cleanup(id)
    snapshots.clear()
    targets.clear()
    config.onDispose?.()
  }
  async function run<T>(
    options: PluginOutputOperationOptions | undefined,
    owner: string | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
    committed = false,
  ): Promise<T> {
    active()
    const signalOption = options?.signal
    if (
      options !== undefined &&
      (!record(options) ||
        !keys(options, [], ['signal']) ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal)))
    )
      throw new PluginOutputError('invalid-input')
    if (signalOption?.aborted) throw new PluginOutputError('aborted')
    if (pending.size >= PLUGIN_OUTPUT_LIMITS.operations) throw new PluginOutputError('busy')
    const controller = new AbortController()
    pending.set(controller, owner)
    const abort = () => controller.abort()
    signalOption?.addEventListener('abort', abort, { once: true })
    let onAbort: (() => void) | undefined
    try {
      const work = Promise.resolve().then(() => {
        active()
        if (controller.signal.aborted) throw new PluginOutputError('aborted')
        return operation(controller.signal)
      })
      void work.then(
        () => pending.delete(controller),
        () => pending.delete(controller),
      )
      const result = committed
        ? await work
        : await Promise.race([
            work,
            new Promise<never>((_, reject) => {
              onAbort = () => reject(new PluginOutputError(disposed ? 'revoked' : 'aborted'))
              controller.signal.addEventListener('abort', onAbort, { once: true })
            }),
          ])
      if (!committed) {
        active()
        if (controller.signal.aborted) throw new PluginOutputError('aborted')
      }
      return result
    } catch (error) {
      const code = record(error) ? error.code : undefined
      throw new PluginOutputError(
        PLUGIN_OUTPUT_ERROR_CODES.includes(code as never)
          ? (code as PluginOutputError['code'])
          : 'unavailable',
      )
    } finally {
      signalOption?.removeEventListener('abort', abort)
      if (onAbort) controller.signal.removeEventListener('abort', onAbort)
    }
  }
  return Object.freeze<RevocablePluginOutputBroker>({
    async capture(request, options) {
      active()
      const input = copyPluginOutputCaptureRequest(request)
      const signalOption = options?.signal
      const gesture = options?.gesture
      if (
        options !== undefined &&
        (!record(options) ||
          !keys(options, [], ['signal', 'gesture']) ||
          (options.gesture !== undefined && typeof options.gesture !== 'string') ||
          (options.signal !== undefined && !(options.signal instanceof AbortSignal)))
      )
        throw new PluginOutputError('invalid-input')
      if (signalOption?.aborted) throw new PluginOutputError('aborted')
      if (capturing + choosing + snapshots.size + targets.size >= PLUGIN_OUTPUT_LIMITS.leases)
        throw new PluginOutputError('busy')
      if (!(config.consumeGesture ?? consumePluginCommandGesture)(gesture, config.manifest.id))
        throw new PluginOutputError('gesture-required')
      capturing++
      let issued: string | undefined
      try {
        return await run(
          signalOption ? { signal: signalOption } : undefined,
          undefined,
          async (signal) => {
            const raw = await config.adapter.capture(input, { signal })
            let result: PluginOutputSnapshot
            try {
              result = copyPluginOutputSnapshot(raw)
            } catch (error) {
              if (
                record(raw) &&
                typeof raw.id === 'string' &&
                /^[A-Za-z0-9_-]{1,128}$/.test(raw.id)
              )
                await cleanup(raw.id)
              throw error
            }
            if (signal.aborted || disposed) {
              await cleanup(result.id)
              throw new PluginOutputError('aborted')
            }
            if (snapshots.has(result.id) || targets.has(result.id) || retired.has(result.id))
              throw new PluginOutputError('invalid-token')
            issued = result.id
            snapshots.set(result.id, { format: input.format, used: false })
            return result
          },
        )
      } catch (error) {
        if (issued) await releaseOwned(issued)
        throw error
      } finally {
        capturing--
      }
    },
    async chooseTarget(request, options) {
      const input = copyPluginOutputChooseTargetRequest(request)
      known(input.snapshotId)
      const snapshot = snapshots.get(input.snapshotId)
      if (!snapshot || snapshot.used || snapshot.format === 'print')
        throw new PluginOutputError('invalid-token')
      if (capturing + choosing + snapshots.size + targets.size >= PLUGIN_OUTPUT_LIMITS.leases)
        throw new PluginOutputError('busy')
      snapshot.used = true
      choosing++
      try {
        const result = await run(options, input.snapshotId, async (signal) => {
          const raw: unknown = await config.adapter.chooseTarget(input, { signal })
          let target: ReturnType<typeof copyPluginOutputTargetResult>
          try {
            target = copyPluginOutputTargetResult(raw)
          } catch (error) {
            if (record(raw) && typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(raw.id))
              await cleanup(raw.id)
            throw error
          }
          if (target.status === 'ready') {
            if (signal.aborted || disposed) {
              await cleanup(target.id)
              throw new PluginOutputError('aborted')
            }
            if (snapshots.has(target.id) || targets.has(target.id) || retired.has(target.id))
              throw new PluginOutputError('invalid-token')
            targets.set(target.id, input.snapshotId)
          }
          return target
        })
        if (result.status === 'cancelled') await releaseOwned(input.snapshotId)
        return result
      } catch (error) {
        await releaseOwned(input.snapshotId)
        throw error
      } finally {
        choosing--
      }
    },
    async write(id, options) {
      known(id)
      const snapshotId = targets.get(id)
      if (!snapshotId || busy.has(id)) throw new PluginOutputError('invalid-token')
      busy.add(id)
      try {
        return await run(
          options,
          id,
          async (signal) => copyPluginOutputWriteResult(await config.adapter.write(id, { signal })),
          true,
        )
      } finally {
        busy.delete(id)
        await releaseOwned(snapshotId)
      }
    },
    async print(id, options) {
      known(id)
      const snapshot = snapshots.get(id)
      if (!snapshot || snapshot.used || snapshot.format !== 'print')
        throw new PluginOutputError('invalid-token')
      snapshot.used = true
      try {
        return await run(
          options,
          id,
          async (signal) => copyPluginOutputPrintResult(await config.adapter.print(id, { signal })),
          true,
        )
      } finally {
        await releaseOwned(id)
      }
    },
    async release(id, options) {
      known(id)
      if (retired.has(id)) return
      await run(options, undefined, () => releaseOwned(id))
    },
    dispose,
  })
}
export function createPluginOutputHostCapabilities(
  broker: PluginOutputBroker,
  isActive: () => boolean = () => true,
  gesture?: string,
): PluginOutputHost {
  const check = () => {
    if (!isActive()) throw new PluginOutputError('revoked')
  }
  return Object.freeze<PluginOutputHost>({
    capture: (request, options) => {
      check()
      return broker.capture(request, {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(gesture ? { gesture } : {}),
      })
    },
    chooseTarget: (request, options) => {
      check()
      return broker.chooseTarget(request, options)
    },
    write: (id, options) => {
      check()
      return broker.write(id, options)
    },
    print: (id, options) => {
      check()
      return broker.print(id, options)
    },
    release: (id, options) => {
      check()
      return broker.release(id, options)
    },
  })
}

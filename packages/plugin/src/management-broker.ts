import type { PluginManifest } from './manifest'
import { consumePluginCommandGesture } from './workspace-gesture'
import {
  PluginManagementError,
  PLUGIN_MANAGEMENT_LIMITS,
  managementRecord,
  managementKeys,
  copyPluginManagementSnapshot,
  copyPluginManagementIdentity,
  copyPluginManagementDetails,
  copyPluginManagementHostViewRequest,
  copyPluginManagementHostViewResult,
  type PluginManagementHost,
  type PluginManagementReadHost,
  type PluginManagementOperationOptions,
  type PluginManagementIdentity,
  type PluginManagementDetails,
  type PluginManagementSnapshot,
  type PluginManagementHostViewRequest,
  type PluginManagementHostViewResult,
} from './management-schema'
export * from './management-schema'
export interface PluginManagementGestureOptions extends PluginManagementOperationOptions {
  readonly gesture?: string
}
export interface PluginManagementBroker extends PluginManagementReadHost {
  requestHostView(
    input: PluginManagementHostViewRequest,
    options?: PluginManagementGestureOptions,
  ): Promise<PluginManagementHostViewResult>
}
export interface PluginManagementOperationContext {
  readonly signal: AbortSignal
  readonly assertActive: () => void
}
/** Trusted adapter returns only sanitized catalog metadata. Navigation rechecks CAS and lifetime before opening host UI. */
export interface PluginManagementBrokerAdapter {
  snapshot(context: PluginManagementOperationContext): Promise<PluginManagementSnapshot>
  describe(
    input: PluginManagementIdentity,
    context: PluginManagementOperationContext,
  ): Promise<PluginManagementDetails>
  requestHostView(
    input: PluginManagementHostViewRequest,
    context: PluginManagementOperationContext,
  ): Promise<PluginManagementHostViewResult>
}
export interface RevocablePluginManagementBroker extends PluginManagementBroker {
  dispose(): void
}
export interface PluginManagementBrokerConfig {
  readonly manifest: PluginManifest
  readonly adapter: PluginManagementBrokerAdapter
  readonly isActive?: () => boolean
  readonly onDispose?: () => void
  readonly consumeGesture?: (proof: string | undefined, pluginId: string) => boolean
}
export function createPluginManagementBroker(
  config: PluginManagementBrokerConfig,
): RevocablePluginManagementBroker {
  let disposed = false
  const pending = new Set<AbortController>()
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const controller of pending) controller.abort()
    config.onDispose?.()
  }
  const active = () => {
    if (
      !disposed &&
      (!config.manifest.permissions?.includes('app:plugins') || config.isActive?.() === false)
    )
      dispose()
    if (disposed) throw new PluginManagementError('revoked')
  }
  async function run<T>(
    options: PluginManagementOperationOptions | undefined,
    operation: (context: PluginManagementOperationContext) => Promise<T>,
  ): Promise<T> {
    active()
    const signal = options?.signal
    if (
      options !== undefined &&
      (!managementRecord(options) ||
        !managementKeys(options, [], ['signal']) ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal)))
    )
      throw new PluginManagementError('invalid-input')
    if (signal?.aborted) throw new PluginManagementError('aborted')
    if (pending.size >= PLUGIN_MANAGEMENT_LIMITS.operations) throw new PluginManagementError('busy')
    const controller = new AbortController()
    pending.add(controller)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const assertActive = () => {
      active()
      if (controller.signal.aborted) throw new PluginManagementError('aborted')
    }
    let rejectAbort: (() => void) | undefined
    const work = Promise.resolve().then(() => {
      assertActive()
      return operation({ signal: controller.signal, assertActive })
    })
    void work.then(
      () => pending.delete(controller),
      () => pending.delete(controller),
    )
    try {
      const cancelled = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new PluginManagementError(disposed ? 'revoked' : 'aborted'))
        controller.signal.addEventListener('abort', rejectAbort, { once: true })
      })
      const result = await Promise.race([work, cancelled])
      assertActive()
      return result
    } catch (error) {
      throw error instanceof PluginManagementError
        ? error
        : new PluginManagementError('unavailable')
    } finally {
      signal?.removeEventListener('abort', abort)
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort)
    }
  }
  return Object.freeze({
    snapshot: (options?: PluginManagementOperationOptions) =>
      run(options, async (context) =>
        copyPluginManagementSnapshot(await config.adapter.snapshot(context)),
      ),
    describe: async (
      input: PluginManagementIdentity,
      options?: PluginManagementOperationOptions,
    ) => {
      active()
      const request = copyPluginManagementIdentity(input)
      return run(options, async (context) => {
        const result = copyPluginManagementDetails(await config.adapter.describe(request, context))
        if (result.pluginId !== request.pluginId || result.revision !== request.revision)
          throw new PluginManagementError('stale')
        return result
      })
    },
    requestHostView: async (
      input: PluginManagementHostViewRequest,
      options?: PluginManagementGestureOptions,
    ) => {
      active()
      const request = copyPluginManagementHostViewRequest(input)
      const gesture = options?.gesture,
        signal = options?.signal
      if (
        options !== undefined &&
        (!managementRecord(options) ||
          !managementKeys(options, [], ['signal', 'gesture']) ||
          (options.signal !== undefined && !(options.signal instanceof AbortSignal)) ||
          (options.gesture !== undefined &&
            (typeof options.gesture !== 'string' ||
              !/^[A-Za-z0-9_-]{1,128}$/.test(options.gesture))))
      )
        throw new PluginManagementError('invalid-input')
      if (!(config.consumeGesture ?? consumePluginCommandGesture)(gesture, config.manifest.id))
        throw new PluginManagementError('gesture-required')
      return run(signal ? { signal } : undefined, async (context) =>
        copyPluginManagementHostViewResult(await config.adapter.requestHostView(request, context)),
      )
    },
    dispose,
  })
}
export function createPluginManagementHostCapabilities(
  broker: PluginManagementBroker,
  isActive: () => boolean = () => true,
  gesture?: string,
): PluginManagementHost {
  const check = () => {
    if (!isActive()) throw new PluginManagementError('revoked')
  }
  return Object.freeze({
    snapshot: (options?: PluginManagementOperationOptions) => {
      check()
      return broker.snapshot(options)
    },
    describe: (input: PluginManagementIdentity, options?: PluginManagementOperationOptions) => {
      check()
      return broker.describe(input, options)
    },
    requestHostView: (
      input: PluginManagementHostViewRequest,
      options?: PluginManagementOperationOptions,
    ) => {
      check()
      return broker.requestHostView(input, {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(gesture ? { gesture } : {}),
      })
    },
  })
}

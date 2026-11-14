import type { PluginManifest } from './manifest'
import {
  PluginSettingsError,
  PLUGIN_SETTINGS_ERROR_CODES,
  assertPluginSettingsId,
  assertPluginSettingsScope,
  copyPluginSettingsDescriptor,
  copyPluginSettingsSnapshot,
  copyPluginSettingsValues,
  samePluginSettingsDescriptor,
  settingsKeys,
  settingsRecord,
  type PluginSettingsScope,
  type PluginSettingsHost,
  type PluginSettingsDescriptor,
  type PluginSettingsSnapshot,
  type PluginSettingsOperationOptions,
} from './settings-schema'
export * from './settings-schema'
export interface PluginSettingsBroker extends PluginSettingsHost {}
export interface RevocablePluginSettingsBroker extends PluginSettingsBroker {
  dispose(): void
}
/** Bound to one plugin. The shared engine owns the application transaction lock,
 * durable atomic commits and rollback. Honor signal before any persisted commit. */
export interface PluginSettingsBrokerAdapter extends PluginSettingsHost {}
export interface PluginSettingsBrokerConfig {
  readonly manifest: PluginManifest
  readonly adapter: PluginSettingsBrokerAdapter
  readonly isActive?: () => boolean
  readonly onDispose?: () => void
}
export function createPluginSettingsBroker(
  config: PluginSettingsBrokerConfig,
): RevocablePluginSettingsBroker {
  let disposed = false
  const opening = new Set<PluginSettingsScope>()
  const transactions = new Map<
    string,
    {
      scope: PluginSettingsScope
      descriptor: PluginSettingsDescriptor
      revision: number
      busy: boolean
    }
  >()
  const retired = new Set<string>()
  const pending = new Map<AbortController, string | undefined>()
  const ownDescriptor = config.manifest.settings
    ? copyPluginSettingsDescriptor(config.manifest.settings)
    : undefined
  const cancelAdapter = (id: string) => config.adapter.cancel(id).catch(() => undefined)
  function retire(id: string): void {
    transactions.delete(id)
    retired.add(id)
    if (retired.size > 128) retired.delete(retired.values().next().value!)
  }
  function active(): void {
    if (
      !disposed &&
      (config.isActive?.() === false || !config.manifest.permissions?.includes('settings:write'))
    )
      dispose()
    if (disposed) throw new PluginSettingsError('revoked')
  }
  function scope(value: unknown): asserts value is PluginSettingsScope {
    active()
    assertPluginSettingsScope(value)
    if (value === 'plugin' && !ownDescriptor) throw new PluginSettingsError('invalid-scope')
  }
  function descriptor(value: unknown, target: PluginSettingsScope): PluginSettingsDescriptor {
    const result = copyPluginSettingsDescriptor(value)
    if (
      target === 'plugin' &&
      (!ownDescriptor || !samePluginSettingsDescriptor(result, ownDescriptor))
    )
      throw new PluginSettingsError('invalid-input')
    return result
  }
  function snapshot(
    value: unknown,
    target: PluginSettingsScope,
    expected?: PluginSettingsDescriptor,
  ): PluginSettingsSnapshot {
    const result = copyPluginSettingsSnapshot(value)
    descriptor({ schema: result.schema, defaults: result.defaults }, target)
    if (expected && !samePluginSettingsDescriptor(result, expected))
      throw new PluginSettingsError('conflict')
    return result
  }
  function transaction(id: unknown) {
    active()
    assertPluginSettingsId(id)
    const tx = transactions.get(id)
    if (!tx) throw new PluginSettingsError('invalid-transaction')
    return tx
  }
  async function run<T>(
    options: PluginSettingsOperationOptions | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
    id?: string,
  ): Promise<T> {
    active()
    const signal = options?.signal
    if (
      options !== undefined &&
      (!settingsRecord(options) ||
        !settingsKeys(options, [], ['signal']) ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal)))
    )
      throw new PluginSettingsError('invalid-input')
    if (signal?.aborted) throw new PluginSettingsError('aborted')
    if (pending.size >= 16) throw new PluginSettingsError('busy')
    const controller = new AbortController()
    pending.set(controller, id)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    let rejectAbort: (() => void) | undefined
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          active()
          if (controller.signal.aborted) throw new PluginSettingsError('aborted')
          return operation(controller.signal)
        }),
        new Promise<never>((_, reject) => {
          rejectAbort = () => reject(new PluginSettingsError(disposed ? 'revoked' : 'aborted'))
          controller.signal.addEventListener('abort', rejectAbort, { once: true })
        }),
      ])
      active()
      if (controller.signal.aborted) throw new PluginSettingsError('aborted')
      return result
    } catch (error) {
      if (controller.signal.aborted && id) {
        retire(id)
        void cancelAdapter(id)
      }
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      throw new PluginSettingsError(
        PLUGIN_SETTINGS_ERROR_CODES.includes(code as never)
          ? (code as PluginSettingsError['code'])
          : 'unavailable',
      )
    } finally {
      pending.delete(controller)
      signal?.removeEventListener('abort', abort)
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort)
    }
  }
  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const controller of pending.keys()) controller.abort()
    for (const id of transactions.keys()) {
      retire(id)
      void cancelAdapter(id)
    }
    opening.clear()
    config.onDispose?.()
  }
  return Object.freeze<RevocablePluginSettingsBroker>({
    describe: async (target, options) => {
      scope(target)
      const result = await run(options, (signal) => config.adapter.describe(target, { signal }))
      active()
      return descriptor(result, target)
    },
    get: async (target, options) => {
      scope(target)
      const result = await run(options, (signal) => config.adapter.get(target, { signal }))
      active()
      return snapshot(result, target)
    },
    begin: async (target, options) => {
      scope(target)
      if (opening.has(target) || [...transactions.values()].some((tx) => tx.scope === target))
        throw new PluginSettingsError('busy')
      opening.add(target)
      let issued: string | undefined
      try {
        const result = await run(options, async (signal) => {
          const value = await config.adapter.begin(target, { signal })
          assertPluginSettingsId(value.id)
          issued = value.id
          if (signal.aborted) {
            await cancelAdapter(value.id)
            throw new PluginSettingsError('aborted')
          }
          return value
        })
        active()
        if (
          !settingsRecord(result) ||
          !settingsKeys(result, ['id', 'snapshot']) ||
          transactions.has(result.id) ||
          retired.has(result.id)
        )
          throw new PluginSettingsError('invalid-transaction')
        const copied = snapshot(result.snapshot, target)
        transactions.set(result.id, {
          scope: target,
          descriptor: copied,
          revision: copied.revision,
          busy: false,
        })
        return Object.freeze({ id: result.id, snapshot: copied })
      } catch (error) {
        if (issued) await cancelAdapter(issued)
        throw error
      } finally {
        opening.delete(target)
      }
    },
    preview: async (id, patch, options) => {
      const tx = transaction(id)
      const copiedPatch = copyPluginSettingsValues(patch, tx.descriptor.schema, true)
      if (tx.busy) throw new PluginSettingsError('busy')
      tx.busy = true
      try {
        const result = await run(
          options,
          (signal) => config.adapter.preview(id, copiedPatch, { signal }),
          id,
        )
        transaction(id)
        const copied = snapshot(result, tx.scope, tx.descriptor)
        if (copied.revision < tx.revision) throw new PluginSettingsError('conflict')
        tx.revision = copied.revision
        return copied
      } finally {
        tx.busy = false
      }
    },
    commit: async (id, options) => {
      const tx = transaction(id)
      if (tx.busy) throw new PluginSettingsError('busy')
      tx.busy = true
      try {
        const result = await run(options, (signal) => config.adapter.commit(id, { signal }), id)
        transaction(id)
        const copied = snapshot(result, tx.scope, tx.descriptor)
        if (copied.revision < tx.revision) throw new PluginSettingsError('conflict')
        retire(id)
        return copied
      } finally {
        tx.busy = false
      }
    },
    cancel: async (id, options) => {
      active()
      assertPluginSettingsId(id)
      if (retired.has(id)) return
      const tx = transaction(id)
      retire(id)
      for (const [controller, transactionId] of pending)
        if (transactionId === id) controller.abort()
      try {
        await run(options, (signal) => config.adapter.cancel(id, { signal }))
      } catch (error) {
        // Cancelling the RPC must not strand an already-visible preview. The
        // rollback retry intentionally has no caller-controlled AbortSignal.
        try {
          await config.adapter.cancel(id)
        } catch {
          if (!disposed) {
            retired.delete(id)
            transactions.set(id, tx)
          }
        }
        throw error
      }
      active()
    },
    dispose,
  })
}
export function createPluginSettingsHostCapabilities(
  broker: PluginSettingsBroker,
  isActive: () => boolean = () => true,
): PluginSettingsHost {
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (!isActive()) throw new PluginSettingsError('revoked')
    const result = await operation()
    if (!isActive()) throw new PluginSettingsError('revoked')
    return result
  }
  return Object.freeze<PluginSettingsHost>({
    describe: (scope, options) => run(() => broker.describe(scope, options)),
    get: (scope, options) => run(() => broker.get(scope, options)),
    begin: (scope, options) => run(() => broker.begin(scope, options)),
    preview: (id, patch, options) => run(() => broker.preview(id, patch, options)),
    commit: (id, options) => run(() => broker.commit(id, options)),
    cancel: (id, options) => run(() => broker.cancel(id, options)),
  })
}

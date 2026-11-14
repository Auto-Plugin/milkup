import {
  PluginSettingsError,
  assertPluginSettingsScope,
  copyPluginSettingsDescriptor,
  copyPluginSettingsValues,
  samePluginSettingsDescriptor,
  settingsKeys,
  settingsRecord,
  type PluginSettingsBrokerAdapter,
  type PluginSettingsDescriptor,
  type PluginSettingsOperationOptions,
  type PluginSettingsScope,
  type PluginSettingsSnapshot,
  type PluginSettingsValues,
} from '@milkup/plugin'

export const desktopSettingsStorageKey = 'milkup.desktop.settings.v1'
export const legacyAppearanceStorageKey = 'milkup.desktop.appearance.v1'
const maximumStoredCharacters = 256 * 1024
const maximumPluginScopes = 64
const pluginIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)*$/

/** Only trusted host code defines settings that can affect the application view. */
export const desktopApplicationSettingsDescriptor = copyPluginSettingsDescriptor({
  schema: {
    'editor.fontFamily': { type: 'enum', options: ['system', 'serif', 'monospace'] },
    'editor.fontSize': { type: 'number', minimum: 12, maximum: 32, step: 1 },
    'editor.lineWidth': { type: 'number', minimum: 480, maximum: 1200, step: 1, allowZero: true },
    'editor.lineHeight': { type: 'number', minimum: 1.2, maximum: 2.4, step: 0.1 },
    'editor.indentSize': { type: 'enum', options: [2, 4] },
    'editor.indentStyle': { type: 'enum', options: ['spaces', 'tabs'] },
    'appearance.theme': { type: 'enum', options: ['system', 'light', 'dark'] },
    'appearance.zoom': { type: 'enum', options: [1, 1.25, 1.5, 2] },
  },
  defaults: {
    'editor.fontFamily': 'monospace',
    'editor.fontSize': 14,
    'editor.lineWidth': 0,
    'editor.lineHeight': 1.5,
    'editor.indentSize': 2,
    'editor.indentStyle': 'spaces',
    'appearance.theme': 'system',
    'appearance.zoom': 1,
  },
})

interface SavedScope {
  readonly revision: number
  readonly values: PluginSettingsValues
}
interface SettingsStore {
  readonly version: 1
  readonly application: SavedScope
  readonly plugins: Readonly<Record<string, SavedScope>>
}
interface ScopeState {
  readonly key: string
  readonly descriptor: PluginSettingsDescriptor
  saved: SavedScope
  transaction?: SettingsTransaction
}
interface SettingsOwner {
  readonly token: string
  readonly pluginId: string
  readonly descriptor?: PluginSettingsDescriptor
  readonly lifetime: AbortController
  sequence: number
}
interface SettingsTransaction {
  readonly id: string
  readonly owner: SettingsOwner
  readonly scope: ScopeState
  readonly revision: number
  readonly baseValues: PluginSettingsValues
  readonly lifetime: AbortController
  values: PluginSettingsValues
  cancelled: boolean
}

function failure(error: unknown): PluginSettingsError {
  return error instanceof PluginSettingsError ? error : new PluginSettingsError('unavailable')
}
function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PluginSettingsError('aborted')
}
function validPluginId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= 128 && pluginIdPattern.test(id)
}
function readSavedScope(value: unknown, descriptor?: PluginSettingsDescriptor): SavedScope {
  if (
    !settingsRecord(value) ||
    !settingsKeys(value, ['revision', 'values']) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  ) {
    throw new PluginSettingsError('invalid-input')
  }
  return Object.freeze({
    revision: value.revision as number,
    values: copyPluginSettingsValues(value.values, descriptor?.schema),
  })
}

/** Shared host state. Adapters are bound to one plugin and never accept a target plugin ID.
 * applyView must finish applying its values before resolving; rollback calls use no cancelled signal. */
export function createDesktopSettingsService(options: {
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | undefined
  readonly applyView: (values: PluginSettingsValues, signal?: AbortSignal) => void | Promise<void>
  readonly onError?: (error: unknown) => void
}) {
  let store: SettingsStore = {
    version: 1,
    application: { revision: 0, values: desktopApplicationSettingsDescriptor.defaults },
    plugins: {},
  }
  const application: ScopeState = {
    key: 'application',
    descriptor: desktopApplicationSettingsDescriptor,
    saved: store.application,
  }
  const pluginScopes = new Map<string, ScopeState>()
  const transactions = new Map<string, SettingsTransaction>()
  const owners = new Set<SettingsOwner>()
  const lifetime = new AbortController()
  let queue: Promise<unknown> = Promise.resolve()
  let applied = desktopApplicationSettingsDescriptor.defaults
  let viewNeedsRecovery = false
  let storedRaw: string | null = null

  function report(error: unknown): void {
    // An observer cannot prevent resource rollback or replace the operation's error.
    try {
      options.onError?.(error)
    } catch {
      /* observer only */
    }
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation)
    queue = result.catch(() => undefined)
    return result
  }
  function active(owner?: SettingsOwner, signal?: AbortSignal): void {
    if (lifetime.signal.aborted || owner?.lifetime.signal.aborted)
      throw new PluginSettingsError('revoked')
    checkSignal(signal)
  }
  function snapshot(scope: ScopeState): PluginSettingsSnapshot {
    return Object.freeze({
      ...scope.descriptor,
      revision: scope.saved.revision,
      values: scope.transaction?.values ?? scope.saved.values,
    })
  }
  function readStore(raw: string | null): SettingsStore {
    if (raw !== null) {
      if (raw.length > maximumStoredCharacters) throw new PluginSettingsError('invalid-input')
      const value: unknown = JSON.parse(raw)
      if (
        !settingsRecord(value) ||
        !settingsKeys(value, ['version', 'application', 'plugins']) ||
        value.version !== 1 ||
        !settingsRecord(value.plugins) ||
        Object.keys(value.plugins).length > maximumPluginScopes
      ) {
        throw new PluginSettingsError('invalid-input')
      }
      const plugins: Record<string, SavedScope> = {}
      for (const [id, saved] of Object.entries(value.plugins)) {
        if (!validPluginId(id)) throw new PluginSettingsError('invalid-input')
        plugins[id] = readSavedScope(saved)
      }
      return {
        version: 1,
        application: readSavedScope(value.application, application.descriptor),
        plugins,
      }
    }
    const defaults: SettingsStore = {
      version: 1,
      application: { revision: 0, values: application.descriptor.defaults },
      plugins: {},
    }
    const legacy = options.storage?.getItem(legacyAppearanceStorageKey)
    if (legacy === undefined || legacy === null) return defaults
    if (legacy.length > 4096) throw new PluginSettingsError('invalid-input')
    const value: unknown = JSON.parse(legacy)
    if (!settingsRecord(value) || !settingsKeys(value, [], ['theme', 'zoom'])) {
      throw new PluginSettingsError('invalid-input')
    }
    return {
      ...defaults,
      application: {
        revision: 0,
        values: copyPluginSettingsValues(
          {
            ...application.descriptor.defaults,
            ...(Object.hasOwn(value, 'theme') ? { 'appearance.theme': value.theme } : {}),
            ...(Object.hasOwn(value, 'zoom') ? { 'appearance.zoom': value.zoom } : {}),
          },
          application.descriptor.schema,
        ),
      },
    }
  }
  async function restoreView(values: PluginSettingsValues): Promise<void> {
    try {
      await options.applyView(values)
      applied = values
      viewNeedsRecovery = false
    } catch (error) {
      viewNeedsRecovery = true
      report(error)
      throw failure(error)
    }
  }
  async function applyView(values: PluginSettingsValues, signal?: AbortSignal): Promise<void> {
    const previous = applied
    checkSignal(signal)
    try {
      await options.applyView(values, signal)
      checkSignal(signal)
      applied = values
      viewNeedsRecovery = false
    } catch (error) {
      await restoreView(previous)
      throw failure(error)
    }
  }
  const ready = (async () => {
    try {
      const raw = options.storage?.getItem(desktopSettingsStorageKey) ?? null
      store = readStore(raw)
      application.saved = store.application
      await applyView(store.application.values, lifetime.signal)
      storedRaw = raw
    } catch (error) {
      report(error)
      throw failure(error)
    }
  })()

  async function synchronizeStore(): Promise<void> {
    let raw: string | null
    try {
      raw = options.storage?.getItem(desktopSettingsStorageKey) ?? null
    } catch (error) {
      throw failure(error)
    }
    if (raw === storedRaw) return
    let candidate: SettingsStore
    try {
      candidate = readStore(raw)
    } catch (error) {
      throw failure(error)
    }
    const pluginUpdates = [...pluginScopes.values()].map(
      (scope) =>
        [
          scope,
          Object.hasOwn(candidate.plugins, scope.key)
            ? readSavedScope(candidate.plugins[scope.key], scope.descriptor)
            : { revision: 0, values: scope.descriptor.defaults },
        ] as const,
    )
    if (
      !application.transaction &&
      JSON.stringify(candidate.application.values) !== JSON.stringify(application.saved.values)
    ) {
      await applyView(candidate.application.values, lifetime.signal)
    }
    application.saved = candidate.application
    for (const [scope, saved] of pluginUpdates) scope.saved = saved
    store = candidate
    storedRaw = raw
  }

  function scopeFor(owner: SettingsOwner, scope: PluginSettingsScope): ScopeState {
    assertPluginSettingsScope(scope)
    if (scope === 'application') return application
    if (!owner.descriptor) throw new PluginSettingsError('invalid-scope')
    const existing = pluginScopes.get(owner.pluginId)
    if (existing) {
      if (!samePluginSettingsDescriptor(existing.descriptor, owner.descriptor))
        throw new PluginSettingsError('conflict')
      return existing
    }
    if (pluginScopes.size >= maximumPluginScopes) throw new PluginSettingsError('busy')
    const saved = Object.hasOwn(store.plugins, owner.pluginId)
      ? readSavedScope(store.plugins[owner.pluginId], owner.descriptor)
      : { revision: 0, values: owner.descriptor.defaults }
    const result: ScopeState = { key: owner.pluginId, descriptor: owner.descriptor, saved }
    pluginScopes.set(owner.pluginId, result)
    return result
  }
  function owns(owner: SettingsOwner, id: unknown): id is string {
    if (typeof id !== 'string' || !id.startsWith(`${owner.token}_`)) return false
    const suffix = id.slice(owner.token.length + 1)
    const sequence = Number(suffix)
    return (
      String(sequence) === suffix &&
      Number.isSafeInteger(sequence) &&
      sequence >= 1 &&
      sequence <= owner.sequence
    )
  }
  function transactionFor(owner: SettingsOwner, id: string): SettingsTransaction {
    if (!owns(owner, id)) throw new PluginSettingsError('invalid-transaction')
    const transaction = transactions.get(id)
    if (!transaction || transaction.owner !== owner)
      throw new PluginSettingsError('invalid-transaction')
    if (transaction.cancelled) throw new PluginSettingsError('aborted')
    if (
      transaction.scope.transaction !== transaction ||
      transaction.scope.saved.revision !== transaction.revision ||
      JSON.stringify(transaction.scope.saved.values) !== JSON.stringify(transaction.baseValues)
    ) {
      throw new PluginSettingsError('conflict')
    }
    return transaction
  }
  function detach(transaction: SettingsTransaction): void {
    transactions.delete(transaction.id)
    if (transaction.scope.transaction === transaction) delete transaction.scope.transaction
  }
  function persist(scope: ScopeState, values: PluginSettingsValues): void {
    if (!options.storage) throw new PluginSettingsError('unavailable')
    const revision = scope.saved.revision + 1
    if (!Number.isSafeInteger(revision)) throw new PluginSettingsError('conflict')
    const saved = Object.freeze({ revision, values })
    const candidate: SettingsStore =
      scope === application
        ? { ...store, application: saved }
        : { ...store, plugins: { ...store.plugins, [scope.key]: saved } }
    if (Object.keys(candidate.plugins).length > maximumPluginScopes)
      throw new PluginSettingsError('busy')
    const serialized = JSON.stringify(candidate)
    if (serialized.length > maximumStoredCharacters) throw new PluginSettingsError('invalid-input')
    try {
      if (options.storage.getItem(desktopSettingsStorageKey) !== storedRaw)
        throw new PluginSettingsError('conflict')
      options.storage.setItem(desktopSettingsStorageKey, serialized)
    } catch (error) {
      throw failure(error)
    }
    // setItem is the synchronous durable commit point. No abort check may turn
    // a completed write into a reported cancellation after this point.
    store = candidate
    storedRaw = serialized
    scope.saved = saved
  }
  async function withSignal<T>(
    signals: readonly (AbortSignal | undefined)[],
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    for (const signal of signals) {
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) controller.abort()
    }
    try {
      checkSignal(controller.signal)
      return await operation(controller.signal)
    } finally {
      for (const signal of signals) signal?.removeEventListener('abort', abort)
    }
  }
  async function cancelTransaction(transaction: SettingsTransaction): Promise<void> {
    if (!transactions.has(transaction.id)) return
    let synchronizationFailure: unknown
    if (transaction.scope === application) {
      try {
        await synchronizeStore()
      } catch (error) {
        synchronizationFailure = error
        report(error)
      }
      // Even if the latest persisted record cannot be read, remove the preview
      // by restoring the last known base, then report the synchronization error.
      await restoreView(application.saved.values)
    }
    detach(transaction)
    if (synchronizationFailure) throw failure(synchronizationFailure)
  }
  async function recoverCancelled(scope: ScopeState): Promise<void> {
    // A failed disable rollback remains visible, but does not create a permanent
    // dead lock: the next settings action retries restoration before proceeding.
    if (scope.transaction?.cancelled) await cancelTransaction(scope.transaction)
  }
  function markCancelled(transaction: SettingsTransaction): void {
    transaction.cancelled = true
    transaction.lifetime.abort()
  }
  async function disposeOwner(owner: SettingsOwner): Promise<void> {
    owner.lifetime.abort()
    const owned = [...transactions.values()].filter((transaction) => transaction.owner === owner)
    for (const transaction of owned) markCancelled(transaction)
    await enqueue(async () => {
      for (const transaction of owned) await cancelTransaction(transaction)
      owners.delete(owner)
    })
  }

  return {
    ready,
    getApplicationSnapshot: () => snapshot(application),
    /** Host theme/zoom commands share the same canonical state and never bypass a preview lock. */
    changeApplication(
      patch: PluginSettingsValues,
      request: PluginSettingsOperationOptions = {},
    ): Promise<PluginSettingsSnapshot> {
      return enqueue(async () => {
        await ready
        active(undefined, request.signal)
        await synchronizeStore()
        await recoverCancelled(application)
        active(undefined, request.signal)
        if (application.transaction) throw new PluginSettingsError('busy')
        const values = copyPluginSettingsValues(
          {
            ...application.saved.values,
            ...copyPluginSettingsValues(patch, application.descriptor.schema, true),
          },
          application.descriptor.schema,
        )
        const previous = application.saved.values
        return withSignal([lifetime.signal, request.signal], async (signal) => {
          await applyView(values, signal)
          try {
            active(undefined, signal)
            persist(application, values)
          } catch (error) {
            await restoreView(previous)
            throw failure(error)
          }
          return snapshot(application)
        })
      })
    },
    adapterForPlugin(pluginId: string, descriptor?: PluginSettingsDescriptor) {
      active()
      if (!validPluginId(pluginId)) throw new PluginSettingsError('invalid-input')
      const owner: SettingsOwner = {
        token: `settings-${crypto.randomUUID()}`,
        pluginId,
        ...(descriptor ? { descriptor: copyPluginSettingsDescriptor(descriptor) } : {}),
        lifetime: new AbortController(),
        sequence: 0,
      }
      owners.add(owner)
      const adapter: PluginSettingsBrokerAdapter = {
        describe: async (scope, request = {}) => {
          await ready
          active(owner, request.signal)
          return scopeFor(owner, scope).descriptor
        },
        get: async (scope, request = {}) => {
          await ready
          active(owner, request.signal)
          return snapshot(scopeFor(owner, scope))
        },
        begin: (scope, request = {}) =>
          enqueue(async () => {
            await ready
            active(owner, request.signal)
            await synchronizeStore()
            const state = scopeFor(owner, scope)
            await recoverCancelled(state)
            active(owner, request.signal)
            if (state.transaction) throw new PluginSettingsError('busy')
            const transaction: SettingsTransaction = {
              id: `${owner.token}_${++owner.sequence}`,
              owner,
              scope: state,
              revision: state.saved.revision,
              baseValues: state.saved.values,
              values: state.saved.values,
              lifetime: new AbortController(),
              cancelled: false,
            }
            state.transaction = transaction
            transactions.set(transaction.id, transaction)
            return Object.freeze({ id: transaction.id, snapshot: snapshot(state) })
          }),
        preview: (id, patch, request = {}) =>
          enqueue(async () => {
            await ready
            active(owner, request.signal)
            const transaction = transactionFor(owner, id)
            const values = copyPluginSettingsValues(
              {
                ...transaction.values,
                ...copyPluginSettingsValues(patch, transaction.scope.descriptor.schema, true),
              },
              transaction.scope.descriptor.schema,
            )
            return withSignal(
              [lifetime.signal, owner.lifetime.signal, transaction.lifetime.signal, request.signal],
              async (signal) => {
                const previous = transaction.values
                try {
                  if (transaction.scope === application) await applyView(values, signal)
                  active(owner, signal)
                  transactionFor(owner, id)
                  transaction.values = values
                  return snapshot(transaction.scope)
                } catch (error) {
                  // Cancellation can arrive in the microtask between applyView's
                  // resolution and publishing the successful preview snapshot.
                  if (transaction.scope === application && applied === values)
                    await restoreView(previous)
                  throw failure(error)
                }
              },
            )
          }),
        commit: (id, request = {}) =>
          enqueue(async () => {
            await ready
            active(owner, request.signal)
            await synchronizeStore()
            active(owner, request.signal)
            const transaction = transactionFor(owner, id)
            if (transaction.scope === application && viewNeedsRecovery)
              throw new PluginSettingsError('unavailable')
            persist(transaction.scope, transaction.values)
            detach(transaction)
            return snapshot(transaction.scope)
          }),
        cancel: async (id, request = {}) => {
          checkSignal(request.signal)
          if (!owns(owner, id)) throw new PluginSettingsError('invalid-transaction')
          const transaction = transactions.get(id)
          if (!transaction) return
          markCancelled(transaction)
          await enqueue(() => cancelTransaction(transaction))
        },
      }
      return { adapter, dispose: () => disposeOwner(owner) }
    },
    async dispose(): Promise<void> {
      lifetime.abort()
      const results = await Promise.allSettled([...owners].map((owner) => disposeOwner(owner)))
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failure(failed.reason)
    },
  }
}

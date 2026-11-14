import {
  PluginResourcesError,
  copyPluginResourcesAsset,
  copyPluginResourcesSource,
  type PluginEditingSnapshot,
  type PluginResourcesAsset,
  type PluginResourcesBrokerAdapter,
  type PluginResourcesOperationOptions,
  type PluginResourcesSource,
} from '@milkup/plugin'

export interface DesktopResourceDocument {
  readonly documentId: string
  readonly version: number
  readonly selectionRevision: number
  readonly saveLocationGeneration: number
  readonly path?: string
  readonly editable?: boolean
}
export interface DesktopResourceSaveTarget {
  readonly id: string
  readonly path: string
}
export interface DesktopResourceRelocation {
  readonly id: string
  readonly replacements: Readonly<Record<string, string>>
}
export type DesktopResourceTransport = <T>(
  command: string,
  args: Record<string, unknown>,
) => Promise<T>
export interface DesktopResourceServiceConfig {
  readonly currentDocument: () => DesktopResourceDocument
  readonly ensureDocumentSaved: () => Promise<boolean>
  readonly transport?: DesktopResourceTransport
  readonly onError?: (error: unknown) => void
}
interface Pending {
  readonly owner: symbol
  readonly document: DesktopResourceDocument
  readonly created: number
}
interface Intent extends Pending {
  readonly file?: File
}
interface Source extends Pending {
  readonly source: PluginResourcesSource
}
interface Asset extends Pending {
  readonly asset: PluginResourcesAsset
  readonly transactionId: string
  readonly snapshotId: string
}
interface NativePrepared {
  readonly id: string
  readonly assets: readonly {
    readonly id: string
    readonly relativePath: string
    readonly mimeType: string
    readonly width: number
    readonly height: number
  }[]
}
interface Paste {
  readonly owner: symbol
  readonly document: DesktopResourceDocument
  readonly file?: File
  readonly pending?: Promise<File | undefined>
  readonly cancel?: () => void
  readonly created: number
}
const maxBytes = 16 * 1024 * 1024
const timeout = 120_000
const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const usedPasteEvents = new WeakSet<Event>()

function failure(code: ConstructorParameters<typeof PluginResourcesError>[0]): never {
  throw new PluginResourcesError(code)
}
function active(options?: PluginResourcesOperationOptions): void {
  if (options?.signal?.aborted) failure('aborted')
}
function sameDocument(
  a: DesktopResourceDocument,
  b: DesktopResourceDocument,
  location = true,
): boolean {
  return (
    a.documentId === b.documentId &&
    a.version === b.version &&
    a.selectionRevision === b.selectionRevision &&
    (!location || a.saveLocationGeneration === b.saveLocationGeneration)
  )
}
function nativePaste(event: Event, file?: File): boolean {
  try {
    const type = Object.getOwnPropertyDescriptor(Event.prototype, 'type')!.get!.call(event)
    const phase = Object.getOwnPropertyDescriptor(Event.prototype, 'eventPhase')!.get!.call(event)
    const trusted = (
      Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted')?.get ??
      Object.getOwnPropertyDescriptor(event, 'isTrusted')?.get
    )?.call(event)
    if (
      type !== 'paste' ||
      !phase ||
      !trusted ||
      usedPasteEvents.has(event) ||
      !(event instanceof ClipboardEvent)
    )
      return false
    const transfer = Object.getOwnPropertyDescriptor(
      ClipboardEvent.prototype,
      'clipboardData',
    )?.get?.call(event) as DataTransfer | null
    if (!transfer) return false
    if (file) {
      if (!Array.from(transfer.files).includes(file)) return false
    } else if (
      transfer.files.length ||
      transfer.items.length ||
      transfer.types.length ||
      transfer.getData('text/plain') ||
      transfer.getData('text/html')
    )
      return false
    usedPasteEvents.add(event)
    return true
  } catch {
    return false
  }
}

/** Start the browser read synchronously while user activation is still live.
 * This helper returns bytes only to its host caller; it never grants authority. */
export async function readClipboardImageWithinLease(
  read: () => Promise<readonly ClipboardItem[]>,
  verify: () => void,
  signal: AbortSignal,
): Promise<File | undefined> {
  verify()
  if (signal.aborted) failure('aborted')
  let rejectAbort!: (error: unknown) => void
  const abort = () => rejectAbort(new PluginResourcesError('aborted'))
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 10_000)
  try {
    // Deliberately no await, task scheduling, or prior operation before read().
    const reading = read()
    const items = await Promise.race([reading, cancelled])
    verify()
    if (signal.aborted) failure('aborted')
    if (items.length > 8) failure('too-large')
    const images = items.filter((item) => item.types.some((type) => allowedMimeTypes.has(type)))
    if (!images.length) return undefined
    if (images.length !== 1) failure('invalid-input')
    const item = images[0]!
    const mime = [...allowedMimeTypes].find((type) => item.types.includes(type))!
    const blob = await Promise.race([item.getType(mime), cancelled])
    verify()
    if (signal.aborted) failure('aborted')
    if (blob.type !== mime) failure('invalid-input')
    if (blob.size < 1 || blob.size > maxBytes) failure('too-large')
    const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length)
    return new File([blob], `clipboard.${extension}`, { type: mime })
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

export function createDesktopResourceService(config: DesktopResourceServiceConfig) {
  const transport: DesktopResourceTransport =
    config.transport ??
    (async <T>(command: string, args: Record<string, unknown>) => {
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window))
        failure('unsupported')
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<T>(command, args)
    })
  const pastes = new Map<string, Paste>()
  const pluginOwners = new Map<string, symbol>()
  const pasteOwner = (pluginId: string): symbol => {
    const owner = pluginOwners.get(pluginId)
    if (!owner) failure('invalid-token')
    return owner
  }
  const intents = new Map<string, Intent>()
  const sources = new Map<string, Source>()
  const assets = new Map<string, Asset>()
  const relocations = new Set<string>()
  const pinned = new Set<string>()
  const deferredAborts = new Set<string>()
  const report = (error: unknown) => {
    try {
      config.onError?.(error)
    } catch {
      /* Reporting must never invalidate an accepted document commit. */
    }
  }
  const current = (): DesktopResourceDocument => Object.freeze({ ...config.currentDocument() })
  const check = (
    document: DesktopResourceDocument,
    options?: PluginResourcesOperationOptions,
  ): void => {
    active(options)
    if (config.currentDocument().editable === false) failure('readonly')
    if (!sameDocument(document, current())) failure('stale')
  }
  const fresh = (
    record: Pending,
    owner: symbol,
    options?: PluginResourcesOperationOptions,
  ): void => {
    if (record.owner !== owner) failure('invalid-token')
    if (Date.now() - record.created > timeout) failure('invalid-token')
    check(record.document, options)
  }
  async function abortOwned(id: string, owner?: symbol): Promise<void> {
    const paste = pastes.get(id)
    if (paste) {
      if (owner !== undefined && paste.owner !== owner) return
      pastes.delete(id)
      paste.cancel?.()
      return
    }
    const intent = intents.get(id)
    if (intent && (owner === undefined || intent.owner === owner)) {
      intents.delete(id)
      return
    }
    const source = sources.get(id)
    if (source && (owner === undefined || source.owner === owner)) {
      sources.delete(id)
      await transport('resources_release_source', { sourceId: source.source.id })
      return
    }
    const asset = assets.get(id)
    if (asset && (owner === undefined || asset.owner === owner)) {
      if (pinned.has(id)) {
        deferredAborts.add(id)
        return
      }
      deferredAborts.delete(id)
      assets.delete(id)
      await transport('resources_abort', { transactionId: asset.transactionId })
      return
    }
    if (owner === undefined && relocations.delete(id))
      await transport('resources_abort', { transactionId: id })
  }
  function adapterForPlugin(pluginId: string) {
    const owner = Symbol('resource-owner')
    pluginOwners.set(pluginId, owner)
    const pendingPasteCancels = new Set<() => void>()
    let disposed = false
    const alive = () => {
      if (disposed) failure('aborted')
    }
    const adapter: PluginResourcesBrokerAdapter = {
      async prepareDocument(request, options) {
        alive()
        active(options)
        const before = current()
        if (before.editable === false) failure('readonly')
        let file: File | undefined
        if (request?.pasteId) {
          const paste = pastes.get(request.pasteId)
          if (paste && paste.owner !== owner) failure('invalid-token')
          pastes.delete(request.pasteId)
          if (
            !paste ||
            Date.now() - paste.created > timeout ||
            !sameDocument(paste.document, before)
          ) {
            paste?.cancel?.()
            failure('invalid-token')
          }
          const cancel = () => paste.cancel?.()
          pendingPasteCancels.add(cancel)
          options?.signal?.addEventListener('abort', cancel, { once: true })
          try {
            file = paste.file ?? (await paste.pending)
          } finally {
            options?.signal?.removeEventListener('abort', cancel)
            pendingPasteCancels.delete(cancel)
          }
          alive()
          check(paste.document, options)
          if (!file) return { status: 'cancelled' }
        }
        const saved = await config.ensureDocumentSaved()
        alive()
        if (!saved) return { status: 'cancelled' }
        active(options)
        const document = current()
        if (!document.path || !sameDocument(before, document, Boolean(before.path)))
          failure('stale')
        if (intents.size >= 16) failure('busy')
        const id = `image-intent-${crypto.randomUUID()}`
        intents.set(id, { owner, document, created: Date.now(), ...(file ? { file } : {}) })
        return { status: 'ready', id }
      },
      async choose(id, options) {
        alive()
        const intent = intents.get(id)
        if (!intent) failure('invalid-token')
        fresh(intent, owner, options)
        intents.delete(id)
        let native: PluginResourcesSource | null = null
        try {
          if (intent.file) {
            const data = new Uint8Array(await intent.file.arrayBuffer())
            check(intent.document, options)
            native = await transport<PluginResourcesSource>('resources_grant_clipboard', {
              documentId: intent.document.documentId,
              name: intent.file.name,
              data: Array.from(data),
            })
          } else
            native = await transport<PluginResourcesSource | null>('resources_choose_image', {
              documentId: intent.document.documentId,
            })
          alive()
          check(intent.document, options)
          const source = copyPluginResourcesSource(native)
          if (!source) return null
          sources.set(source.id, { owner, document: intent.document, created: Date.now(), source })
          return source
        } catch (error) {
          if (native)
            await transport('resources_release_source', { sourceId: native.id }).catch(report)
          throw error
        }
      },
      async stage(request, snapshot, options) {
        alive()
        const source = sources.get(request.sourceId)
        if (!source) failure('invalid-token')
        fresh(source, owner, options)
        if (snapshot.id !== request.snapshotId || !sameDocument(source.document, snapshot))
          failure('stale')
        sources.delete(request.sourceId)
        let prepared: NativePrepared | undefined
        try {
          prepared = await transport<NativePrepared>('resources_stage_image', {
            documentId: source.document.documentId,
            sourceId: source.source.id,
            policy: request.strategy,
          })
          alive()
          check(source.document, options)
          if (prepared.assets.length !== 1) failure('invalid-input')
          const native = prepared.assets[0]!
          const asset = copyPluginResourcesAsset({
            id: native.id,
            reference: native.relativePath,
            mimeType: native.mimeType,
            width: native.width,
            height: native.height,
            sizeBytes: source.source.sizeBytes,
          })
          assets.set(asset.id, {
            owner,
            document: source.document,
            created: Date.now(),
            asset,
            transactionId: prepared.id,
            snapshotId: snapshot.id,
          })
          return asset
        } catch (error) {
          if (prepared)
            await transport('resources_abort', { transactionId: prepared.id }).catch(report)
          else
            await transport('resources_release_source', { sourceId: source.source.id }).catch(
              report,
            )
          throw error
        }
      },
      async abort(id) {
        await abortOwned(id, owner)
      },
    }
    return Object.freeze({
      adapter,
      dispose(): void {
        if (disposed) return
        disposed = true
        if (pluginOwners.get(pluginId) === owner) pluginOwners.delete(pluginId)
        for (const [id, paste] of pastes)
          if (paste.owner === owner) {
            pastes.delete(id)
            paste.cancel?.()
          }
        for (const cancel of pendingPasteCancels) cancel()
        pendingPasteCancels.clear()
        for (const [id, record] of [...intents, ...sources, ...assets]) {
          if (record.owner === owner) void abortOwned(id, owner).catch(report)
        }
      },
    })
  }
  return Object.freeze({
    adapterForPlugin,
    grantPaste(file: File, event: Event, pluginId: string): string {
      if (!nativePaste(event, file)) failure('gesture-required')
      const owner = pasteOwner(pluginId)
      if (!allowedMimeTypes.has(file.type)) failure('unsupported')
      if (file.size < 1 || file.size > maxBytes) failure('too-large')
      for (const [id, paste] of pastes)
        if (Date.now() - paste.created > timeout) {
          pastes.delete(id)
          paste.cancel?.()
        }
      if (pastes.size >= 8) failure('busy')
      const id = `image-paste-${crypto.randomUUID()}`
      pastes.set(id, { owner, file, document: current(), created: Date.now() })
      return id
    },
    grantClipboardPaste(
      event: Event,
      options: { readonly signal: AbortSignal; readonly pluginId: string },
    ): string {
      if (!nativePaste(event)) failure('gesture-required')
      const owner = pasteOwner(options.pluginId)
      const document = current()
      check(document, options)
      if (typeof navigator === 'undefined' || !navigator.clipboard?.read) failure('unsupported')
      for (const [id, paste] of pastes)
        if (Date.now() - paste.created > timeout) {
          pastes.delete(id)
          paste.cancel?.()
        }
      if (pastes.size >= 8) failure('busy')
      const controller = new AbortController()
      const cancel = () => controller.abort()
      options.signal.addEventListener('abort', cancel, { once: true })
      const pending = readClipboardImageWithinLease(
        () => navigator.clipboard.read(),
        () => check(document, options),
        controller.signal,
      ).finally(() => options.signal.removeEventListener('abort', cancel))
      // The command consumes this promise later; suppress an unhandled rejection
      // if permission denial wins the race against worker command delivery.
      void pending.catch(() => undefined)
      const id = `image-paste-${crypto.randomUUID()}`
      pastes.set(id, { owner, document, pending, cancel, created: Date.now() })
      return id
    },
    async assertAssets(snapshot: PluginEditingSnapshot, ids: readonly string[]): Promise<void> {
      check(snapshot)
      for (const id of ids) {
        const asset = assets.get(id)
        if (!asset || asset.snapshotId !== snapshot.id || !sameDocument(asset.document, snapshot))
          failure('invalid-token')
        await transport('resources_validate_assets', {
          transactionId: asset.transactionId,
          documentId: snapshot.documentId,
          assetIds: [id],
        })
        check(snapshot)
        if (assets.get(id) !== asset) failure('invalid-token')
      }
    },
    /** Pin after the final CAS guard and before asynchronous native mutation.
     * Revocation may request cleanup but cannot remove a committing asset. */
    pinAssets(ids: readonly string[]): void {
      for (const id of ids) if (!assets.has(id) || pinned.has(id)) failure('invalid-token')
      for (const id of ids) pinned.add(id)
    },
    async releasePins(ids: readonly string[]): Promise<void> {
      for (const id of ids) pinned.delete(id)
      const cleanup = await Promise.allSettled(
        ids.filter((id) => deferredAborts.has(id)).map((id) => abortOwned(id)),
      )
      const failed = cleanup.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    },
    /** Synchronous adoption immediately after the document CAS. An IPC ACK failure
     * must never permit later plugin disposal to delete an already referenced file. */
    acceptAssets(ids: readonly string[]): void {
      for (const id of ids) {
        const asset = assets.get(id)
        if (!asset) continue
        assets.delete(id)
        pinned.delete(id)
        deferredAborts.delete(id)
        void Promise.resolve()
          .then(() =>
            transport('resources_accept', { transactionId: asset.transactionId, assetIds: [id] }),
          )
          .catch(report)
      }
    },
    abort: (id: string): Promise<void> => abortOwned(id),
    async selectSaveTarget(defaultPath: string): Promise<DesktopResourceSaveTarget | undefined> {
      return (
        (await transport<DesktopResourceSaveTarget | null>('resources_choose_save_target', {
          defaultPath,
        })) ?? undefined
      )
    },
    async restoreRecovery(
      recoveryId: string,
      documentId: string,
      relativeURLs: readonly string[],
    ): Promise<void> {
      await transport('resources_restore_recovery', {
        recoveryId,
        documentId,
        relativeUrls: [...relativeURLs],
      })
    },
    readDocumentChunk(
      documentId: string,
      expectedVersion: number,
      fromByte: number,
    ): Promise<{ text: string; nextByte: number; totalBytes: number }> {
      return transport('resources_read_document_chunk', { documentId, expectedVersion, fromByte })
    },
    async prepareRelocation(
      documentId: string,
      targetId: string,
      relativeURLs: readonly string[],
    ): Promise<DesktopResourceRelocation> {
      const result = await transport<DesktopResourceRelocation>('resources_prepare_relocation', {
        documentId,
        targetId,
        relativeUrls: [...relativeURLs],
      })
      relocations.add(result.id)
      return result
    },
    async commitRelocation(id: string): Promise<void> {
      if (!relocations.has(id)) failure('invalid-token')
      await transport('resources_commit_relocation', { transactionId: id })
      relocations.delete(id)
    },
    async resolveImage(
      documentId: string,
      relativeURL: string,
      options?: { readonly signal?: AbortSignal },
    ) {
      if (options?.signal?.aborted || !isManagedResourceReference(relativeURL)) return undefined
      const result = await transport<{
        data: number[]
        mimeType: string
        width: number
        height: number
      }>('resources_resolve_image', { documentId, relativeUrl: relativeURL })
      if (options?.signal?.aborted) return undefined
      if (
        !allowedMimeTypes.has(result.mimeType) ||
        result.data.length < 1 ||
        result.data.length > maxBytes
      )
        failure('invalid-input')
      const bytes = Uint8Array.from(result.data)
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }))
      let disposed = false
      const dispose = () => {
        if (disposed) return
        disposed = true
        URL.revokeObjectURL(url)
        options?.signal?.removeEventListener('abort', dispose)
      }
      options?.signal?.addEventListener('abort', dispose, { once: true })
      return Object.freeze({
        url,
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
        dispose,
      })
    },
    async releaseDocument(documentId: string): Promise<void> {
      for (const [id, paste] of pastes)
        if (paste.document.documentId === documentId) pastes.delete(id)
      const cleanup = await Promise.allSettled(
        [...intents, ...sources, ...assets]
          .filter(([, record]) => record.document.documentId === documentId)
          .map(([id]) => abortOwned(id)),
      )
      await transport('resources_release_document', { documentId })
      const failed = cleanup.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    },
  })
}

export function isManagedResourceReference(url: string): boolean {
  try {
    if (url.length > 2048 || /[?:#\\]/u.test(url)) return false
    const decoded = decodeURIComponent(url).replace(/^\.\//u, '')
    const parts = decoded.split('/')
    return (
      parts.length === 2 &&
      parts.every(
        (part) =>
          part.length > 0 &&
          part !== '.' &&
          part !== '..' &&
          !/[\\:\x00-\x1f\x7f]/u.test(part) &&
          !/[. ]$/u.test(part),
      ) &&
      (parts[0] === 'assets' || (parts[0]!.endsWith('.assets') && parts[0]!.length > 7))
    )
  } catch {
    return false
  }
}
export type DesktopResourceService = ReturnType<typeof createDesktopResourceService>

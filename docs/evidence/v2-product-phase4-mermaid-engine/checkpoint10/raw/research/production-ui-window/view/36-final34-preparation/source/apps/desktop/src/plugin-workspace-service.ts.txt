import {
  PluginWorkspaceError,
  type PluginWorkspaceBrokerAdapter,
  type PluginWorkspaceRoot,
  type PluginWorkspaceEntry,
  type PluginWorkspacePage,
} from '@milkup/plugin'
import type { OpenFileResult } from '@milkup/tauri-bridge'
import type { DesktopLargeTextFileOpenResult } from './large-file-service'

export type WorkspaceInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>
export interface WorkspaceOpenLease {
  readonly metadata: {
    readonly path: string
    readonly sizeBytes: number
    readonly readonly: boolean
  }
  read(documentId: string): Promise<OpenFileResult>
  openLarge(documentId: string): Promise<DesktopLargeTextFileOpenResult>
  validate(): Promise<void>
  accept(): Promise<void>
}
export interface WorkspaceOpenRequest {
  readonly signal: AbortSignal
  prepare(): Promise<WorkspaceOpenLease>
}

/** Native scope and file-descriptor leases only. Navigation state belongs to the plugin. */
export function createDesktopWorkspaceAdapter(options: {
  invoke?: WorkspaceInvoke
  openDocument(request: WorkspaceOpenRequest): Promise<{ status: 'opened' | 'cancelled' }>
}) {
  const invoke = options.invoke ?? nativeWorkspaceInvoke
  const lifetime = new AbortController()
  let scope: Promise<string> | undefined
  const active = (signal?: AbortSignal) => {
    if (lifetime.signal.aborted || signal?.aborted)
      throw new DOMException('工作区访问已取消', 'AbortError')
  }
  const getScope = async (signal?: AbortSignal) => {
    active(signal)
    scope ??= invoke<string>('workspace_create_scope')
    const id = await scope
    active(signal)
    return id
  }
  const run = async <T>(
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ) => {
    active(signal)
    const controller = new AbortController()
    const cancel = () => controller.abort()
    lifetime.signal.addEventListener('abort', cancel, { once: true })
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      return await operation(controller.signal)
    } finally {
      lifetime.signal.removeEventListener('abort', cancel)
      signal?.removeEventListener('abort', cancel)
    }
  }
  const releaseLateRoot = async (
    scopeId: string,
    root: PluginWorkspaceRoot | null,
    signal: AbortSignal,
  ) => {
    if (root && (signal.aborted || lifetime.signal.aborted))
      await invoke('workspace_release_root', { scopeId, rootId: root.id }).catch(() => undefined)
    active(signal)
    return root
  }
  const adapter: PluginWorkspaceBrokerAdapter = {
    chooseRoot: (request) =>
      run(request?.signal, async (signal) => {
        const scopeId = await getScope(signal)
        const root = await invoke<PluginWorkspaceRoot | null>('workspace_choose_root', { scopeId })
        return releaseLateRoot(scopeId, root, signal)
      }),
    listChildren: (rootId, request = {}) =>
      run(request.signal, async (signal) => {
        const scopeId = await getScope(signal)
        const result = await invoke<PluginWorkspacePage>('workspace_list_children', {
          scopeId,
          rootId,
          ...(request.directoryId ? { directoryId: request.directoryId } : {}),
          ...(request.cursor ? { cursor: request.cursor } : {}),
          ...(request.limit === undefined ? {} : { limit: request.limit }),
        })
        if (result.nextCursor && (signal.aborted || lifetime.signal.aborted))
          await invoke('workspace_cancel_cursor', { scopeId, cursor: result.nextCursor }).catch(
            () => undefined,
          )
        active(signal)
        return result
      }),
    resolveEntry: (rootId, relativePath, request) =>
      run(request?.signal, async (signal) => {
        const scopeId = await getScope(signal)
        const entry = await invoke<PluginWorkspaceEntry | null>('workspace_resolve_entry', {
          scopeId,
          rootId,
          relativePath,
        })
        active(signal)
        return entry
      }),
    refreshRoot: (rootId, request) =>
      run(request?.signal, async (signal) => {
        const scopeId = await getScope(signal)
        const root = await invoke<PluginWorkspaceRoot>('workspace_refresh_root', {
          scopeId,
          rootId,
        })
        await releaseLateRoot(scopeId, root, signal)
        return root
      }),
    releaseRoot: async (rootId) => {
      const scopeId = await getScope()
      await invoke('workspace_release_root', { scopeId, rootId })
    },
    requestOpen: (fileId, request) =>
      run(request?.signal, async (signal) => {
        const scopeId = await getScope(signal)
        let openId: string | undefined
        let accepted = false
        let finished = false
        let preparing = false
        let accepting: Promise<void> | undefined
        let cleanup: Promise<unknown> | undefined
        const activeOpen = () => {
          active(signal)
          if (finished) throw new DOMException('文件打开请求已结束', 'AbortError')
        }
        const releaseLease = async () => {
          // An accept already sent to native owns its terminal disposition.
          // Do not race an accepted:true transfer with accepted:false cleanup.
          await accepting?.catch(() => undefined)
          if (!openId || accepted) return
          cleanup ??= invoke('workspace_finish_open', { scopeId, openId, accepted: false }).catch(
            () => undefined,
          )
          await cleanup
        }
        try {
          return await options.openDocument({
            signal,
            prepare: async () => {
              activeOpen()
              if (preparing) throw Error('文件打开请求已经准备')
              preparing = true
              const prepared = await invoke<{
                id: string
                path: string
                sizeBytes: number
                readonly: boolean
              }>('workspace_prepare_open', { scopeId, fileId })
              openId = prepared.id
              try {
                activeOpen()
              } catch (error) {
                // The protected transition can settle before native preparation
                // returns. Its outer finally then has no lease ID to release.
                await releaseLease()
                throw error
              }
              const args = { scopeId, openId }
              const validate = async () => {
                activeOpen()
                await invoke('workspace_validate_open', args)
                activeOpen()
              }
              return {
                metadata: {
                  path: prepared.path,
                  sizeBytes: prepared.sizeBytes,
                  readonly: prepared.readonly,
                },
                read: async (documentId) => {
                  activeOpen()
                  const result = await invoke<OpenFileResult>('workspace_read_file', {
                    ...args,
                    documentId,
                  })
                  activeOpen()
                  return result
                },
                openLarge: async (documentId) => {
                  activeOpen()
                  const result = await invoke<DesktopLargeTextFileOpenResult>(
                    'workspace_open_large_file',
                    { ...args, documentId },
                  )
                  activeOpen()
                  return result
                },
                validate,
                accept: () => {
                  accepting ??= (async () => {
                    await validate()
                    await invoke('workspace_finish_open', { ...args, accepted: true })
                    accepted = true
                    activeOpen()
                  })()
                  return accepting
                },
              }
            },
          })
        } finally {
          finished = true
          await releaseLease()
        }
      }),
  }
  return {
    adapter,
    dispose() {
      if (lifetime.signal.aborted) return
      lifetime.abort()
      if (scope)
        void scope
          .then((scopeId) => invoke('workspace_release_scope', { scopeId }))
          .catch(() => undefined)
    },
  }
}

async function nativeWorkspaceInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<T>(command, args)
  } catch (error) {
    const message = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
    const codes = [
      'invalidated',
      'invalid-path',
      'invalid-token',
      'revoked',
      'quota',
      'busy',
      'unavailable',
    ] as const
    const code = codes.find((value) => message.startsWith(`[${value}]`)) ?? 'unavailable'
    // Native diagnostics may contain absolute paths. Only the fixed code
    // crosses this boundary; retain neither the message nor a raw cause.
    throw new PluginWorkspaceError(code)
  }
}

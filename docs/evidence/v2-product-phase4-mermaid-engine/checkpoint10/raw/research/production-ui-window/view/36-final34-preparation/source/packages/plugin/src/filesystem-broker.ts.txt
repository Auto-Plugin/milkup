import type { PluginManifest, PluginPermission } from './manifest'

export type PluginFileOperation = 'read' | 'write' | 'delete'

export interface PluginFileBroker {
  readText(request: PluginFileReadRequest): Promise<string>
  writeText(request: PluginFileWriteRequest): Promise<PluginFileBrokerResult>
  deleteFile(request: PluginFileDeleteRequest): Promise<PluginFileBrokerResult>
}

export interface PluginFileHostCapabilities {
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
  deleteFile(path: string): Promise<void>
}

export interface PluginFileBrokerConfig {
  readonly manifest: PluginManifest
  readonly roots: readonly PluginFileScopeRoot[]
  readonly adapter: PluginFileBrokerAdapter
  readonly audit?: PluginFileAuditSink
}

export interface PluginFileScopeRoot {
  readonly id: string
  readonly path: string
  readonly operations?: readonly PluginFileOperation[]
}

export interface PluginFileBrokerAdapter {
  resolvePath(path: string): string | Promise<string>
  readText(path: string): string | Promise<string>
  writeText(path: string, text: string): void | Promise<void>
  deleteFile(path: string): void | Promise<void>
}

export interface PluginFileReadRequest {
  readonly path: string
}

export interface PluginFileWriteRequest {
  readonly path: string
  readonly text: string
}

export interface PluginFileDeleteRequest {
  readonly path: string
}

export interface PluginFileBrokerResult {
  readonly ok: true
  readonly path: string
  readonly rootId: string
}

export interface PluginFileAuditRecord {
  readonly pluginId: string
  readonly operation: PluginFileOperation
  readonly requestedPath: string
  readonly resolvedPath?: string
  readonly rootId?: string
  readonly ok: boolean
  readonly reason?: string
}

export type PluginFileAuditSink = (record: PluginFileAuditRecord) => void

interface AuthorizedPath {
  readonly resolvedPath: string
  readonly rootId: string
}

const FILE_PERMISSION_BY_OPERATION: Readonly<Record<PluginFileOperation, PluginPermission>> =
  Object.freeze({
    read: 'file:read',
    write: 'file:write',
    delete: 'file:delete',
  })

export function createPluginFileBroker(config: PluginFileBrokerConfig): PluginFileBroker {
  validateRoots(config.roots)

  return Object.freeze({
    readText: async (request: PluginFileReadRequest): Promise<string> => {
      const authorized = await authorizeFileOperation(config, 'read', request.path)

      try {
        const text = await config.adapter.readText(authorized.resolvedPath)

        auditSuccess(config, 'read', request.path, authorized)
        return text
      } catch (error) {
        auditFailure(config, 'read', request.path, error)
        throw error
      }
    },
    writeText: async (request: PluginFileWriteRequest): Promise<PluginFileBrokerResult> => {
      const authorized = await authorizeFileOperation(config, 'write', request.path)

      try {
        await config.adapter.writeText(authorized.resolvedPath, request.text)
        auditSuccess(config, 'write', request.path, authorized)
        return Object.freeze({
          ok: true,
          path: authorized.resolvedPath,
          rootId: authorized.rootId,
        })
      } catch (error) {
        auditFailure(config, 'write', request.path, error)
        throw error
      }
    },
    deleteFile: async (request: PluginFileDeleteRequest): Promise<PluginFileBrokerResult> => {
      const authorized = await authorizeFileOperation(config, 'delete', request.path)

      try {
        await config.adapter.deleteFile(authorized.resolvedPath)
        auditSuccess(config, 'delete', request.path, authorized)
        return Object.freeze({
          ok: true,
          path: authorized.resolvedPath,
          rootId: authorized.rootId,
        })
      } catch (error) {
        auditFailure(config, 'delete', request.path, error)
        throw error
      }
    },
  })
}

export function createPluginFileHostCapabilities(
  broker: PluginFileBroker,
): PluginFileHostCapabilities {
  return Object.freeze({
    readText: (path: string) => broker.readText({ path }),
    writeText: async (path: string, text: string) => {
      await broker.writeText({ path, text })
    },
    deleteFile: async (path: string) => {
      await broker.deleteFile({ path })
    },
  })
}

async function authorizeFileOperation(
  config: PluginFileBrokerConfig,
  operation: PluginFileOperation,
  requestedPath: string,
): Promise<AuthorizedPath> {
  try {
    assertOperationPermission(config.manifest, operation)
    const resolvedPath = await config.adapter.resolvePath(requestedPath)
    const root = await findAllowedRoot(config, operation, resolvedPath)

    if (!root) {
      throw new Error(`Plugin file path is outside allowed roots: ${requestedPath}`)
    }

    return Object.freeze({
      resolvedPath,
      rootId: root.id,
    })
  } catch (error) {
    auditFailure(config, operation, requestedPath, error)
    throw error
  }
}

async function findAllowedRoot(
  config: PluginFileBrokerConfig,
  operation: PluginFileOperation,
  resolvedPath: string,
): Promise<PluginFileScopeRoot | undefined> {
  const normalizedPath = normalizeResolvedPath(resolvedPath)

  for (const root of config.roots) {
    if (root.operations && !root.operations.includes(operation)) {
      continue
    }

    const resolvedRoot = normalizeResolvedPath(await config.adapter.resolvePath(root.path))

    if (pathInsideRoot(normalizedPath, resolvedRoot)) {
      return root
    }
  }

  return undefined
}

function assertOperationPermission(manifest: PluginManifest, operation: PluginFileOperation): void {
  const permission = FILE_PERMISSION_BY_OPERATION[operation]

  if (!manifest.permissions?.includes(permission)) {
    throw new Error(`Plugin permission is required for file ${operation}: ${permission}`)
  }
}

function validateRoots(roots: readonly PluginFileScopeRoot[]): void {
  const ids = new Set<string>()

  for (const root of roots) {
    if (root.id.trim().length === 0) {
      throw new Error('Plugin file root id must not be empty')
    }

    if (root.path.trim().length === 0) {
      throw new Error(`Plugin file root path must not be empty: ${root.id}`)
    }

    if (ids.has(root.id)) {
      throw new Error(`Duplicate plugin file root id: ${root.id}`)
    }

    ids.add(root.id)
  }
}

function pathInsideRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

function normalizeResolvedPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+/g, '/')

  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.replace(/\/+$/, '')
  }

  return normalized
}

function auditSuccess(
  config: PluginFileBrokerConfig,
  operation: PluginFileOperation,
  requestedPath: string,
  authorized: AuthorizedPath,
): void {
  config.audit?.(
    Object.freeze({
      pluginId: config.manifest.id,
      operation,
      requestedPath,
      resolvedPath: authorized.resolvedPath,
      rootId: authorized.rootId,
      ok: true,
    }),
  )
}

function auditFailure(
  config: PluginFileBrokerConfig,
  operation: PluginFileOperation,
  requestedPath: string,
  error: unknown,
): void {
  config.audit?.(
    Object.freeze({
      pluginId: config.manifest.id,
      operation,
      requestedPath,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }),
  )
}

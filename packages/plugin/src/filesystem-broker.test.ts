import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import {
  createPluginFileBroker,
  type PluginFileAuditRecord,
  type PluginFileBrokerAdapter,
} from './filesystem-broker'
import type { PluginManifest, PluginPermission } from './manifest'

describe('plugin filesystem broker', () => {
  it('reads text through a scoped adapter when file:read is declared', async () => {
    const adapter = createMemoryAdapter({
      '/workspace/doc.md': 'hello',
    })
    const broker = createPluginFileBroker({
      manifest: manifestWith(['file:read']),
      roots: [{ id: 'workspace', path: '/workspace' }],
      adapter,
    })

    await expect(broker.readText({ path: '/workspace/doc.md' })).resolves.toBe('hello')
    expect(adapter.readText).toHaveBeenCalledWith('/workspace/doc.md')
  })

  it('rejects read access without file:read permission', async () => {
    const adapter = createMemoryAdapter({
      '/workspace/doc.md': 'hello',
    })
    const broker = createPluginFileBroker({
      manifest: manifestWith([]),
      roots: [{ id: 'workspace', path: '/workspace' }],
      adapter,
    })

    await expect(broker.readText({ path: '/workspace/doc.md' })).rejects.toThrow('file:read')
    expect(adapter.readText).not.toHaveBeenCalled()
  })

  it('keeps read, write, and delete permissions independent', async () => {
    const adapter = createMemoryAdapter()
    const broker = createPluginFileBroker({
      manifest: manifestWith(['file:write']),
      roots: [{ id: 'workspace', path: '/workspace' }],
      adapter,
    })

    await expect(broker.writeText({ path: '/workspace/doc.md', text: 'updated' })).resolves.toEqual(
      {
        ok: true,
        path: '/workspace/doc.md',
        rootId: 'workspace',
      },
    )
    await expect(broker.readText({ path: '/workspace/doc.md' })).rejects.toThrow('file:read')
    await expect(broker.deleteFile({ path: '/workspace/doc.md' })).rejects.toThrow('file:delete')
    expect(adapter.writeText).toHaveBeenCalledWith('/workspace/doc.md', 'updated')
    expect(adapter.readText).not.toHaveBeenCalled()
    expect(adapter.deleteFile).not.toHaveBeenCalled()
  })

  it('applies per-root operation limits after permission checks', async () => {
    const adapter = createMemoryAdapter()
    const broker = createPluginFileBroker({
      manifest: manifestWith(['file:read', 'file:write']),
      roots: [{ id: 'readonly', path: '/workspace', operations: ['read'] }],
      adapter,
    })

    await expect(broker.readText({ path: '/workspace/doc.md' })).resolves.toBe('')
    await expect(broker.writeText({ path: '/workspace/doc.md', text: 'updated' })).rejects.toThrow(
      'outside allowed roots',
    )
    expect(adapter.writeText).not.toHaveBeenCalled()
  })

  it('rejects sibling path prefix escapes', async () => {
    const adapter = createMemoryAdapter()
    const broker = createPluginFileBroker({
      manifest: manifestWith(['file:read']),
      roots: [{ id: 'workspace', path: '/workspace/docs' }],
      adapter,
    })

    await expect(broker.readText({ path: '/workspace/docs-private/secret.md' })).rejects.toThrow(
      'outside allowed roots',
    )
    expect(adapter.readText).not.toHaveBeenCalled()
  })

  it('rejects relative traversal after canonicalization', async () => {
    const adapter = createMemoryAdapter(undefined, {
      '/workspace/docs/../secrets/key.md': '/workspace/secrets/key.md',
    })
    const broker = createPluginFileBroker({
      manifest: manifestWith(['file:read']),
      roots: [{ id: 'document', path: '/workspace/docs' }],
      adapter,
    })

    await expect(broker.readText({ path: '/workspace/docs/../secrets/key.md' })).rejects.toThrow(
      'outside allowed roots',
    )
    expect(adapter.readText).not.toHaveBeenCalled()
  })

  it('rejects symlink escapes after adapter resolution', async () => {
    const adapter = createMemoryAdapter(undefined, {
      '/workspace/docs/linked-secret.md': '/private/secret.md',
    })
    const broker = createPluginFileBroker({
      manifest: manifestWith(['file:read']),
      roots: [{ id: 'document', path: '/workspace/docs' }],
      adapter,
    })

    await expect(broker.readText({ path: '/workspace/docs/linked-secret.md' })).rejects.toThrow(
      'outside allowed roots',
    )
    expect(adapter.readText).not.toHaveBeenCalled()
  })

  it('normalizes Windows-style separators for scope checks', async () => {
    const adapter = createMemoryAdapter({
      'C:/workspace/doc.md': 'windows',
    })
    const broker = createPluginFileBroker({
      manifest: manifestWith(['file:read']),
      roots: [{ id: 'workspace', path: 'C:\\workspace' }],
      adapter,
    })

    await expect(broker.readText({ path: 'C:\\workspace\\doc.md' })).resolves.toBe('windows')
  })

  it('records audit entries for allowed and denied operations', async () => {
    const audit = vi.fn<(record: PluginFileAuditRecord) => void>()
    const adapter = createMemoryAdapter({
      '/workspace/doc.md': 'hello',
    })
    const broker = createPluginFileBroker({
      manifest: manifestWith(['file:read']),
      roots: [{ id: 'workspace', path: '/workspace' }],
      adapter,
      audit,
    })

    await broker.readText({ path: '/workspace/doc.md' })
    await expect(broker.readText({ path: '/private/secret.md' })).rejects.toThrow(
      'outside allowed roots',
    )

    expect(audit).toHaveBeenCalledWith({
      pluginId: 'file-tools',
      operation: 'read',
      requestedPath: '/workspace/doc.md',
      resolvedPath: '/workspace/doc.md',
      rootId: 'workspace',
      ok: true,
    })
    expect(audit).toHaveBeenCalledWith({
      pluginId: 'file-tools',
      operation: 'read',
      requestedPath: '/private/secret.md',
      ok: false,
      reason: 'Plugin file path is outside allowed roots: /private/secret.md',
    })
  })

  it('records audit failures for adapter operation errors after authorization', async () => {
    const audit = vi.fn<(record: PluginFileAuditRecord) => void>()
    const adapter = createMemoryAdapter()
    adapter.writeText.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    const broker = createPluginFileBroker({
      manifest: manifestWith(['file:write']),
      roots: [{ id: 'workspace', path: '/workspace' }],
      adapter,
      audit,
    })

    await expect(broker.writeText({ path: '/workspace/doc.md', text: 'updated' })).rejects.toThrow(
      'disk full',
    )
    expect(audit).toHaveBeenCalledWith({
      pluginId: 'file-tools',
      operation: 'write',
      requestedPath: '/workspace/doc.md',
      ok: false,
      reason: 'disk full',
    })
  })

  it('validates root ids before exposing a broker', () => {
    expect(() =>
      createPluginFileBroker({
        manifest: manifestWith(['file:read']),
        roots: [
          { id: 'workspace', path: '/workspace-a' },
          { id: 'workspace', path: '/workspace-b' },
        ],
        adapter: createMemoryAdapter(),
      }),
    ).toThrow('Duplicate plugin file root id')
  })
})

function manifestWith(permissions: readonly PluginPermission[]): PluginManifest {
  return {
    id: 'file-tools',
    name: 'File Tools',
    version: '1.0.0',
    permissions,
  }
}

function createMemoryAdapter(
  files: Readonly<Record<string, string>> = {},
  resolvedPaths: Readonly<Record<string, string>> = {},
): PluginFileBrokerAdapter & {
  readonly readText: Mock<(path: string) => string>
  readonly writeText: Mock<(path: string, text: string) => void>
  readonly deleteFile: Mock<(path: string) => void>
} {
  const store = new Map(Object.entries(files))

  return {
    resolvePath: (path: string) => resolvedPaths[path] ?? normalizePath(path),
    readText: vi.fn((path: string) => store.get(path) ?? ''),
    writeText: vi.fn((path: string, text: string) => {
      store.set(path, text)
    }),
    deleteFile: vi.fn((path: string) => {
      store.delete(path)
    }),
  }
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/+$/, '')
}

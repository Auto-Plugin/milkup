import { vi } from 'vitest'
import type { PluginWorkspaceBrokerAdapter } from './workspace-broker'
import type { PluginManifest } from './manifest'
export const manifest: PluginManifest = {
  id: 'workspace-test',
  name: 'Workspace',
  version: '1.0.0',
  permissions: ['workspace:read'],
}
export const selected = { id: 'root-1', key: 'stable-root', label: 'Notes' }
export const file = {
  id: 'file-1',
  name: 'readme.md',
  kind: 'file' as const,
  relativePath: 'readme.md',
}
export const directory = {
  id: 'dir-1',
  name: 'notes',
  kind: 'directory' as const,
  relativePath: 'notes',
}
export function adapter() {
  return {
    chooseRoot: vi.fn<PluginWorkspaceBrokerAdapter['chooseRoot']>(async () => ({
      ...selected,
      path: '/private',
    })),
    listChildren: vi.fn<PluginWorkspaceBrokerAdapter['listChildren']>(async () => ({
      entries: [file, directory],
      nextCursor: 'cursor-1',
    })),
    resolveEntry: vi.fn<PluginWorkspaceBrokerAdapter['resolveEntry']>(async () => file),
    refreshRoot: vi.fn<PluginWorkspaceBrokerAdapter['refreshRoot']>(async () => ({
      ...selected,
      id: 'root-2',
    })),
    requestOpen: vi.fn<PluginWorkspaceBrokerAdapter['requestOpen']>(async () => ({
      status: 'opened',
    })),
    releaseRoot: vi.fn<PluginWorkspaceBrokerAdapter['releaseRoot']>(async () => {}),
  }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
export async function flush() {
  for (let i = 0; i < 16; i++) await Promise.resolve()
}

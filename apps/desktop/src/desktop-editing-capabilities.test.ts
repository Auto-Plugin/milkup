import { describe, it, expect, vi } from 'vitest'
import { ActionRegistry } from '@milkup/core'
import {
  DesktopPluginManager,
  type DesktopPluginModuleCapabilities,
} from './desktop-plugin-manager'
import type { PluginManifest, PluginEditingSnapshot } from '@milkup/plugin'
const snapshot: PluginEditingSnapshot = {
  id: 'snap-1',
  documentId: 'doc-1',
  version: 1,
  selectionRevision: 0,
  saveLocationGeneration: 0,
  from: 0,
  to: 1,
  text: 'x',
  selection: { anchor: 0, head: 1 },
  startLine: 1,
  lineCount: 1,
  lineEnding: 'lf',
  mode: 'memory',
}
describe('desktop editing capability lifecycle', () => {
  it('enables ordinary document editing without inventing sensitive approvals', async () => {
    const manifest: PluginManifest = {
      id: 'formatting-default',
      name: 'Formatting',
      version: '1.0.0',
      host: 'worker',
      main: 'dist/plugin.js',
      permissions: ['document:read', 'document:write'],
    }
    const adapter = {
      capture: vi.fn(async () => snapshot),
      apply: vi.fn(async () => ({ documentId: 'doc-1', version: 2 })),
      table: vi.fn(async () => ({ documentId: 'doc-1', version: 2 })),
      release: vi.fn(async () => {}),
    }
    const factory = vi.fn(() => ({ adapter, dispose: vi.fn() }))
    const loaded: DesktopPluginModuleCapabilities[] = []
    const manager = new DesktopPluginManager({
      actionRegistry: new ActionRegistry(),
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(manifest),
      },
      permissions: manifest.permissions!,
      milkupVersion: '2.0.0-beta.1',
      pluginSdkVersion: '0.3.2',
      editingAdapter: factory,
      loadModule: async (_manifest, _specifier, capabilities) => {
        loaded.push(capabilities!)
        return { module: { runtimeHost: 'isolated', activate: () => ({}) }, dispose: () => {} }
      },
    })
    const installed = await manager.installManifestPath('/plugins/formatting/plugin.json')
    expect(installed.approvals).toEqual({ permissions: [], hosts: ['worker'] })
    await manager.enable(manifest.id)
    expect(manager.state().records[0]?.enabled).toBe(true)
    expect(manager.state().records[0]?.approvals.permissions).toEqual([])
    expect(factory).toHaveBeenCalledTimes(1)
    const first = loaded[0]!.editingBroker!
    expect(await first.capture({ extent: 'selection' })).toEqual(snapshot)
    await manager.disable(manifest.id)
    await expect(first.capture({ extent: 'selection' })).rejects.toMatchObject({ code: 'revoked' })
    await manager.enable(manifest.id)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(loaded[1]!.editingBroker).not.toBe(first)
    expect(manager.state().records[0]?.approvals.permissions).toEqual([])
  })
  it('requires approval, routes paste by contribution, revokes both brokers and awaits cleanup', async () => {
    const actions = new ActionRegistry()
    const manifest: PluginManifest = {
      id: 'image-plugin',
      name: 'Images',
      version: '1.0.0',
      host: 'worker',
      main: 'dist/plugin.js',
      permissions: ['document:read', 'document:write', 'images:import'],
      contributes: {
        commands: [{ id: 'image.paste', action: 'image.paste', title: 'Paste' }],
        pasteHandlers: [{ kind: 'image', command: 'image.paste' }],
      },
    }
    const editingAdapter = {
      capture: vi.fn(async () => snapshot),
      apply: vi.fn(async () => ({ documentId: 'doc-1', version: 2 })),
      table: vi.fn(async () => ({ documentId: 'doc-1', version: 2 })),
      release: vi.fn(async () => {}),
    }
    const resourceAdapter = {
      prepareDocument: vi.fn(async () => ({ status: 'ready' as const, id: 'intent-1' })),
      choose: vi.fn(async () => null),
      stage: vi.fn(async () => ({
        id: 'asset-1',
        reference: 'assets/x.png',
        mimeType: 'image/png' as const,
        sizeBytes: 32,
        width: 1,
        height: 1,
      })),
      abort: vi.fn(async () => {}),
    }
    const stopped: string[] = []
    const editFactory = vi.fn(() => ({
        adapter: editingAdapter,
        dispose: async () => {
          await Promise.resolve()
          stopped.push('editing')
        },
      })),
      resourceFactory = vi.fn(() => ({
        adapter: resourceAdapter,
        dispose: async () => {
          await Promise.resolve()
          stopped.push('resources')
        },
      }))
    const captures: DesktopPluginModuleCapabilities[] = []
    const manager = new DesktopPluginManager({
      actionRegistry: actions,
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(manifest),
      },
      permissions: manifest.permissions!,
      milkupVersion: '2.0.0-beta.1',
      pluginSdkVersion: '0.3.2',
      editingAdapter: editFactory,
      resourcesAdapter: resourceFactory,
      loadModule: async (_m, _s, cap) => {
        captures.push(cap!)
        return {
          module: {
            runtimeHost: 'isolated',
            commands: { 'image.paste': () => {} },
            activate: () => ({}),
          },
          dispose: async () => {
            const editingRevoked = cap?.editingBroker?.capture({ extent: 'selection' })
            const resourcesRevoked = cap?.resourcesBroker?.prepareDocument()
            if (editingRevoked)
              await expect(editingRevoked).rejects.toMatchObject({ code: 'revoked' })
            if (resourcesRevoked)
              await expect(resourcesRevoked).rejects.toMatchObject({ code: 'revoked' })
            stopped.push('module')
          },
        }
      },
    })
    await manager.installManifestPath('/plugins/image/plugin.json')
    await manager.enable(manifest.id)
    expect(editFactory).not.toHaveBeenCalled()
    expect(manager.resolveImagePasteHandler()).toBeUndefined()
    expect(() => manager.grantImagePaste(manifest.id, 'paste-1')).toThrow()
    manager.approve(manifest.id)
    await manager.enable(manifest.id)
    expect(manager.resolveImagePasteHandler()).toEqual({
      pluginId: manifest.id,
      command: 'image.paste',
    })
    expect(editFactory).toHaveBeenCalledTimes(1)
    const before = captures[0]!
    await before.editingBroker!.capture({ extent: 'selection' })
    manager.grantImagePaste(manifest.id, 'paste-1')
    await before.resourcesBroker!.prepareDocument({ pasteId: 'paste-1' })
    await manager.disable(manifest.id)
    expect([...stopped].sort()).toEqual(['editing', 'module', 'resources'])
    expect(manager.resolveImagePasteHandler()).toBeUndefined()
    await expect(before.editingBroker!.capture({ extent: 'selection' })).rejects.toMatchObject({
      code: 'revoked',
    })
    await expect(before.resourcesBroker!.prepareDocument()).rejects.toMatchObject({
      code: 'revoked',
    })
    expect(resourceAdapter.abort).toHaveBeenCalledWith('intent-1')
    await manager.enable(manifest.id)
    expect(captures[1]!.editingBroker).not.toBe(before.editingBroker)
    await manager.revokeApproval(manifest.id)
    await expect(captures[1]!.resourcesBroker!.prepareDocument()).rejects.toMatchObject({
      code: 'revoked',
    })
  })
})

import {
  createPluginFileBroker,
  type PluginFileAuditSink,
  type PluginFileBroker,
  type PluginFileBrokerAdapter,
  type PluginFileScopeRoot,
} from '@milkup/plugin'
import type { PluginManifest } from '@milkup/plugin'

export type DesktopPluginFileInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>

export interface DesktopPluginFileBrokerAdapterConfig {
  readonly invoke?: DesktopPluginFileInvoke
}

export interface DesktopPluginFileBrokerConfig extends DesktopPluginFileBrokerAdapterConfig {
  readonly manifest: PluginManifest
  readonly roots: readonly PluginFileScopeRoot[]
  readonly audit?: PluginFileAuditSink
}

export function createDesktopPluginFileBroker(
  config: DesktopPluginFileBrokerConfig,
): PluginFileBroker {
  return createPluginFileBroker({
    manifest: config.manifest,
    roots: config.roots,
    adapter: createDesktopPluginFileBrokerAdapter(config),
    ...(config.audit ? { audit: config.audit } : {}),
  })
}

export function createDesktopPluginFileBrokerAdapter(
  config: DesktopPluginFileBrokerAdapterConfig = {},
): PluginFileBrokerAdapter {
  return new TauriPluginFileBrokerAdapter(config.invoke ?? loadTauriInvoke)
}

class TauriPluginFileBrokerAdapter implements PluginFileBrokerAdapter {
  constructor(private readonly invoke: DesktopPluginFileInvoke) {}

  resolvePath(path: string): Promise<string> {
    return this.invoke<string>('resolve_plugin_file_path', { path })
  }

  readText(path: string): Promise<string> {
    return this.invoke<string>('read_plugin_text_file', { path })
  }

  async writeText(path: string, text: string): Promise<void> {
    await assertNativePluginFileResult(
      this.invoke<boolean>('write_plugin_text_file', { path, text }),
      'write',
    )
  }

  async deleteFile(path: string): Promise<void> {
    await assertNativePluginFileResult(
      this.invoke<boolean>('delete_plugin_file', { path }),
      'delete',
    )
  }
}

async function assertNativePluginFileResult(
  result: Promise<boolean>,
  operation: 'write' | 'delete',
): Promise<void> {
  if (!(await result)) {
    throw new Error(`Native plugin file ${operation} was rejected`)
  }
}

async function loadTauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

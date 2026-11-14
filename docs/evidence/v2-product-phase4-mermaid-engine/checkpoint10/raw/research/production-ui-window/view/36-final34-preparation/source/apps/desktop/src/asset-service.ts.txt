import { LocalAssetProvider, MemoryAssetProvider } from '@milkup/assets'
import type { AssetFileSystem, AssetInput, AssetProvider, ImportedAsset } from '@milkup/assets'

export interface DesktopAssetProviderConfig {
  readonly getMarkdownPath: () => string | undefined
  readonly fileSystem?: AssetFileSystem
  readonly relativeBasePath?: string
  readonly fallbackProvider?: AssetProvider
}

export function createDesktopAssetProvider(config: DesktopAssetProviderConfig): AssetProvider {
  return new SessionAssetProvider(config)
}

export function getSiblingAssetDirectory(markdownPath: string): string {
  const normalized = markdownPath.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')

  if (slashIndex < 0) {
    return 'assets'
  }

  const directory = normalized.slice(0, slashIndex)
  return directory.length > 0 ? `${directory}/assets` : 'assets'
}

export function createMemoryAssetFileSystem(): AssetFileSystem & {
  readonly directories: ReadonlySet<string>
  readonly files: ReadonlyMap<string, unknown>
} {
  const directories = new Set<string>()
  const files = new Map<string, unknown>()

  return {
    directories,
    files,
    async ensureDirectory(path: string): Promise<void> {
      directories.add(path)
    },
    async writeFile(path: string, data: unknown): Promise<void> {
      files.set(path, data)
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path)
    },
  }
}

class SessionAssetProvider implements AssetProvider {
  private readonly getMarkdownPath: () => string | undefined
  private readonly fileSystem: AssetFileSystem
  private readonly relativeBasePath: string
  private readonly fallbackProvider: AssetProvider

  constructor(config: DesktopAssetProviderConfig) {
    this.getMarkdownPath = config.getMarkdownPath
    this.fileSystem = config.fileSystem ?? createRuntimeAssetFileSystem()
    this.relativeBasePath = config.relativeBasePath ?? 'assets'
    this.fallbackProvider = config.fallbackProvider ?? new MemoryAssetProvider()
  }

  async importAsset(input: AssetInput): Promise<ImportedAsset> {
    const markdownPath = this.getMarkdownPath()

    if (!markdownPath) {
      return this.fallbackProvider.importAsset(input)
    }

    const provider = new LocalAssetProvider({
      fileSystem: this.fileSystem,
      assetDirectory: getSiblingAssetDirectory(markdownPath),
      relativeBasePath: this.relativeBasePath,
    })

    return provider.importAsset(input)
  }
}

function createRuntimeAssetFileSystem(): AssetFileSystem {
  return isTauriRuntime() ? new TauriAssetFileSystem() : createMemoryAssetFileSystem()
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

class TauriAssetFileSystem implements AssetFileSystem {
  async ensureDirectory(path: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke<boolean>('ensure_asset_directory', { path })
  }

  async writeFile(path: string, data: unknown): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke<boolean>('write_asset_file', {
      path,
      data: Array.from(await readAssetBytes(data)),
    })
  }

  async exists(path: string): Promise<boolean> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<boolean>('asset_file_exists', { path })
  }
}

async function readAssetBytes(data: unknown): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return data
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer())
  }

  if (Array.isArray(data)) {
    return Uint8Array.from(data)
  }

  throw new Error('Unsupported asset data type')
}

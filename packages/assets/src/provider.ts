export interface AssetInput {
  readonly name: string
  readonly type: string
  readonly data?: unknown
}

export interface ImportedAsset {
  readonly originalName: string
  readonly fileName: string
  readonly relativePath: string
  readonly storagePath?: string
  readonly mimeType: string
}

export interface AssetProvider {
  importAsset(input: AssetInput): Promise<ImportedAsset>
}

export interface AssetFileSystem {
  ensureDirectory(path: string): Promise<void>
  writeFile(path: string, data: unknown): Promise<void>
  exists?(path: string): Promise<boolean>
}

export interface MemoryAssetProviderConfig {
  readonly basePath?: string
}

export class MemoryAssetProvider implements AssetProvider {
  private readonly basePath: string
  private readonly usedFileNames = new Set<string>()
  private readonly importedAssets: ImportedAsset[] = []

  constructor(config: MemoryAssetProviderConfig = {}) {
    this.basePath = normalizeBasePath(config.basePath ?? 'assets')
  }

  get assets(): readonly ImportedAsset[] {
    return Object.freeze([...this.importedAssets])
  }

  async importAsset(input: AssetInput): Promise<ImportedAsset> {
    const fileName = await createUniqueFileName({
      name: input.name,
      mimeType: input.type,
      isUsed: (candidate) => this.usedFileNames.has(candidate),
      markUsed: (candidate) => this.usedFileNames.add(candidate),
    })
    const imported = Object.freeze({
      originalName: input.name,
      fileName,
      relativePath: `${this.basePath}/${fileName}`,
      mimeType: input.type,
    })

    this.importedAssets.push(imported)
    return imported
  }
}

export interface LocalAssetProviderConfig {
  readonly fileSystem: AssetFileSystem
  readonly assetDirectory: string
  readonly relativeBasePath?: string
}

export class LocalAssetProvider implements AssetProvider {
  private readonly fileSystem: AssetFileSystem
  private readonly assetDirectory: string
  private readonly relativeBasePath: string
  private readonly usedFileNames = new Set<string>()

  constructor(config: LocalAssetProviderConfig) {
    this.fileSystem = config.fileSystem
    this.assetDirectory = normalizeStoragePath(config.assetDirectory)
    this.relativeBasePath = normalizeBasePath(config.relativeBasePath ?? 'assets')
  }

  async importAsset(input: AssetInput): Promise<ImportedAsset> {
    if (input.data === undefined) {
      throw new Error(`Asset data is required for local import: ${input.name}`)
    }

    await this.fileSystem.ensureDirectory(this.assetDirectory)

    const fileName = await this.createUniqueFileName(input)
    const storagePath = joinPath(this.assetDirectory, fileName)
    const imported = Object.freeze({
      originalName: input.name,
      fileName,
      relativePath: `${this.relativeBasePath}/${fileName}`,
      storagePath,
      mimeType: input.type,
    })

    await this.fileSystem.writeFile(storagePath, input.data)
    return imported
  }

  private async createUniqueFileName(input: AssetInput): Promise<string> {
    return createUniqueFileName({
      name: input.name,
      mimeType: input.type,
      isUsed: (candidate) => this.usedFileNames.has(candidate),
      markUsed: (candidate) => this.usedFileNames.add(candidate),
      exists: async (candidate) => {
        if (!this.fileSystem.exists) {
          return false
        }

        return this.fileSystem.exists(joinPath(this.assetDirectory, candidate))
      },
    })
  }
}

interface UniqueFileNameConfig {
  readonly name: string
  readonly mimeType: string
  readonly isUsed: (candidate: string) => boolean
  readonly markUsed: (candidate: string) => void
  readonly exists?: (candidate: string) => Promise<boolean>
}

async function createUniqueFileName(config: UniqueFileNameConfig): Promise<string> {
  const fallbackExtension = extensionFromMimeType(config.mimeType)
  const sanitized = sanitizeFileName(config.name, fallbackExtension)
  const extensionIndex = sanitized.lastIndexOf('.')
  const base = extensionIndex > 0 ? sanitized.slice(0, extensionIndex) : sanitized
  const extension = extensionIndex > 0 ? sanitized.slice(extensionIndex) : ''
  let candidate = sanitized
  let index = 2

  while (config.isUsed(candidate) || (await config.exists?.(candidate))) {
    candidate = `${base}-${index}${extension}`
    index += 1
  }

  config.markUsed(candidate)
  return candidate
}

export function createMarkdownImage(asset: ImportedAsset, altText?: string): string {
  const alt = escapeImageAltText(altText ?? fileNameWithoutExtension(asset.originalName))
  const path = encodeMarkdownUrl(asset.relativePath)

  return `![${alt}](${path})`
}

export function isImageAsset(input: AssetInput): boolean {
  return input.type.startsWith('image/')
}

export function sanitizeFileName(name: string, fallbackExtension = 'bin'): string {
  const trimmed = name.trim()
  const baseName = trimmed.length > 0 ? trimmed : `pasted.${fallbackExtension}`
  const normalized = baseName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/g, '')
    .replace(/[.-]+$/g, '')
    .toLowerCase()

  if (normalized.length === 0) {
    return `pasted.${fallbackExtension}`
  }

  return normalized.includes('.') ? normalized : `${normalized}.${fallbackExtension}`
}

function extensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/svg+xml':
      return 'svg'
    default:
      return 'bin'
  }
}

function normalizeBasePath(path: string): string {
  return (
    path
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '')
      .replace(/^\/+|\/+$/g, '') || 'assets'
  )
}

function normalizeStoragePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function joinPath(directory: string, fileName: string): string {
  const normalizedDirectory = normalizeStoragePath(directory)

  return normalizedDirectory.length > 0 ? `${normalizedDirectory}/${fileName}` : fileName
}

function fileNameWithoutExtension(name: string): string {
  const sanitized = sanitizeFileName(name)
  const extensionIndex = sanitized.lastIndexOf('.')

  return extensionIndex > 0 ? sanitized.slice(0, extensionIndex) : sanitized
}

function escapeImageAltText(value: string): string {
  return value.replace(/[[\]\\]/g, '\\$&')
}

function encodeMarkdownUrl(value: string): string {
  return value.replace(/\s/g, '%20').replace(/\)/g, '%29')
}

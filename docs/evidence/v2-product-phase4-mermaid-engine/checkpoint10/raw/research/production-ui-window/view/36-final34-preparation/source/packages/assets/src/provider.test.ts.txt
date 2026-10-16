import { describe, expect, it } from 'vitest'

import {
  type AssetFileSystem,
  createMarkdownImage,
  isImageAsset,
  LocalAssetProvider,
  MemoryAssetProvider,
  sanitizeFileName,
} from './provider'

class TestAssetFileSystem implements AssetFileSystem {
  readonly directories = new Set<string>()
  readonly files = new Map<string, unknown>()

  constructor(existingFiles: readonly string[] = []) {
    for (const file of existingFiles) {
      this.files.set(file, 'existing')
    }
  }

  async ensureDirectory(path: string): Promise<void> {
    this.directories.add(path)
  }

  async writeFile(path: string, data: unknown): Promise<void> {
    this.files.set(path, data)
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path)
  }
}

describe('asset provider', () => {
  it('sanitizes unsafe pasted file names', () => {
    expect(sanitizeFileName(' Screen Shot: 1.PNG ')).toBe('screen-shot-1.png')
    expect(sanitizeFileName('../')).toBe('pasted.bin')
    expect(sanitizeFileName('', 'png')).toBe('pasted.png')
  })

  it('imports assets under a relative base path with stable unique names', async () => {
    const provider = new MemoryAssetProvider({ basePath: './images/' })
    const first = await provider.importAsset({ name: 'Chart.png', type: 'image/png' })
    const second = await provider.importAsset({ name: 'Chart.png', type: 'image/png' })

    expect(first).toMatchObject({
      originalName: 'Chart.png',
      fileName: 'chart.png',
      relativePath: 'images/chart.png',
      mimeType: 'image/png',
    })
    expect(second.fileName).toBe('chart-2.png')
    expect(second.relativePath).toBe('images/chart-2.png')
    expect(provider.assets).toHaveLength(2)
  })

  it('creates markdown image syntax for imported assets', async () => {
    const provider = new MemoryAssetProvider()
    const asset = await provider.importAsset({ name: 'diagram final.png', type: 'image/png' })

    expect(createMarkdownImage(asset)).toBe('![diagram-final](assets/diagram-final.png)')
    expect(createMarkdownImage(asset, 'flow [draft]')).toBe(
      '![flow \\[draft\\]](assets/diagram-final.png)',
    )
  })

  it('copies local assets through an injected file system adapter', async () => {
    const fileSystem = new TestAssetFileSystem(['/docs/assets/chart.png'])
    const provider = new LocalAssetProvider({
      fileSystem,
      assetDirectory: '/docs/assets/',
      relativeBasePath: './assets/',
    })
    const data = new Uint8Array([1, 2, 3])
    const asset = await provider.importAsset({
      name: 'Chart.png',
      type: 'image/png',
      data,
    })

    expect(fileSystem.directories.has('/docs/assets')).toBe(true)
    expect(asset).toMatchObject({
      originalName: 'Chart.png',
      fileName: 'chart-2.png',
      relativePath: 'assets/chart-2.png',
      storagePath: '/docs/assets/chart-2.png',
      mimeType: 'image/png',
    })
    expect(fileSystem.files.get('/docs/assets/chart-2.png')).toBe(data)
  })

  it('requires data before copying a local asset', async () => {
    const provider = new LocalAssetProvider({
      fileSystem: new TestAssetFileSystem(),
      assetDirectory: '/docs/assets',
    })

    await expect(provider.importAsset({ name: 'missing.png', type: 'image/png' })).rejects.toThrow(
      'Asset data is required',
    )
  })

  it('detects image assets by mime type', () => {
    expect(isImageAsset({ name: 'x.png', type: 'image/png' })).toBe(true)
    expect(isImageAsset({ name: 'x.txt', type: 'text/plain' })).toBe(false)
  })
})

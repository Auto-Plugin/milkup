import { describe, expect, it } from 'vitest'

import {
  createDesktopAssetProvider,
  createMemoryAssetFileSystem,
  getSiblingAssetDirectory,
} from './asset-service'

describe('desktop asset service', () => {
  it('resolves sibling asset directory from markdown path', () => {
    expect(getSiblingAssetDirectory('D:\\notes\\draft.md')).toBe('D:/notes/assets')
    expect(getSiblingAssetDirectory('/home/me/draft.md')).toBe('/home/me/assets')
    expect(getSiblingAssetDirectory('draft.md')).toBe('assets')
  })

  it('copies assets next to the current markdown document', async () => {
    const fileSystem = createMemoryAssetFileSystem()
    const provider = createDesktopAssetProvider({
      getMarkdownPath: () => 'D:/notes/draft.md',
      fileSystem,
    })
    const data = new Uint8Array([1, 2, 3])
    const asset = await provider.importAsset({
      name: 'Diagram Final.PNG',
      type: 'image/png',
      data,
    })

    expect(asset).toMatchObject({
      fileName: 'diagram-final.png',
      relativePath: 'assets/diagram-final.png',
      storagePath: 'D:/notes/assets/diagram-final.png',
    })
    expect(fileSystem.directories.has('D:/notes/assets')).toBe(true)
    expect(fileSystem.files.get('D:/notes/assets/diagram-final.png')).toBe(data)
  })

  it('uses a fallback provider for unsaved documents', async () => {
    const fileSystem = createMemoryAssetFileSystem()
    const provider = createDesktopAssetProvider({
      getMarkdownPath: () => undefined,
      fileSystem,
    })
    const asset = await provider.importAsset({
      name: 'Unsaved.png',
      type: 'image/png',
    })

    expect(asset.relativePath).toBe('assets/unsaved.png')
    expect(fileSystem.files.size).toBe(0)
  })
})

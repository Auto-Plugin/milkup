import { describe, expect, it } from 'vitest'
import {
  createPluginPackageArchive,
  parsePluginPackageArchive,
  serializePluginPackageArchive,
} from './package'

const manifest = {
  id: 'example.presentation',
  name: 'Presentation',
  version: '1.0.0',
  host: 'dom',
  main: './dist/plugin.js',
  permissions: ['document:read'],
  contributes: {
    documentRenderers: [
      { id: 'example.graph', contexts: ['fence'], fenceLanguages: ['example-graph'] },
    ],
  },
}
const entry = {
  path: 'dist/plugin.js',
  encoding: 'utf8' as const,
  content: 'export default { documentRenderers: {} };\n',
}

describe('DOM plugin packages', () => {
  it('round-trips a package-local UTF-8 ESM entry and declared resources', () => {
    const archive = createPluginPackageArchive({ ...manifest, resources: ['assets/font.woff2'] }, [
      entry,
      { path: 'assets/font.woff2', encoding: 'base64', content: 'AA==' },
    ])
    expect(archive.manifest.host).toBe('dom')
    expect(parsePluginPackageArchive(JSON.parse(serializePluginPackageArchive(archive)))).toEqual(
      archive,
    )
  })
  it('rejects a missing DOM entry instead of accepting manifest-only execution', () => {
    expect(() => createPluginPackageArchive(manifest, [])).toThrow(/entry is missing/)
  })
  it('rejects a base64 DOM entry even when a decoder could turn it into JavaScript', () => {
    expect(() =>
      createPluginPackageArchive(manifest, [
        { ...entry, encoding: 'base64', content: 'ZXhwb3J0IGRlZmF1bHQge307' },
      ]),
    ).toThrow(/utf.?8/i)
  })
  it('rejects missing declared resources', () => {
    expect(() =>
      createPluginPackageArchive({ ...manifest, resources: ['assets/font.woff2'] }, [entry]),
    ).toThrow(/resource is missing/)
  })
})

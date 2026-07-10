import { describe, expect, it } from 'vitest'

import {
  createPluginPackageArchive,
  parsePluginPackageArchive,
  readPluginPackageTextFile,
  serializePluginPackageArchive,
} from './package'

describe('plugin package archive', () => {
  it('validates, serializes, and reads a worker package', () => {
    const archive = createPluginPackageArchive(
      {
        id: 'example-tools',
        name: 'Example Tools',
        version: '1.0.0',
        main: './dist/plugin.js',
        resources: ['assets/template.md'],
      },
      [
        { path: 'dist/plugin.js', encoding: 'utf8', content: 'export const commands = {}' },
        { path: 'assets/template.md', encoding: 'utf8', content: '# Template' },
      ],
    )

    expect(readPluginPackageTextFile(archive, './dist/plugin.js')).toContain('commands')
    expect(parsePluginPackageArchive(JSON.parse(serializePluginPackageArchive(archive)))).toEqual(
      archive,
    )
  })

  it('rejects missing entries and paths escaping the package', () => {
    expect(() =>
      createPluginPackageArchive(
        { id: 'bad', name: 'Bad', version: '1.0.0', main: 'dist/missing.js' },
        [],
      ),
    ).toThrow('entry is missing')
    expect(() =>
      createPluginPackageArchive({ id: 'bad', name: 'Bad', version: '1.0.0' }, [
        { path: '../outside.js', encoding: 'utf8', content: '' },
      ]),
    ).toThrow('stay inside the package')
  })

  it('allows base64 files for optional sidecar payloads but not Worker entries', () => {
    expect(() =>
      createPluginPackageArchive({ id: 'bad', name: 'Bad', version: '1.0.0', main: 'plugin.js' }, [
        { path: 'plugin.js', encoding: 'base64', content: 'AA==' },
      ]),
    ).toThrow('Worker plugin entry must use utf8 encoding')

    expect(
      createPluginPackageArchive(
        { id: 'native', name: 'Native', version: '1.0.0', host: 'sidecar', main: 'bin.exe' },
        [{ path: 'bin.exe', encoding: 'base64', content: 'AA==' }],
      ).files[0]?.encoding,
    ).toBe('base64')
  })
})

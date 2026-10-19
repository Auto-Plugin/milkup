import { describe, expect, it } from 'vitest'

import { createPluginPackageArchive, parsePluginPackageArchive } from './package'

const manifest = { id: 'example.validation', name: 'Validation', version: '1.0.0' }
const textFile = (path: string) => ({
  path,
  encoding: 'utf8' as const,
  content: 'export default {}',
})

describe('plugin package validation before installation', () => {
  it.each([
    '/outside.js',
    '\\outside.js',
    '//server/share/file.js',
    '\\\\server\\share\\file.js',
    'C:/outside.js',
    'C:\\outside.js',
    'C:outside.js',
    './C:outside.js',
    'dir/file\0.js',
    'dir/line\n.js',
    'dir/file:stream',
    'dir/trailing. ',
    'dir/trailing.',
    'dir/CON',
    'dir/nul.txt',
    'dir/COM1.exe',
  ])('rejects an unsafe package file path: %j', (path) => {
    expect(() => createPluginPackageArchive(manifest, [textFile(path)])).toThrow()
  })

  it.each(['plugin.json', './plugin.json', 'PLUGIN.JSON', 'plugin.json/child'])(
    'reserves the installed manifest path: %s',
    (path) => {
      expect(() => createPluginPackageArchive(manifest, [textFile(path)])).toThrow(/reserved/i)
    },
  )

  it.each([
    ['dist/plugin.js', './dist//plugin.js'],
    ['dist/plugin.js', 'dist\\plugin.js'],
    ['dist/Plugin.js', 'DIST/plugin.js'],
    ['dist', 'dist/plugin.js'],
    ['dist/plugin.js', 'dist'],
    ['Assets', 'assets/icon.png'],
  ])('rejects duplicate or file/directory conflicts in %j and %j', (first, second) => {
    expect(() =>
      createPluginPackageArchive(manifest, [textFile(first), textFile(second)]),
    ).toThrow()
  })

  it.each([
    '***',
    'A',
    'A===',
    'AA=',
    'AA===',
    '=AAA',
    'AA==AA==',
    'AA-_',
    'AB==',
    'AAB=',
    'AA',
    'AA==\n',
  ])('rejects invalid or noncanonical base64 before any file can be installed: %j', (content) => {
    expect(() =>
      createPluginPackageArchive(manifest, [
        textFile('dist/plugin.js'),
        { path: 'assets/data.bin', encoding: 'base64', content },
      ]),
    ).toThrow(/base64/i)
  })

  it.each(['', 'AA==', 'AAA=', 'AAAA', '/w==', '//8=', '////'])(
    'accepts canonical base64 without decoding allocation: %j',
    (content) => {
      expect(
        createPluginPackageArchive(manifest, [
          { path: 'assets/data.bin', encoding: 'base64', content },
        ]).files[0]?.content,
      ).toBe(content)
    },
  )

  it.each(['/outside.js', 'C:outside.js', 'https://example.test/plugin.js', 'plugin.json'])(
    'requires package-local executable content for all archive hosts: %s',
    (main) => {
      for (const host of ['worker', 'sidecar'] as const) {
        expect(() => createPluginPackageArchive({ ...manifest, host, main }, [])).toThrow()
      }
    },
  )

  it('rejects resource path aliases that would otherwise match a safe file', () => {
    expect(() =>
      createPluginPackageArchive({ ...manifest, resources: ['/assets/a.txt'] }, [
        textFile('assets/a.txt'),
      ]),
    ).toThrow()
  })

  it('preserves supported relative paths and accepts an existing Mermaid-sized entry', () => {
    const content = 'x'.repeat(6 * 1024 * 1024)
    const archive = createPluginPackageArchive({ ...manifest, main: './dist/plugin.js' }, [
      { path: './dist//plugin.js', encoding: 'utf8', content },
      textFile('assets/说明.txt'),
      textFile('nested/plugin.json'),
    ])
    expect(archive.files[0]).toEqual({ path: 'dist/plugin.js', encoding: 'utf8', content })
    expect(parsePluginPackageArchive(archive)).toEqual(archive)
  })
})

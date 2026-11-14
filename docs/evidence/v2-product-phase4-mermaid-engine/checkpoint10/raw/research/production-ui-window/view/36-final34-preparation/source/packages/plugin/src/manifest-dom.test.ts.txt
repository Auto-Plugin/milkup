import { describe, expect, it } from 'vitest'
import { validatePluginManifest } from './manifest'

function domManifest() {
  return {
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
}

describe('DOM-only plugin manifest profile', () => {
  it('accepts an independent read-only document renderer without changing its host', () => {
    const input = domManifest()
    const result = validatePluginManifest(input)
    expect(result.errors).toEqual([])
    expect(result.manifest).toMatchObject(input)
  })

  it.each([
    'https://example.test/plugin.js',
    'data:text/javascript,export{}',
    'blob:example',
    'file:///tmp/plugin.js',
    'milkup://plugin/main.js',
    '/tmp/plugin.js',
    'C:\\plugin.js',
    '../plugin.js',
    'dist/../../plugin.js',
    'dist/\u0000plugin.js',
    '',
  ])('rejects non-package DOM main %j', (main) => {
    const result = validatePluginManifest({ ...domManifest(), main })
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.path === '$.main')).toBe(true)
  })

  it('requires a main entry and at least one document renderer', () => {
    const { main: _main, ...missing } = domManifest()
    expect(validatePluginManifest(missing).errors.some((error) => error.path === '$.main')).toBe(
      true,
    )
    for (const contributes of [{}, { documentRenderers: [] }]) {
      expect(
        validatePluginManifest({ ...domManifest(), contributes }).errors.some((error) =>
          error.path.startsWith('$.contributes'),
        ),
      ).toBe(true)
    }
  })

  it.each(
    [
      [],
      ['document:read', 'document:write'],
      ['document:read', 'file:read'],
      ['document:read', 'network:access'],
      ['document:read', 'settings:write'],
      ['document:read', 'app:control'],
    ].map((permissions) => ({ permissions })),
  )('permits only document:read, not $permissions', ({ permissions }) => {
    const result = validatePluginManifest({ ...domManifest(), permissions })
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.path === '$.permissions')).toBe(true)
  })

  it.each([
    'commands',
    'keymaps',
    'pasteHandlers',
    'ui',
    'renderers',
    'markdownSyntax',
    'importers',
    'documentTypes',
    'unknownExecution',
  ])('rejects raw %s contribution keys even when empty', (key) => {
    const manifest = domManifest()
    const result = validatePluginManifest({
      ...manifest,
      contributes: { ...manifest.contributes, [key]: [] },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.path.startsWith('$.contributes'))).toBe(true)
  })

  it('rejects declared network origins independently of an omitted network permission', () => {
    const result = validatePluginManifest({
      ...domManifest(),
      networkOrigins: ['https://example.test'],
    })
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.path.startsWith('$.networkOrigins'))).toBe(true)
  })

  it('retains strict renderer declarations instead of accepting a second execution schema', () => {
    const manifest = domManifest()
    const result = validatePluginManifest({
      ...manifest,
      contributes: {
        documentRenderers: [
          { ...manifest.contributes.documentRenderers[0], runtime: 'dom', entry: 'other.js' },
        ],
      },
    })
    expect(result.ok).toBe(false)
    expect(
      result.errors.some((error) => error.path.startsWith('$.contributes.documentRenderers')),
    ).toBe(true)
  })

  it.each(['worker', 'sidecar'])(
    'does not apply the pure DOM profile to existing %s plugins',
    (host) => {
      expect(
        validatePluginManifest({
          id: 'example.tools',
          name: 'Tools',
          version: '1.0.0',
          host,
          permissions: ['document:write'],
          contributes: {
            commands: [{ id: 'example.insert', title: 'Insert', action: 'example.insert' }],
          },
        }).ok,
      ).toBe(true)
    },
  )
})

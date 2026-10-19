import { expect, it } from 'vitest'
import { parsePluginManifest } from './manifest'
import {
  copyPluginManagementSnapshot,
  copyPluginManagementDetails,
  projectPluginManagementMetadata,
  PLUGIN_MANAGEMENT_LIMITS,
} from './management-schema'

it('projects 512 valid long Unicode manifests into a bounded complete catalog', () => {
  const items = Array.from({ length: 512 }, (_, i) => {
    const manifest = parsePluginManifest({
      id: `example.${'a'.repeat(116)}${String(i).padStart(4, '0')}`,
      name: '😀中\\\"'.repeat(300),
      description: '中文😀\\\"'.repeat(2000),
      version: '1.0.0',
    })
    return { id: manifest.id, ...projectPluginManagementMetadata(manifest) }
  })
  const result = copyPluginManagementSnapshot({ revision: 1, items })
  expect(result.items).toHaveLength(512)
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(
    PLUGIN_MANAGEMENT_LIMITS.bytes,
  )
  expect(result.items[0]!.title.endsWith('…')).toBe(true)
  expect(result.items[0]!.description.endsWith('…')).toBe(true)
  expect(result.items[0]!.title).not.toMatch(/[\uD800-\uDBFF]…$/)
  expect(() =>
    copyPluginManagementSnapshot({
      revision: 1,
      items: [...items, { ...items[0], id: 'example.extra' }],
    }),
  ).toThrow()
})
it('preserves small metadata and sanitizes unsupported presentation controls only', () => {
  expect(projectPluginManagementMetadata({ name: 'A😀', description: '描述' })).toEqual({
    title: 'A😀',
    description: '描述',
  })
  expect(projectPluginManagementMetadata({ name: 'Name\0', description: '\ud800end' })).toEqual({
    title: 'Name ',
    description: '\ufffdend',
  })
})
it('preserves complete legal long version, compatibility and 256-origin differences', () => {
  const origins = Array.from({ length: 256 }, (_, i) => `https://host${i}.example.invalid`)
  const manifest = parsePluginManifest({
    id: 'example.long',
    name: '长'.repeat(1000),
    version: '1.0.0-' + 'a'.repeat(300),
    engines: { pluginSdk: ' '.repeat(300) + '>=0.3.0 <0.4.0' },
    permissions: ['network:access'],
    networkOrigins: origins,
  })
  const result = copyPluginManagementDetails({
    pluginId: manifest.id,
    revision: 1,
    entryRevision: 1,
    ...projectPluginManagementMetadata(manifest),
    version: manifest.version,
    host: 'worker',
    state: 'disabled',
    compatibility: {
      compatible: true,
      hostVersion: '2.0.0',
      sdkVersion: '0.3.7',
      requiredSdk: manifest.engines!.pluginSdk,
    },
    permissions: {
      declared: ['network:access'],
      approved: [],
      added: ['network:access'],
      removed: [],
    },
    networkOrigins: { declared: origins, approved: [], added: origins, removed: [] },
    diagnostics: Array.from({ length: 34 }, () => ({
      code: 'catalog',
      severity: 'error',
      message: '中'.repeat(1024),
    })),
  })
  expect(result.version).toBe(manifest.version)
  expect(result.compatibility.requiredSdk).toBe(manifest.engines!.pluginSdk)
  expect(result.networkOrigins.declared).toEqual(origins)
  expect(result.networkOrigins.added).toEqual(origins)
  expect(result.diagnostics).toHaveLength(34)
  const oversizedOrigins = origins.map((origin) => origin + 'x'.repeat(1900))
  expect(() =>
    copyPluginManagementDetails({
      ...result,
      networkOrigins: {
        declared: oversizedOrigins,
        approved: [],
        added: oversizedOrigins,
        removed: [],
      },
    }),
  ).toThrowError(expect.objectContaining({ code: 'unavailable' }))

  expect(() =>
    copyPluginManagementDetails({ ...result, version: '1.0.0-' + 'a'.repeat(512 * 1024) }),
  ).toThrow()
})

it('accepts native catalog cardinality without omitting the 129th entry', () => {
  const items = Array.from({ length: 512 }, (_, i) => ({
    id: `example.item${i}`,
    title: 'Item',
    description: '',
  }))
  expect(copyPluginManagementSnapshot({ revision: 1, items }).items).toHaveLength(512)
})

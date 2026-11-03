import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  nativeManifestJson,
  nativePackageSeals,
  assertReviewedMermaidPackage,
} from './package-seals.mjs'

const hash = (text) => createHash('sha256').update(text).digest('hex')
const archive = () => ({
  format: 'milkup-plugin',
  version: 1,
  manifest: {
    version: '1.3.0',
    id: 'milkup.diagrams',
    host: 'worker',
    permissions: ['document:read'],
    contributes: {
      documentRenderers: [
        { id: 'diagrams.mermaid', contexts: ['fence'], fenceLanguages: ['mermaid'] },
      ],
    },
  },
  files: [
    { path: 'z.txt', encoding: 'base64', content: Buffer.from('中文').toString('base64') },
    { path: 'dist/plugin.js', encoding: 'utf8', content: 'export default {}\n' },
  ],
})

test('native manifest order and FileSeal field order match the catalog representation', () => {
  assert.equal(
    nativeManifestJson({ z: ['保留', { b: true, a: null }], a: 'x' }),
    '{"a":"x","z":["保留",{"a":null,"b":true}]}',
  )
  const value = {
    format: 'milkup-plugin',
    version: 1,
    manifest: { z: 'last', a: 'first' },
    files: [],
  }
  const manifest = '{"a":"first","z":"last"}'
  assert.deepEqual(nativePackageSeals(value), {
    manifestSha256: hash(manifest),
    contentSha256: hash('{"plugin.json":{"sha256":"' + hash(manifest) + '","bytes":24}}'),
  })
})

test('encoding and order do not change decoded package identity; byte changes do', () => {
  const value = archive()
  const expected = nativePackageSeals(value)
  value.files.reverse()
  value.files[1] = { path: 'z.txt', encoding: 'utf8', content: '中文' }
  assert.deepEqual(nativePackageSeals(value), expected)
  value.files[0].content += '// changed'
  assert.notEqual(nativePackageSeals(value).contentSha256, expected.contentSha256)
})

test('the fixed reviewed identity rejects code, resource, and manifest substitutions', () => {
  const value = archive()
  const reviewed = {
    pluginId: 'milkup.diagrams',
    rendererId: 'diagrams.mermaid',
    ...nativePackageSeals(value),
  }
  assertReviewedMermaidPackage(value, reviewed)
  for (const mutate of [
    (copy) => {
      copy.files[1].content += '// changed'
    },
    (copy) => {
      copy.files[0].content = Buffer.from('changed').toString('base64')
    },
    (copy) => {
      copy.manifest.name = 'same id, changed manifest'
    },
  ]) {
    const copy = structuredClone(value)
    mutate(copy)
    assert.throws(() => assertReviewedMermaidPackage(copy, reviewed), /drift/)
  }
})

test('reserved files and invalid resource encodings fail closed', () => {
  for (const file of [
    { path: 'plugin.json', encoding: 'utf8', content: '{}' },
    { path: '../escape', encoding: 'utf8', content: 'x' },
    { path: 'bad.txt', encoding: 'base64', content: 'not base64' },
  ]) {
    const value = archive()
    value.files.push(file)
    assert.throws(() => nativePackageSeals(value))
  }
})

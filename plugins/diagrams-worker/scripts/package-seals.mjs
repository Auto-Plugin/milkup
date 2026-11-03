import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const compare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))

// Match serde_json::Value's ordered object representation in plugin_catalog.rs.
// The reviewed manifest contains only JSON strings, arrays, booleans and objects.
export function nativeManifestJson(value) {
  if (Array.isArray(value)) return '[' + value.map(nativeManifestJson).join(',') + ']'
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort(compare)
        .map((key) => JSON.stringify(key) + ':' + nativeManifestJson(value[key]))
        .join(',') +
      '}'
    )
  const text = JSON.stringify(value)
  assert.notEqual(text, undefined, 'Manifest must contain JSON values')
  return text
}

/** Native catalog code identity. This does not grant runtime authorization. */
export function nativePackageSeals(archive) {
  assert.equal(archive.format, 'milkup-plugin')
  assert.equal(archive.version, 1)
  assert(Array.isArray(archive.files))
  const manifest = Buffer.from(nativeManifestJson(archive.manifest))
  const files = new Map([['plugin.json', manifest]])
  for (const file of archive.files) {
    assert.equal(typeof file.path, 'string')
    assert.match(file.path, /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/)
    assert(!file.path.split('/').some((part) => part === '.' || part === '..'))
    assert(!files.has(file.path), 'Duplicate or reserved package path')
    assert.equal(typeof file.content, 'string')
    assert(['utf8', 'base64'].includes(file.encoding))
    const bytes = Buffer.from(file.content, file.encoding)
    if (file.encoding === 'base64')
      assert.equal(bytes.toString('base64'), file.content, 'Non-canonical base64 resource')
    files.set(file.path, bytes)
  }
  // BTreeMap sorts paths; FileSeal serializes sha256 before bytes (struct order).
  const seals =
    '{' +
    [...files]
      .sort(([left], [right]) => compare(left, right))
      .map(
        ([path, bytes]) =>
          JSON.stringify(path) +
          ':' +
          JSON.stringify({ sha256: digest(bytes), bytes: bytes.length }),
      )
      .join(',') +
    '}'
  return Object.freeze({
    manifestSha256: digest(manifest),
    contentSha256: digest(seals),
  })
}

export function assertReviewedMermaidPackage(archive, reviewed) {
  assert.equal(archive.manifest.id, reviewed.pluginId)
  assert.equal(archive.manifest.host, 'worker')
  assert.equal(archive.manifest.version, '1.3.0')
  assert.deepEqual(archive.manifest.permissions, ['document:read'])
  assert.deepEqual(archive.manifest.contributes?.documentRenderers, [
    { id: reviewed.rendererId, contexts: ['fence'], fenceLanguages: ['mermaid'] },
  ])
  const actual = nativePackageSeals(archive)
  assert.equal(actual.manifestSha256, reviewed.manifestSha256, 'Reviewed Mermaid manifest drift')
  assert.equal(actual.contentSha256, reviewed.contentSha256, 'Reviewed Mermaid package code drift')
  return actual
}

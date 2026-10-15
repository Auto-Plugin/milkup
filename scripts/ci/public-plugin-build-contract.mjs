import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

const json = async (file) => JSON.parse(await readFile(file, 'utf8'))
const versionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/

/** Inputs for local public-SDK proof only. This does not grant packaging,
 * distribution or upload approval; those retain their separate delivery gates. */
export async function readPublicPluginBuildInputs(root) {
  const checkout = await realpath(root)
  const sdk = await json(path.join(checkout, 'packages/plugin-sdk/package.json'))
  assert.equal(sdk.name, '@milkup/plugin-sdk', 'Unexpected public SDK package')
  assert.equal(typeof sdk.version, 'string')
  assert.match(sdk.version, versionPattern, 'SDK version must be a safe complete version')
  const distribution = await json(path.join(checkout, 'release/bundled-plugins.json'))
  assert.ok(Array.isArray(distribution) && distribution.length > 0 && distribution.length <= 64)
  const directories = new Set()
  const ids = new Set()
  const plugins = []
  for (const entry of distribution) {
    assert.ok(entry && typeof entry.directory === 'string')
    assert.match(entry.directory, /^plugins\/[a-z0-9][a-z0-9-]*$/, 'Unsafe plugin directory')
    assert.ok(!directories.has(entry.directory), 'Duplicate plugin directory')
    directories.add(entry.directory)
    const directory = await realpath(path.join(checkout, entry.directory))
    assert.ok(directory.startsWith(`${checkout}${path.sep}`), 'Plugin directory escapes checkout')
    assert.ok(Array.isArray(entry.permissions) && entry.permissions.length <= 64)
    assert.ok(entry.permissions.every((permission) => typeof permission === 'string'))
    assert.equal(new Set(entry.permissions).size, entry.permissions.length)
    const manifest = await json(path.join(directory, 'plugin.json'))
    assert.match(manifest.id, /^[a-z][a-z0-9.-]{0,127}$/, 'Unsafe plugin identity')
    assert.ok(!ids.has(manifest.id), 'Duplicate plugin identity')
    ids.add(manifest.id)
    assert.match(manifest.version, versionPattern, 'Unsafe plugin version')
    assert.equal(manifest.host, 'worker', 'Bundled plugins must use the Worker host')
    assert.equal(manifest.main, './dist/plugin.js')
    assert.deepEqual(manifest.permissions, entry.permissions, 'Distribution permission mismatch')
    assert.equal(
      typeof manifest.engines?.pluginSdk,
      'string',
      'Explicit SDK compatibility is required',
    )
    const resources = manifest.resources ?? []
    assert.ok(Array.isArray(resources) && resources.length <= 64)
    assert.equal(new Set(resources).size, resources.length)
    for (const resource of resources) {
      assert.equal(typeof resource, 'string')
      assert.match(
        resource,
        /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/,
        'Unsafe plugin resource',
      )
      const resolved = await realpath(path.join(directory, resource))
      assert.ok(
        resolved.startsWith(`${directory}${path.sep}`),
        'Plugin resource escapes its package',
      )
    }
    plugins.push({
      directory: entry.directory,
      name: `${manifest.id}-${manifest.version}.milkup-plugin`,
      id: manifest.id,
      version: manifest.version,
      permissions: [...entry.permissions],
      resources: [...resources],
    })
  }
  return {
    sdkVersion: sdk.version,
    sdkTarballName: `milkup-plugin-sdk-${sdk.version}.tgz`,
    plugins: plugins.sort((a, b) => a.name.localeCompare(b.name)),
  }
}

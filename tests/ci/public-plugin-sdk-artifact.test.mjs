import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import {
  readPublicPluginSdkArtifact,
  resolvePublicPluginSdkEntry,
} from '../../scripts/ci/public-plugin-build-contract.mjs'

const sha = (value) => createHash('sha256').update(value).digest('hex')
const metadata = (version) => ({
  name: '@milkup/plugin-sdk',
  version,
  exports: { '.': { types: './src/index.d.ts', import: './src/index.js' } },
})
const members = (version) => [
  { name: 'package/package.json', bytes: Buffer.from(JSON.stringify(metadata(version))) },
  { name: 'package/src/index.js', bytes: Buffer.from('export const sdk = "frozen"\n') },
  { name: 'package/src/index.d.ts', bytes: Buffer.from('export declare const sdk: string\n') },
  { name: 'package/README.md', bytes: Buffer.from('Reviewed public SDK\n') },
]
function tar(items) {
  const chunks = []
  for (const { name, bytes, type = '0' } of items) {
    const header = Buffer.alloc(512)
    header.write(name, 0, 100)
    header.write('0000644\0', 100)
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124)
    header.fill(32, 148, 156)
    header.write(type, 156)
    header.write('ustar\x0000', 257)
    const sum = header.reduce((total, value) => total + value, 0)
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    chunks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512))
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)])
}
async function fixture(t, version = '0.3.4') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'milkup-frozen-sdk-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const plugin = path.join(root, 'plugin')
  const installed = path.join(plugin, 'node_modules/@milkup/plugin-sdk')
  const write = async (name, bytes) => {
    await mkdir(path.dirname(name), { recursive: true })
    await writeFile(name, bytes)
  }
  const files = members(version)
  for (const file of files) await write(path.join(installed, file.name.slice(8)), file.bytes)
  const setTar = async (bytes) => {
    await write(path.join(plugin, 'vendor/plugin-sdk.tgz'), bytes)
    return { buildMode: 'frozen-closure', closure: { sdkTarballSha256: sha(bytes) } }
  }
  const entry = await setTar(gzipSync(tar(files)))
  return { root, plugin, installed, write, files, setTar, entry }
}

test('frozen SDK is bound to its reviewed tar, independently of host SDK/source', async (t) => {
  const f = await fixture(t)
  for (const hostVersion of ['0.3.5', '0.3.6']) {
    await f.write(
      path.join(f.root, 'packages/plugin-sdk/package.json'),
      JSON.stringify(metadata(hostVersion)),
    )
    await f.write(path.join(f.root, 'packages/plugin-sdk/src/index.js'), 'different host code')
    const result = await resolvePublicPluginSdkEntry(f.plugin, f.entry)
    assert.equal(result.sdkVersion, '0.3.4')
    assert.equal(result.sdkTarballSha256, f.entry.closure.sdkTarballSha256)
    assert.equal(result.entryPath, path.join(f.installed, 'src/index.js'))
  }
})

test('installed package metadata, JavaScript, types and documentation must match archive bytes', async (t) => {
  const f = await fixture(t)
  for (const file of f.files) {
    const installed = path.join(f.installed, file.name.slice(8))
    await writeFile(installed, Buffer.concat([file.bytes, Buffer.from(' ')]))
    await assert.rejects(resolvePublicPluginSdkEntry(f.plugin, f.entry), /SDK.*match|SDK.*changed/i)
    await writeFile(installed, file.bytes)
  }
})

test('reviewed tar hash, local installation and required artifact remain authoritative', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    resolvePublicPluginSdkEntry(f.plugin, {
      ...f.entry,
      closure: { sdkTarballSha256: '0'.repeat(64) },
    }),
    /hash/i,
  )
  const outside = path.join(f.root, 'outside-sdk')
  await mkdir(outside)
  await rm(f.installed, { recursive: true })
  await symlink(outside, f.installed)
  await assert.rejects(resolvePublicPluginSdkEntry(f.plugin, f.entry), /locally|checkout/i)
  await rm(path.join(f.plugin, 'vendor/plugin-sdk.tgz'))
  await assert.rejects(resolvePublicPluginSdkEntry(f.plugin, f.entry))
})

test('rejects unsafe or incomplete reviewed archive shapes without extraction', async (t) => {
  const f = await fixture(t)
  const variants = [
    [...f.files, f.files[0]],
    f.files.slice(1),
    [{ ...f.files[0], name: '../package.json' }, ...f.files.slice(1)],
    [{ ...f.files[0], name: '/package/package.json' }, ...f.files.slice(1)],
    [{ ...f.files[0], type: '2' }, ...f.files.slice(1)],
    [{ ...f.files[0], type: '1' }, ...f.files.slice(1)],
    [{ ...f.files[0], type: 'x' }, ...f.files.slice(1)],
  ]
  for (const files of variants) {
    const entry = await f.setTar(gzipSync(tar(files)))
    await assert.rejects(resolvePublicPluginSdkEntry(f.plugin, entry))
  }
  for (const bytes of [
    Buffer.from('not gzip'),
    Buffer.alloc(4 * 1024 * 1024 + 1),
    gzipSync(tar(f.files).subarray(0, 600)),
    gzipSync(Buffer.concat([tar(f.files), Buffer.from('trailing data')])),
    gzipSync(Buffer.alloc(9 * 1024 * 1024)),
    gzipSync(tar([{ ...f.files[0], bytes: Buffer.alloc(3 * 1024 * 1024) }, ...f.files.slice(1)])),
  ])
    await assert.rejects(resolvePublicPluginSdkEntry(f.plugin, await f.setTar(bytes)))
  const corruptHeader = tar(f.files)
  corruptHeader[100] ^= 1
  await assert.rejects(
    resolvePublicPluginSdkEntry(f.plugin, await f.setTar(gzipSync(corruptHeader))),
    /checksum/i,
  )
})

test('archive metadata cannot change the SDK name, version grammar or fixed exports', async (t) => {
  const f = await fixture(t)
  for (const patch of [
    { name: 'private-host' },
    { version: '0.3' },
    { exports: { '.': { import: './elsewhere.js' } } },
  ]) {
    const files = [
      { ...f.files[0], bytes: Buffer.from(JSON.stringify({ ...metadata('0.3.4'), ...patch })) },
      ...f.files.slice(1),
    ]
    await assert.rejects(
      resolvePublicPluginSdkEntry(f.plugin, await f.setTar(gzipSync(tar(files)))),
    )
  }
})

test('different frozen SDK artifacts resolve separately without changing either tar', async (t) => {
  const first = await fixture(t, '0.3.4'),
    second = await fixture(t, '0.3.6')
  assert.equal((await resolvePublicPluginSdkEntry(first.plugin, first.entry)).sdkVersion, '0.3.4')
  assert.equal((await resolvePublicPluginSdkEntry(second.plugin, second.entry)).sdkVersion, '0.3.6')
  assert.equal(
    sha(await readFile(path.join(first.plugin, 'vendor/plugin-sdk.tgz'))),
    first.entry.closure.sdkTarballSha256,
  )
})

test('external verification copies reviewed vendor bytes rather than the current host SDK', async (t) => {
  const original = await fixture(t, '0.3.4')
  const target = await fixture(t, '0.3.4')
  const host = await fixture(t, '0.3.6')
  const artifact = await readPublicPluginSdkArtifact(original.plugin, original.entry)
  const hostBytes = await readFile(path.join(host.plugin, 'vendor/plugin-sdk.tgz'))
  assert.notEqual(artifact.sdkTarballSha256, sha(hostBytes))
  await writeFile(path.join(target.plugin, 'vendor/plugin-sdk.tgz'), artifact.bytes)
  assert.equal(
    (await resolvePublicPluginSdkEntry(target.plugin, original.entry)).sdkVersion,
    '0.3.4',
  )
  await writeFile(path.join(target.plugin, 'vendor/plugin-sdk.tgz'), hostBytes)
  await assert.rejects(resolvePublicPluginSdkEntry(target.plugin, original.entry), /hash/i)
})

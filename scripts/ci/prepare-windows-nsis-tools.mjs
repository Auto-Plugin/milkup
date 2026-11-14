import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

// Exact assets used by the locked Tauri CLI 2.11.4. SHA-1 remains identical to
// Tauri's own verification; SHA-256/length also bind the official release assets.
export const assets = Object.freeze([
  Object.freeze({
    repository: 'tauri-apps/binary-releases',
    id: 317051073,
    name: 'nsis-3.11.zip',
    bytes: 2361546,
    sha256: 'c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1',
    sha1: 'ef7ff767e5cbd9edd22add3a32c9b8f4500bb10d',
  }),
  Object.freeze({
    repository: 'tauri-apps/nsis-tauri-utils',
    id: 345882097,
    name: 'nsis_tauri_utils.dll',
    bytes: 34304,
    sha256: '5ba143b5db4a87d32d6e7802e033330aae56cbceabe0d1e3ba41948385ad4709',
    sha1: '75197fee3c6a814fe035788d1c34ead39349b860',
  }),
])

export function verifyAssetMetadata(value, expected) {
  assert.equal(value.id, expected.id)
  assert.equal(value.name, expected.name)
  assert.equal(value.size, expected.bytes)
  assert.equal(value.state, 'uploaded')
  assert.equal(value.digest, `sha256:${expected.sha256}`)
  assert.equal(
    value.url,
    `https://api.github.com/repos/${expected.repository}/releases/assets/${expected.id}`,
  )
}
export function verifyAssetBytes(bytes, expected) {
  assert.equal(bytes.length, expected.bytes, 'Pinned tool length changed')
  for (const algorithm of ['sha256', 'sha1'])
    assert.equal(
      createHash(algorithm).update(bytes).digest('hex'),
      expected[algorithm],
      `Pinned tool ${algorithm} changed`,
    )
}

const execute = promisify(execFile)
export async function downloadAsset(
  expected,
  run = execute,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  const endpoint = `repos/${expected.repository}/releases/assets/${expected.id}`
  const request = async (accept, maxBuffer) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await run('gh', ['api', endpoint, '-H', `Accept: ${accept}`], {
          encoding: 'buffer',
          maxBuffer,
          timeout: 30000,
          windowsHide: true,
        })
        return { bytes: result.stdout, attempts: attempt }
      } catch (error) {
        // Retry only explicit upstream 5xx. Auth/permission, timeout, integrity,
        // oversized output and every other error fail closed without a retry.
        const status = /HTTP (502|503|504)\b/.exec(String(error.stderr ?? ''))?.[1]
        if (!status || attempt === 3)
          throw new Error(
            `Pinned NSIS asset request failed (${status ?? 'non-retryable'}), attempt ${attempt}`,
          )
        await pause(attempt * 750)
      }
    }
  }
  const metadata = await request('application/vnd.github+json', 65536)
  verifyAssetMetadata(JSON.parse(metadata.bytes.toString('utf8')), expected)
  const download = await request('application/octet-stream', expected.bytes + 1024)
  verifyAssetBytes(download.bytes, expected)
  return {
    bytes: download.bytes,
    metadataAttempts: metadata.attempts,
    downloadAttempts: download.attempts,
  }
}

export async function prepare(directory) {
  await mkdir(directory) // Fresh staging only; never trust or overwrite an old cache.
  const records = []
  for (const asset of assets) {
    const value = await downloadAsset(asset)
    await writeFile(path.join(directory, asset.name), value.bytes, { flag: 'wx' })
    records.push({
      ...asset,
      metadataAttempts: value.metadataAttempts,
      downloadAttempts: value.downloadAttempts,
    })
  }
  const receipt = {
    schema: 1,
    status: 'verified',
    source: 'official-github-release-assets',
    assets: records,
  }
  await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
  })
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3)
  console.log(JSON.stringify(await prepare(path.resolve(process.argv[2]))))
}

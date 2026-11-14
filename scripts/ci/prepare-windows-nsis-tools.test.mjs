import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  assets,
  downloadAsset,
  verifyAssetBytes,
  verifyAssetMetadata,
} from './prepare-windows-nsis-tools.mjs'

const bytes = Buffer.from('bounded official asset fixture')
const expected = {
  repository: 'tauri-apps/test',
  id: 123,
  name: 'tool.zip',
  bytes: bytes.length,
  ...Object.fromEntries(
    ['sha256', 'sha1'].map((a) => [a, createHash(a).update(bytes).digest('hex')]),
  ),
}
const metadata = {
  id: 123,
  name: 'tool.zip',
  size: bytes.length,
  state: 'uploaded',
  digest: `sha256:${expected.sha256}`,
  url: 'https://api.github.com/repos/tauri-apps/test/releases/assets/123',
}
const response = (args) => ({
  stdout: args.at(-1).endsWith('octet-stream') ? bytes : Buffer.from(JSON.stringify(metadata)),
})

test('pins retain the exact locked Tauri SHA-1 checks in addition to SHA-256 and lengths', () => {
  assert.deepEqual(
    assets.map((x) => [x.id, x.bytes, x.sha1]),
    [
      [317051073, 2361546, 'ef7ff767e5cbd9edd22add3a32c9b8f4500bb10d'],
      [345882097, 34304, '75197fee3c6a814fe035788d1c34ead39349b860'],
    ],
  )
  for (const asset of assets) assert.match(asset.sha256, /^[a-f0-9]{64}$/)
})
test('metadata requires every exact asset identity field', () => {
  verifyAssetMetadata(metadata, expected)
  for (const field of Object.keys(metadata)) {
    assert.throws(() => verifyAssetMetadata({ ...metadata, [field]: null }, expected), field)
    const missing = { ...metadata }
    delete missing[field]
    assert.throws(() => verifyAssetMetadata(missing, expected), field)
  }
})
test('truncated, oversized, same-length corrupt, and mismatched legacy hash bytes fail closed', () => {
  verifyAssetBytes(bytes, expected)
  for (const bad of [bytes.subarray(1), Buffer.concat([bytes, bytes]), Buffer.alloc(bytes.length)])
    assert.throws(() => verifyAssetBytes(bad, expected))
  assert.throws(() => verifyAssetBytes(bytes, { ...expected, sha1: '0'.repeat(40) }))
})
test('binary download is separately bounded and returned only after full verification', async () => {
  const calls = []
  const result = await downloadAsset(expected, async (exe, args, options) => {
    calls.push({ exe, args, options })
    return response(args)
  })
  assert.deepEqual(result, { bytes, metadataAttempts: 1, downloadAttempts: 1 })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].options.maxBuffer, 65536)
  assert.equal(calls[1].options.maxBuffer, bytes.length + 1024)
  for (const call of calls) {
    assert.equal(call.exe, 'gh')
    assert.equal(call.options.timeout, 30000)
    assert.equal(call.options.windowsHide, true)
    assert.equal(call.args[1], 'repos/tauri-apps/test/releases/assets/123')
  }
})
test('wrong metadata prevents binary fetch; corrupt bytes are not retried', async () => {
  let calls = 0
  await assert.rejects(
    downloadAsset(expected, async () => {
      calls++
      return { stdout: Buffer.from(JSON.stringify({ ...metadata, id: 124 })) }
    }),
  )
  assert.equal(calls, 1)
  calls = 0
  await assert.rejects(
    downloadAsset(expected, async (_exe, args) => {
      calls++
      return calls === 1 ? response(args) : { stdout: Buffer.alloc(bytes.length) }
    }),
  )
  assert.equal(calls, 2)
})
test('permission/auth, timeout and output-budget errors never retry', async () => {
  for (const stderr of ['HTTP 401', 'HTTP 403', 'ETIMEDOUT', 'maxBuffer exceeded']) {
    let calls = 0
    await assert.rejects(
      downloadAsset(expected, async () => {
        calls++
        throw Object.assign(new Error('request failure'), { stderr })
      }),
      /non-retryable/,
    )
    assert.equal(calls, 1)
  }
})
test('only explicit upstream 502/503/504 retries, bounded at three attempts', async () => {
  let calls = 0
  const delays = []
  const result = await downloadAsset(
    expected,
    async (_exe, args) => {
      calls++
      if (calls <= 2) throw { stderr: Buffer.from('gh: gateway error (HTTP 504)') }
      return response(args)
    },
    async (ms) => delays.push(ms),
  )
  assert.equal(result.metadataAttempts, 3)
  assert.equal(result.downloadAttempts, 1)
  assert.deepEqual(delays, [750, 1500])
  calls = 0
  await assert.rejects(
    downloadAsset(
      expected,
      async () => {
        calls++
        throw { stderr: 'HTTP 503' }
      },
      async () => {},
    ),
    /attempt 3/,
  )
  assert.equal(calls, 3)
})

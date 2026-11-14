import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import https from 'node:https'
import { startFixture } from './test-support/in-app-update-server.mjs'
import { verifyMinisign } from './update-readiness.mjs'

test('scoped TLS and real signature failures preserve exact valid target; private keys never persisted', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'milkup-update-'))
  let fixture
  try {
    const artifact = Buffer.from('test artifact bytes')
    fixture = await startFixture({
      artifact,
      directory,
      openssl: process.env.TEST_DOTNET ?? process.env.TEST_OPENSSL ?? '/usr/bin/openssl',
      ...(process.env.TEST_DOTNET ? { dotnetCertificate: true } : {}),
    })
    const get = (route, trusted = true) =>
      new Promise((resolve, reject) => {
        const req = https.get(
          fixture.base + route,
          { ...(trusted ? { ca: fixture.cert } : {}), timeout: 3000 },
          (res) => {
            const chunks = []
            res.on('data', (v) => chunks.push(v))
            res.on('end', () => resolve({ status: res.statusCode, bytes: Buffer.concat(chunks) }))
          },
        )
        req.on('error', reject)
        req.on('timeout', () => req.destroy(Error('timeout')))
      })
    await assert.rejects(get('/manifest.json', false), /self-signed|certificate/)
    const config = JSON.parse(await readFile(path.join(directory, 'public-fixture.json')))
    const wrong = JSON.parse((await get('/manifest.json')).bytes)
    assert.throws(() =>
      verifyMinisign(
        Buffer.from(wrong.payload, 'base64'),
        wrong.signature,
        config.channel.publicKey,
      ),
    )
    const mode = (value) => writeFile(path.join(directory, 'endpoint-mode.txt'), value)
    await mode('download-error')
    const signed = JSON.parse((await get('/manifest.json')).bytes)
    verifyMinisign(
      Buffer.from(signed.payload, 'base64'),
      signed.signature,
      config.channel.publicKey,
    )
    const release = JSON.parse(Buffer.from(signed.payload, 'base64')).release
    assert.equal(release.version, '2.0.0-beta.11')
    assert.equal((await get('/candidate.exe')).status, 503)
    await mode('bad-artifact')
    const bad = await get('/candidate.exe')
    assert.equal(bad.bytes.length, artifact.length)
    assert.throws(() =>
      verifyMinisign(
        bad.bytes,
        release.platforms['windows-x86_64'].signature,
        config.channel.publicKey,
      ),
    )
    await mode('valid')
    const valid = await get('/candidate.exe')
    assert(valid.bytes.equals(artifact))
    verifyMinisign(
      valid.bytes,
      release.platforms['windows-x86_64'].signature,
      config.channel.publicKey,
    )
    await fixture.stop()
    const report = JSON.parse(await readFile(path.join(directory, 'endpoint-report.json')))
    assert.equal(report.status, 'closed')
    assert.equal(report.requests.length, 5)
    for (const name of await readdir(directory))
      assert(!/PRIVATE KEY/.test(await readFile(path.join(directory, name), 'utf8')))
  } finally {
    await fixture?.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

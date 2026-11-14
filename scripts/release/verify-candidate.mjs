import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
export async function verifyCandidate(directory, sha, variant) {
  assert.match(sha, /^[a-f0-9]{40}$/)
  assert.ok(['windows-standard', 'windows-offline', 'linux-deb'].includes(variant))
  const manifestFile = path.join(directory, 'manifest.json')
  const stat = await lstat(manifestFile)
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16384)
  const receipt = JSON.parse(await readFile(manifestFile, 'utf8'))
  assert.equal(receipt.schema, 1)
  assert.equal(receipt.status, 'built-not-installed')
  assert.equal(receipt.sourceSha, sha)
  assert.equal(receipt.variant, variant)
  assert.equal(receipt.architecture, 'x86_64')
  assert.equal(receipt.signed, false)
  assert.equal(receipt.releasePublished, false)
  assert.match(receipt.version, /^[0-9A-Za-z.+-]+$/)
  const extension = variant === 'linux-deb' ? '.deb' : '.exe'
  assert.equal(
    receipt.installer.name,
    `milkup-${receipt.version}-${variant}-${sha.slice(0, 12)}${extension}`,
  )
  const installer = path.join(directory, receipt.installer.name)
  const file = await lstat(installer)
  assert.ok(
    file.isFile() && !file.isSymbolicLink() && file.size > 0 && file.size <= 512 * 1024 * 1024,
  )
  assert.equal(file.size, receipt.installer.bytes)
  assert.match(receipt.installer.sha256, /^[a-f0-9]{64}$/)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(installer)) hash.update(chunk)
  assert.equal(hash.digest('hex'), receipt.installer.sha256)
  return { ...receipt, installer: { ...receipt.installer, path: installer } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 5, 'Usage: verify-candidate.mjs directory sha variant')
  console.log(JSON.stringify(await verifyCandidate(...process.argv.slice(2)), null, 2))
}

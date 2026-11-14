import assert from 'node:assert/strict'
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
const [binary, output] = process.argv.slice(2)
assert.equal(process.platform, 'win32')
assert.equal(process.env.GITHUB_ACTIONS, 'true')
assert.equal(process.env.GITHUB_REPOSITORY, 'Auto-Plugin/milkup')
assert.match(process.env.GITHUB_SHA, /^[a-f0-9]{40}$/)
const config = JSON.parse(await readFile('release/update-channel.json', 'utf8'))
assert.deepEqual(config, { channel: 'beta', endpoints: [], publicKey: null })
const bytes = await readFile(binary)
assert(bytes.length > 1000000 && bytes.length < 128 * 1024 * 1024)
const record = {
  schema: 1,
  sourceSha: process.env.GITHUB_SHA,
  run: process.env.GITHUB_RUN_ID,
  applicationBaseline: 'b877746f5dfd236dfc13f718ed23d837b8e4f89d',
  version: '2.0.0-beta.10',
  feature: 'ci-update-fixture',
  scope:
    'Instrumented old application; NOT the previously accepted binary or a deliverable installer',
  name: 'milkup-desktop.exe',
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  productionChannel: config,
  acceptance: 'not-run',
}
await mkdir(output)
await copyFile(binary, path.join(output, record.name))
await writeFile(path.join(output, 'fixture-manifest.json'), JSON.stringify(record, null, 2))
console.log(JSON.stringify(record))

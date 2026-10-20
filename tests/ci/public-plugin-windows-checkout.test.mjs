import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  readDependencyClosure,
  readPublicPluginSdkArtifact,
} from '../../scripts/ci/public-plugin-build-contract.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

test('autocrlf checkout preserves every reviewed diagrams hash without normalizing validation', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'milkup-public-checkout-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const repository = path.join(temporary, 'repository')
  const checkout = path.join(temporary, 'checkout with spaces')
  await mkdir(repository)
  await mkdir(checkout)
  const distribution = JSON.parse(
    await readFile(path.join(root, 'release/bundled-plugins.json'), 'utf8'),
  )
  const entry = distribution.find((item) => item.directory === 'plugins/diagrams')
  const pluginRoot = path.join(root, entry.directory)
  const profile = JSON.parse(
    await readFile(path.join(pluginRoot, entry.dependencyClosure.profile), 'utf8'),
  )
  const manifest = JSON.parse(await readFile(path.join(pluginRoot, 'plugin.json'), 'utf8'))
  const names = [
    ...new Set([
      'package.json',
      'plugin.json',
      '.gitignore',
      'vendor/plugin-sdk.tgz',
      entry.dependencyClosure.lockfile,
      entry.dependencyClosure.profile,
      ...profile.buildFiles,
      ...manifest.resources,
    ]),
  ]
  for (const name of names) {
    const target = path.join(repository, entry.directory, name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, await readFile(path.join(pluginRoot, name)))
  }
  await writeFile(
    path.join(repository, '.gitattributes'),
    await readFile(path.join(root, '.gitattributes')),
  )
  await writeFile(
    path.join(repository, 'unrelated.txt'),
    'Ordinary text remains subject to autocrlf.\n',
  )
  await writeFile(path.join(repository, entry.directory, 'vendor/unreviewed.tgz'), 'ignored')
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: repository,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  git('init', '--quiet')
  git('config', 'core.autocrlf', 'false')
  git('config', 'core.attributesFile', path.join(temporary, 'absent-global-attributes'))
  git('add', '--all')
  const tracked = git('ls-files', '-z').split('\0')
  assert.ok(tracked.includes(`${entry.directory}/vendor/plugin-sdk.tgz`))
  assert.ok(!tracked.includes(`${entry.directory}/vendor/unreviewed.tgz`))
  git('config', 'core.autocrlf', 'true')
  git('checkout-index', '--all', '--force', `--prefix=${checkout.replaceAll('\\', '/')}/`)
  assert.equal(
    await readFile(path.join(checkout, 'unrelated.txt'), 'utf8'),
    'Ordinary text remains subject to autocrlf.\r\n',
    'The fixture must actually exercise Git CRLF conversion',
  )
  const checkedPlugin = path.join(checkout, entry.directory)
  const notices = new Map(
    profile.packages.flatMap((item) =>
      item.notices.map((notice) => [notice.resource, notice.resourceSha256]),
    ),
  )
  const expected = new Map([
    [entry.dependencyClosure.lockfile, entry.dependencyClosure.lockSha256],
    [entry.dependencyClosure.profile, entry.dependencyClosure.profileSha256],
    ['vendor/plugin-sdk.tgz', profile.sdkTarballSha256],
    ...notices,
  ])
  for (const [name, digest] of expected) {
    await t.test(`exact bytes survive checkout: ${name}`, async () => {
      assert.equal(sha256(await readFile(path.join(checkedPlugin, name))), digest)
    })
  }
  await t.test('the real frozen-closure validator accepts the checked-out package', async () => {
    await readDependencyClosure(checkedPlugin, entry.dependencyClosure, manifest)
    const sdk = await readPublicPluginSdkArtifact(checkedPlugin, {
      buildMode: 'frozen-closure',
      closure: profile,
    })
    assert.equal(sdk.sdkVersion, '0.3.4')
    assert.equal(sdk.files.size, 4)
  })
})

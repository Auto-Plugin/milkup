import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, realpath, lstat, writeFile } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { localFile, sha256 } from './build-support.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sdk = process.argv[2] && (await realpath(resolve(process.argv[2])))
assert.ok(
  sdk?.endsWith('.tgz'),
  'Usage: node scripts/verify-external.mjs /absolute/milkup-plugin-sdk-0.3.4.tgz /new/external/directory',
)
assert.ok(process.argv[3], 'Use a new explicit evidence directory')
const output = resolve(process.argv[3])
const relation = relative(resolve(root, '../..'), output)
assert.ok(
  relation.startsWith('../') || isAbsolute(relation),
  'Verification directory must be outside the checkout',
)
await mkdir(output, { recursive: false })
const target = resolve(output, 'plugin')
await mkdir(target)
const profile = JSON.parse(
  (await localFile(root, 'build-dependencies.json')).bytes.toString('utf8'),
)
const manifest = JSON.parse((await localFile(root, 'plugin.json')).bytes.toString('utf8'))
const sdkBytes = await readFile(sdk)
assert.equal(
  sha256(sdkBytes),
  profile.sdkTarballSha256,
  'Only the reviewed public SDK tarball is allowed',
)
const inputs = [
  ...new Set([
    'package.json',
    'plugin.json',
    'tsconfig.json',
    'src',
    'pnpm-lock.yaml',
    'build-dependencies.json',
    ...profile.buildFiles,
    ...manifest.resources,
  ]),
]
const generated = new Set(['dist', 'node_modules', 'vendor/plugin-sdk.tgz'])
async function snapshot(directory, selected, copyTo) {
  const files = new Map()
  async function visit(name) {
    assert.ok(
      typeof name === 'string' &&
        !isAbsolute(name) &&
        !name.includes('\\') &&
        name.split('/').every((part) => part && part !== '.' && part !== '..'),
      'Unsafe copied input path',
    )
    if (!selected && generated.has(name)) return
    const full = resolve(directory, name)
    const metadata = await lstat(full)
    assert.ok(!metadata.isSymbolicLink(), `Build input cannot be a symlink: ${name}`)
    if (metadata.isDirectory()) {
      for (const child of (await readdir(full)).sort()) await visit(`${name}/${child}`)
      return
    }
    if (files.has(name)) return
    const { bytes } = await localFile(directory, name)
    files.set(name, { path: name, bytes: bytes.length, sha256: sha256(bytes) })
    if (copyTo) {
      await mkdir(dirname(resolve(copyTo, name)), { recursive: true })
      await writeFile(resolve(copyTo, name), bytes)
    }
  }
  for (const name of selected ?? (await readdir(directory)).sort()) await visit(name)
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
}
const original = await snapshot(root, inputs, target)
await writeFile(resolve(output, 'copied-inputs.json'), JSON.stringify(original, null, 2) + '\n')
await mkdir(resolve(target, 'vendor'))
await writeFile(resolve(target, 'vendor/plugin-sdk.tgz'), sdkBytes)
const executions = []
async function run(args, log) {
  const start = new Date().toISOString()
  const env = { ...process.env }
  delete env.NODE_PATH
  const cli = process.env.PNPM_CLI
  const command = cli ? process.execPath : 'pnpm'
  const argv = cli ? [cli, ...args] : args
  const result = spawnSync(command, argv, { cwd: target, env, encoding: 'utf8' })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  await writeFile(resolve(output, log), stdout + stderr)
  executions.push({
    command: [command, ...argv],
    cwd: target,
    start,
    end: new Date().toISOString(),
    exitCode: result.status,
  })
  await writeFile(resolve(output, 'execution.json'), JSON.stringify(executions, null, 2) + '\n')
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Command failed: ${args.join(' ')}`)
  return stdout.trim()
}
assert.equal(await run(['--version'], 'version.log'), '11.7.0')
await run(
  [
    'install',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--config.manage-package-manager-versions=false',
    '--config.verify-store-integrity=true',
  ],
  'install.log',
)
await run(['run', 'build'], 'build.log')
await run(['test'], 'test.log')
assert.deepEqual(await snapshot(target), original, 'Copied source set changed during verification')
assert.deepEqual(
  await snapshot(root, inputs),
  original,
  'Checkout source changed during verification',
)
assert.equal(
  sha256((await localFile(target, 'vendor/plugin-sdk.tgz')).bytes),
  profile.sdkTarballSha256,
)
const archive = `dist/${manifest.id}-${manifest.version}.milkup-plugin`
const bytes = (await localFile(target, archive)).bytes
await writeFile(
  resolve(output, 'verification.json'),
  JSON.stringify(
    {
      status: 'passed',
      buildMode: 'frozen-closure',
      sdk: { path: sdk, sha256: sha256(sdkBytes) },
      directory: target,
      build: 'passed',
      tests: 'passed',
      copiedInputSha256: sha256(JSON.stringify(original)),
      archive,
      archiveSha256: sha256(bytes),
      bytes: bytes.length,
      scope:
        'Standalone frozen plugin build; distribution trusted rebuild and native DOM acceptance remain separate gates.',
    },
    null,
    2,
  ) + '\n',
)

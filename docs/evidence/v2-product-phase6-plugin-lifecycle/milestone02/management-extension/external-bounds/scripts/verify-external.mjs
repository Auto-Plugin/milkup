import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile, readdir, realpath, lstat } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [sdkArgument, directory] = process.argv.slice(2)
assert.ok(
  sdkArgument && directory && process.env.PNPM_CLI,
  'Supply SDK archive, new external directory and PNPM_CLI',
)
const sdk = await realpath(sdkArgument),
  output = resolve(directory),
  checkout = resolve(root, '../..')
await mkdir(output, { recursive: false })
const target = await realpath(output),
  relation = relative(await realpath(checkout), target)
assert.ok(relation.startsWith('../') || isAbsolute(relation), 'Build must be outside the checkout')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const copied = []
async function copy(name) {
  const source = join(root, name),
    metadata = await lstat(source)
  assert.ok(!metadata.isSymbolicLink(), 'Copied inputs cannot be symlinks')
  if (metadata.isDirectory()) {
    await mkdir(join(target, name), { recursive: true })
    for (const child of await readdir(source)) await copy(`${name}/${child}`)
  } else {
    assert.ok(metadata.isFile() && metadata.size <= 1024 * 1024)
    const bytes = await readFile(source)
    await writeFile(join(target, name), bytes)
    copied.push({ path: name, sha256: sha(bytes) })
  }
}
for (const name of [
  'src',
  'scripts',
  'package.json',
  'plugin.json',
  'tsconfig.json',
  'vitest.config.ts',
  'pnpm-workspace.yaml',
  'README.md',
])
  await copy(name)
await writeFile(join(target, 'copied-inputs.json'), JSON.stringify(copied, null, 2) + '\n')
const pkg = JSON.parse(await readFile(join(target, 'package.json')))
assert.deepEqual(Object.keys(pkg.devDependencies).sort(), [
  '@milkup/plugin-sdk',
  'esbuild',
  'typescript',
  'vitest',
])
pkg.devDependencies['@milkup/plugin-sdk'] = 'file:vendor/plugin-sdk.tgz'
pkg.packageManager = 'pnpm@11.7.0'
await mkdir(join(target, 'vendor'))
const sdkBytes = await readFile(sdk)
await writeFile(join(target, 'vendor/plugin-sdk.tgz'), sdkBytes)
await writeFile(join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
const commands = []
async function run(args, name) {
  const env = { ...process.env }
  delete env.NODE_PATH
  const result = spawnSync(process.execPath, args, { cwd: target, env, encoding: 'utf8' })
  await writeFile(join(target, `${name}.log`), (result.stdout ?? '') + (result.stderr ?? ''))
  commands.push({ args, exitCode: result.status })
  await writeFile(join(target, 'commands.json'), JSON.stringify(commands, null, 2) + '\n')
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${name} failed; see ${target}/${name}.log`)
}
const cacheArgs = [
  ...(process.env.PNPM_STORE_DIR ? ['--store-dir', process.env.PNPM_STORE_DIR] : []),
  ...(process.env.PNPM_CACHE_DIR ? ['--cache-dir', process.env.PNPM_CACHE_DIR] : []),
]
await run(
  [
    process.env.PNPM_CLI,
    'install',
    '--offline',
    '--ignore-scripts',
    '--no-frozen-lockfile',
    '--config.manage-package-manager-versions=false',
    '--config.verify-store-integrity=true',
    ...cacheArgs,
  ],
  'install',
)
await run(
  [
    process.env.PNPM_CLI,
    'install',
    '--offline',
    '--ignore-scripts',
    '--frozen-lockfile',
    '--config.manage-package-manager-versions=false',
    '--config.verify-store-integrity=true',
    ...cacheArgs,
  ],
  'frozen-install',
)
await run(['node_modules/typescript/bin/tsc', '--noEmit'], 'typecheck')
await run(['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.ts'], 'tests')
await run(['scripts/build.mjs'], 'build')
const sdkRoot = await realpath(join(target, 'node_modules/@milkup/plugin-sdk'))
assert.ok(sdkRoot.startsWith(join(target, 'node_modules') + '/'), 'SDK must be installed locally')
const sdkPackage = JSON.parse(await readFile(join(sdkRoot, 'package.json')))
assert.equal(sdkPackage.name, '@milkup/plugin-sdk')
assert.equal(sdkPackage.version, '0.3.7')
assert.equal(sdkPackage.exports['.'].import, './src/index.js')
const meta = JSON.parse(await readFile(join(target, 'dist/build-meta.json')))
const inputs = []
for (const name of Object.keys(meta.inputs)) {
  const file = await realpath(resolve(target, name))
  assert.ok(
    file.startsWith(join(target, 'src') + '/') || file === join(sdkRoot, 'src/index.js'),
    'Non-public build input',
  )
  inputs.push({ path: name, sha256: sha(await readFile(file)) })
}
assert.ok(
  Object.values(meta.outputs).every((item) => item.imports.length === 0),
  'Runtime imports are forbidden',
)
for (const item of copied)
  if (item.path !== 'package.json')
    assert.equal(sha(await readFile(join(target, item.path))), item.sha256, 'Copied source changed')
const manifest = JSON.parse(await readFile(join(target, 'plugin.json')))
const archiveName = `milkup.management-${manifest.version}.milkup-plugin`,
  archiveBytes = await readFile(join(target, 'dist', archiveName)),
  archive = JSON.parse(archiveBytes)
assert.equal(archive.format, 'milkup-plugin')
assert.equal(archive.version, 1)
assert.deepEqual(archive.manifest, manifest)
assert.deepEqual(archive.files, [
  {
    path: 'dist/plugin.js',
    encoding: 'utf8',
    content: (await readFile(join(target, 'dist/plugin.js'))).toString(),
  },
])
const tools = {}
for (const name of ['typescript', 'esbuild', 'vitest'])
  tools[name] = JSON.parse(
    await readFile(join(target, 'node_modules', name, 'package.json')),
  ).version
const proof = {
  status: 'passed',
  sdkVersion: sdkPackage.version,
  sdkSha256: sha(sdkBytes),
  directory: target,
  dependencyPolicy: 'external-derived-lock',
  tools,
  inputs,
  outputImports: 0,
  archive: archiveName,
  bytes: archiveBytes.length,
  sha256: sha(archiveBytes),
  entrySha256: sha(await readFile(join(target, 'dist/plugin.js'))),
  lockSha256: sha(await readFile(join(target, 'pnpm-lock.yaml'))),
  commands,
}
await writeFile(join(target, 'verification.json'), JSON.stringify(proof, null, 2) + '\n')
console.log(JSON.stringify(proof))

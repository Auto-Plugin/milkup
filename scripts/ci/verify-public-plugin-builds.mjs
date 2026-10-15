import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPluginInventory } from './plugin-offline-delivery.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [directory, pnpmCli] = process.argv.slice(2)
assert.ok(
  directory && pnpmCli,
  'Usage: node verify-public-plugin-builds.mjs <new external directory> <pnpm.cjs>',
)
await mkdir(directory, { recursive: false })
const output = await realpath(directory)
const relative = path.relative(await realpath(root), output)
assert.ok(
  relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
  'Build proof must live outside the checkout',
)
const require = createRequire(path.join(root, 'package.json'))
const version = (name) => require(`${name}/package.json`).version
const tools = {
  esbuild: version('esbuild'),
  typescript: version('typescript'),
  vitest: version('vitest'),
}
function run(args, cwd) {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    cwd,
    env: process.env,
    encoding: 'utf8',
  })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  if (result.error) throw result.error
  assert.equal(result.status, 0, `pnpm ${args.join(' ')} failed`)
}
const sdkDirectory = path.join(output, 'sdk')
await mkdir(sdkDirectory)
assert.equal(
  JSON.parse(await readFile(path.join(root, 'packages/plugin-sdk/package.json'))).version,
  '0.2.0',
)
run(
  ['--dir', path.join(root, 'packages/plugin-sdk'), 'pack', '--pack-destination', sdkDirectory],
  root,
)
const sdk = path.join(sdkDirectory, 'milkup-plugin-sdk-0.2.0.tgz')
const sdkBytes = await readFile(sdk)
const records = []
for (const entry of await readPluginInventory(root)) {
  const target = path.join(output, entry.id)
  await mkdir(target)
  for (const name of ['package.json', 'plugin.json', 'tsconfig.json', 'src'])
    await cp(path.join(root, entry.directory, name), path.join(target, name), { recursive: true })
  await mkdir(path.join(target, 'scripts'))
  await cp(
    path.join(root, entry.directory, 'scripts/build.mjs'),
    path.join(target, 'scripts/build.mjs'),
  )
  const manifest = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'))
  assert.ok(
    Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
      .filter((name) => name.startsWith('@milkup/'))
      .every((name) => name === '@milkup/plugin-sdk'),
  )
  manifest.devDependencies = {
    ...manifest.devDependencies,
    ...tools,
    '@milkup/plugin-sdk': `file:${sdk.replaceAll('\\', '/')}`,
  }
  await writeFile(path.join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(
    path.join(target, 'pnpm-workspace.yaml'),
    "packages:\n  - '.'\nallowBuilds:\n  esbuild: true\n",
  )
  await writeFile(
    path.join(target, 'vitest.config.ts'),
    "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: { include: ['src/**/*.test.ts'] } })\n",
  )
  run(['install', '--no-frozen-lockfile', '--config.manage-package-manager-versions=false'], target)
  run(['run', 'build'], target)
  run(['exec', 'vitest', 'run', '--config', 'vitest.config.ts'], target)
  const archive = await readFile(path.join(target, 'dist', entry.name))
  records.push({
    ...entry,
    build: 'passed',
    tests: 'passed',
    bytes: archive.length,
    sha256: createHash('sha256').update(archive).digest('hex'),
  })
}
const result = {
  status: 'passed',
  sdkVersion: '0.2.0',
  sdkSha256: createHash('sha256').update(sdkBytes).digest('hex'),
  tools,
  plugins: records,
}
await writeFile(path.join(output, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result))

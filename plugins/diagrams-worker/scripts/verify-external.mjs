import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = JSON.parse(await readFile(resolve(root, 'plugin.json'), 'utf8'))
const packageManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (packageManifest.version !== plugin.version) throw new Error('Plugin/package versions differ')
const sdk = process.argv[2] && (await realpath(resolve(process.argv[2])))
if (!sdk || !sdk.endsWith('.tgz'))
  throw new Error(
    `Usage: node scripts/verify-external.mjs /absolute/milkup-plugin-sdk-${packageManifest.devDependencies['@milkup/plugin-sdk']}.tgz external-directory`,
  )
if (!process.argv[3]) throw new Error('An external verification directory is required')
const output = resolve(process.argv[3])
await mkdir(output, { recursive: true })
const target = await realpath(output)
const checkout = resolve(root, '../..')
const within = relative(checkout, target)
if (!within || (!within.startsWith('..') && !isAbsolute(within)))
  throw new Error('Verification directory must be outside the Milkup checkout')
for (const name of [
  'package.json',
  'pnpm-workspace.yaml',
  'plugin.json',
  'tsconfig.json',
  'vitest.config.ts',
  'README.md',
  'THIRD-PARTY-NOTICES.txt',
  'dependency-provenance.json',
  'src',
  'scripts',
])
  await cp(resolve(root, name), resolve(target, name), { recursive: true })
// Resolve the sole Milkup dependency to the supplied public distribution archive.
const manifest = JSON.parse(await readFile(resolve(target, 'package.json'), 'utf8'))
manifest.devDependencies['@milkup/plugin-sdk'] = `file:${sdk}`
await writeFile(resolve(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
async function run(args, log) {
  const chunks = []
  const code = await new Promise((done, reject) => {
    const cli = process.env.MILKUP_PNPM_CLI
    const invocation = [
      ...(cli ? [cli] : []),
      '--config.manage-package-manager-versions=false',
      ...args,
    ]
    const child = spawn(cli ? process.execPath : 'pnpm', invocation, {
      cwd: target,
      env: {
        ...process.env,
        npm_config_manage_package_manager_versions: 'false',
        pnpm_config_pm_on_fail: 'ignore',
        XDG_CACHE_HOME: resolve(target, '.cache'),
        PNPM_HOME: resolve(target, '.pnpm-home'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        chunks.push(chunk)
        process.stdout.write(chunk)
      })
    child.on('error', reject)
    child.on('close', done)
  })
  await writeFile(resolve(target, log), Buffer.concat(chunks))
  await writeFile(resolve(target, log.replace(/\.log$/, '.exit')), `${code}\n`)
  if (code !== 0) throw new Error(`pnpm ${args.join(' ')} failed (${code})`)
}
await run(
  ['install', '--no-frozen-lockfile', '--store-dir', resolve(target, '.pnpm-store')],
  'install.log',
)
await run(['run', 'check'], 'typecheck.log')
await run(['run', 'build'], 'build.log')
await run(['test'], 'test.log')
const archive = `dist/${plugin.id}-${plugin.version}.milkup-plugin`
const digest = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
await writeFile(
  resolve(target, 'verification.json'),
  `${JSON.stringify({ sdk, sdkSha256: await digest(sdk), directory: target, pluginVersion: plugin.version, typecheck: 'passed', build: 'passed', tests: 'passed', archive, archiveSha256: await digest(resolve(target, archive)) }, null, 2)}\n`,
)
console.log(`Independent limited diagrams Worker plugin verified: ${target}`)

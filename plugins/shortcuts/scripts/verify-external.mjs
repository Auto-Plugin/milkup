import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sdk = process.argv[2] && (await realpath(resolve(process.argv[2])))
if (!sdk || !sdk.endsWith('.tgz'))
  throw new Error(
    'Usage: node scripts/verify-external.mjs /absolute/milkup-plugin-sdk-0.3.1.tgz [external-directory]',
  )
const output = resolve(
  process.argv[3] || '/workspace/milkup-preferences-phase3-evidence/keymap/external',
)
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
    const child = spawn('pnpm', args, {
      cwd: target,
      env: process.env,
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
  if (code !== 0) throw new Error(`pnpm ${args.join(' ')} failed (${code})`)
}
await run(
  ['install', '--no-frozen-lockfile', '--config.manage-package-manager-versions=false'],
  'install.log',
)
await run(['run', 'build'], 'build.log')
await run(['test'], 'test.log')
await writeFile(
  resolve(target, 'verification.json'),
  `${JSON.stringify({ sdk, directory: target, build: 'passed', tests: 'passed', archive: 'dist/milkup.shortcuts-1.0.0.milkup-plugin' }, null, 2)}\n`,
)
console.log(`Independent shortcuts plugin verified: ${target}`)

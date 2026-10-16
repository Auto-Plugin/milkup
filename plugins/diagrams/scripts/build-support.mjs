import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const within = (root, file) => {
  const rel = relative(root, file)
  return rel && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
}
export async function localFile(root, name) {
  assert.ok(
    typeof name === 'string' &&
      !/[\\\u0000-\u001f\u007f:%?#]/u.test(name) &&
      !isAbsolute(name) &&
      name.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Unsafe package path',
  )
  const file = await realpath(resolve(root, name))
  assert.ok(within(await realpath(root), file), `Package path escaped: ${name}`)
  assert.ok((await stat(file)).isFile(), `Not a regular file: ${name}`)
  return { path: file, bytes: await readFile(file) }
}
export async function compileEntry(root, { target, minify }) {
  const { build } = await import('esbuild')
  assert.equal(
    target,
    'es2024',
    'Use the reviewed engine target; esbuild does not supply runtime polyfills',
  )
  assert.equal(
    minify,
    true,
    'The full engine uses explicitly reviewed minification within the fixed entry budget',
  )
  const sdkRoot = await realpath(resolve(root, 'node_modules/@milkup/plugin-sdk'))
  assert.ok(within(resolve(root, 'node_modules'), sdkRoot), 'SDK must be installed locally')
  const sdk = JSON.parse((await localFile(sdkRoot, 'package.json')).bytes.toString('utf8'))
  assert.equal(sdk.name, '@milkup/plugin-sdk')
  assert.equal(sdk.version, '0.3.4')
  assert.equal(sdk.exports?.['.']?.import, './src/index.js')
  const sdkEntry = (await localFile(sdkRoot, 'src/index.js')).path
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/plugin.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target,
    minify,
    outfile: 'dist/plugin.js',
    legalComments: 'eof',
    write: false,
    metafile: true,
    alias: { '@milkup/plugin-sdk': sdkEntry },
  })
  assert.equal(result.outputFiles.length, 1, 'One self-contained ESM entry is required')
  assert.ok(
    Object.values(result.metafile.outputs).every((output) => output.imports.length === 0),
    'Runtime imports are forbidden',
  )
  assert.ok(
    result.outputFiles[0].contents.length <= 8 * 1024 * 1024,
    'Entry exceeds existing native 8 MiB limit',
  )
  return { result, sdkEntry }
}
export async function validateProfile(root, profile, result, sdkEntry) {
  assert.equal(profile.version, 1)
  assert.equal(profile.packageManager, 'pnpm@11.7.0')
  assert.equal(
    sha256((await localFile(root, 'vendor/plugin-sdk.tgz')).bytes),
    profile.sdkTarballSha256,
    'SDK tarball changed',
  )
  const approved = new Set([sdkEntry])
  for (const pkg of profile.packages) {
    const packageRoot = await realpath(resolve(root, pkg.root))
    assert.ok(
      within(resolve(root, 'node_modules'), packageRoot),
      'Dependency escapes installed tree',
    )
    const metadata = JSON.parse(
      (await localFile(packageRoot, 'package.json')).bytes.toString('utf8'),
    )
    assert.equal(metadata.name, pkg.name)
    assert.equal(metadata.version, pkg.version)
    for (const input of pkg.inputs) {
      const file = await localFile(packageRoot, input.path)
      assert.equal(sha256(file.bytes), input.sha256, `Dependency input changed: ${input.path}`)
      assert.ok(!approved.has(file.path), 'Duplicate dependency input')
      approved.add(file.path)
    }
    for (const notice of pkg.notices) {
      const original = (await localFile(packageRoot, notice.path)).bytes
      const resource = (await localFile(root, notice.resource)).bytes
      assert.equal(sha256(original), notice.sha256, 'Original notice changed')
      assert.equal(sha256(resource), notice.resourceSha256, 'Packaged notices changed')
      assert.ok(resource.includes(original), 'Notice text was not preserved')
    }
  }
  const sourceRoot = await realpath(resolve(root, 'src'))
  assert.equal(sourceRoot, resolve(root, 'src'), 'Source root cannot be a symlink')
  const consumed = new Set()
  for (const name of Object.keys(result.metafile.inputs)) {
    const file = await realpath(resolve(root, name))
    if (within(sourceRoot, file)) continue
    assert.ok(approved.has(file), `Unreviewed dependency: ${name}`)
    consumed.add(file)
  }
  for (const file of approved)
    if (file !== sdkEntry) assert.ok(consumed.has(file), `Reviewed input not consumed: ${file}`)
}

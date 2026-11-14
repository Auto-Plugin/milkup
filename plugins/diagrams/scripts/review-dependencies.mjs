// Explicit authoring step only. Normal build/test never regenerates reviewed inputs.
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileEntry, localFile, sha256, within } from './build-support.mjs'

assert.ok(
  process.argv.includes('--write-candidate'),
  'Pass --write-candidate only during an explicitly reviewed dependency refresh',
)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profilePath = resolve(root, 'build-dependencies.json')
try {
  await stat(profilePath)
  assert.ok(
    process.argv.includes('--replace'),
    'An existing reviewed profile requires explicit --replace',
  )
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const lock = (await localFile(root, 'pnpm-lock.yaml')).bytes
const sdkBytes = (await localFile(root, 'vendor/plugin-sdk.tgz')).bytes
const { result, sdkEntry } = await compileEntry(root, { target: 'es2024', minify: true })
const groups = new Map()
const sourceRoot = await realpath(resolve(root, 'src'))
for (const name of Object.keys(result.metafile.inputs)) {
  const file = await realpath(resolve(root, name))
  if (file === sdkEntry || within(sourceRoot, file)) continue
  assert.ok(within(resolve(root, 'node_modules'), file), `Private/noninstalled input: ${name}`)
  let packageRoot = dirname(file)
  let metadata
  while (within(resolve(root, 'node_modules'), packageRoot)) {
    try {
      const candidate = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
      if (candidate.name && candidate.version) {
        metadata = candidate
        break
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    packageRoot = dirname(packageRoot)
  }
  assert.ok(metadata && !metadata.name.startsWith('@milkup/'), `No public package owner: ${name}`)
  if (!groups.has(packageRoot))
    groups.set(packageRoot, {
      locator: `${metadata.name}@${metadata.version}`,
      name: metadata.name,
      version: metadata.version,
      license: metadata.license ?? null,
      root: relative(root, packageRoot).replaceAll('\\', '/'),
      inputs: [],
      notices: [],
    })
  groups.get(packageRoot).inputs.push({
    path: relative(packageRoot, file).replaceAll('\\', '/'),
    sha256: sha256(await readFile(file)),
  })
}
const packages = [...groups.values()].sort((a, b) => a.locator.localeCompare(b.locator))
assert.equal(
  new Set(packages.map((pkg) => pkg.locator)).size,
  packages.length,
  'Multiple peer instances need explicit locator review, not guessed resolution',
)
const noticeParts = [
  Buffer.from(
    'Third-party notices for bundled runtime inputs. Full locked resolution graph is pnpm-lock.yaml.\n',
  ),
]
for (const pkg of packages) {
  const packageRoot = resolve(root, pkg.root)
  const names = (await readdir(packageRoot))
    .filter(
      (name) =>
        /^(?:licen[cs]e|notice|copying)(?:[._-].*)?$/i.test(name) &&
        !/\.(?:[cm]?[jt]s|sh|json)$/i.test(name),
    )
    .sort()
  assert.ok(
    names.length > 0,
    `No distributed notice found for ${pkg.locator}; manual review required`,
  )
  for (const name of names) {
    const { bytes } = await localFile(packageRoot, name)
    noticeParts.push(
      Buffer.from(`\n===== ${pkg.locator} / ${name} =====\n`),
      bytes,
      Buffer.from('\n'),
    )
    pkg.notices.push({ path: name, sha256: sha256(bytes), resource: 'THIRD-PARTY-NOTICES.txt' })
  }
  pkg.inputs.sort((a, b) => a.path.localeCompare(b.path))
}
const notices = Buffer.concat(noticeParts)
for (const pkg of packages)
  for (const notice of pkg.notices) notice.resourceSha256 = sha256(notices)
const profile = {
  version: 1,
  packageManager: 'pnpm@11.7.0',
  target: 'es2024',
  minify: true,
  sdkTarballSha256: sha256(sdkBytes),
  buildFiles: [
    'scripts/build.mjs',
    'scripts/build-support.mjs',
    'scripts/review-dependencies.mjs',
    'scripts/verify-external.mjs',
    'pnpm-workspace.yaml',
    'vitest.config.ts',
  ],
  packages,
}
const provenance = {
  status: 'candidate-for-review',
  engine: {
    name: 'mermaid',
    version: '12.2.0',
    entry: 'public default export; full package, not tiny',
  },
  runtimeCompatibility:
    'ES2024 runtime; esbuild target does not provide runtime polyfills. Actual production WebKit acceptance is a separate gate.',
  lockfile: { path: 'pnpm-lock.yaml', sha256: sha256(lock) },
  sdkTarballSha256: sha256(sdkBytes),
  excludedNoticeSources:
    'Maintenance scripts such as license-update.mjs are not treated as license text. Version-qualified original license/notice files are preserved without flattening package versions.',
  coverage:
    'Every bundled dependency input and its distributed package notices. Tool-only and noninstalled optional packages are in the full pinned lock; not asserted as bundled runtime code.',
  entryBytes: result.outputFiles[0].contents.length,
  inputs: Object.keys(result.metafile.inputs).length,
  runtimeImports: [],
  packages: packages.map(({ locator, name, version, license, inputs, notices }) => ({
    locator,
    name,
    version,
    license,
    inputCount: inputs.length,
    notices,
  })),
}
await writeFile(resolve(root, 'THIRD-PARTY-NOTICES.txt'), notices)
await writeFile(
  resolve(root, 'dependency-provenance.json'),
  JSON.stringify(provenance, null, 2) + '\n',
)
await writeFile(profilePath, JSON.stringify(profile, null, 2) + '\n')
await mkdir(resolve(root, 'dist'), { recursive: true })
await writeFile(
  resolve(root, 'dist/review-metafile.json'),
  JSON.stringify(result.metafile, null, 2) + '\n',
)
console.log(
  JSON.stringify({
    status: 'candidate-for-review',
    lockSha256: sha256(lock),
    profileSha256: sha256(await readFile(profilePath)),
    sdkTarballSha256: sha256(sdkBytes),
    packages: packages.length,
    inputs: Object.keys(result.metafile.inputs).length,
    entryBytes: result.outputFiles[0].contents.length,
    noticeBytes: notices.length,
  }),
)

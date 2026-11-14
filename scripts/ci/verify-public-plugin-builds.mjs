import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readPublicPluginBuildInputs,
  publicBuildFile,
  verifyPublicPluginBundle,
  verifyPublicSdkTarball,
  resolvePublicPluginSdkEntry,
  readPublicPluginSdkArtifact,
  capturePublicBuildInputs,
  verifyPublicBuildInputs,
} from './public-plugin-build-contract.mjs'

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
const executions = []
function run(args, cwd) {
  const startedAt = new Date().toISOString()
  const env = { ...process.env }
  delete env.NODE_PATH
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  executions.push({
    command: [process.execPath, pnpmCli, ...args],
    cwd,
    startedAt,
    endedAt: new Date().toISOString(),
    exitCode: result.status,
  })
  writeFileSync(
    path.join(output, 'execution-progress.json'),
    `${JSON.stringify(executions, null, 2)}\n`,
  )
  if (result.error) throw result.error
  assert.equal(result.status, 0, `pnpm ${args.join(' ')} failed`)
  return result.stdout?.trim()
}

async function copyInput(sourceRoot, targetRoot, name, ancestors = new Set()) {
  const source = await realpath(path.join(sourceRoot, name))
  const relative = path.relative(sourceRoot, source)
  assert.ok(
    relative &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative),
    'Build input escapes plugin',
  )
  if (name === 'src')
    assert.equal(source, path.join(sourceRoot, 'src'), 'Source root must not be a symlink')
  if (name.startsWith(`src${path.sep}`)) {
    const sourceRelative = path.relative(path.join(sourceRoot, 'src'), source)
    assert.ok(
      sourceRelative &&
        sourceRelative !== '..' &&
        !sourceRelative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(sourceRelative),
      'Source input escapes src',
    )
  }
  const metadata = await stat(source)
  if (metadata.isDirectory()) {
    assert.ok(!ancestors.has(source), 'Build input directory cycle')
    const next = new Set([...ancestors, source])
    await mkdir(path.join(targetRoot, name), { recursive: true })
    for (const child of await readdir(source))
      await copyInput(sourceRoot, targetRoot, path.join(name, child), next)
  } else {
    const file = await publicBuildFile(sourceRoot, name.replaceAll('\\', '/'))
    await mkdir(path.dirname(path.join(targetRoot, name)), { recursive: true })
    await writeFile(path.join(targetRoot, name), file.bytes)
  }
}
const sdkDirectory = path.join(output, 'sdk')
await mkdir(sdkDirectory)
const { sdkVersion, sdkTarballName, plugins } = await readPublicPluginBuildInputs(root)
run(
  ['--dir', path.join(root, 'packages/plugin-sdk'), 'pack', '--pack-destination', sdkDirectory],
  root,
)
const sdk = path.join(sdkDirectory, sdkTarballName)
const sdkBytes = await readFile(sdk)
const records = []
for (const entry of plugins) {
  const target = path.join(output, entry.id)
  await mkdir(target)
  const pluginRoot = await realpath(path.join(root, entry.directory))
  const inputs = [
    ...new Set([
      'package.json',
      'plugin.json',
      'tsconfig.json',
      'src',
      'scripts/build.mjs',
      ...entry.resources,
      ...(entry.buildFiles ?? []),
    ]),
  ]
  for (const name of inputs) await copyInput(pluginRoot, target, name)
  const copiedSnapshot =
    entry.buildMode === 'frozen-closure' ? await capturePublicBuildInputs(target) : undefined
  if (copiedSnapshot) {
    await verifyPublicBuildInputs(target, pluginRoot, inputs, copiedSnapshot)
    await writeFile(
      path.join(output, `${entry.id}-copied-inputs.json`),
      `${JSON.stringify(copiedSnapshot, null, 2)}\n`,
    )
  }
  const manifest = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'))
  assert.ok(
    Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    })
      .filter((name) => name.startsWith('@milkup/'))
      .every((name) => name === '@milkup/plugin-sdk'),
  )
  if (entry.buildMode === 'frozen-closure') {
    assert.equal(run(['--version'], target), '11.7.0', 'Frozen builds require pnpm 11.7.0')
    const reviewedSdk = await readPublicPluginSdkArtifact(pluginRoot, entry)
    await mkdir(path.join(target, 'vendor'))
    await writeFile(path.join(target, 'vendor/plugin-sdk.tgz'), reviewedSdk.bytes)
    // Preserve package.json and lock bytes. No resolver, overrides, or derived lock.
    run(
      [
        'install',
        '--frozen-lockfile',
        '--ignore-scripts',
        '--config.manage-package-manager-versions=false',
        '--config.verify-store-integrity=true',
      ],
      target,
    )
  } else {
    // Historical Worker proof intentionally remains non-frozen and is labelled as such.
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
    run(
      ['install', '--no-frozen-lockfile', '--config.manage-package-manager-versions=false'],
      target,
    )
  }
  // Test discovery is a local public proof input, never a workspace import.
  assert.ok(!inputs.includes('vitest.public.config.mjs'), 'Reserved public proof config')
  await writeFile(
    path.join(target, 'vitest.public.config.mjs'),
    "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: { include: ['src/**/*.test.ts'] } })\n",
  )
  run(['run', 'build'], target)
  run(['exec', 'vitest', 'run', '--config', 'vitest.public.config.mjs'], target)
  const archive = await readFile(path.join(target, 'dist', entry.name))
  let verification
  let inputProof
  let frozenSdk
  if (entry.buildMode === 'frozen-closure') {
    // Reject changed copied sources before the independent trusted rebuild.
    inputProof = await verifyPublicBuildInputs(target, pluginRoot, inputs, copiedSnapshot)
    verifyPublicSdkTarball(entry, (await publicBuildFile(target, 'vendor/plugin-sdk.tgz')).bytes)
    frozenSdk = await resolvePublicPluginSdkEntry(target, entry)
    const sdkEntry = frozenSdk.entryPath
    const installedRequire = createRequire(path.join(target, 'package.json'))
    const { build } = installedRequire('esbuild')
    assert.equal(installedRequire('esbuild/package.json').version, manifest.devDependencies.esbuild)
    const built = await build({
      absWorkingDir: target,
      entryPoints: ['src/plugin.ts'],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: entry.closure.target,
      minify: entry.closure.minify,
      outfile: 'dist/plugin.js',
      legalComments: 'eof',
      write: false,
      metafile: true,
      alias: { '@milkup/plugin-sdk': sdkEntry },
    })
    assert.equal(built.outputFiles.length, 1)
    verification = await verifyPublicPluginBundle(target, entry, built.metafile, { sdkEntry })
    const contents = JSON.parse(archive.toString('utf8'))
    assert.equal(contents.format, 'milkup-plugin')
    assert.equal(contents.version, 1)
    assert.deepEqual(
      contents.manifest,
      JSON.parse(await readFile(path.join(target, 'plugin.json'), 'utf8')),
    )
    assert.equal(contents.files.length, entry.resources.length + 1)
    assert.equal(new Set(contents.files.map((file) => file.path)).size, contents.files.length)
    const bundled = contents.files.find((file) => file.path === 'dist/plugin.js')
    assert.equal(bundled?.encoding, 'utf8')
    assert.equal(
      bundled?.content,
      built.outputFiles[0].text,
      'Package entry differs from trusted build',
    )
    for (const name of entry.resources) {
      const resource = contents.files.find((file) => file.path === name)
      assert.ok(
        resource && ['utf8', 'base64'].includes(resource.encoding),
        'Missing package resource',
      )
      assert.ok(
        Buffer.from(resource.content, resource.encoding).equals(
          (await publicBuildFile(target, name)).bytes,
        ),
        'Package resource changed',
      )
    }
    // Recheck after rebuilding too, including src/manifest/tsconfig and unexpected files.
    inputProof = await verifyPublicBuildInputs(target, pluginRoot, inputs, copiedSnapshot)
  }
  records.push({
    ...entry,
    build: 'passed',
    dependencyVerification: verification ?? { mode: 'legacy-non-frozen' },
    ...(inputProof ? { copiedInputProof: inputProof } : {}),
    tests: 'passed',
    sdkVersion: frozenSdk?.sdkVersion ?? sdkVersion,
    ...(frozenSdk ? { sdkTarballSha256: frozenSdk.sdkTarballSha256 } : {}),
    bytes: archive.length,
    sha256: createHash('sha256').update(archive).digest('hex'),
  })
}
const result = {
  status: 'passed',
  sdkVersion,
  sdkSha256: createHash('sha256').update(sdkBytes).digest('hex'),
  tools,
  executions,
  dependencyPolicies: {
    frozen: records.filter((entry) => entry.buildMode === 'frozen-closure').length,
    legacyNonFrozen: records.filter((entry) => entry.buildMode === 'legacy-non-frozen').length,
  },
  plugins: records,
}
await writeFile(path.join(output, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result))

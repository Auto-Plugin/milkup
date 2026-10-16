import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readPublicPluginBuildInputs,
  publicBuildFile,
  verifyPublicPluginBundle,
  verifyPublicSdkTarball,
  resolvePublicPluginSdkEntry,
} from './public-plugin-build-contract.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { sdkVersion, plugins } = await readPublicPluginBuildInputs(root)
const destination = resolve(root, 'apps/desktop/src/bundled-plugins')
const prepared = []
for (const item of plugins) {
  const pluginRoot = resolve(root, item.directory)
  const manifest = JSON.parse(
    (await publicBuildFile(pluginRoot, 'plugin.json')).bytes.toString('utf8'),
  )
  const sdkEntry =
    item.buildMode === 'frozen-closure'
      ? await resolvePublicPluginSdkEntry(pluginRoot, root, sdkVersion)
      : resolve(root, 'packages/plugin-sdk/src/index.js')
  if (item.buildMode === 'frozen-closure') {
    verifyPublicSdkTarball(item, (await publicBuildFile(pluginRoot, 'vendor/plugin-sdk.tgz')).bytes)
    const pluginPackage = JSON.parse(
      (await publicBuildFile(pluginRoot, 'package.json')).bytes.toString('utf8'),
    )
    const buildPackage = JSON.parse(
      await readFile(resolve(root, 'node_modules/esbuild/package.json'), 'utf8'),
    )
    if (pluginPackage.devDependencies?.esbuild !== buildPackage.version)
      throw Error('Reviewed plugin bundler version must match the distribution bundler')
  }
  const result = await build({
    absWorkingDir: pluginRoot,
    entryPoints: ['src/plugin.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: item.closure?.target ?? 'es2022',
    minify: item.closure?.minify ?? false,
    outfile: 'dist/plugin.js',
    legalComments: 'eof',
    write: false,
    metafile: true,
    alias: { '@milkup/plugin-sdk': sdkEntry },
  })
  if (result.outputFiles.length !== 1)
    throw Error('Plugin entry must be a single self-contained module')
  const verification = await verifyPublicPluginBundle(pluginRoot, item, result.metafile, {
    sdkEntry,
  })
  const resources = []
  for (const resource of manifest.resources ?? []) {
    const { bytes } = await publicBuildFile(pluginRoot, resource)
    if (
      resource === manifest.icon &&
      (!resource.endsWith('.png') ||
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    )
      throw Error('Declared plugin icon must be a PNG resource')
    resources.push({ path: resource, encoding: 'base64', content: bytes.toString('base64') })
  }
  if (manifest.icon && !resources.some((resource) => resource.path === manifest.icon))
    throw Error('Declared icon must be listed in plugin resources')
  const archive =
    JSON.stringify(
      {
        format: 'milkup-plugin',
        version: 1,
        manifest,
        files: [
          { path: 'dist/plugin.js', encoding: 'utf8', content: result.outputFiles[0].text },
          ...resources,
        ],
      },
      null,
      2,
    ) + '\n'
  prepared.push({
    name: item.name,
    archive,
    record: {
      name: item.name,
      host: item.host,
      buildMode: item.buildMode,
      bytes: Buffer.byteLength(archive),
      sha256: createHash('sha256').update(archive).digest('hex'),
      sdkVersion,
      ...verification,
      installationProof:
        item.buildMode === 'frozen-closure'
          ? 'installed-input-hashes-only; no install executed by staging'
          : 'legacy-non-frozen',
      ...(item.dependencyClosure ? { dependencyClosure: item.dependencyClosure } : {}),
    },
  })
}
// Validate the entire distribution before writing any staged plugin.
await mkdir(destination, { recursive: true })
const expectedNames = new Set(prepared.map((item) => item.name))
const existing = await readdir(destination)
if (existing.some((file) => !expectedNames.has(file)))
  throw Error('Unexpected staged plugin; refusing to silently change the distribution')
for (const item of prepared) {
  await writeFile(resolve(destination, item.name), item.archive)
  console.log(JSON.stringify(item.record))
}

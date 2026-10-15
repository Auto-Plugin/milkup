import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, realpath } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const distribution = JSON.parse(
  await readFile(resolve(root, 'release/bundled-plugins.json'), 'utf8'),
)
const expectedNames = []
for (const item of distribution) {
  const pluginRoot = resolve(root, item.directory)
  const destination = resolve(root, 'apps/desktop/src/bundled-plugins')
  const manifest = JSON.parse(await readFile(resolve(pluginRoot, 'plugin.json'), 'utf8'))
  if (
    manifest.host !== 'worker' ||
    manifest.main !== './dist/plugin.js' ||
    JSON.stringify([...manifest.permissions].sort()) !==
      JSON.stringify([...item.permissions].sort())
  ) {
    throw Error('Review distribution default before bundling a different capability set')
  }
  const approvedInputs = new Set()
  const packageJson = JSON.parse(await readFile(resolve(pluginRoot, 'package.json'), 'utf8'))
  for (const dependency of item.bundledDependencies ?? []) {
    if (
      !/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(dependency.name) ||
      dependency.name.startsWith('@milkup/') ||
      packageJson.dependencies?.[dependency.name] !== dependency.version
    )
      throw Error('Unreviewed bundled dependency declaration')
    const directory = await realpath(resolve(pluginRoot, 'node_modules', dependency.name))
    const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
    if (metadata.name !== dependency.name || metadata.version !== dependency.version)
      throw Error('Bundled dependency version mismatch')
    for (const entry of dependency.entries) {
      const path = await realpath(resolve(directory, entry))
      const within = relative(directory, path)
      if (!within || within.startsWith('..') || isAbsolute(within))
        throw Error('Dependency entry escapes its package')
      approvedInputs.add(path)
    }
  }
  // Use only the SDK package's public export, with the repository's locked build tool.
  // This does not add a runtime host dependency on the plugin implementation.
  const result = await build({
    absWorkingDir: pluginRoot,
    entryPoints: ['src/plugin.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile: 'dist/plugin.js',
    write: false,
    metafile: true,
    alias: { '@milkup/plugin-sdk': resolve(root, 'packages/plugin-sdk/src/index.js') },
  })
  for (const input of Object.keys(result.metafile.inputs)) {
    const normalized = input.replaceAll('\\', '/')
    if (
      !normalized.startsWith('src/') &&
      normalized !== '../../packages/plugin-sdk/src/index.js' &&
      !approvedInputs.has(await realpath(resolve(pluginRoot, input)))
    ) {
      throw Error(`Non-public plugin dependency: ${input}`)
    }
  }
  if (
    result.outputFiles.length !== 1 ||
    Object.values(result.metafile.outputs).some((output) => output.imports.length)
  ) {
    throw Error('Plugin entry must be a single self-contained module')
  }
  const resources = []
  for (const resource of manifest.resources || []) {
    const source = resolve(pluginRoot, resource)
    const relativePath = relative(pluginRoot, source)
    if (
      !relativePath ||
      relativePath.startsWith('..') ||
      isAbsolute(relativePath) ||
      resource.includes('\\')
    ) {
      throw Error(`Resource must stay within plugin directory: ${resource}`)
    }
    const bytes = await readFile(source)
    if (
      resource === manifest.icon &&
      (!resource.endsWith('.png') ||
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    ) {
      throw Error('Declared plugin icon must be a PNG resource')
    }
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
  await mkdir(destination, { recursive: true })
  const name = `${manifest.id}-${manifest.version}.milkup-plugin`
  expectedNames.push(name)
  await writeFile(resolve(destination, name), archive)
  const record = {
    name,
    bytes: Buffer.byteLength(archive),
    sha256: createHash('sha256').update(archive).digest('hex'),
    sdkVersion: JSON.parse(await readFile(resolve(root, 'packages/plugin-sdk/package.json')))
      .version,
  }
  console.log(JSON.stringify(record))
}
const existing = await readdir(resolve(root, 'apps/desktop/src/bundled-plugins'))
if (existing.some((file) => !expectedNames.includes(file))) {
  throw Error('Unexpected staged plugin; refusing to silently change the distribution')
}

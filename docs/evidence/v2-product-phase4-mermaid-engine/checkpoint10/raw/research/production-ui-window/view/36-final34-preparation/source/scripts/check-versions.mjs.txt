import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'))
const app = await readJson('package.json')
if (!/^2\.\d+\.\d+(?:-beta\.(?:0|[1-9]\d*))?$/.test(app.version))
  throw Error('Application version must be a complete 2.x stable or beta version')
const write = process.argv.includes('--write')
const failures = []
const channel = await readJson('release/update-channel.json')
if (channel.channel !== (app.version.includes('-') ? 'beta' : 'stable'))
  failures.push('Release channel must match the application prerelease/stable version')
for (const parent of ['apps', 'packages', 'tests']) {
  for (const item of await readdir(resolve(root, parent), { withFileTypes: true })) {
    if (!item.isDirectory() || item.name === 'plugin-sdk') continue
    const path = `${parent}/${item.name}/package.json`
    let pkg
    try {
      pkg = await readJson(path)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (pkg.version === app.version) continue
    if (write)
      await writeFile(
        resolve(root, path),
        JSON.stringify({ ...pkg, version: app.version }, null, 2) + '\n',
      )
    else failures.push(`${path}: ${pkg.version} != ${app.version}`)
  }
}
const cargoPath = resolve(root, 'apps/desktop/src-tauri/Cargo.toml')
const cargo = await readFile(cargoPath, 'utf8')
const cargoVersion = cargo.match(/\[package\][\s\S]*?^version = "([^"]+)"/m)?.[1]
if (cargoVersion !== app.version) {
  if (write)
    await writeFile(
      cargoPath,
      cargo.replace(/(\[package\][\s\S]*?^version = ")[^"]+"/m, `$1${app.version}"`),
    )
  else failures.push(`Cargo.toml: ${cargoVersion} != ${app.version}`)
}
const tauri = await readJson('apps/desktop/src-tauri/tauri.conf.json')
if (tauri.version !== '../../../package.json')
  failures.push('Tauri must read version from the root package.json')
const outline = await readJson('plugins/outline/plugin.json')
const outlinePackage = await readJson('plugins/outline/package.json')
if (outline.version !== outlinePackage.version)
  failures.push('Outline package and manifest versions differ')
if (outline.engines.milkup !== '^2.0.0-0')
  failures.push('Outline must explicitly support the 2.0.0 prerelease line and stable 2.x')
if (failures.length) throw Error(failures.join('\n'))
console.log(
  `Application ${app.version}; SDK ${(await readJson('packages/plugin-sdk/package.json')).version}; outline ${outline.version}`,
)

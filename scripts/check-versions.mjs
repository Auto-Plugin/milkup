import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'))
const app = await readJson('package.json')
if (
  typeof app.version !== 'string' ||
  app.version.trim() !== app.version ||
  !/^2\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-beta\.(?:0|[1-9]\d*))?$/.test(app.version)
)
  throw Error('Application version must be a complete 2.x stable or beta version')
const write = process.argv.includes('--write')
const failures = []
const channel = await readJson('release/update-channel.json')
if (channel.channel !== (app.version.includes('-') ? 'beta' : 'stable'))
  failures.push('Release channel must match the application prerelease/stable version')
const cargoPath = resolve(root, 'apps/desktop/src-tauri/Cargo.toml')
const cargo = await readFile(cargoPath, 'utf8')
// A TOML table header can be indented. Never borrow a dependency's version
// when the package table is missing its own explicit version.
const cargoTables = cargo.split(/(?=^[\t ]*\[)/m)
const packageTables = cargoTables.filter((table) => /^\[package\]\r?$/m.test(table))
const packageTable = packageTables[0]
const cargoVersions = packageTable ? [...packageTable.matchAll(/^version = "([^"]+)"\r?$/gm)] : []
if (packageTables.length !== 1 || cargoVersions.length !== 1)
  throw Error('Cargo.toml must contain one [package] table with one explicit version')
const cargoVersion = cargoVersions[0][1]
// Cargo generates these package tables. Change only our unique local entry;
// preserve all dependency versions, checksums, comments and line endings.
const lockPath = resolve(root, 'apps/desktop/src-tauri/Cargo.lock')
const lock = await readFile(lockPath, 'utf8')
const lockPackages = lock.split(/(?=^\[\[package\]\]\r?$)/m)
const localPackages = lockPackages.filter((entry) => /^name = "milkup-desktop"\r?$/m.test(entry))
const localPackage = localPackages[0]
const lockVersions = localPackage ? [...localPackage.matchAll(/^version = "([^"]+)"\r?$/gm)] : []
if (
  localPackages.length !== 1 ||
  !localPackage.startsWith('[[package]]') ||
  /^(?:source|checksum)\s*=/m.test(localPackage) ||
  lockVersions.length !== 1
)
  throw Error('Cargo.lock must contain one unambiguous local milkup-desktop package')
if (lockVersions[0][1] !== app.version) {
  if (write) {
    const updated = localPackage.replace(/^(version = ")[^"]+("\r?$)/m, `$1${app.version}$2`)
    await writeFile(
      lockPath,
      lockPackages.map((entry) => (entry === localPackage ? updated : entry)).join(''),
    )
  } else failures.push(`Cargo.lock: ${lockVersions[0][1]} != ${app.version}`)
}
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
if (cargoVersion !== app.version) {
  if (write) {
    const updated = packageTable.replace(/^(version = ")[^"]+("\r?$)/m, `$1${app.version}$2`)
    await writeFile(
      cargoPath,
      cargoTables.map((table) => (table === packageTable ? updated : table)).join(''),
    )
  } else failures.push(`Cargo.toml: ${cargoVersion} != ${app.version}`)
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

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkChannel } from './update-readiness.mjs'
import { inspectWindowsInstaller } from './prepare-recovery-kit.mjs'

export const variants = Object.freeze({
  'windows-standard': {
    platform: 'win32',
    target: 'x86_64-pc-windows-msvc',
    bundles: ['nsis'],
    runtime: 'downloadBootstrapper',
    extension: '.exe',
  },
  'windows-offline': {
    platform: 'win32',
    target: 'x86_64-pc-windows-msvc',
    bundles: ['nsis'],
    runtime: 'offlineInstaller',
    extension: '.exe',
  },
  'linux-deb': {
    platform: 'linux',
    target: 'x86_64-unknown-linux-gnu',
    bundles: ['deb'],
    runtime: 'system-webkitgtk-4.1',
    extension: '.deb',
  },
})
export function candidateConfig(name) {
  const variant = variants[name]
  assert.ok(variant, 'Unknown distribution variant')
  const bundle = { active: true, targets: variant.bundles, createUpdaterArtifacts: false }
  if (variant.platform === 'win32') {
    bundle.windows = {
      webviewInstallMode: { type: variant.runtime, silent: true },
      nsis: { installMode: 'currentUser' },
    }
  } else {
    bundle.icon = ['icons/icon.png']
    bundle.linux = { deb: { depends: ['libwebkit2gtk-4.1-0', 'libgtk-3-0'] } }
  }
  return { bundle }
}
export function extractPngIcon(ico) {
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  const count = ico.readUInt16LE(4)
  assert.ok(count > 0 && 6 + count * 16 <= ico.length)
  let best
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16,
      width = ico[entry] || 256
    const size = ico.readUInt32LE(entry + 8),
      offset = ico.readUInt32LE(entry + 12)
    assert.ok(offset >= 6 + count * 16 && offset + size <= ico.length)
    const bytes = ico.subarray(offset, offset + size)
    if (
      bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      (!best || width > best.width)
    )
      best = { width, bytes }
  }
  assert.ok(best, 'ICO has no lossless PNG entry')
  return best.bytes
}
function run(command, args, options = {}) {
  // pnpm's Windows shim is a .cmd. Resolve its installed JS entry once and run
  // it with Node so paths/arguments never pass through cmd.exe interpolation.
  if (command === 'pnpm' && process.platform === 'win32') {
    const locations = execFileSync('where.exe', ['pnpm'], { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/)
    const cmd = locations.find((item) => item.toLowerCase().endsWith('.cmd'))
    assert.ok(cmd, 'Pinned npm-installed pnpm shim missing')
    return run(
      process.execPath,
      [path.join(path.dirname(cmd), 'node_modules/pnpm/bin/pnpm.cjs'), ...args],
      options,
    )
  }
  return execFileSync(command, args, { stdio: 'inherit', ...options })
}
async function files(directory) {
  const result = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!item.isSymbolicLink(), 'Bundle contains symlink')
    const full = path.join(directory, item.name)
    if (item.isDirectory()) result.push(...(await files(full)))
    else if (item.isFile()) result.push(full)
  }
  return result
}
export async function buildCandidate(name, output, expectedSha) {
  const variant = variants[name]
  assert.ok(
    variant && variant.platform === process.platform && process.arch === 'x64',
    'Use native x64 runner for this variant',
  )
  assert.match(expectedSha, /^[a-f0-9]{40}$/)
  const root = process.cwd()
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
  assert.equal(git('rev-parse', 'HEAD'), expectedSha, 'Candidate SHA mismatch')
  assert.equal(git('status', '--porcelain'), '', 'Refusing dirty source')
  assert.ok(!process.env.TAURI_CONFIG, 'Unreviewed TAURI_CONFIG override')
  assert.ok(
    !process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.WINDOWS_CERTIFICATE,
    'Candidate build never consumes production signing credentials',
  )
  output = path.resolve(output)
  assert.ok(output !== root && !root.startsWith(output + path.sep), 'Unsafe output directory')
  await mkdir(output, { recursive: false }) // never overwrite an earlier candidate
  const version = JSON.parse(await readFile('package.json', 'utf8')).version
  assert.match(version, /^[0-9A-Za-z.+-]+$/)
  const channel = checkChannel(JSON.parse(await readFile('release/update-channel.json', 'utf8')))
  run(process.execPath, ['scripts/check-versions.mjs'])
  run(process.execPath, ['scripts/ci/prepare-bundled-plugins.mjs'])
  const overlay = path.join(output, 'tauri-candidate.json')
  await writeFile(overlay, JSON.stringify(candidateConfig(name), null, 2) + '\n')
  const targetDir = path.join(output, 'cargo-target')
  run(
    'pnpm',
    [
      '--filter',
      '@milkup/desktop',
      'tauri',
      'build',
      '--ci',
      '--target',
      variant.target,
      '--bundles',
      ...variant.bundles,
      '--config',
      overlay,
      '--',
      '--locked',
    ],
    {
      env: { ...process.env, CARGO_TARGET_DIR: targetDir, CARGO_INCREMENTAL: '0' },
    },
  )
  assert.equal(git('status', '--porcelain'), '', 'Build modified tracked source')
  const bundleDir = path.join(targetDir, variant.target, 'release/bundle')
  const found = (await files(bundleDir)).filter((file) => file.endsWith(variant.extension))
  assert.equal(found.length, 1, 'Expected exactly one native installer')
  const stat = await lstat(found[0])
  assert.ok(stat.size > 0 && stat.size <= 512 * 1024 * 1024, 'Unexpected installer size')
  const destination = `milkup-${version}-${name}-${expectedSha.slice(0, 12)}${variant.extension}`
  const payload = path.join(output, 'deliverable')
  await mkdir(payload)
  await copyFile(found[0], path.join(payload, destination))
  const sha256 = createHash('sha256')
    .update(await readFile(found[0]))
    .digest('hex')
  let outerInstallerVersion = null
  if (variant.platform === 'win32') {
    const inspected = inspectWindowsInstaller(path.join(payload, destination))
    assert.equal(
      inspected.productVersion,
      version,
      'Installer PE ProductVersion differs from source',
    )
    assert.equal(inspected.sha256, sha256, 'PE inspector observed different installer bytes')
    outerInstallerVersion = inspected.productVersion
  }
  const record = {
    schema: 1,
    status: 'built-not-installed',
    sourceSha: expectedSha,
    version,
    variant: name,
    outerInstallerVersion,
    architecture: 'x86_64',
    runtime: variant.runtime,
    channel,
    installer: { name: destination, bytes: stat.size, sha256 },
    signed: false,
    releasePublished: false,
    installedAcceptance: 'not-run',
    rollbackAcceptance: 'not-run',
    limitations: [
      'Unsigned candidate; not a formal release',
      name === 'windows-standard'
        ? 'Internet required to install missing WebView2 Runtime'
        : name === 'windows-offline'
          ? 'Evergreen Runtime installer embedded; elevation may be requested by Microsoft Runtime installer'
          : 'Debian/Ubuntu x64 with WebKitGTK 4.1 dependencies; not all Linux distributions',
      'No automatic application rollback; manual recovery remains to be validated',
    ],
  }
  await writeFile(path.join(payload, 'manifest.json'), JSON.stringify(record, null, 2) + '\n')
  await writeFile(path.join(payload, 'SHA256SUMS.txt'), `${sha256}  ${destination}\n`)
  console.log(JSON.stringify(record, null, 2))
  return record
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [variant, output, sha, ...extra] = process.argv.slice(2)
  assert.ok(
    variant && output && sha && !extra.length,
    'Usage: build-candidate.mjs <windows-standard|windows-offline|linux-deb> <new-output-directory> <exact-commit-sha>',
  )
  await buildCandidate(variant, output, sha)
}

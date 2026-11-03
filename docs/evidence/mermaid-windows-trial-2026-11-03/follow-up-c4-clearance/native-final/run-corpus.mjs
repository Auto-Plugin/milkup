// Independent, opt-in production-ELF direct-helper corpus. No Registry lease claim.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, readFile, writeFile, copyFile, chmod, readdir, stat, readlink, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const mode = process.argv[2]
assert(['smoke', 'corpus'].includes(mode), 'Explicit smoke or corpus mode')
assert.equal(process.env.MILKUP_DIRECT_CORPUS_RUN, '1')
assert.equal(process.env.DISPLAY, ':155', 'Only the dedicated :155 display is permitted')
assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
const outerPidNamespace = process.env.MILKUP_DIRECT_CORPUS_OUTER_PID_NS
const pidNamespace = await readlink('/proc/self/ns/pid')
assert(outerPidNamespace && pidNamespace !== outerPidNamespace, 'Must run in a new owned PID namespace through run.sh')
assert.equal(await readlink('/proc/1/ns/pid'), pidNamespace, 'Mounted /proc belongs to this namespace')
const sourceCommit = "3ee9c3d8f27ae07005547081ce55b9e7aedd2ae4"
const sourceBinary = "/workspace/mermaid-rebuild-evidence/c4-label-clearance/native-final/binary/milkup-desktop"
const binarySha256 = "cf63ed142f795ac4f7ed3a08d63090e81760a72762361b8389780324679c92ab"
const sourceGuard = "/workspace/mermaid-rebuild-evidence/c4-label-clearance/native-final/binary/libmilkup_dom_guard.so"
const guardSha256 = "5b1082768123b9ac1923eb8ef3f6f8c0bd05ffd5d66b8b2a023f75b69106c44c"
const depfile = "/workspace/mermaid-rebuild-evidence/c4-label-clearance/native-final/build-dependencies.d"
const sha = (data) => createHash('sha256').update(data).digest('hex')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const exists = async (file) => stat(file).then(() => true, (error) => {
  if (error.code === 'ENOENT') return false
  throw error
})
async function deadline(promise, ms, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(label)), Math.max(0, ms))
    })])
  } finally { clearTimeout(timer) }
}
async function identity(pid) {
  const raw = await readFile(`/proc/${pid}/stat`, 'utf8')
  const f = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/)
  return { pid, birth: f[19], state: f[0], parent: Number(f[1]), group: Number(f[2]),
    argv: (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean) }
}
async function activeNativeProcesses(binary) {
  const result = []
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const p = await identity(Number(name))
      if (p.state !== 'Z' && (p.argv[0] === binary ||
          p.argv.some((arg) => arg.startsWith('--milkup-internal-')) ||
          /WebKit(?:Web|Network|GPU)Process$/.test(p.argv[0] ?? ''))) result.push(p)
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error }
  }
  return result
}
async function activeGroupMembers(group) {
  const result = []
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const p = await identity(Number(name))
      if (p.group === group && p.state !== 'Z') result.push(p)
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error }
  }
  return result
}

const output = path.join(root, mode)
await mkdir(output, { mode: 0o700 }) // Fail rather than overwrite a previous run.
const runtimeProfile = await mkdtemp('/tmp/milkup-corpus-')
const runtimeTmp = path.join(runtimeProfile, 'native-tmp')
for (const name of ['native-tmp', 'config', 'cache', 'data', 'runtime'])
  await mkdir(path.join(runtimeProfile, name), { mode: 0o700 })
for (const name of ['png', 'logs']) await mkdir(path.join(output, name), { mode: 0o700 })
assert(Buffer.byteLength(path.join(runtimeProfile, 'runtime/webkitgtk/bus-proxy-XXXXXX')) < 108, 'Unix socket path budget')
const env = { ...process.env, DISPLAY: ':155', TMPDIR: runtimeTmp,
  XDG_CONFIG_HOME: path.join(runtimeProfile, 'config'), XDG_CACHE_HOME: path.join(runtimeProfile, 'cache'),
  XDG_DATA_HOME: path.join(runtimeProfile, 'data'), XDG_RUNTIME_DIR: path.join(runtimeProfile, 'runtime'),
  MILKUP_MERMAID_DIAGNOSTICS: '1', MILKUP_DOM_DIAGNOSTICS: '1' }
for (const key of ['WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS', 'WEBKIT_INSPECTOR_SERVER',
  'WEBKIT_INSPECTOR_HTTP_SERVER', 'LD_PRELOAD', 'TAURI_AUTOMATION', 'TAURI_WEBVIEW_AUTOMATION']) delete env[key]
const report = { kind: 'production-ELF-direct-helper-corpus', mode, sourceCommit,
  binarySha256, guardSha256, startedAt: new Date().toISOString(), status: 'running',
  display: ':155', runtimeProfile, runtimeTmp, pidNamespace, outerPidNamespace, sandboxDisabled: false, registryLeaseTest: false,
  parameters: { width: 1280, theme: 'default', look: 'classic', renderBudgetMs: 30000 },
  boundaries: ['No editor/Registry lease acceptance.', 'Three installed-product diagram sources; no negative cases.',
    'Classic look; this is direct helper output, not product UI acceptance.',
    'Decoded retained PNGs do not substitute for complete visual review.'], cases: [], services: [], cleanup: [] }
const persist = () => writeFile(path.join(output, 'native-corpus-results.json'), JSON.stringify(report, null, 2) + '\n')
const services = []
let fatal
async function launchService(name, command, args) {
  const child = spawn(command, args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
  child.on('error', (error) => { child.launchError = String(error) })
  let bytesSeen = 0, retained = 0, chunks = []
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (bytes) => {
    bytesSeen += bytes.length
    const keep = bytes.subarray(0, Math.max(0, 1024 * 1024 - retained))
    chunks.push(keep); retained += keep.length
  })
  await deadline(new Promise((resolve, reject) => {
    child.once('spawn', resolve); child.once('error', reject)
  }), 5000, `${name} spawn timeout`)
  const item = { name, child, closed, identity: await identity(child.pid),
    log: () => ({ bytesSeen, retained, overflow: bytesSeen > retained, data: Buffer.concat(chunks) }) }
  services.push(item); report.services.push({ name, command, args, identity: item.identity })
  return child
}
function query(command, args) {
  return execFileSync(command, args, { env, encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024 }).trim()
}
async function waitUntil(check, label, ms = 10000) {
  const end = performance.now() + ms
  let last
  while (performance.now() < end) {
    try { if (await check()) return } catch (error) { last = String(error) }
    await delay(100)
  }
  throw Error(`${label}: ${last ?? 'timeout'}`)
}

async function renderCase(binary, guard, fixture, index) {
  const sourceBytes = await readFile(path.join(root, 'fixtures', fixture.file))
  assert.equal(sha(sourceBytes), fixture.sourceSha256)
  const source = sourceBytes.toString('utf8')
  assert(Buffer.from(source).equals(sourceBytes), 'Exact UTF-8 source')
  assert(source.length <= 50000 && source.split('\n').length <= 256)
  const requestId = `native-corpus-${index}`
  const input = Buffer.from(JSON.stringify({ protocol: 1, requestId, fixtureId: requestId,
    source, width: 1280, theme: 'default', look: 'classic' }))
  assert(input.length <= 65536)
  const frame = Buffer.alloc(4 + input.length); frame.writeUInt32LE(input.length); input.copy(frame, 4)
  const privateRoot = path.join(runtimeTmp, `milkup-mermaid-${randomUUID()}`)
  assert.equal(path.dirname(privateRoot), runtimeTmp)
  await mkdir(privateRoot, { mode: 0o700 })
  await copyFile(guard, path.join(privateRoot, 'libmilkup_dom_guard.so'), constants.COPYFILE_EXCL)
  await chmod(path.join(privateRoot, 'libmilkup_dom_guard.so'), 0o600)
  const row = { fixture: fixture.name, sourceSha256: fixture.sourceSha256,
    inputBytes: input.length, privateRoot, startedAt: new Date().toISOString(), status: 'running' }
  report.cases.push(row); await persist()
  const begin = performance.now(), end = begin + 30000
  // libuv explicitly maps these channels to child FD3/FD4. No parent endpoint
  // is inherited by other children; fd4.destroy() closes the sole stop writer.
  const child = spawn(binary, ['--milkup-internal-fixed-mermaid-linux'], {
    env: { ...env, MILKUP_INTERNAL_MERMAID_DIRECTORY: privateRoot,
      MILKUP_INTERNAL_DOM_INSTANCE_ID: requestId }, detached: true,
    stdio: ['pipe', 'ignore', 'pipe', 'pipe', 'pipe'],
  })
  let spawnError, logBytes = 0, keptLog = 0, logChunks = [], protocolBytes = 0,
    chunks = [], header, expectedBytes, protocolFailure, completeResponse, resultSettled = false
  let resolveResult, rejectResult
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
  result.catch(() => {})
  const failProtocol = (error) => {
    protocolFailure ??= String(error)
    if (!resultSettled) { resultSettled = true; rejectResult(error) }
  }
  const exited = new Promise((resolve) => child.once('exit', (code, signal) =>
    resolve({ code, signal, observedMonotonicMs: performance.now() })))
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
  child.on('error', (error) => { spawnError = String(error); failProtocol(error) })
  child.stdin.on('error', failProtocol)
  child.stderr.on('data', (bytes) => {
    logBytes += bytes.length
    const keep = bytes.subarray(0, Math.max(0, 1024 * 1024 - keptLog))
    logChunks.push(keep); keptLog += keep.length
  })
  child.stdio[3].on('error', failProtocol)
  child.stdio[3].on('data', (bytes) => {
    try {
      protocolBytes += bytes.length
      assert(protocolBytes <= 4 + 4096 + 16 * 1024 * 1024, 'Bounded output channel')
      chunks.push(bytes)
      const all = Buffer.concat(chunks)
      if (all.length < 4) return
      const size = all.readUInt32LE(0)
      assert(size > 0 && size <= 4096, 'Bounded header')
      if (all.length < 4 + size) return
      if (!header) {
        header = JSON.parse(all.subarray(4, 4 + size).toString('utf8'))
        assert.equal(typeof header.ok, 'boolean')
        if (header.ok) {
          for (const n of [header.width, header.height, header.bytes]) assert(Number.isSafeInteger(n) && n > 0)
          assert(header.width <= 8192 && header.height <= 8192 && header.width * header.height <= 16777216)
          assert(header.bytes <= 16 * 1024 * 1024)
        }
        expectedBytes = 4 + size + (header.ok ? header.bytes : 0)
      }
      assert(all.length <= expectedBytes, 'No trailing protocol output')
      if (all.length === expectedBytes && !resultSettled) {
        completeResponse = { header, png: all.subarray(4 + size) }
        resultSettled = true
        resolveResult(completeResponse)
      }
    } catch (error) { failProtocol(error) }
  })
  child.stdio[3].on('end', () => {
    if (!resultSettled) failProtocol(Error('Output ended before a complete response'))
  })
  let received, caseError
  try {
    await deadline(new Promise((resolve, reject) => {
      child.once('spawn', resolve); child.once('error', reject)
    }), Math.max(0, end - performance.now()), 'Helper spawn deadline')
    row.guardian = await identity(child.pid)
    assert.equal(row.guardian.argv[0], binary)
    assert.equal(row.guardian.group, child.pid)
    child.stdin.end(frame)
    received = await deadline(result, Math.max(0, end - performance.now()), 'Original 30s render deadline exceeded')
    assert(performance.now() <= end, 'Response within original render budget')
    row.header = received.header
    assert.equal(received.header.ok, true, received.header.error ?? 'Helper rejected source')
  } catch (error) { caseError = error }
  finally {
    row.stopChannelClosedAt = new Date().toISOString()
    child.stdio[4].destroy()
    child.stdin.destroy()
    try {
      if (spawnError) throw Error(spawnError)
      row.exit = await deadline(exited, 5000, 'Guardian cleanup pending after 5s; namespace teardown required')
      await deadline(closed, 2000, 'Helper stdio did not fully close')
      row.stdioClosed = true
      assert.equal(row.exit.code, 0, 'Guardian reports completed cleanup')
      assert.equal(row.exit.signal, null)
      row.privateDirectoryAbsent = !(await exists(privateRoot))
      assert(row.privateDirectoryAbsent, 'Guardian removed exactly its owned private root')
      row.nativeProcessesAfterCleanup = await activeNativeProcesses(binary)
      assert.deepEqual(row.nativeProcessesAfterCleanup, [], 'No active owned renderer/WebKit after guardian exit')
      row.cleanupVerified = true
    } catch (error) {
      row.cleanupVerified = false; row.cleanupError = String(error)
      caseError ??= error
      // Leave an uncertain guardian alive to clean its own descendants. The
      // dedicated outer PID namespace is the final reclamation boundary.
      child.unref()
    }
    row.log = { bytesSeen: logBytes, bytesRetained: keptLog, overflow: logBytes > keptLog }
    await writeFile(path.join(output, 'logs', `${fixture.name}.log`), Buffer.concat(logChunks), { flag: 'wx' })
  }
  // Retain complete output even when its case fails deadline or cleanup gates.
  received ??= completeResponse
  let pngError
  if (received?.header.ok) {
    try {
      const pngPath = path.join(output, 'png', `${fixture.name}.png`)
      await writeFile(pngPath, received.png, { flag: 'wx' })
      row.png = { file: path.relative(output, pngPath), bytes: received.png.length,
        sha256: sha(received.png), width: header.width, height: header.height }
      row.decode = JSON.parse(execFileSync('python3', [path.join(root, 'decode-png.py'), pngPath,
        String(header.width), String(header.height)], { env, encoding: 'utf8', timeout: 15000, maxBuffer: 65536 }))
    } catch (error) { pngError = error; row.pngError = String(error) }
  }
  try {
    assert(!protocolFailure, protocolFailure)
    assert(!row.log.overflow, 'Full native stderr retained')
    if (caseError) throw caseError
    if (pngError) throw pngError
    assert(received?.header.ok)
    row.status = 'rendered-decoded-retained'
  } catch (error) { row.status = 'failed'; row.error = String(error) }
  row.elapsedMs = performance.now() - begin; row.finishedAt = new Date().toISOString()
  await persist()
  console.log(JSON.stringify({ fixture: row.fixture, status: row.status, elapsedMs: Math.round(row.elapsedMs), cleanupVerified: row.cleanupVerified, error: row.error }))
  if (!row.cleanupVerified) throw Error(`Uncertain cleanup for ${fixture.name}; stop corpus`)
}

try {
  await persist()
  assert(!(await exists('/tmp/.X155-lock')) && !(await exists('/tmp/.X11-unix/X155')), ':155 already owned; never reuse')
  const manifest = JSON.parse(await readFile(path.join(root, 'corpus-source-manifest.json'), 'utf8'))
  assert.equal(manifest.cases.length, 3)
  report.fixtureManifestSha256 = sha(await readFile(path.join(root, 'corpus-source-manifest.json')))
  const baseline = await readFile(depfile)
  assert(baseline.includes(Buffer.from('libmilkup_dom_guard.so')), 'Build depfile retains native guard input')
  await writeFile(path.join(output, 'production-dependencies.d'), baseline, { flag: 'wx' })
  report.depfileSha256 = sha(baseline)
  const sourceBytes = await readFile(sourceBinary), guardBytes = await readFile(sourceGuard)
  assert.equal(sha(sourceBytes), binarySha256); assert.equal(sha(guardBytes), guardSha256)
  assert.equal(sourceBytes.length, 315897432); assert.equal(guardBytes.length, 15656)
  const binRoot = "/workspace/mermaid-rebuild-evidence/c4-label-clearance/native-final/binary"
  const binary = path.join(binRoot, 'milkup-desktop'), guard = path.join(binRoot, 'libmilkup_dom_guard.so')
  for (const [file, bytes, mode] of [[binary, sourceBytes, 0o700], [guard, guardBytes, 0o600]]) {
    assert(await exists(file), 'Reuse the already frozen artifact without writing it')
    assert.equal(sha(await readFile(file)), sha(bytes))
  }
  report.binary = binary; report.guard = guard
  report.harnessSha256 = sha(await readFile(fileURLToPath(import.meta.url)))
  report.decoderSha256 = sha(await readFile(path.join(root, 'decode-png.py')))
  report.runtime = { webkitGtk: query('pkg-config', ['--modversion', 'webkit2gtk-4.1']), source: 'Existing selected-environment sysroot' }
  await launchService('xvfb', 'Xvfb', [':155', '-screen', '0', '1440x1000x24', '-nolisten', 'tcp'])
  await waitUntil(() => query('xwininfo', ['-root']).includes('Window id:'), 'Owned Xvfb readiness')
  await launchService('xfconfd', '/usr/host/lib/x86_64-linux-gnu/xfce4/xfconf/xfconfd', [])
  await launchService('xfwm4', '/usr/bin/xfwm4', ['--compositor=off', '--sm-client-disable'])
  await waitUntil(() => /window id # 0x/.test(query('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK'])), 'Owned WM readiness')
  report.wm = query('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK'])
  const selected = mode === 'smoke' ? manifest.cases.slice(0, 1) : manifest.cases
  for (const [index, fixture] of selected.entries()) await renderCase(binary, guard, fixture, index)
  assert(report.cases.every((row) => row.status === 'rendered-decoded-retained'))
  assert.equal(sha(await readFile(binary)), binarySha256)
  assert.deepEqual(await readdir(runtimeTmp), [], 'No retained native private roots')
  report.status = 'passed'
} catch (error) { fatal = error; report.status = 'failed'; report.failure = { message: String(error), stack: error.stack } }
finally {
  for (const item of [...services].reverse()) {
    const row = { name: item.name, identity: item.identity }
    try {
      if (item.child.exitCode === null && item.child.signalCode === null) {
        const current = await identity(item.child.pid)
        assert.equal(current.birth, item.identity.birth)
        assert.equal(current.group, item.child.pid)
        process.kill(-item.child.pid, 'SIGTERM'); row.requestedSignal = 'SIGTERM'
        try { row.exit = await deadline(item.closed, 5000, 'Service stop deadline') }
        catch {
          const same = await identity(item.child.pid)
          assert.equal(same.birth, item.identity.birth)
          process.kill(-item.child.pid, 'SIGKILL'); row.escalatedSignal = 'SIGKILL'
          row.exit = await deadline(item.closed, 5000, 'Service kill deadline')
        }
      } else row.exit = await item.closed
      row.identityAbsent = !(await exists(`/proc/${item.child.pid}`))
      assert(row.identityAbsent, 'Owned service fully reaped')
      row.activeGroupMembers = await activeGroupMembers(item.identity.group)
      assert.deepEqual(row.activeGroupMembers, [], 'Owned service process group is empty')
    } catch (error) { row.error = String(error); fatal ??= error; report.status = 'failed' }
    const log = item.log()
    row.log = { bytesSeen: log.bytesSeen, retained: log.retained, overflow: log.overflow }
    await writeFile(path.join(output, 'logs', `${item.name}.log`), log.data, { flag: 'wx' })
    report.cleanup.push(row)
  }
  report.finishedAt = new Date().toISOString()
  report.visualReview = 'pending'
  await persist()
  console.log(JSON.stringify({ status: report.status, mode, completed: report.cases.length,
    passed: report.cases.filter((row) => row.status === 'rendered-decoded-retained').length,
    report: path.join(output, 'native-corpus-results.json'), failure: report.failure }))
}
// On uncertain guardian cleanup, ending only this dedicated PID namespace is
// the final fallback; its partial case stays failed and its root is retained.
process.exit(fatal ? 1 : 0)

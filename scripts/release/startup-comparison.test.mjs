import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  StartupLog,
  fixtureSource,
  observeMode,
  sha,
  logBudget,
  modes,
  verifyCatalogRestart,
} from './startup-comparison-contract.mjs'

const catalog = (revision = 5) => ({
  version: 1,
  revision,
  entries: [
    {
      id: 'milkup.diagrams',
      revision,
      enabled: true,
      tombstone: false,
      startAttempt: null,
      active: {
        verified: true,
        approvedFingerprint: 'a',
        capabilityFingerprint: 'a',
        contentSha256: 'c'.repeat(64),
      },
      previous: null,
      pending: null,
      diagnostics: [],
    },
  ],
  diagnostics: [],
  migrationReceipt: null,
})
const envelope = (payload) =>
  Buffer.from(JSON.stringify({ sha256: sha(Buffer.from(JSON.stringify(payload))), payload }))
test('catalogue permits exactly two durable startup transitions, preserving all other state', () => {
  const before = envelope(catalog()),
    after = envelope(catalog(7))
  assert.equal(verifyCatalogRestart(before, after).expectedDurableTransitions, 2)
  for (const mutate of [
    (p) => (p.entries[0].enabled = false),
    (p) => (p.entries[0].active.contentSha256 = 'changed'),
    (p) => (p.entries[0].active.approvedFingerprint = 'changed'),
    (p) => (p.entries[0].startAttempt = 'pending'),
    (p) => p.entries[0].diagnostics.push('failure'),
    (p) => p.revision++,
    (p) => p.entries[0].revision--,
  ]) {
    const changed = catalog(7)
    mutate(changed)
    assert.throws(() => verifyCatalogRestart(before, envelope(changed)))
  }
  const bad = JSON.parse(after.toString())
  bad.sha256 = '0'.repeat(64)
  assert.throws(() => verifyCatalogRestart(before, Buffer.from(JSON.stringify(bad))))
})

const document = Buffer.from('# Sample\n\n```mermaid\nflowchart LR\n A-->B\n```\n')
const source = fixtureSource(document)
const creation = 1700000000000
const base = {
  productPid: 17,
  ownerId: 'a'.repeat(32),
  requestId: 'b'.repeat(32),
  sourceSha256: source,
  timestampUnixMs: creation + 10,
}
const event = (phase, extra = {}) =>
  `MILKUP_MERMAID_FRONTEND_AUDIT ${JSON.stringify({ ...base, phase, ...extra })}\n`
const ready = {
  status: 'ready',
  consumerAborted: false,
  pngBytes: 90,
  pngSha256: 'c'.repeat(64),
  width: 10,
  height: 10,
}
const trace = event('admitted') + event('started') + event('finished', ready)
const log = (text = trace) => {
  const p = new StartupLog(17, source, creation)
  p.append(text, Buffer.byteLength(text))
  return p
}

test('counterbalanced modes distinguish early, late and genuinely absent attachment', async () => {
  assert.deepEqual(modes, ['none', 'late', 'early', 'early', 'late', 'none'])
  for (const [mode, expected] of [
    ['early', ['attach', 'ready', 'observe']],
    ['late', ['ready', 'attach', 'observe']],
    ['none', ['ready']],
  ]) {
    const calls = []
    const result = await observeMode(mode, {
      attach: async () => calls.push('attach'),
      waitReady: async () => {
        calls.push('ready')
        return ready
      },
      observe: async () => {
        calls.push('observe')
        return { decoded: true }
      },
    })
    assert.deepEqual(calls, expected)
    if (mode === 'none') assert.equal(result.dom, null)
  }
})
test('missing first render cannot become a successful observation', async () => {
  const calls = []
  await assert.rejects(
    observeMode('late', {
      attach: async () => calls.push(1),
      waitReady: async () => null,
      observe: async () => calls.push(2),
    }),
  )
  assert.deepEqual(calls, [])
})
test('fragmented native log preserves request chain, source, timestamp and complete final line', () => {
  const p = new StartupLog(17, source, creation)
  for (const part of trace.match(/.{1,19}|\n/g)) p.append(part, Buffer.byteLength(part))
  p.finish()
  assert.equal(p.firstReady.pngSha256, ready.pngSha256)
  assert.equal(p.records.length, 3)
  assert.equal(fixtureSource(Buffer.from(document.toString().replaceAll('\n', '\r\n'))), source)
})
test('wrong PID, old launch, wrong source, missing admission/start, and aborted PNG are rejected', () => {
  for (const text of [
    trace.replaceAll('"productPid":17', '"productPid":18'),
    trace.replaceAll(String(creation + 10), String(creation - 100)),
    trace.replaceAll(source, 'd'.repeat(64)),
    event('finished', ready),
    event('admitted') + event('finished', ready),
    event('admitted') + event('started') + event('finished', { ...ready, consumerAborted: true }),
  ])
    assert.throws(() => log(text))
})
test('oversized, truncated, malformed and limited evidence fails closed', () => {
  assert.throws(() => log('x'.repeat(logBudget + 1)))
  assert.throws(() => log(trace.slice(0, -1)).finish())
  assert.throws(() => log('MILKUP_STARTUP_TIMING nope\n'))
  assert.throws(() =>
    log(
      `MILKUP_STARTUP_TIMING ${JSON.stringify({ pid: 17, limitReached: true, unixMs: creation })}\n`,
    ),
  )
  assert.throws(() => fixtureSource(Buffer.from(document.toString() + document.toString())))
})
test('post-exit verifier binds exact spec and complete raw bytes; no-attachment downgrade rejected', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'milkup-startup-'))
  try {
    const stderr =
      trace +
      ['STARTUP', 'WRY_STARTUP', 'CATALOG']
        .map(
          (kind) => `MILKUP_${kind}_TIMING ${JSON.stringify({ pid: 17, unixMs: creation + 2 })}\n`,
        )
        .join('')
    const spec = {
      mode: 'none',
      pid: 17,
      creationTicks: '638355968000000000',
      creationUtc: new Date(creation).toISOString(),
      document: path.join(dir, 'input.md'),
      documentSha256: sha(document),
      stderr: path.join(dir, 'stderr'),
      stdout: path.join(dir, 'stdout'),
      report: path.join(dir, 'report.json'),
      catalogBefore: path.join(dir, 'before.json'),
      catalogAfter: path.join(dir, 'after.json'),
    }
    const specFile = path.join(dir, 'spec.json')
    const observation = {
      spec,
      status: 'observed-await-normal-close',
      inputs: 0,
      connectionAttempts: 0,
      observation: { ready: log().firstReady, dom: null },
    }
    await Promise.all([
      writeFile(specFile, JSON.stringify(spec)),
      writeFile(spec.document, document),
      writeFile(spec.stderr, stderr),
      writeFile(spec.stdout, ''),
      writeFile(spec.report, JSON.stringify(observation)),
      writeFile(spec.catalogBefore, envelope(catalog())),
      writeFile(spec.catalogAfter, envelope(catalog(7))),
    ])
    const run = () =>
      spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./startup-comparison-verify.mjs', import.meta.url)), specFile],
        { encoding: 'utf8' },
      )
    let result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).stderr.sha256, sha(Buffer.from(stderr)))
    observation.connectionAttempts = 1
    await writeFile(spec.report, JSON.stringify(observation))
    assert.notEqual(run().status, 0)
    observation.connectionAttempts = 0
    observation.spec = { ...spec, creationTicks: 'wrong' }
    await writeFile(spec.report, JSON.stringify(observation))
    assert.notEqual(run().status, 0)
    observation.spec = spec
    await writeFile(spec.report, JSON.stringify(observation))
    await writeFile(spec.stderr, stderr.slice(0, -1))
    assert.notEqual(run().status, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
test('workflow and parent copy all bounded original trial evidence without changing package identity', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/distribution-install-candidate.yml', import.meta.url),
    'utf8',
  )
  const parent = await readFile(
    new URL('./run-repair-health-standard.ps1', import.meta.url),
    'utf8',
  )
  assert.match(workflow, /r\.head_sha!==process\.env\.SOURCE_SHA/)
  for (const suffix of [
    'spec.json',
    'observation.json',
    'product.stdout.log',
    'product.stderr.log',
    'verify.json',
  ])
    assert(parent.includes(`'${suffix}'`))
  assert(parent.includes('600000'))
})

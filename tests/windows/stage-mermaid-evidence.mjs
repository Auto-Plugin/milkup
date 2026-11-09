import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syntaxCases, decodeProductEvidence } from './mermaid-product-e2e.mjs'
import { GUI_EVIDENCE_NAMES, validateGuiIdentity } from './mermaid-gui-contract.mjs'

const steps = [
  '00-prepare-old-plugin-choice',
  '00-restart-old-plugin-choice',
  '01-migrated-plugin-choice',
  '01-default-mermaid-preview',
  '02-enable-and-exact-bytes',
  '03-real-edit-save-replacement',
  '04-undo-exact-original',
  '05-redo-exact-edit',
  '06-disable-and-reenable-in-place',
  '07-wide',
  '07-c4',
  '07-syntax',
  '07-invalid',
  '08-final-disable',
]
const screenshots = new Set(
  [...steps.flatMap((name) => [name, name + '-failure']), 'unhandled-failure'].map(
    (name) => name + '-window.png',
  ),
)
const diagrams = new Set(
  [
    'migration-old-enabled',
    'migration-old-restarted',
    '02-enabled',
    '03-edited',
    '04-undone',
    '05-redone',
    '06-reenabled',
    '07-wide',
    '07-c4',
    ...syntaxCases.map(({ id }) => 'syntax-' + id),
  ].map((name) => name + '-diagram.png'),
)
const fixtures = ['ordinary', 'wide', 'c4', 'syntax', 'invalid']
const metadata = new Set([
  'ordinary-restart-product.log',
  'migration-synthetic-catalog.json',
  'migration-synthetic-catalog.log',
  'standard-context.json',
  'standard-child-result.json',
  'mermaid-product-e2e.json',
  'installation-result.json',
  'installed-binary-comparison.json',
  'installed-binary-comparison-stderr.log',
  'installer-stdout.log',
  'installer-stderr.log',
  'node-stdout.log',
  'node-stderr.log',
  'edgedriver-native.log',
  'edgedriver-stdio.log',
  ...fixtures.map((name) => name + '-product.log'),
  ...fixtures.flatMap((name) => ['fixture-' + name + '.md.log', 'saved-' + name + '.md.log']),
])
const sourcePhases = ['checkout', 'desktop-check', 'final']
const outer = new Set([
  'windows-standard-product-audit.json',
  'evidence-files.json',
  ...sourcePhases.map((phase) => `mermaid-source-${phase}.json`),
])
const guiEvidence = new Set([
  ...GUI_EVIDENCE_NAMES,
  ...['ordinary', 'wide', 'multi', 'many', 'manyScroll', 'busy'].map(
    (name) => `fixture-gui-${name}.md.log`,
  ),
])
const allowedBase = (name) =>
  outer.has(name) ||
  metadata.has(name) ||
  screenshots.has(name) ||
  diagrams.has(name) ||
  guiEvidence.has(name)
const allowed = (name) =>
  allowedBase(name) ||
  (name.startsWith('migration-prepare-') && allowedBase(name.slice('migration-prepare-'.length)))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
export function stageEvidence(source, destination, candidateSha) {
  assert(/^[a-f0-9]{40}$/.test(candidateSha), 'Exact candidate SHA required')
  source = resolve(source)
  destination = resolve(destination)
  assert(
    lstatSync(source).isDirectory() && !lstatSync(source).isSymbolicLink(),
    'Plain evidence root required',
  )
  const names = readdirSync(source).sort()
  assert(
    names.length > 0 && names.length <= 95,
    'Bounded artifact file count, including reserved manifest',
  )
  assert(names.includes('windows-standard-product-audit.json'), 'Outer ownership audit required')
  let total = 0
  const files = names.map((name) => {
    assert(allowed(name), `Unreviewed evidence name: ${name}`)
    const file = join(source, name),
      stat = lstatSync(file)
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Only plain evidence files may be retained')
    assert(
      stat.size <= (name.endsWith('.png') ? 32 * 1024 * 1024 : 2 * 1024 * 1024),
      'Evidence file exceeds size budget',
    )
    total += stat.size
    assert(total <= 127 * 1024 * 1024, 'Evidence leaves no room for bounded provenance')
    const bytes = readFileSync(file)
    assert.equal(bytes.length, stat.size, 'Evidence changed during inspection')
    if (name.endsWith('.png'))
      assert.equal(
        bytes.subarray(0, 8).toString('hex'),
        '89504e470d0a1a0a',
        'PNG signature required',
      )
    if (name.endsWith('mermaid-product-e2e.json')) decodeProductEvidence(bytes)
    else if (name.endsWith('.json')) JSON.parse(bytes.toString('utf8'))
    return { name, bytes, sha256: hash(bytes) }
  })
  const byName = new Map(files.map((file) => [file.name, file]))
  const audit = JSON.parse(byName.get('windows-standard-product-audit.json').bytes)
  assert.equal(audit.source, candidateSha, 'Outer audit must match the exact built candidate')
  if (files.some((file) => guiEvidence.has(file.name))) {
    assert.equal(
      audit.harnessMode,
      'gui-regression',
      'GUI evidence requires its explicit separate mode',
    )
    const gui = byName.get('gui-regression.json')
    if (gui) {
      const value = JSON.parse(gui.bytes)
      validateGuiIdentity(value)
      assert.equal(value.harnessCandidateSha, candidateSha)
      assert.equal(value.applicationCandidateSha, audit.applicationCandidateSha)
      const native = byName.get(value.nativeAudit?.file)
      if (value.nativeAudit) {
        assert.equal(value.nativeAudit.file, 'gui-native-audit.json')
        assert(native, 'Referenced native audit must be retained')
        assert.equal(native.sha256, value.nativeAudit.sha256)
        assert.equal(JSON.parse(native.bytes).length, value.nativeAudit.events)
      }
      if (value.nativeWindowEvidence) {
        const windows = byName.get('native-window-events.json')
        assert(windows, 'Referenced OS window events must be retained')
        assert.equal(windows.sha256, value.nativeWindowEvidence.sha256)
      }
      if (audit.status === 'passed') assert.equal(value.status, 'passed')
    } else assert.notEqual(audit.status, 'passed', 'No passing GUI audit without its actual report')
  }

  assert(['passed', 'failed', 'blocked'].includes(audit.status), 'Closed outer audit status')
  assert.equal(
    audit.passwordInLogsFilesArgumentsOrEnvironment,
    false,
    'Credential-free audit declaration required',
  )
  for (const phase of sourcePhases) {
    const snapshot = byName.get(`mermaid-source-${phase}.json`)
    if (snapshot) {
      const value = JSON.parse(snapshot.bytes)
      assert.equal(value.candidateSha, candidateSha)
      assert.equal(value.phase, phase)
      assert.equal(value.readOnly, true)
      assert.equal(value.refreshedIndex, false)
      assert.equal(
        value.rawStatus,
        '',
        'Only a strictly clean source build may launch product acceptance',
      )
    }
  }
  const copy = byName.get('evidence-files.json')
  if (copy) {
    const manifest = JSON.parse(copy.bytes)
    assert.equal(manifest.schema, 1)
    assert(Array.isArray(manifest.files) && manifest.files.length <= 94)
    if (Object.hasOwn(manifest, 'complete')) {
      assert.equal(typeof manifest.complete, 'boolean', 'Closed evidence completeness required')
      assert.equal(
        audit.evidenceCopy?.complete,
        manifest.complete,
        'Copy manifest and outer audit must agree on completeness',
      )
      assert(Array.isArray(manifest.rejected) && manifest.rejected.length <= 64)
      assert(
        Number.isSafeInteger(manifest.rejectedCount) &&
          manifest.rejectedCount >= 0 &&
          manifest.rejectedCount <= 4096,
      )
      assert(Number.isSafeInteger(manifest.rejectionsOmitted) && manifest.rejectionsOmitted >= 0)
      assert.equal(
        manifest.rejectedCount,
        manifest.rejected.length + manifest.rejectionsOmitted,
        'All rejected evidence must be accounted for',
      )
      assert.equal(manifest.complete, manifest.rejectedCount === 0)
      if (!manifest.complete)
        assert.equal(audit.status, 'failed', 'Incomplete evidence cannot be accepted as passing')
    }
    const reviewed = new Set()
    for (const entry of manifest.files) {
      assert(
        !outer.has(entry.retainedName) && allowed(entry.retainedName),
        'Only reviewed child evidence is permitted',
      )
      assert(!reviewed.has(entry.retainedName), 'Duplicate evidence entry')
      reviewed.add(entry.retainedName)
      const retained = byName.get(entry.retainedName)
      assert(retained, 'Manifest evidence is missing')
      assert.equal(retained.bytes.length, entry.bytes)
      assert.equal(retained.sha256, entry.sha256)
      const original = entry.retainedName.endsWith('.md.log')
        ? entry.retainedName.slice(0, -4)
        : entry.retainedName
      assert.equal(
        entry.relativePath,
        original,
        'Only known top-level harness files, without profile traversal',
      )
    }
    assert.equal(
      reviewed.size,
      files.filter((file) => !outer.has(file.name)).length,
      'No unlisted child evidence',
    )
  } else
    assert.equal(
      files.filter((file) => !outer.has(file.name)).length,
      0,
      'No child evidence without its bounded copy manifest',
    )
  const manifest = {
    schema: 1,
    candidateSha,
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    outerStatus: audit.status,
    scope: 'Self-authored Windows Mermaid product screenshots, reports and closed logs only',
    excluded: [
      'binaries',
      'installers',
      'profiles',
      'cookies',
      'credentials',
      'temporary password',
    ],
    files: files.map((file) => ({
      name: file.name,
      bytes: file.bytes.length,
      sha256: file.sha256,
    })),
    totalBytes: total,
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
  assert(manifestBytes.length < 1024 * 1024 && total + manifestBytes.length <= 128 * 1024 * 1024)
  mkdirSync(destination)
  for (const file of files) writeFileSync(join(destination, file.name), file.bytes, { flag: 'wx' })
  writeFileSync(join(destination, 'artifact-manifest.json'), manifestBytes, { flag: 'wx' })
  console.log(JSON.stringify(manifest))
  return manifest
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  stageEvidence(...process.argv.slice(2))

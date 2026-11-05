import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageEvidence } from './stage-mermaid-evidence.mjs'
const candidate = 'a'.repeat(40)
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mermaid-evidence-test-')),
    source = join(root, 'source'),
    destination = join(root, 'artifact')
  mkdirSync(source)
  writeFileSync(
    join(source, 'windows-standard-product-audit.json'),
    JSON.stringify({
      source: candidate,
      status: 'blocked',
      passwordInLogsFilesArgumentsOrEnvironment: false,
    }),
  )
  return { root, source, destination }
}
for (const scenario of [
  'blocked-audit',
  'unknown-log',
  'linked-file',
  'missing-manifest',
  'wrong-candidate',
  'bad-copy-hash',
  'installer-executable',
  'user-profile-directory',
  'installer-evidence-directory',
])
  test(scenario, () => {
    const f = fixture()
    try {
      if (scenario === 'unknown-log') writeFileSync(join(f.source, 'cookies.log'), 'not allowed')
      if (scenario === 'installer-executable')
        writeFileSync(join(f.source, 'installer.exe'), 'not allowed')
      if (scenario === 'user-profile-directory') mkdirSync(join(f.source, 'userprofile'))
      if (scenario === 'installer-evidence-directory')
        mkdirSync(join(f.source, 'installation-result.json'))
      if (scenario === 'linked-file')
        symlinkSync(
          join(f.source, 'windows-standard-product-audit.json'),
          join(f.source, 'standard-context.json'),
        )
      if (scenario === 'missing-manifest')
        writeFileSync(join(f.source, 'standard-context.json'), '{}')
      if (scenario === 'bad-copy-hash') {
        writeFileSync(join(f.source, 'standard-context.json'), '{}')
        writeFileSync(
          join(f.source, 'evidence-files.json'),
          JSON.stringify({
            schema: 1,
            files: [
              {
                retainedName: 'standard-context.json',
                relativePath: 'standard-context.json',
                bytes: 2,
                sha256: '0'.repeat(64),
              },
            ],
          }),
        )
      }
      if (scenario === 'blocked-audit')
        assert.equal(stageEvidence(f.source, f.destination, candidate).outerStatus, 'blocked')
      else
        assert.throws(() =>
          stageEvidence(
            f.source,
            f.destination,
            scenario === 'wrong-candidate' ? 'b'.repeat(40) : candidate,
          ),
        )
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

for (const name of [
  'installation-result.json',
  'installed-binary-comparison.json',
  'installed-binary-comparison-stderr.log',
  'installer-stdout.log',
  'installer-stderr.log',
  'fixture-gui-many.md.log',
  'fixture-gui-manyScroll.md.log',
  'migration-prepare-ordinary-restart-product.log',
  'migration-prepare-00-restart-old-plugin-choice-window.png',
  'migration-prepare-migration-old-restarted-diagram.png',
])
  test(`retains declared bounded evidence: ${name}`, () => {
    const f = fixture()
    try {
      if (name.startsWith('fixture-gui-')) {
        const auditPath = join(f.source, 'windows-standard-product-audit.json')
        const audit = JSON.parse(readFileSync(auditPath, 'utf8'))
        audit.harnessMode = 'gui-regression'
        writeFileSync(auditPath, JSON.stringify(audit))
      }
      const body = name.endsWith('.png')
        ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        : Buffer.from(name.endsWith('.json') ? '{"status":"blocked"}\n' : 'fixture log\n')
      const sha256 = createHash('sha256').update(body).digest('hex')
      writeFileSync(join(f.source, name), body)
      writeFileSync(
        join(f.source, 'evidence-files.json'),
        JSON.stringify({
          schema: 1,
          files: [
            {
              retainedName: name,
              relativePath: name.startsWith('fixture-gui-') ? name.slice(0, -4) : name,
              bytes: body.length,
              sha256,
            },
          ],
        }),
      )
      const manifest = stageEvidence(f.source, f.destination, candidate)
      assert.deepEqual(readFileSync(join(f.destination, name)), body)
      assert.deepEqual(
        manifest.files.find((file) => file.name === name),
        {
          name,
          bytes: body.length,
          sha256,
        },
      )
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

for (const scenario of [
  'partial-failed',
  'partial-passed',
  'audit-mismatch',
  'rejection-unaccounted',
])
  test(scenario, () => {
    const f = fixture()
    try {
      const body = Buffer.from('Primary Node failure retained\n')
      writeFileSync(join(f.source, 'node-stderr.log'), body)
      writeFileSync(
        join(f.source, 'windows-standard-product-audit.json'),
        JSON.stringify({
          source: candidate,
          status: scenario === 'partial-passed' ? 'passed' : 'failed',
          passwordInLogsFilesArgumentsOrEnvironment: false,
          evidenceCopy: { complete: scenario === 'audit-mismatch' },
        }),
      )
      writeFileSync(
        join(f.source, 'evidence-files.json'),
        JSON.stringify({
          schema: 1,
          complete: false,
          files: [
            {
              retainedName: 'node-stderr.log',
              relativePath: 'node-stderr.log',
              bytes: body.length,
              sha256: createHash('sha256').update(body).digest('hex'),
            },
          ],
          rejected: [
            {
              relativePath: 'edgedriver-native.log',
              bytes: 3 * 1024 * 1024,
              sha256: null,
              hashStatus: 'not-read-budget',
              reason: 'file-size',
            },
          ],
          rejectedCount: scenario === 'rejection-unaccounted' ? 2 : 1,
          rejectionsOmitted: 0,
        }),
      )
      if (scenario === 'partial-failed') {
        const manifest = stageEvidence(f.source, f.destination, candidate)
        assert.equal(manifest.outerStatus, 'failed')
        assert.deepEqual(readFileSync(join(f.destination, 'node-stderr.log')), body)
        assert(!manifest.files.some((file) => file.name === 'edgedriver-native.log'))
      } else assert.throws(() => stageEvidence(f.source, f.destination, candidate))
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

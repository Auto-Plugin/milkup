import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
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
])
  test(scenario, () => {
    const f = fixture()
    try {
      if (scenario === 'unknown-log') writeFileSync(join(f.source, 'cookies.log'), 'not allowed')
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

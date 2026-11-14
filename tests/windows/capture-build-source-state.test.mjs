import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const capture = fileURLToPath(new URL('./capture-build-source-state.mjs', import.meta.url))
const cargo = 'apps/desktop/src-tauri/Cargo.toml'
const files = [
  cargo,
  ...['desktop', 'windows'].map((name) => `apps/desktop/src-tauri/gen/schemas/${name}-schema.json`),
]
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
function fixture(body) {
  const directory = mkdtempSync(path.join(tmpdir(), 'milkup-source-capture-'))
  const source = path.join(directory, 'source')
  mkdirSync(source)
  const git = (...args) => {
    const result = spawnSync('git', args, {
      cwd: source,
      env: { ...process.env, GIT_CONFIG_COUNT: '0', GIT_OPTIONAL_LOCKS: '0' },
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trimEnd()
  }
  try {
    git('init', '--quiet')
    git('config', 'core.autocrlf', 'true')
    git('config', 'user.name', 'Local capture regression')
    git('config', 'user.email', 'capture@example.invalid')
    mkdirSync(path.join(source, 'apps/desktop/src-tauri/gen/schemas'), { recursive: true })
    writeFileSync(
      path.join(source, '.gitattributes'),
      'apps/desktop/src-tauri/gen/schemas/*.json text eol=lf\n',
    )
    writeFileSync(path.join(source, cargo), '[package]\nname = "test"\nversion = "1.0.0"\n')
    for (const file of files.slice(1)) writeFileSync(path.join(source, file), '{}\n')
    git('add', '--all')
    git('-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'Synthetic capture fixture')
    // Force a real checkout conversion in this disposable fixture. An existing
    // file whose stat matches the just-written index can otherwise remain LF.
    rmSync(path.join(source, cargo))
    git('checkout-index', '--index', '--all', '--force')
    assert.equal(git('status', '--porcelain=v1'), '', 'Clean indexed checkout control required')
    body({ directory, source, git, sha: git('rev-parse', 'HEAD') })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
function snapshot({ directory, source, sha }, phase) {
  const output = path.join(directory, phase + '.json')
  const beforeIndex = readFileSync(path.join(source, '.git/index'))
  const result = spawnSync(process.execPath, [capture, source, phase, sha, output], {
    env: { ...process.env, GIT_CONFIG_COUNT: '0' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    readFileSync(path.join(source, '.git/index')),
    beforeIndex,
    'Read-only capture never refreshes or changes index',
  )
  return JSON.parse(readFileSync(output, 'utf8'))
}

test('captures Cargo and schema raw HEAD/index/worktree bytes before build', () =>
  fixture((f) => {
    const record = snapshot(f, 'checkout')
    assert.equal(record.rawStatus, '')
    assert.equal(record.readOnly, true)
    assert.equal(record.refreshedIndex, false)
    assert.deepEqual(
      record.files.map(({ path }) => path),
      files,
    )
    const value = record.files[0]
    const raw = readFileSync(path.join(f.source, cargo))
    assert.equal(value.worktree.sha256, digest(raw))
    assert.equal(value.worktree.crlf, 3)
    assert.equal(value.head.crlf, 0)
    assert.equal(value.head.sha256, value.index.sha256)
    assert.equal(value.worktree.lfNormalizedSha256, value.head.sha256)
    assert.match(value.eol, /i\/lf\s+w\/crlf/)
  }))

test('preserves raw-status-only Cargo rewrite evidence without normalizing it away', () =>
  fixture((f) => {
    const initial = snapshot(f, 'checkout')
    const raw = readFileSync(path.join(f.source, cargo), 'utf8').replaceAll('\r\n', '\n')
    writeFileSync(path.join(f.source, cargo), raw)
    assert.equal(f.git('diff', '--no-ext-diff', '--no-textconv', 'HEAD'), '')
    const changed = snapshot(f, 'final')
    assert.equal(changed.rawStatus, ' M ' + cargo)
    assert.equal(changed.files[0].worktree.crlf, 0)
    assert.equal(changed.files[0].worktree.bareLf, 3)
    assert.notEqual(initial.files[0].worktree.sha256, changed.files[0].worktree.sha256)
    assert.equal(changed.files[0].worktree.sha256, changed.files[0].head.sha256)
    assert.equal(changed.files[0].normalizedWorktreeObjectId, changed.files[0].headObjectId)
    assert.equal(f.git('status', '--porcelain=v1'), changed.rawStatus)
  }))

test('rejects an unrelated candidate without writing snapshot evidence', () =>
  fixture((f) => {
    const result = spawnSync(process.execPath, [capture, f.source, 'final', '0'.repeat(40)], {
      env: { ...process.env, GIT_CONFIG_COUNT: '0' },
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Source snapshot candidate mismatch/)
  }))

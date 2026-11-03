import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [sourceArgument, phase, expectedSha, output] = process.argv.slice(2)
const source = resolve(sourceArgument)
assert(/^[a-z0-9-]{1,64}$/.test(phase), 'Bounded phase name required')
assert(/^[a-f0-9]{40}$/.test(expectedSha), 'Exact candidate SHA required')
const git = (...args) => {
  const result = spawnSync('git', args, {
    cwd: source,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error || result.status === null) throw result.error ?? Error('git did not complete')
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr.toString('utf8') }
}
const required = (...args) => {
  const result = git(...args)
  assert.equal(result.exitCode, 0, result.stderr)
  return result.stdout
}
const string = (...args) =>
  required(...args)
    .toString('utf8')
    .trimEnd()
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const measure = (bytes) => {
  let crlf = 0,
    cr = 0,
    lf = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 10) lf++
    if (bytes[i] === 13) {
      cr++
      if (bytes[i + 1] === 10) crlf++
    }
  }
  return {
    bytes: bytes.length,
    sha256: hash(bytes),
    crlf,
    bareLf: lf - crlf,
    bareCr: cr - crlf,
    lfNormalizedSha256: hash(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))),
  }
}
const candidateSha = string('rev-parse', 'HEAD')
assert.equal(candidateSha, expectedSha, 'Source snapshot candidate mismatch')
const rawStatus = string('status', '--porcelain=v1', '--untracked-files=all')
const files = ['desktop-schema.json', 'windows-schema.json'].map((name) => {
  const path = `apps/desktop/src-tauri/gen/schemas/${name}`
  const file = resolve(source, path)
  const stat = lstatSync(file)
  assert(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4 * 1024 * 1024,
    'Bounded plain generated schema required',
  )
  return {
    path,
    head: measure(required('cat-file', 'blob', `HEAD:${path}`)),
    index: measure(required('cat-file', 'blob', `:${path}`)),
    worktree: measure(readFileSync(file)),
    headObjectId: string('rev-parse', `HEAD:${path}`),
    normalizedWorktreeObjectId: string('hash-object', `--path=${path}`, path),
    eol: string('ls-files', '--eol', '--', path),
    indexStat: string('ls-files', '--debug', '--', path),
    attributes: string(
      'check-attr',
      'text',
      'eol',
      'filter',
      'ident',
      'working-tree-encoding',
      '--',
      path,
    ),
  }
})
const configuration = Object.fromEntries(
  ['core.autocrlf', 'core.eol', 'core.filemode', 'core.safecrlf'].map((key) => {
    const result = git('config', '--show-origin', '--get', key)
    assert([0, 1].includes(result.exitCode), result.stderr)
    return [key, { exitCode: result.exitCode, value: result.stdout.toString('utf8').trimEnd() }]
  }),
)
const record = {
  phase,
  candidateSha,
  instrumentationSha: process.env.GITHUB_SHA ?? null,
  readOnly: true,
  refreshedIndex: false,
  rawStatus,
  configuration,
  files,
}
const json = JSON.stringify(record, null, 2) + '\n'
if (output) writeFileSync(resolve(output), json, { flag: 'wx' })
console.log(json)

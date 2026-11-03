import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// Explicit synthetic mechanism experiment. Never rewrites the original checkout.
const originalSha = 'ca10c4e17fa1b8114ba65bd32da8082d625fbe16'
const source = resolve(process.argv[2])
const scratch = mkdtempSync(join(resolve(process.argv[3]), 'mermaid-eol-'))
const paths = ['desktop-schema.json', 'windows-schema.json'].map(
  (name) => `apps/desktop/src-tauri/gen/schemas/${name}`,
)
const git = (cwd, ...args) => execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
const text = (cwd, ...args) =>
  git(cwd, ...args)
    .toString('utf8')
    .trimEnd()
const optional = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.error || ![0, 1].includes(result.status))
    throw result.error ?? Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return {
    exitCode: result.status,
    stdout: result.stdout.trimEnd(),
    stderr: result.stderr.trimEnd(),
  }
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const bytesRecord = (bytes) => {
  let crlf = 0,
    lf = 0,
    cr = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 10) lf++
    if (bytes[i] === 13) {
      cr++
      if (bytes[i + 1] === 10) crlf++
    }
  }
  return {
    bytes: bytes.length,
    sha256: sha(bytes),
    crlf,
    bareLf: lf - crlf,
    bareCr: cr - crlf,
    lfNormalizedSha256: sha(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))),
  }
}
const configKeys = ['core.autocrlf', 'core.eol', 'core.filemode', 'core.safecrlf']
function snapshot(cwd, phase, synthetic) {
  const record = {
    phase,
    synthetic,
    sourceSha: originalSha,
    checkoutSha: text(cwd, 'rev-parse', 'HEAD'),
    instrumentationSha: process.env.GITHUB_SHA ?? null,
    gitVersion: text(cwd, '--version'),
    status: text(cwd, 'status', '--porcelain=v1', '--untracked-files=all'),
    diff: text(cwd, 'diff', '--no-ext-diff', '--no-textconv', 'HEAD'),
    diffExit: optional(cwd, 'diff', '--exit-code', '--no-ext-diff', '--no-textconv', 'HEAD')
      .exitCode,
    config: Object.fromEntries(
      configKeys.map((key) => [key, optional(cwd, 'config', '--show-origin', '--get', key)]),
    ),
    files: paths.map((path) => ({
      path,
      head: bytesRecord(git(cwd, 'cat-file', 'blob', `HEAD:${path}`)),
      index: bytesRecord(git(cwd, 'cat-file', 'blob', `:${path}`)),
      worktree: bytesRecord(readFileSync(join(cwd, path))),
      headObjectId: text(cwd, 'rev-parse', `HEAD:${path}`),
      normalizedWorktreeObjectId: text(cwd, 'hash-object', `--path=${path}`, path),
      eol: text(cwd, 'ls-files', '--eol', '--', path),
      indexStat: text(cwd, 'ls-files', '--debug', '--', path),
      attributes: text(
        cwd,
        'check-attr',
        'text',
        'eol',
        'filter',
        'ident',
        'working-tree-encoding',
        '--',
        path,
      ),
    })),
  }
  console.log(JSON.stringify(record))
  return record
}
assert.equal(text(source, 'rev-parse', 'HEAD'), originalSha)
const before = snapshot(source, 'original-checkout-before', false)
assert.equal(before.status, '', 'Original checkout must be clean')
const experiments = []
for (const lfAttributes of [false, true]) {
  const name = lfAttributes ? 'synthetic-with-lf-attributes' : 'synthetic-original-attributes'
  const cwd = join(scratch, name)
  // A bounded synthetic repository contains only the exact two HEAD blobs and
  // their ancestor attributes, never a full historical object database.
  mkdirSync(cwd)
  git(cwd, 'init', '--quiet')
  for (const key of configKeys) {
    const value = optional(source, 'config', '--get', key)
    if (value.exitCode === 0) git(cwd, 'config', '--local', key, value.stdout)
  }
  const attributePaths = text(source, 'ls-tree', '-r', '--name-only', 'HEAD')
    .split('\n')
    .filter(
      (path) =>
        path === '.gitattributes' ||
        (path.endsWith('/.gitattributes') &&
          paths.some((target) => target.startsWith(path.slice(0, -'.gitattributes'.length)))),
    )
  for (const path of [...paths, ...attributePaths]) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true })
    writeFileSync(join(cwd, path), git(source, 'cat-file', 'blob', `HEAD:${path}`))
  }
  if (lfAttributes) {
    const attributesPath = join(cwd, '.gitattributes')
    let previous = ''
    try {
      previous = readFileSync(attributesPath, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    writeFileSync(
      attributesPath,
      `${previous}\n# Synthetic experiment only: exact generated-schema line endings.\n${paths.map((path) => `/${path} text eol=lf`).join('\n')}\n`,
    )
  }
  git(cwd, 'add', '--all')
  git(
    cwd,
    '-c',
    'user.name=Mermaid EOL experiment',
    '-c',
    'user.email=synthetic@invalid.example',
    '-c',
    'core.hooksPath=',
    'commit',
    '--no-gpg-sign',
    '-m',
    name,
  )
  for (const path of paths) unlinkSync(join(cwd, path))
  git(cwd, 'checkout-index', '--all', '--force')
  snapshot(cwd, `${name}-before-rewrite`, true)
  for (const path of paths) {
    const head = git(cwd, 'cat-file', 'blob', `HEAD:${path}`)
    // Only replace line endings; byte content and JSON semantics stay identical.
    writeFileSync(join(cwd, path), Buffer.from(head.toString('utf8').replace(/\r\n/g, '\n')))
  }
  const rewritten = snapshot(cwd, `${name}-after-lf-rewrite`, true)
  for (const file of rewritten.files)
    assert.equal(
      file.headObjectId,
      file.normalizedWorktreeObjectId,
      'Synthetic LF rewrite changed normalized content',
    )
  const refresh = optional(cwd, 'update-index', '--refresh')
  console.log(JSON.stringify({ phase: `${name}-index-refresh`, synthetic: true, ...refresh }))
  const after = snapshot(cwd, `${name}-after-index-refresh`, true)
  experiments.push({
    name,
    dirtyAfterRewrite: rewritten.status !== '',
    diffAfterRewrite: rewritten.diffExit,
    statusAfterRefresh: after.status,
    refreshExit: refresh.exitCode,
  })
}
const after = snapshot(source, 'original-checkout-after', false)
assert.deepEqual(
  after,
  { ...before, phase: 'original-checkout-after' },
  'Original source changed during synthetic experiment',
)
console.log(
  JSON.stringify({
    phase: 'summary',
    sourceSha: originalSha,
    instrumentationSha: process.env.GITHUB_SHA ?? null,
    syntheticOnly: true,
    actualBuildReplayed: false,
    originalCheckoutUnchanged: true,
    experiments,
  }),
)

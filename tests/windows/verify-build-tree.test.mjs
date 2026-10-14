import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { verifyBuildTree } from './verify-build-tree.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'milkup-build-tree-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const schemas = path.join(root, 'apps/desktop/src-tauri/gen/schemas')
  await mkdir(schemas, { recursive: true })
  await writeFile(path.join(root, 'source.rs'), 'fn main() {}\n')
  await writeFile(path.join(schemas, 'desktop-schema.json'), '{}\n')
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('add', '.')
  git(
    '-c',
    'user.name=LarryZhu-dev',
    '-c',
    'user.email=larryzhu@foxmail.com',
    'commit',
    '-qm',
    'fixture',
  )
  return { root, schemas }
}
test('accepts clean checkout and records known generated JSON without restoring it', async (t) => {
  const { root, schemas } = await fixture(t)
  assert.equal((await verifyBuildTree(root)).changed.length, 0)
  await writeFile(path.join(schemas, 'desktop-schema.json'), '{"platform":"windows"}')
  const result = await verifyBuildTree(root)
  assert.equal(result.status, 'passed')
  assert.equal(result.generatedSchemas.length, 1)
  assert.equal(result.generatedSchemas[0].sha256.length, 64)
})
test('rejects tracked source edits', async (t) => {
  const { root } = await fixture(t)
  await writeFile(path.join(root, 'source.rs'), 'unexpected input')
  await assert.rejects(verifyBuildTree(root), /source\.rs/)
})
test('rejects unexpected untracked files even in the schema directory', async (t) => {
  const { root, schemas } = await fixture(t)
  await writeFile(path.join(schemas, 'unexpected.json'), '{}')
  await assert.rejects(verifyBuildTree(root), /unexpected\.json/)
})
test('rejects malformed generated JSON', async (t) => {
  const { root, schemas } = await fixture(t)
  await writeFile(path.join(schemas, 'desktop-schema.json'), 'invalid')
  await assert.rejects(verifyBuildTree(root), SyntaxError)
})

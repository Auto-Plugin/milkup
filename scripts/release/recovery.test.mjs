import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { signedFixture } from './test-support/signing-fixture.mjs'
import { prepareRecoveryKit, verifyRecoveryCandidate } from './prepare-recovery-kit.mjs'

const installed = '2.0.0-beta.10'
function check(f, from = installed, now = 1500) {
  return verifyRecoveryCandidate(f.envelope(), f.config, f.artifact, from, now)
}
test('same-version recovery is preparation, never installation or rollback success', () => {
  const receipt = check(signedFixture())
  assert.equal(receipt.purpose, 'same-version-repair')
  assert.equal(receipt.executed, false)
  assert.equal(receipt.automaticRollback, false)
  assert.equal(receipt.dataCompatibilityVerified, false)
})
test('older recovery needs separate signed manual-recovery scope, never candidate rollbackFrom', () => {
  const f = signedFixture()
  assert.throws(() => check(f, '2.0.0-beta.11'), /separate signed/)
  f.statement.release.milkup.rollbackFrom = '2.0.0-beta.11'
  assert.throws(() => check(f, '2.0.0-beta.11'), /separate signed/)
  f.statement.release.recovery = {
    schema: 1,
    mode: 'manual-reinstall',
    fromVersion: '2.0.0-beta.11',
    toVersion: installed,
    dataBackwardCompatible: true,
  }
  assert.equal(check(f, '2.0.0-beta.11').purpose, 'manual-older-version-recovery')
  assert.equal(check(f, '2.0.0-beta.11').dataCompatibilityVerified, false)
  assert.throws(() => check(f, '2.0.0-beta.11', 2000), /not currently valid/)
  for (const [field, value] of [
    ['fromVersion', '2.0.0-beta.12'],
    ['toVersion', '2.0.0-beta.9'],
    ['mode', 'automatic'],
    ['dataBackwardCompatible', false],
    ['surprise', true],
  ]) {
    const original = f.statement.release.recovery[field]
    f.statement.release.recovery[field] = value
    assert.throws(() => check(f, '2.0.0-beta.11'))
    if (original === undefined) delete f.statement.release.recovery[field]
    else f.statement.release.recovery[field] = original
  }
})
test('newer version, bad key, stale metadata and replaced bytes never become recovery candidates', () => {
  const f = signedFixture()
  assert.throws(() => check(f, '2.0.0-beta.9'), /normal update/)
  assert.throws(() => check(f, installed, 2000), /not currently valid/)
  const other = signedFixture()
  assert.throws(
    () => verifyRecoveryCandidate(f.envelope(), other.config, f.artifact, installed, 1500),
    /signature/,
  )
  f.artifact = Buffer.from('changed')
  assert.throws(() => check(f), /signature/)
})
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'milkup-recovery-test-'))
  const f = signedFixture()
  const output = path.join(directory, 'kit')
  const args = {
    envelope: f.envelope(),
    config: f.config,
    installer: f.artifact,
    installedVersion: installed,
    output,
    now: 1500,
    // Explicit synthetic observer. Tests never execute a real installer or
    // claim to have exercised Windows PE resource parsing.
    inspect: async (file) => ({
      productVersion: installed,
      sha256: createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
    }),
  }
  return { directory, output, args }
}
test('kit includes exact signed bytes, receipt and honest recovery instructions, without touching user data', async () => {
  const { directory, output, args } = await setup()
  const userFile = path.join(directory, 'document.md')
  await writeFile(userFile, 'unsaved user content')
  const receipt = await prepareRecoveryKit(args)
  assert.equal(receipt.status, 'prepared-for-manual-recovery-not-installed')
  assert.deepEqual(await readFile(path.join(output, receipt.installer)), args.installer)
  assert.deepEqual(await readFile(path.join(output, 'signed-envelope.json')), args.envelope)
  assert.equal(await readFile(userFile, 'utf8'), 'unsaved user content')
  assert.equal((await readdir(output)).length, 5)
  const instructions = await readFile(path.join(output, 'RECOVERY.txt'), 'utf8')
  assert.match(instructions, /未执行安装/)
  assert.match(instructions, /未确认备份完成时不要安装/)
  assert.match(instructions, /不要删除原目录/)
  assert.match(instructions, /签名授权不等于数据迁移安全/)
  await assert.rejects(() => prepareRecoveryKit(args), /EEXIST/)
})
test('signature failure does not create an output directory', async () => {
  const { output, args } = await setup()
  await assert.rejects(
    () => prepareRecoveryKit({ ...args, installer: Buffer.from('wrong') }),
    /signature/,
  )
  await assert.rejects(() => access(output), /ENOENT/)
})
for (const failure of [
  'wrong-version',
  'wrong-hash',
  'observer-error',
  'modified-after-inspection',
]) {
  test(`interrupted/failed preparation (${failure}) cannot yield a completed kit`, async () => {
    const { output, args } = await setup()
    const inspect = async (file) => {
      if (failure === 'observer-error') throw Error('resource inspection failed')
      const observed = await args.inspect(file)
      if (failure === 'wrong-version') observed.productVersion = '0.0.0'
      if (failure === 'wrong-hash') observed.sha256 = '0'.repeat(64)
      if (failure === 'modified-after-inspection') await writeFile(file, 'replaced bytes')
      return observed
    }
    await assert.rejects(() => prepareRecoveryKit({ ...args, inspect }))
    await assert.rejects(() => access(path.join(output, 'recovery-receipt.json')), /ENOENT/)
    await assert.rejects(() => access(path.join(output, 'RECOVERY.txt')), /ENOENT/)
    await access(path.join(output, 'INCOMPLETE.txt'))
  })
}

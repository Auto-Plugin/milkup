// Reuses the existing identity-held native picker input helper; no application hook.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
export async function openLatencyDocument({
  target,
  trigger,
  until,
  output,
  pid,
  birth,
  image,
  receiptIndex,
}) {
  const mode = 'open'
  const receipt = path.join(output, `mermaid-visible-dialog-${receiptIndex}.json`)
  const helper = fileURLToPath(new URL('./installed-dialog-input.ps1', import.meta.url))
  const child = spawn(
    'pwsh.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-File',
      helper,
      '-ProductId',
      pid,
      '-CreationTicks',
      birth,
      '-Image',
      image,
      '-FixtureRoot',
      output,
      '-Target',
      target,
      '-Mode',
      mode,
      '-Receipt',
      receipt,
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let log = '',
    overflow = false
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (b) => {
      if (Buffer.byteLength(log) + b.length > 65536) overflow = true
      else log += b.toString()
    })
  let timer
  const ended = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
    timer = setTimeout(() => {
      child.kill()
      reject(Error('Native dialog helper exceeded 60 seconds'))
    }, 60000)
  })
  // Attach rejection handling before any UI awaits; original failure remains in the report.
  ended.catch(() => {})
  try {
    await until(
      async () => {
        try {
          return (await readFile(receipt + '.ready', 'utf8')) === 'ready'
        } catch {
          return false
        }
      },
      'native input helper ready',
      15000,
    )
    await trigger()
    const code = await ended
    const proof = JSON.parse((await readFile(receipt, 'utf8')).replace(/^\uFEFF/, ''))
    assert.equal(code, 0, log)
    assert(!overflow, 'Complete bounded native helper logs')
    assert.equal(proof.status, 'passed')
    assert.equal(proof.input.path, target)
    assert(proof.input.accepted && proof.input.nativeSendInput && proof.input.filenameReadbackExact)
    return proof
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await ended.catch(() => {})
    await writeFile(receipt + '.log', log)
  }
}

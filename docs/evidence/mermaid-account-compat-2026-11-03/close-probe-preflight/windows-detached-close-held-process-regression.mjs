import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { decodeWebDriverResponse, probeCloseConfirmation, waitForOwnedExit, stopOwnedProductAfterFailure } from '/workspace/milkup-mermaid-rebuild/tests/windows/mermaid-product-e2e.mjs'
const originalPath = '/workspace/mermaid-rebuild-evidence/windows-account-41688389731/extracted/filtered-admin/mermaid-product-e2e.json'
const originalBytes = await readFile(originalPath)
const raw = JSON.parse(originalBytes).launches[3].closeConfirmationProbes.observations[0].response.text
const result = { localOnly: true, windowsProductRun: false, originalReportSha256: createHash('sha256').update(originalBytes).digest('hex'), cases: [] }
async function ownedStub(run) {
  const child = spawn(process.execPath, ['-e', 'process.stdin.once("data",()=>setTimeout(()=>process.exit(0),4));process.stdout.write("ready")'], { stdio: ['pipe', 'pipe', 'pipe'] })
  const exit = once(child, 'exit'), close = once(child, 'close')
  let killed = 0
  const originalKill = child.kill.bind(child)
  child.kill = (...args) => { killed++; return originalKill(...args) }
  const guard = setTimeout(() => originalKill(), 5000)
  try {
    await once(child.stdout, 'data')
    await run(child, exit)
    await close
    assert.equal(killed, 0)
    assert.equal(child.exitCode, 0)
    assert.equal(child.signalCode, null)
  } finally {
    clearTimeout(guard)
    if (child.exitCode === null && child.signalCode === null) originalKill()
    await close
  }
}
await ownedStub(async (child) => {
  const record = { teardown: { realUiCloseRequested: true } }, controller = new AbortController()
  let exitedAt, probeFinishedAt
  child.once('exit', () => { exitedAt = performance.now(); controller.abort() })
  const started = performance.now()
  assert.equal(await waitForOwnedExit(() => child.exitCode === null && child.signalCode === null, 15000, 100, async (signal) => {
    assert.equal(await probeCloseConfirmation(record, row => decodeWebDriverResponse(raw, 404, row), true, signal), null)
    probeFinishedAt = performance.now()
    child.stdin.end('exit')
  }, { exitedAt: () => exitedAt, exitSignal: controller.signal }), true)
  assert(exitedAt > probeFinishedAt)
  assert.equal(record.closeConfirmationProbes.observations[0].decision, 'closed-context-awaiting-owned-exit')
  result.cases.push({ name: 'actual owned Node exits after raw detached response', passed: true, elapsedMs: exitedAt - started, responseToExitMs: exitedAt - probeFinishedAt, exitCode: child.exitCode, signal: child.signalCode })
})
await ownedStub(async (child, exit) => {
  const r = await stopOwnedProductAfterFailure({ current: child, expectedPid: child.pid,
    observeIdentity: async () => { child.stdin.end('exit'); await exit; return [] },
    verifyIdentity: () => assert.fail('No identity inference after actual held exit'),
  })
  assert.equal(r.exactOwnedProcessAlreadyExited, true)
  assert.equal(r.forcedTermination, false)
  assert.equal(r.innerCleanupAcceptance, false)
  result.cases.push({ name: 'actual owned Node exits while identity observation awaits', passed: true, ...r })
  const after = await stopOwnedProductAfterFailure({ current: child, expectedPid: child.pid,
    observeIdentity: () => assert.fail('Exited held process must not launch observer'),
    verifyIdentity: () => assert.fail('Exited held process must not require PID snapshot'),
  })
  assert.equal(after.exactOwnedProcessAlreadyExited, true)
  result.cases.push({ name: 'actual already exited Node skips observer and kill', passed: true, ...after })
})
assert.equal(createHash('sha256').update(await readFile(originalPath)).digest('hex'), result.originalReportSha256)
await writeFile('/workspace/mermaid-rebuild-evidence/windows-detached-close-held-process-regression.json', JSON.stringify(result, null, 2)+'\n')
console.log(JSON.stringify(result, null, 2))

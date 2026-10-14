import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { captureStartup } from './startup-diagnostics.mjs'

assert.equal(process.platform, 'win32')
const [application, evidence] = process.argv.slice(2)
assert(application && evidence)
const result = {
  status: 'started',
  application,
  controlOnly: true,
  sha256: createHash('sha256')
    .update(await readFile(application))
    .digest('hex'),
  debugPort: 9230,
  profile: path.join(evidence, 'minimal-control-profile'),
  startedAt: new Date().toISOString(),
  output: '',
}
const app = spawn(application, [], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    TAURI_WEBVIEW_AUTOMATION: 'true',
    WEBVIEW2_USER_DATA_FOLDER: result.profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      '--remote-debugging-port=9230 --remote-debugging-address=127.0.0.1',
  },
})
result.pid = app.pid
app.once('error', (error) => {
  result.spawnError = String(error)
})
app.once('exit', (code, signal) =>
  Object.assign(result, { exitCode: code, signal, exitedAt: new Date().toISOString() }),
)
for (const stream of [app.stdout, app.stderr])
  stream.on('data', (chunk) => {
    if (result.output.length < 16384)
      result.output += chunk.toString().slice(0, 16384 - result.output.length)
  })
try {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline && app.exitCode === null && !result.spawnError) {
    const version = await fetch('http://127.0.0.1:9230/json/version', {
      signal: AbortSignal.timeout(1000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    if (version) {
      result.devTools = version
      result.targets = await fetch('http://127.0.0.1:9230/json/list').then((r) => r.json())
      break
    }
    await delay(100)
  }
  result.status = result.devTools ? 'debug-endpoint-ready' : 'debug-endpoint-unavailable'
  result.beforeCleanup = await captureStartup(result, evidence, 'minimal-control')
} catch (error) {
  result.status = 'failed'
  result.error = String(error)
} finally {
  if (app.exitCode === null && !result.spawnError) {
    const exited = new Promise((resolve) => app.once('exit', resolve))
    result.stopRequestedByHarness = true
    app.kill()
    await Promise.race([exited, delay(5000)])
  }
  await writeFile(
    path.join(evidence, 'minimal-control-result.json'),
    JSON.stringify(result, null, 2),
  )
}
// A diagnostic control outcome never substitutes for product acceptance.

// Diagnostic observation only: never sends editor input, navigates, or invokes IPC.
import assert from 'node:assert/strict'
import { open, readFile, writeFile } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { observe, startupPerformanceScript } from '../../tests/windows/mermaid-product-e2e.mjs'
import {
  StartupLog,
  fixtureSource,
  observeMode,
  sha,
  logBudget,
} from './startup-comparison-contract.mjs'

const [specFile] = process.argv.slice(2)
const specBytes = await readFile(specFile)
assert(specBytes.length < 16384)
const spec = JSON.parse(specBytes.toString('utf8').replace(/^\uFEFF/, ''))
const creationMs = Date.parse(spec.creationUtc)
const deadline = creationMs + 45000
assert(spec.creationTicks && spec.image && spec.sourceSha && spec.harnessSha)
const documentBytes = await readFile(spec.document)
assert.equal(sha(documentBytes), spec.documentSha256)
const parser = new StartupLog(spec.pid, fixtureSource(documentBytes), creationMs)
const record = {
  status: 'running',
  spec,
  inputs: 0,
  connectionAttempts: 0,
  boundary:
    'Native finished PNG is the common metric; not DOM decode in the unattached mode. Two samples per mode cannot establish causality.',
}
const persist = () => writeFile(spec.report, JSON.stringify(record, null, 2))
let session,
  handle,
  position = 0
const decoder = new StringDecoder('utf8')
const remaining = () => {
  assert(Date.now() < deadline, 'Startup comparison exceeded 45 seconds from process creation')
  return deadline - Date.now()
}
const pollLog = async () => {
  remaining()
  handle ??= await open(spec.stderr, 'r')
  const stat = await handle.stat()
  assert(stat.size >= position && stat.size <= logBudget, 'Truncated or oversized startup log')
  while (position < stat.size) {
    const buffer = Buffer.alloc(Math.min(16384, stat.size - position))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
    assert(bytesRead > 0)
    position += bytesRead
    parser.append(decoder.write(buffer.subarray(0, bytesRead)), bytesRead)
  }
  return parser.firstReady
}
const request = async (method, route, body) => {
  assert(spec.mode !== 'none', 'Unattached trial must make no driver connection')
  assert(/^\d{4,5}$/.test(String(spec.driverPort)) && spec.driverPort < 65536)
  record.connectionAttempts++
  const response = await fetch(`http://127.0.0.1:${spec.driverPort}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1, Math.min(15000, remaining()))),
  })
  const text = await response.text()
  assert(text.length <= 256 * 1024, 'Bounded driver response required')
  const result = JSON.parse(text)
  assert(response.ok && !result.value?.error, text.slice(0, 1000))
  return result.value ?? result
}
try {
  await persist()
  const result = await observeMode(spec.mode, {
    waitReady: async () => {
      while (!(await pollLog())) await delay(50)
      record.readyObservedUtc = new Date().toISOString()
      record.firstReady = parser.firstReady
      await persist()
      return parser.firstReady
    },
    attach: async () => {
      assert(/^\d{4,5}$/.test(String(spec.debugPort)) && spec.debugPort < 65536)
      record.attachStartedUtc = new Date().toISOString()
      await persist()
      while (true) {
        remaining()
        try {
          record.connectionAttempts++
          const response = await fetch(`http://127.0.0.1:${spec.debugPort}/json/version`, {
            signal: AbortSignal.timeout(Math.min(1000, remaining())),
          })
          if (response.ok) {
            const text = await response.text()
            assert(text.length < 16384)
            const value = JSON.parse(text)
            assert(typeof value.webSocketDebuggerUrl === 'string')
            record.devToolsVersion = value.Browser
            break
          }
        } catch (error) {
          record.lastReadinessError = String(error).slice(0, 1000)
        }
        await delay(50)
      }
      const value = await request('POST', '/session', {
        capabilities: {
          alwaysMatch: {
            browserName: 'webview2',
            'ms:edgeChromium': true,
            'ms:edgeOptions': { debuggerAddress: `127.0.0.1:${spec.debugPort}` },
          },
        },
      })
      session = record.sessionId = value.sessionId
      assert(session)
      assert.equal(
        value.capabilities.browserVersion,
        spec.runtimeVersion,
        'Exact installed runtime attachment',
      )
      record.attachFinishedUtc = new Date().toISOString()
      await persist()
    },
    observe: async () => {
      let value
      do {
        value = await request('POST', `/session/${session}/execute/sync`, {
          script: `const images=[...document.querySelectorAll('[data-document-presentation] img')];return {performance:(()=>{${startupPerformanceScript}})(),decoded:images.some(e=>e.complete&&e.naturalWidth>0)};`,
          args: [],
        })
        if (!value.decoded) await delay(50)
      } while (!value.decoded)
      const state = await request('POST', `/session/${session}/execute/sync`, {
        script: observe,
        args: [],
      })
      assert.equal(
        path.resolve(state.path).toLowerCase(),
        path.resolve(spec.document).toLowerCase(),
      )
      assert.equal(state.loading, 'ready')
      assert.equal(state.developmentProbe, 'undefined')
      value.documentPath = state.path
      return value
    },
  })
  record.observation = result
  record.nativeFirstReadyFromCreationMs = result.ready.timestampUnixMs - creationMs
  assert.equal(sha(await readFile(spec.document)), spec.documentSha256)
  record.status = 'observed-await-normal-close'
} catch (error) {
  record.status = 'failed'
  record.error = error.stack
  process.exitCode = 1
} finally {
  record.nativeRecords = parser.records
  record.consumedBytes = position
  record.completeLogRequiresPostExitVerification = true
  await handle?.close()
  await persist()
}

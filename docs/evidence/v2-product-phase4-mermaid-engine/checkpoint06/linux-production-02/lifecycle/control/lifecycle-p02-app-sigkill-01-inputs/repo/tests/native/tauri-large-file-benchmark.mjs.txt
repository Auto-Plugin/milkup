import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { cpus, freemem, platform, release, totalmem, tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const MIB = 1024 * 1024
const GENERATE_BATCH_BYTES = 4 * MIB
const rootDir = path.resolve(import.meta.dirname, '..', '..')
const appPath = path.join(
  rootDir,
  'apps',
  'desktop',
  'src-tauri',
  'target',
  'x86_64-pc-windows-gnu',
  'debug',
  'milkup-desktop.exe',
)
const driverPath =
  process.env.TAURI_DRIVER ??
  path.join(process.env.USERPROFILE ?? '', '.cargo', 'bin', 'tauri-driver.exe')
const nativeDriverPath = process.env.TAURI_NATIVE_DRIVER
const port = Number(process.env.TAURI_DRIVER_PORT ?? '4454')
const nativePort = Number(process.env.TAURI_NATIVE_DRIVER_PORT ?? '9525')
const baseUrl = `http://127.0.0.1:${port}`
const sizeMib = Number(process.env.MILKUP_NATIVE_LARGE_FILE_MIB ?? '16')
const keepFixture = process.env.MILKUP_NATIVE_LARGE_FILE_KEEP === '1'
const reportPath = process.env.MILKUP_NATIVE_LARGE_FILE_REPORT
const implementationMode =
  process.env.MILKUP_NATIVE_LARGE_FILE_IMPLEMENTATION_MODE ?? 'native-persistent-piece-tree'

if (!Number.isInteger(sizeMib) || sizeMib <= 0) {
  throw new Error('MILKUP_NATIVE_LARGE_FILE_MIB must be a positive integer')
}

if (!existsSync(appPath)) {
  throw new Error(
    [
      `Tauri debug binary was not found at ${appPath}`,
      'Build it first with: pnpm --filter @milkup/desktop tauri build --debug --target x86_64-pc-windows-gnu',
    ].join('\n'),
  )
}

if (!existsSync(driverPath)) {
  throw new Error(
    [
      `tauri-driver was not found at ${driverPath}`,
      'Install or expose it with TAURI_DRIVER before running this benchmark.',
    ].join('\n'),
  )
}

const workDir = path.join(tmpdir(), `milkup-native-large-${process.pid}-${Date.now()}`)
const fixturePath = path.join(workDir, `large-${sizeMib}mib.md`)

await mkdir(workDir, { recursive: true })

let driver
let session
let driverOutput = ''

try {
  const generated = await generateSyntheticMarkdown(fixturePath, sizeMib * MIB)
  const driverArgs = ['--port', String(port), '--native-port', String(nativePort)]

  if (nativeDriverPath) {
    driverArgs.push('--native-driver', nativeDriverPath)
  }

  driver = spawn(driverPath, driverArgs, {
    cwd: rootDir,
    env: {
      ...process.env,
      MILKUP_DESKTOP_TEST_SKIP_REVEAL: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  driver.stdout.on('data', (chunk) => {
    driverOutput += chunk.toString()
  })
  driver.stderr.on('data', (chunk) => {
    driverOutput += chunk.toString()
  })

  await waitForDriver()
  session = await createSession()
  await waitForText('[data-title]', '未命名')

  const userAgent = await execute('return navigator.userAgent')
  const benchmark = await runLargeFileBenchmark(normalizePath(fixturePath))
  const finalFile = await hashAndFindMarkers(fixturePath, [
    '<!-- head -->',
    '<!-- middle -->',
    '<!-- tail -->',
  ])
  const desktopProcessMemory = await readDesktopProcessMemory()
  const report = {
    generatedAt: new Date().toISOString(),
    sourceSnapshot: await readSourceSnapshot(),
    implementation: {
      mode: implementationMode,
      expectedNativePath:
        'open_large_text_file/read_large_text_file_line_window/apply_large_text_file_changes/flush_large_text_file',
      expectedEditStorage: 'immutable base ranges plus append-only add buffer',
      frontendPath: 'desktop SourceDocumentView/LargeDocumentSource',
    },
    environment: {
      platform: platform(),
      release: release(),
      arch: process.arch,
      cpu: cpus()[0]?.model ?? 'unknown',
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      freeMemoryBytesAfterRun: freemem(),
      node: process.version,
      userAgent,
      driverPath,
      nativeDriverPath: nativeDriverPath ?? null,
      appPath,
      desktopProcessMemory,
    },
    fixture: {
      path: fixturePath,
      requestedSizeMib: sizeMib,
      sizeBytesBeforeRun: generated.sizeBytes,
      sha256BeforeRun: generated.sha256,
      sizeBytesAfterRun: (await stat(fixturePath)).size,
      sha256AfterRun: finalFile.sha256,
      retained: keepFixture,
    },
    benchmark,
    verification: {
      usedNativeTauriLargeFileCommands: true,
      containsHeadMarker: finalFile.markers['<!-- head -->'] === true,
      containsMiddleMarker: finalFile.markers['<!-- middle -->'] === true,
      containsTailMarker: finalFile.markers['<!-- tail -->'] === true,
    },
  }
  const missingMarkers = [
    report.verification.containsHeadMarker ? undefined : '<!-- head -->',
    report.verification.containsMiddleMarker ? undefined : '<!-- middle -->',
    report.verification.containsTailMarker ? undefined : '<!-- tail -->',
  ].filter((marker) => marker !== undefined)
  const serialized = `${JSON.stringify({ ...report, missingMarkers }, null, 2)}\n`

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, serialized, 'utf8')
  }

  console.log(serialized)

  if (
    !report.verification.containsHeadMarker ||
    !report.verification.containsMiddleMarker ||
    !report.verification.containsTailMarker
  ) {
    throw new Error(`Large-file benchmark markers were not flushed to disk: ${missingMarkers}`)
  }
} catch (error) {
  if (driver) {
    console.error(await collectProcessOutput(driver))
  }

  throw error
} finally {
  if (session) {
    await session.delete().catch(() => undefined)
  }

  if (driver) {
    driver.kill()
  }

  if (!keepFixture) {
    await rm(workDir, { recursive: true, force: true })
  }
}

async function generateSyntheticMarkdown(filePath, targetBytes) {
  const startedAt = performance.now()
  const stream = createWriteStream(filePath, { encoding: 'utf8' })
  const hash = createHash('sha256')
  const heading = '# Native Large File Benchmark\n\n'
  let batch = ''
  let batchBytes = 0
  let bytes = 0
  let index = 0

  bytes += await writeHashed(stream, hash, heading)

  while (bytes < targetBytes) {
    const line =
      index % 128 === 0
        ? `\n\`\`\`ts\nexport const marker${index} = ${index}\n\`\`\`\n\n`
        : `- repeated item ${String(index).padStart(9, '0')}: **bold** [link](./target.md) marker-${index}\n`
    const remaining = targetBytes - bytes
    const next = Buffer.byteLength(line) <= remaining ? line : 'x'.repeat(remaining)
    const nextBytes = Buffer.byteLength(next)

    batch += next
    batchBytes += nextBytes
    bytes += nextBytes

    if (batchBytes >= GENERATE_BATCH_BYTES || bytes >= targetBytes) {
      await writeHashed(stream, hash, batch)
      batch = ''
      batchBytes = 0
    }

    index += 1
  }

  await closeStream(stream)

  return {
    sizeBytes: bytes,
    sha256: hash.digest('hex'),
    generateMs: round(performance.now() - startedAt),
  }
}

function writeHashed(stream, hash, text) {
  return new Promise((resolveWrite, rejectWrite) => {
    stream.write(text, (error) => {
      if (error) {
        rejectWrite(error)
        return
      }

      hash.update(text)
      resolveWrite(Buffer.byteLength(text))
    })
  })
}

function closeStream(stream) {
  return new Promise((resolveClose, rejectClose) => {
    stream.end((error) => {
      if (error) {
        rejectClose(error)
        return
      }

      resolveClose()
    })
  })
}

function hashAndFindMarkers(filePath, markerList) {
  return new Promise((resolveMarkers, rejectMarkers) => {
    const stream = createReadStream(filePath, { encoding: 'utf8' })
    const hash = createHash('sha256')
    const markers = Object.fromEntries(markerList.map((marker) => [marker, false]))
    const maxMarkerLength = Math.max(...markerList.map((marker) => marker.length))
    let tail = ''

    stream.on('data', (chunk) => {
      hash.update(chunk)

      const searchable = `${tail}${chunk}`

      for (const marker of markerList) {
        markers[marker] ||= searchable.includes(marker)
      }

      tail = searchable.slice(-maxMarkerLength)
    })
    stream.on('error', rejectMarkers)
    stream.on('end', () => {
      resolveMarkers({
        sha256: hash.digest('hex'),
        markers,
      })
    })
  })
}

async function runLargeFileBenchmark(filePath) {
  const result = await executeAsync(
    `
      const done = arguments[arguments.length - 1]
      const api = globalThis.__milkupDesktopTest

      if (!api?.runDesktopLargeTextFileBenchmark) {
        done({ error: 'Desktop large text file benchmark API was not registered' })
        return
      }

      api
        .runDesktopLargeTextFileBenchmark(arguments[0])
        .then((value) => done({ value }))
        .catch((error) =>
          done({ error: error instanceof Error ? error.message : String(error) }),
        )
    `,
    filePath,
  )

  if (result?.error) {
    throw new Error(`Desktop large text file benchmark failed: ${result.error}`)
  }

  return result?.value ?? {}
}

async function waitForDriver() {
  const deadline = Date.now() + 10_000
  let lastError

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/status`)

      if (response.ok) {
        return
      }
    } catch (error) {
      lastError = error
    }

    await delay(200)
  }

  throw new Error(`Timed out waiting for tauri-driver: ${lastError}`)
}

async function createSession() {
  const response = await webdriverRequest('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'wry',
        'tauri:options': {
          application: appPath,
        },
      },
    },
  })
  const sessionId = response.sessionId ?? response.value?.sessionId

  if (!sessionId) {
    throw new Error(`WebDriver session id missing: ${JSON.stringify(response)}`)
  }

  await webdriverRequest('POST', `/session/${sessionId}/timeouts`, {
    script: 15 * 60 * 1000,
  })

  return {
    id: sessionId,
    async request(method, endpoint, body) {
      return webdriverRequest(method, `/session/${sessionId}${endpoint}`, body)
    },
    async delete() {
      return webdriverRequest('DELETE', `/session/${sessionId}`)
    },
  }
}

async function waitForText(selector, expected) {
  const deadline = Date.now() + 5_000
  let actual = ''

  while (Date.now() < deadline) {
    actual = await getText(selector)

    if (actual === expected) {
      return
    }

    await delay(100)
  }

  throw new Error(
    `Expected ${selector} text ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  )
}

async function getText(selector) {
  const value = await execute(
    `
      const element = document.querySelector(arguments[0])

      if (!element) {
        return ''
      }

      return element.textContent
    `,
    selector,
  )

  return String(value ?? '').trim()
}

async function execute(script, ...args) {
  const response = await session.request('POST', '/execute/sync', {
    script,
    args,
  })

  return response.value
}

async function executeAsync(script, ...args) {
  const response = await session.request('POST', '/execute/async', {
    script,
    args,
  })

  return response.value
}

async function webdriverRequest(method, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const payload = text.length > 0 ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(`WebDriver ${method} ${endpoint} failed: ${text}`)
  }

  return payload
}

function readDesktopProcessMemory() {
  if (platform() !== 'win32') {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '(Get-Process milkup-desktop -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1).WorkingSet64',
      ],
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }

        const bytes = Number(stdout.trim())
        resolve(Number.isFinite(bytes) ? bytes : null)
      },
    )
  })
}

async function readSourceSnapshot() {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', 'HEAD'], { cwd: rootDir }, (error, stdout) => {
      resolve(error ? 'not-a-git-repository' : stdout.trim())
    })
  })
}

async function collectProcessOutput(process) {
  await delay(100)
  return `tauri-driver exitCode=${process.exitCode ?? 'running'}\n${driverOutput}`
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/')
}

function round(value) {
  return Math.round(value * 100) / 100
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

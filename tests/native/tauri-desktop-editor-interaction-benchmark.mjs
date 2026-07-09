import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
const nativeDriverPath = await resolveNativeDriverPath()
const port = Number(process.env.TAURI_DRIVER_PORT ?? '4455')
const nativePort = Number(process.env.TAURI_NATIVE_DRIVER_PORT ?? '9535')
const baseUrl = `http://127.0.0.1:${port}`
const keepFixture = process.env.MILKUP_DESKTOP_INTERACTION_BENCHMARK_KEEP === '1'
const reportPath = process.env.MILKUP_DESKTOP_INTERACTION_BENCHMARK_REPORT
const targetNames = new Set(
  (process.env.MILKUP_DESKTOP_INTERACTION_BENCHMARK_TARGETS ?? 'coding-plan,10mib,100mib')
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean),
)

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

const workDir = path.join(tmpdir(), `milkup-desktop-interaction-${process.pid}-${Date.now()}`)

await mkdir(workDir, { recursive: true })

let driver
let session
let driverOutput = ''

try {
  const fixtures = await prepareFixtures()
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
  const runs = []

  for (const fixture of fixtures) {
    const startedAt = performance.now()
    const before = await describeFile(fixture.path)
    const benchmark = await runEditorInteractionBenchmark(normalizePath(fixture.path))
    const after = await describeFile(fixture.path)
    const markerVerification =
      fixture.expectFlushMarker === true
        ? await fileContains(fixture.path, '<!-- benchmark-visible-edit -->')
        : null

    runs.push({
      target: fixture.name,
      description: fixture.description,
      expectedPath: fixture.expectedPath,
      fixture: {
        path: fixture.path,
        retained: fixture.retained,
        generated: fixture.generated,
        sizeBytesBeforeRun: before.sizeBytes,
        sha256BeforeRun: before.sha256,
        sizeBytesAfterRun: after.sizeBytes,
        sha256AfterRun: after.sha256,
      },
      benchmark,
      verification: {
        ranInsideDesktopWebView: true,
        activePathMatchedFixture:
          normalizeBenchmarkPath(benchmark?.afterOpen?.path) === normalizePath(fixture.path),
        usedExpectedScaleMode: fixture.expectedScaleModes.includes(
          String(benchmark?.afterOpen?.scaleMode ?? ''),
        ),
        renderedLineCount: Number(benchmark?.afterInteractions?.renderedLineCount ?? 0),
        hasClickToCursorMetric: isFinitePositive(benchmark?.timings?.clickToCursorMs),
        flushMarkerPresent: markerVerification,
      },
      wallTimeMs: round(performance.now() - startedAt),
    })
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sourceSnapshot: await readSourceSnapshot(),
    implementation: {
      mode: 'desktop-editor-policy-source-backed-working-temp',
      expectedDesktopApi: 'globalThis.__milkupDesktopTest.runDesktopEditorInteractionBenchmark',
      expectedPaths: [
        'normal/incremental: desktop EditorView over memory document',
        'large/ultra-large: desktop SourceDocumentView over LargeDocumentSource',
      ],
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
      desktopProcessMemory: await readDesktopProcessMemory(),
    },
    runs,
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, serialized, 'utf8')
  }

  console.log(serialized)

  const failed = runs.filter(
    (run) =>
      !run.verification.activePathMatchedFixture ||
      !run.verification.usedExpectedScaleMode ||
      run.verification.renderedLineCount <= 0 ||
      !run.verification.hasClickToCursorMetric ||
      run.verification.flushMarkerPresent === false,
  )

  if (failed.length > 0) {
    throw new Error(
      `Desktop editor interaction benchmark verification failed for: ${failed
        .map((run) => run.target)
        .join(', ')}`,
    )
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

async function prepareFixtures() {
  const fixtures = []

  if (targetNames.has('coding-plan')) {
    fixtures.push({
      name: 'coding-plan',
      description: '175 KB real plan file interactive report',
      path: path.join(rootDir, 'docs', 'coding-plan.md'),
      retained: true,
      generated: false,
      expectedPath: 'normal memory EditorView',
      expectedScaleModes: ['normal'],
      expectFlushMarker: false,
    })
  }

  if (targetNames.has('10mib')) {
    const fixturePath = path.join(workDir, 'desktop-interaction-10mib.md')

    await generateSyntheticMarkdown(fixturePath, 10 * MIB)
    fixtures.push({
      name: '10mib',
      description: '10 MiB desktop memory/virtual renderer report',
      path: fixturePath,
      retained: keepFixture,
      generated: true,
      expectedPath: 'memory virtual/incremental desktop editor path',
      expectedScaleModes: ['incremental', 'large'],
      expectFlushMarker: false,
    })
  }

  if (targetNames.has('100mib')) {
    const fixturePath = path.join(workDir, 'desktop-interaction-100mib.md')

    await generateSyntheticMarkdown(fixturePath, 100 * MIB)
    fixtures.push({
      name: '100mib',
      description: '100 MiB desktop large-mode source-backed report',
      path: fixturePath,
      retained: keepFixture,
      generated: true,
      expectedPath: 'large native SourceDocumentView path',
      expectedScaleModes: ['large', 'ultra-large'],
      expectFlushMarker: true,
    })
  }

  return fixtures
}

async function generateSyntheticMarkdown(filePath, targetBytes) {
  const stream = createWriteStream(filePath, { encoding: 'utf8' })
  let batch = ''
  let batchBytes = 0
  let bytes = 0
  let index = 0

  bytes += await writeStream(stream, '# Desktop Editor Interaction Benchmark\n\n')

  while (bytes < targetBytes) {
    const line =
      index % 256 === 0
        ? `\n## Section ${index}\n\nmarker heading ${index}\n\n`
        : `- marker repeated item ${String(index).padStart(9, '0')}: **bold** [link](./target.md)\n`
    const remaining = targetBytes - bytes
    const next = Buffer.byteLength(line) <= remaining ? line : 'x'.repeat(remaining)
    const nextBytes = Buffer.byteLength(next)

    batch += next
    batchBytes += nextBytes
    bytes += nextBytes

    if (batchBytes >= GENERATE_BATCH_BYTES || bytes >= targetBytes) {
      await writeStream(stream, batch)
      batch = ''
      batchBytes = 0
    }

    index += 1
  }

  await closeStream(stream)
}

function writeStream(stream, text) {
  return new Promise((resolve, reject) => {
    stream.write(text, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve(Buffer.byteLength(text))
    })
  })
}

function closeStream(stream) {
  return new Promise((resolve, reject) => {
    stream.end((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

async function runEditorInteractionBenchmark(filePath) {
  const result = await executeAsync(
    `
      const done = arguments[arguments.length - 1]
      const api = globalThis.__milkupDesktopTest

      if (!api?.runDesktopEditorInteractionBenchmark) {
        done({ error: 'Desktop editor interaction benchmark API was not registered' })
        return
      }

      api
        .runDesktopEditorInteractionBenchmark(arguments[0])
        .then((value) => done({ value }))
        .catch((error) =>
          done({ error: error instanceof Error ? error.message : String(error) }),
        )
    `,
    filePath,
  )

  if (result?.error) {
    throw new Error(`Desktop editor interaction benchmark failed: ${result.error}`)
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

async function describeFile(filePath) {
  const [fileStat, sha256] = await Promise.all([stat(filePath), hashFile(filePath)])

  return {
    sizeBytes: fileStat.size,
    sha256,
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    const hash = createHash('sha256')

    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function fileContains(filePath, expected) {
  const text = await readFile(filePath, 'utf8')

  return text.includes(expected)
}

async function collectProcessOutput(process) {
  await delay(100)
  return `tauri-driver exitCode=${process.exitCode ?? 'running'}\n${driverOutput}`
}

function normalizeBenchmarkPath(value) {
  return value === undefined ? undefined : normalizePath(String(value))
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/')
}

function round(value) {
  return Math.round(value * 100) / 100
}

function isFinitePositive(value) {
  const number = Number(value)

  return Number.isFinite(number) && number >= 0
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function resolveNativeDriverPath() {
  if (process.env.TAURI_NATIVE_DRIVER) {
    return process.env.TAURI_NATIVE_DRIVER
  }

  const pathDriver = findExecutableOnPath('msedgedriver.exe')

  if (pathDriver) {
    return pathDriver
  }

  const version = await findInstalledWebView2Version()

  if (!version) {
    return undefined
  }

  return downloadEdgeDriver(version)
}

function findExecutableOnPath(name) {
  const entries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)

  for (const entry of entries) {
    const candidate = path.join(entry, name)

    if (existsSync(candidate)) {
      return candidate
    }
  }

  return undefined
}

async function findInstalledWebView2Version() {
  const roots = [
    path.join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft', 'EdgeWebView', 'Application'),
    path.join(process.env.ProgramFiles ?? '', 'Microsoft', 'EdgeWebView', 'Application'),
  ].filter((root) => root && existsSync(root))
  const versions = []

  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name)) {
        versions.push(entry.name)
      }
    }
  }

  return versions.sort(compareVersion).at(-1)
}

function compareVersion(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)

    if (delta !== 0) {
      return delta
    }
  }

  return 0
}

async function downloadEdgeDriver(version) {
  const driverRoot = path.join(rootDir, '.tmp', `msedgedriver-${version}`)
  const driverExe = path.join(driverRoot, 'msedgedriver.exe')

  if (existsSync(driverExe)) {
    return driverExe
  }

  await mkdir(driverRoot, { recursive: true })

  const zipPath = path.join(driverRoot, 'edgedriver_win64.zip')
  const response = await fetch(`https://msedgedriver.microsoft.com/${version}/edgedriver_win64.zip`)

  if (!response.ok) {
    throw new Error(
      `Failed to download msedgedriver ${version}: ${response.status} ${response.statusText}`,
    )
  }

  const bytes = Buffer.from(await response.arrayBuffer())

  if (bytes.length < 1024) {
    throw new Error(`Downloaded msedgedriver ${version} archive is unexpectedly small`)
  }

  await writeFile(zipPath, bytes)
  await expandZip(zipPath, driverRoot)

  if (!existsSync(driverExe)) {
    throw new Error(`msedgedriver.exe was not found after extracting ${zipPath}`)
  }

  return driverExe
}

async function expandZip(zipPath, destination) {
  await new Promise((resolve, reject) => {
    const powershell = spawn(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Expand-Archive -LiteralPath $env:MILKUP_EDGE_DRIVER_ZIP -DestinationPath $env:MILKUP_EDGE_DRIVER_DESTINATION -Force',
      ],
      {
        env: {
          ...process.env,
          MILKUP_EDGE_DRIVER_ZIP: zipPath,
          MILKUP_EDGE_DRIVER_DESTINATION: destination,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let output = ''

    powershell.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    powershell.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })
    powershell.on('error', reject)
    powershell.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Expand-Archive failed with code ${code}: ${output}`))
    })
  })
}

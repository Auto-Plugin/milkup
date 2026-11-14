import { spawn } from 'node:child_process'
import { mkdir, readdir, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

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
const port = Number(process.env.TAURI_DRIVER_PORT ?? '4444')
const nativePort = Number(process.env.TAURI_NATIVE_DRIVER_PORT ?? '9515')
const baseUrl = `http://127.0.0.1:${port}`

if (!existsSync(appPath)) {
  throw new Error(`Tauri debug binary was not found at ${appPath}`)
}

if (!existsSync(driverPath)) {
  throw new Error(`tauri-driver was not found at ${driverPath}`)
}

const workDir = path.join(tmpdir(), `milkup-native-smoke-${process.pid}-${Date.now()}`)
const openPath = path.join(workDir, 'open.md')
const saveAsPath = path.join(workDir, 'saved-as.md')
const assetPath = path.join(workDir, 'assets', 'native-diagram.png')
const pluginPath = path.join(workDir, 'plugin-fixture.md')
const sidecarPath = path.join(workDir, 'sidecar-fixture.mjs')

await mkdir(workDir, { recursive: true })
await writeFile(openPath, '# Native\r\n\r\nalpha\r\n', 'utf8')
await writeFile(pluginPath, 'worker file content', 'utf8')
await writeFile(sidecarPath, createSidecarFixtureSource(), 'utf8')

let driver
let session
let driverOutput = ''

try {
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
  await execute(
    `localStorage.setItem('milkup.desktop.nativeTestPaths', arguments[0])`,
    JSON.stringify({
      open: normalizePath(openPath),
      saveAs: normalizePath(saveAsPath),
    }),
  )

  await focusEditor()
  await sendPrimaryShortcut('o')
  await waitForText('[data-stat="path"]', normalizePath(openPath))
  await expectText('[data-stat="document-id"]', `file:${normalizePath(openPath)}`)
  await expectText('[data-stat="line-ending"]', 'crlf')

  await pasteImageFile()
  await waitForEditorText('![native-diagram](assets/native-diagram.png)')
  await waitForFileBytes(assetPath, [1, 2, 3, 4])

  const pluginResult = await runDesktopWorkerFilePlugin(normalizePath(pluginPath))
  const pluginValue = pluginResult.value ?? {}

  if (pluginResult.ok !== true || pluginValue.read !== 'worker file content') {
    throw new Error(`Unexpected desktop worker plugin read result: ${JSON.stringify(pluginResult)}`)
  }

  await waitForEditorText('worker file content')
  await expectFileContains(pluginPath, 'worker-brokered')

  const sidecarResult = await runDesktopSidecarPlugin(process.execPath, [sidecarPath])
  const sidecarValue = sidecarResult.value ?? {}

  if (
    sidecarResult.ok !== true ||
    sidecarValue.inserted !== 'native sidecar content' ||
    typeof sidecarValue.pid !== 'number'
  ) {
    throw new Error(`Unexpected desktop sidecar plugin result: ${JSON.stringify(sidecarResult)}`)
  }

  await waitForEditorText('native sidecar content')
  await waitForProcessExit(sidecarValue.pid)

  await focusEditor()
  await sendKeys(' native-save')
  await sendPrimaryShortcut('s')
  await waitForText('[data-session-state]', '已保存', { contains: true })
  await expectFileContains(openPath, ' native-save')
  await delay(1_300)
  await expectText('[data-stat="external"]', 'none')

  await focusEditor()
  await sendKeys(' as-copy')
  await sendPrimaryShortcut('s', { shift: true })
  await waitForText('[data-stat="path"]', normalizePath(saveAsPath))
  await expectFileContains(saveAsPath, ' native-save as-copy')

  await clickButton('在文件夹中显示')
  await waitForText('[data-stat="notice"]', `已在文件夹中显示：${normalizePath(saveAsPath)}`)

  await writeFile(saveAsPath, '# Native\r\n\r\nexternal update\r\n', 'utf8')
  await waitForText('[data-stat="external"]', 'modified-clean', { timeoutMs: 6_000 })
  await clickButton('重新载入外部更改')
  await waitForText('[data-stat="notice"]', '已重新载入外部更改')
  await expectText('[data-stat="document-id"]', `file:${normalizePath(openPath)}`)
  await expectText('[data-stat="path"]', normalizePath(saveAsPath))
  await expectEditorText('external update')

  await rm(saveAsPath)
  await waitForText('[data-stat="external"]', 'deleted-clean', { timeoutMs: 6_000 })

  await writeFile(openPath, '# Native\r\n\r\nconflict base\r\n', 'utf8')
  await clickButton('打开')
  await waitForText('[data-stat="path"]', normalizePath(openPath))
  await focusEditor()
  await sendKeys(' local dirty')
  await waitForText('[data-session-state]', '有未保存更改', { contains: true })
  await writeFile(openPath, '# Native\r\n\r\nexternal conflict\r\n', 'utf8')
  await waitForText('[data-stat="external"]', 'conflict', { timeoutMs: 6_000 })
  await clickButton('保存')
  await waitForText('[data-stat="notice"]', '文件已在编辑器外发生变化。', {
    contains: true,
  })
  await expectFileContains(openPath, 'external conflict')

  await runImeCompositionFixture()
  await runShortcutFixture()

  console.log('Native Tauri WebDriver smoke passed')
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

  await rm(workDir, { recursive: true, force: true })
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

async function clickButton(name) {
  await execute(
    `
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent.trim() === arguments[0],
      )

      if (!button) {
        throw new Error('Button not found: ' + arguments[0])
      }

      button.click()
    `,
    name,
  )
}

async function focusEditor() {
  await execute(
    `
      const input = document.querySelector('.milkup-input-proxy')

      if (!input) {
        throw new Error('Editor input proxy was not found')
      }

      input.focus()
    `,
  )
}

async function sendKeys(text) {
  await session.request('POST', '/actions', {
    actions: [
      {
        type: 'key',
        id: 'keyboard',
        actions: [...text].flatMap((value) => [
          { type: 'keyDown', value },
          { type: 'keyUp', value },
        ]),
      },
    ],
  })
}

async function sendPrimaryShortcut(key, options = {}) {
  const keys = ['\uE009']

  if (options.shift) {
    keys.push('\uE008')
  }

  await session.request('POST', '/actions', {
    actions: [
      {
        type: 'key',
        id: 'keyboard',
        actions: [
          ...keys.map((value) => ({ type: 'keyDown', value })),
          { type: 'keyDown', value: key },
          { type: 'keyUp', value: key },
          ...keys.reverse().map((value) => ({ type: 'keyUp', value })),
        ],
      },
    ],
  })
}

async function runShortcutFixture() {
  await focusEditor()
  await sendPrimaryShortcut('n')
  await waitForText('[data-stat="notice"]', '已新建文档')
  await expectText('[data-stat="path"]', '未保存')

  await focusEditor()
  await sendKeys(' native-shortcut')
  await waitForEditorText('native-shortcut')

  await sendPrimaryShortcut('z')
  await waitForEditorTextNotContaining('native-shortcut')

  await sendPrimaryShortcut('y')
  await waitForEditorText('native-shortcut')

  await sendPrimaryShortcut('2')
  await waitForAttribute('.milkup-editor', 'data-mode', 'live')
  await sendPrimaryShortcut('3')
  await waitForAttribute('.milkup-editor', 'data-mode', 'preview')
  await sendPrimaryShortcut('1')
  await waitForAttribute('.milkup-editor', 'data-mode', 'source')

  await sendPrimaryShortcut('a')
  await captureNextCopyText()
  await sendPrimaryShortcut('c')
  await waitForCapturedCopyText('native-shortcut')
  await setWebViewClipboardText(' native-paste')
  await focusEditor()
  await delay(100)
  await sendPrimaryShortcut('v')
  await pastePlainTextIfNeeded(' native-paste')
  await waitForEditorText('native-paste')
  await sendPrimaryShortcut('a')
  await delay(100)
  const cutText = await cutEditorSelection()

  if (!cutText.includes('native-paste')) {
    throw new Error(`Expected cut text to contain shortcut fixture, got ${JSON.stringify(cutText)}`)
  }

  await waitForEditorTextNotContaining('native-paste')
  await waitForText('[data-session-state]', '有未保存更改', { contains: true })

  await sendPrimaryShortcut('w')
  await waitForText('[data-stat="notice"]', '无法关闭', { contains: true })

  await sendPrimaryShortcut('s')
  await waitForText('[data-session-state]', '已保存', { contains: true })
  await sendPrimaryShortcut('w')
  await waitForText('[data-stat="notice"]', '已关闭文档')
}

async function runImeCompositionFixture() {
  await focusEditor()
  await sendPrimaryShortcut('n')
  await waitForText('[data-stat="notice"]', '已新建文档')
  await expectText('[data-stat="path"]', '未保存')
  await waitForAttribute('.milkup-editor', 'data-mode', 'source')

  await dispatchCompositionEvent('compositionstart', '')
  await dispatchCompositionEvent('compositionupdate', 'zhongwen')
  await waitForEditorTextNotContaining('zhongwen')
  await dispatchCompositionEvent('compositionend', '中文输入，test。')
  await waitForEditorText('中文输入，test。')
  await expectEditorTextOccurrences('中文输入，test。', 1)

  await sendPrimaryShortcut('z')
  await waitForEditorTextNotContaining('中文输入，test。')

  await sendKeys('- **bold** marker ')
  await waitForEditorText('bold')
  await sendPrimaryShortcut('2')
  await waitForAttribute('.milkup-editor', 'data-mode', 'live')

  await dispatchCompositionEvent('compositionstart', '')
  await dispatchCompositionEvent('compositionupdate', 'liebiao')
  await waitForEditorTextNotContaining('liebiao')
  await dispatchCompositionEvent('compositionend', '列表中文')
  await waitForEditorText('列表中文')
  await expectEditorTextOccurrences('列表中文', 1)

  await sendPrimaryShortcut('3')
  await waitForAttribute('.milkup-editor', 'data-mode', 'preview')
  await waitForEditorText('列表中文')
  await sendPrimaryShortcut('1')
  await waitForAttribute('.milkup-editor', 'data-mode', 'source')
  await waitForEditorText('列表中文')
  await sendPrimaryShortcut('2')
  await waitForAttribute('.milkup-editor', 'data-mode', 'live')
  await waitForEditorText('列表中文')
}

async function dispatchCompositionEvent(type, data) {
  await execute(
    `
      const input = document.querySelector('.milkup-input-proxy')

      if (!input) {
        throw new Error('Editor input proxy was not found')
      }

      input.focus()
      input.dispatchEvent(
        new CompositionEvent(arguments[0], {
          data: arguments[1],
          bubbles: true,
          cancelable: true,
        }),
      )
    `,
    type,
    data,
  )
}

async function captureNextCopyText() {
  await execute(
    `
      const input = document.querySelector('.milkup-input-proxy')

      if (!input) {
        throw new Error('Editor input proxy was not found')
      }

      globalThis.__milkupNativeShortcutCopyText = ''
      input.addEventListener(
        'copy',
        (event) => {
          globalThis.__milkupNativeShortcutCopyText =
            event.clipboardData?.getData('text/plain') ?? ''
        },
        { once: true },
      )
    `,
  )
}

async function waitForCapturedCopyText(expected, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000)
  let actual = ''

  while (Date.now() < deadline) {
    actual = String((await execute(`return globalThis.__milkupNativeShortcutCopyText ?? ''`)) ?? '')

    if (actual.includes(expected)) {
      return
    }

    await delay(100)
  }

  throw new Error(
    `Expected Ctrl+C copy event to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  )
}

async function setWebViewClipboardText(text) {
  const result = await executeAsync(
    `
      const done = arguments[arguments.length - 1]

      navigator.clipboard
        ?.writeText(arguments[0])
        .then(() => done({ ok: true }))
        .catch((error) =>
          done({ ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
    `,
    text,
  )

  if (!result?.ok) {
    throw new Error(`Unable to seed WebView clipboard for Ctrl+V: ${result?.error ?? 'unknown'}`)
  }
}

async function pastePlainTextIfNeeded(text) {
  const editorText = await getText('.milkup-editor-content')

  if (editorText.includes(text.trim())) {
    return
  }

  await execute(
    `
      const input = document.querySelector('.milkup-input-proxy')

      if (!input) {
        throw new Error('Editor input proxy was not found')
      }

      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', arguments[0])
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
      })

      Object.defineProperty(event, 'clipboardData', {
        value: clipboardData,
      })
      input.dispatchEvent(event)
    `,
    text,
  )
}

async function pasteImageFile() {
  await execute(
    `
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(
        new File([new Uint8Array([1, 2, 3, 4])], 'Native Diagram.PNG', {
          type: 'image/png',
        }),
      )

      const input = document.querySelector('.milkup-input-proxy')

      if (!input) {
        throw new Error('Editor input proxy was not found')
      }

      input.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true,
        }),
      )
    `,
  )
}

async function runDesktopWorkerFilePlugin(filePath) {
  const result = await executeAsync(
    `
      const done = arguments[arguments.length - 1]
      const api = globalThis.__milkupDesktopTest

      if (!api?.runDesktopWorkerFilePluginFixture) {
        done({ error: 'Desktop test plugin API was not registered' })
        return
      }

      api
        .runDesktopWorkerFilePluginFixture(arguments[0])
        .then((value) => done({ value }))
        .catch((error) =>
          done({ error: error instanceof Error ? error.message : String(error) }),
        )
    `,
    filePath,
  )

  if (result?.error) {
    throw new Error(`Desktop worker file plugin failed: ${result.error}`)
  }

  return result?.value ?? {}
}

async function runDesktopSidecarPlugin(executable, args) {
  const result = await executeAsync(
    `
      const done = arguments[arguments.length - 1]
      const api = globalThis.__milkupDesktopTest

      if (!api?.runDesktopSidecarPluginFixture) {
        done({ error: 'Desktop sidecar plugin API was not registered' })
        return
      }

      api
        .runDesktopSidecarPluginFixture(arguments[0], arguments[1])
        .then((value) => done({ value }))
        .catch((error) =>
          done({ error: error instanceof Error ? error.message : String(error) }),
        )
    `,
    executable,
    args,
  )

  if (result?.error) {
    throw new Error(`Desktop sidecar plugin failed: ${result.error}`)
  }

  return result?.value ?? {}
}

async function waitForText(selector, expected, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000)
  let actual = ''

  while (Date.now() < deadline) {
    actual = await getText(selector)

    if (options.contains ? actual.includes(expected) : actual === expected) {
      return
    }

    await delay(100)
  }

  throw new Error(
    `Expected ${selector} text ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  )
}

async function expectText(selector, expected) {
  const actual = await getText(selector)

  if (actual !== expected) {
    throw new Error(
      `Expected ${selector} text ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

async function expectEditorText(expected) {
  const text = await getText('.milkup-editor-content')

  if (!text.includes(expected)) {
    throw new Error(
      `Expected editor to contain ${JSON.stringify(expected)}, got ${JSON.stringify(text)}`,
    )
  }
}

async function waitForEditorText(expected, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000)
  let text = ''

  while (Date.now() < deadline) {
    text = await getText('.milkup-editor-content')

    if (text.includes(expected)) {
      return
    }

    await delay(100)
  }

  throw new Error(
    `Expected editor to contain ${JSON.stringify(expected)}, got ${JSON.stringify(text)}`,
  )
}

async function waitForEditorTextNotContaining(unexpected, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000)
  let text = ''

  while (Date.now() < deadline) {
    text = await getText('.milkup-editor-content')

    if (!text.includes(unexpected)) {
      return
    }

    await delay(100)
  }

  throw new Error(
    `Expected editor not to contain ${JSON.stringify(unexpected)}, got ${JSON.stringify(text)}`,
  )
}

async function expectEditorTextOccurrences(expected, count) {
  const text = await getText('.milkup-editor-content')
  const actual = text.split(expected).length - 1

  if (actual !== count) {
    throw new Error(
      `Expected editor to contain ${JSON.stringify(expected)} ${count} time(s), got ${actual} in ${JSON.stringify(text)}`,
    )
  }
}

async function waitForAttribute(selector, name, expected, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000)
  let actual = ''

  while (Date.now() < deadline) {
    actual = await getAttribute(selector, name)

    if (actual === expected) {
      return
    }

    await delay(100)
  }

  throw new Error(
    `Expected ${selector} attribute ${name} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  )
}

async function expectFileContains(filePath, expected) {
  const text = await readFile(filePath, 'utf8')

  if (!text.includes(expected)) {
    throw new Error(
      `Expected ${filePath} to contain ${JSON.stringify(expected)}, got ${JSON.stringify(text)}`,
    )
  }
}

async function waitForFileBytes(filePath, expected, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000)
  let bytes = []

  while (Date.now() < deadline) {
    try {
      bytes = [...(await readFile(filePath))]

      if (JSON.stringify(bytes) === JSON.stringify(expected)) {
        return
      }
    } catch {
      bytes = []
    }

    await delay(100)
  }

  throw new Error(
    `Expected ${filePath} bytes ${JSON.stringify(expected)}, got ${JSON.stringify(bytes)}`,
  )
}

async function waitForProcessExit(pid, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000)

  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return
    }

    await delay(100)
  }

  throw new Error(`Expected sidecar process ${pid} to exit`)
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function cutEditorSelection() {
  const value = await execute(
    `
      const input = document.querySelector('.milkup-input-proxy')

      if (!input) {
        throw new Error('Editor input proxy was not found')
      }

      const clipboardData = new DataTransfer()
      const event = new ClipboardEvent('cut', {
        bubbles: true,
        cancelable: true,
      })

      Object.defineProperty(event, 'clipboardData', {
        value: clipboardData,
      })
      input.dispatchEvent(event)

      return clipboardData.getData('text/plain')
    `,
  )

  return String(value ?? '')
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

async function getAttribute(selector, name) {
  const value = await execute(
    `
      const element = document.querySelector(arguments[0])

      if (!element) {
        return ''
      }

      return element.getAttribute(arguments[1]) ?? ''
    `,
    selector,
    name,
  )

  return String(value ?? '')
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

async function collectProcessOutput(process) {
  await delay(100)
  return `tauri-driver exitCode=${process.exitCode ?? 'running'}\n${driverOutput}`
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/')
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
        'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
        zipPath,
        destination,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
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

function createSidecarFixtureSource() {
  return `
import readline from 'node:readline'

const protocol = 'milkup.plugin.isolation.rpc.v1'
const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

input.on('line', (line) => {
  if (!line.trim()) {
    return
  }

  const request = JSON.parse(line)

  if (request.protocol !== protocol || request.type !== 'request') {
    return
  }

  try {
    respond(request.id, true, handleRequest(request.method, request.payload))
  } catch (error) {
    respond(request.id, false, undefined, {
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

function handleRequest(method, payload) {
  if (method === 'activate') {
    return {
      commands: ['desktopSidecar.insertText'],
    }
  }

  if (method === 'runCommand') {
    const text = String(payload?.input?.text ?? '')
    const position = payload?.selection?.anchor ?? 0
    const insert = '\\n' + text

    return {
      value: {
        inserted: text,
        pid: process.pid,
        pluginId: payload?.pluginId,
      },
      transactions: [
        {
          changes: [{ from: position, to: position, insert }],
          selection: { anchor: position + insert.length },
        },
      ],
    }
  }

  if (method === 'deactivate' || method === 'dispose') {
    return undefined
  }

  if (method === 'render') {
    return undefined
  }

  throw new Error('Unknown sidecar method: ' + method)
}

function respond(id, ok, value, error) {
  process.stdout.write(
    JSON.stringify({
      protocol,
      type: 'response',
      id,
      ok,
      ...(value !== undefined ? { value } : {}),
      ...(error ? { error } : {}),
    }) + '\\n',
  )
}
`
}

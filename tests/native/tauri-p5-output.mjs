// P5 production acceptance. Reuses the P4 native harness; never dispatches private IPC.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { nativeFixture, action, writeLogoFixture, x } from '../helpers/native-updates-fixture.mjs'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const output = path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR || '')
assert(process.env.MILKUP_NATIVE_EVIDENCE_DIR, 'Set a fresh P5 evidence directory')
assert(process.env.MILKUP_P5_ARCHIVE, 'Supply an independent output plugin archive')
const archive = await realpath(process.env.MILKUP_P5_ARCHIVE)
const archiveBytes = await readFile(archive)
assert.equal(hash(archiveBytes), process.env.MILKUP_P5_ARCHIVE_SHA256, 'Reviewed archive hash')
const bundle = JSON.parse(archiveBytes)
assert.equal(bundle.manifest.id, 'milkup.export-print')
assert.equal(bundle.manifest.version, '1.0.0')
assert.equal(bundle.manifest.engines.pluginSdk, '^0.3.5')
assert.deepEqual(bundle.manifest.permissions, ['document:read', 'document:output'])
assert(!archive.startsWith(path.resolve('plugins') + path.sep), 'Use the independent build')
const stage = process.env.MILKUP_P5_STAGE || 'html'
assert(
  [
    'html',
    'pdf',
    'cancel',
    'selection',
    'disable',
    'print-cancel',
    'print-file',
    'overwrite',
    'large',
  ].includes(stage),
)
await mkdir(output, { recursive: true })
const fixture = await readFile(
  new URL('../fixtures/p5-output/rich-document.md', import.meta.url),
  'utf8',
)
const source =
  stage === 'pdf' || stage === 'print-file'
    ? fixture +
      '\n\n' +
      Array.from(
        { length: 100 },
        (_, i) =>
          `第 ${i + 1} 段分页检查 P5-PAGE-${i + 1}：中文排版、表格与代码之后的正文需要保持可读。\n\n`,
      ).join('')
    : stage === 'large'
      ? fixture + '\n\n大文档中文行 P5-LARGE-LINE\n'.repeat(60000)
      : fixture
const sourcePath = path.join(output, 'source.md')
await writeFile(sourcePath, source, { flag: 'wx' })
await writeLogoFixture(output)
const originalHash = hash(Buffer.from(source))
const plan = {
  preparedOnly: process.argv.includes('--preflight'),
  stage,
  sourcePath,
  sourceSha256: originalHash,
  archive,
  archiveSha256: hash(archiveBytes),
  manifest: bundle.manifest,
  cases: [
    'html offline with images',
    'html omitted images',
    'actual A4 and Letter PDF',
    'native print-to-file PDF',
    'chooser and print cancellation',
    'source overwrite refusal',
    'existing output overwrite refusal/confirmation',
    'selection and captured version',
    'disabled plugin edit/undo/save',
    'large file',
  ],
  limitations: [
    'Snapshots of GTK dialogs do not prove PDF output quality.',
    'Modal chooser prevents foreground edits while open; capture/edit race remains separately covered by host/controller tests.',
    'Formula/Mermaid rendering and pagination need inspection of actual output, not marker presence.',
  ],
}
await writeFile(path.join(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
if (process.argv.includes('--preflight')) {
  console.log('PREPARED P5 fixture and plan; no native application or driver started')
  process.exit(0)
}
assert.equal(
  process.env.MILKUP_P5_BINARY_CONFIRMED,
  '1',
  'Wait for Root-confirmed integrated Linux build',
)
assert(process.env.TAURI_APP_PATH && process.env.TAURI_DRIVER_URL && process.env.DISPLAY)
assert.equal(process.env.MILKUP_NATIVE_EXCLUSIVE_DISPLAY, '1')
assert(process.env.MILKUP_NATIVE_PROFILE_ROOT, 'Use a disposable native profile')
for (const key of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'])
  assert(
    process.env[key]?.startsWith(process.env.MILKUP_NATIVE_PROFILE_ROOT + '/'),
    `${key} is outside the test profile`,
  )
const binary = await realpath(process.env.TAURI_APP_PATH)
assert(!binary.includes('/target/'), 'Use a frozen binary copy')
assert.equal(hash(await readFile(binary)), process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      ...plan,
      preparedOnly: false,
      binary,
      binarySha256: process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256,
      display: process.env.DISPLAY,
      driver: process.env.TAURI_DRIVER_URL,
      profile: process.env.MILKUP_NATIVE_PROFILE_ROOT,
      sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    },
    null,
    2,
  ) + '\n',
)

const id = 'milkup.export-print',
  panel = '[data-plugin-ui="milkup.export-print:export-print-panel"]'
let app
const ui = nativeFixture(() => app),
  results = []
const panelText = () =>
  app.execute('return document.querySelector(arguments[0])?.textContent || ""', panel)
async function record(name, extra = {}) {
  assert.equal(hash(await readFile(sourcePath)), originalHash, 'Source file unchanged')
  results.push({
    name,
    at: new Date().toISOString(),
    sourceSha256: originalHash,
    document: await app.probe(),
    panel: await panelText(),
    ...extra,
  })
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  await app.shot(name)
  console.log('PASS ' + name)
}
const visibleWindow = (title) => {
  try {
    return x('search', '--onlyvisible', '--name', '^' + title + '$')
      .split('\n')
      .at(-1)
  } catch {
    return null
  }
}
async function waitDialog(title) {
  const window = await app.until(() => visibleWindow(title), title, 45000)
  x('windowfocus', '--sync', window)
  await app.delay(500)
  return window
}
async function savePath(file) {
  const window = await waitDialog('Choose output destination')
  execFileSync('import', ['-window', window, path.join(output, 'save-dialog.png')])
  x('key', '--clearmodifiers', 'ctrl+l')
  await app.delay(150)
  x('key', '--clearmodifiers', 'ctrl+a')
  x('type', '--clearmodifiers', '--delay', '2', '--', file)
  x('key', '--clearmodifiers', 'Return')
  await app.delay(500)
  if (visibleWindow('Choose output destination')) x('key', '--clearmodifiers', 'alt+s')
  await app.until(() => !visibleWindow('Choose output destination'), 'output picker closed')
}
async function openPanel() {
  await ui.closeMenu()
  if (
    !(await app.execute(
      'return !!document.querySelector(arguments[0])?.getClientRects().length',
      panel,
    ))
  )
    await ui.click('[data-sidebar-toggle]')
  await ui.ready(panel)
  const start = `${panel} [data-plugin-command="export-print.start"]`
  if (
    !(await app.execute(
      'return !!document.querySelector(arguments[0])?.getClientRects().length',
      start,
    ))
  ) {
    const toggle = `${panel} .plugin-ui-panel-toggle`
    assert(await ui.exists(toggle), 'Expand the ordinary sidebar contribution')
    await ui.click(toggle)
  }
}
async function setField(key, value) {
  const selector = `${panel} [data-plugin-field-control="${key}"]`
  await ui.ready(selector)
  await app.focus(selector)
  const options = await app.execute(
    'return [...document.querySelector(arguments[0]).options].map(o=>o.value)',
    selector,
  )
  const index = options.indexOf(value)
  assert(index >= 0)
  await app.key('Home')
  for (let i = 0; i < index; i++) await app.key('Down')
  await app.key('Tab')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(arguments[0])?.value===arguments[1]',
        selector,
        value,
      ),
    'field ' + key,
  )
}
async function startOutput() {
  const retry = `${panel} [data-plugin-command="export-print.retry"]`
  await ui.click(
    (await ui.exists(retry)) ? retry : `${panel} [data-plugin-command="export-print.start"]`,
  )
}
async function done() {
  await app.until(
    async () => {
      const text = await panelText()
      if (/未完成|未提供|权限已撤销|暂不支持/.test(text))
        throw Error('Visible output error: ' + text)
      return /已保存|已提交打印/.test(text)
    },
    'output committed',
    stage === 'large' ? 180000 : 90000,
  )
}
async function verifyHtml(file, includeImages = true, selection = false) {
  const bytes = await readFile(file),
    html = bytes.toString('utf8')
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /中文/)
  assert(!/<script\b|<iframe\b|\bon(?:load|error)\s*=/i.test(html))
  assert(
    !/(?:src|href)=["']https?:/i.test(html),
    'Offline artifact does not reference remote resources',
  )
  assert((await panelText()).includes('版本'), 'Captured version remains visible')
  if (selection) assert(!html.includes('P5-END-MARKER'))
  else {
    assert(
      /图片.*(省略|缺失|内嵌)|省略图片/.test(await panelText()),
      'Resource warnings remain visible',
    )
    for (const marker of [
      'P5-ORIGINAL-BODY',
      'P5-CODE-MARKER',
      'P5-FOOTNOTE-MARKER',
      'P5-END-MARKER',
    ])
      assert(html.includes(marker), marker)
    assert.match(html, /<table\b/)
    assert.match(html, /<pre\b/)
    assert.equal(/data:image\/png;base64,/.test(html), includeImages)
  }
  await record(path.basename(file), { file, sha256: hash(bytes), bytes: bytes.length })
}
async function verifyPdf(file, landscape) {
  const bytes = await readFile(file)
  assert(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
  assert(bytes.subarray(-1024).includes(Buffer.from('%%EOF')))
  const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' })
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
  await writeFile(file + '.info.txt', info)
  await writeFile(file + '.text.txt', text)
  const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1])
  assert(pages >= 2, 'Actual multipage PDF')
  assert.match(text, /中文/)
  assert(text.includes('P5-END-MARKER'))
  assert(text.includes('P5-CODE-MARKER'))
  const dims = /^Page size:\s+([\d.]+) x ([\d.]+)/m.exec(info)
  assert(dims)
  assert.equal(Number(dims[1]) > Number(dims[2]), landscape)
  execFileSync('pdftoppm', [
    '-f',
    '1',
    '-singlefile',
    '-scale-to',
    '1400',
    '-png',
    file,
    file + '-first',
  ])
  execFileSync('pdftoppm', [
    '-f',
    String(pages),
    '-singlefile',
    '-scale-to',
    '1400',
    '-png',
    file,
    file + '-last',
  ])
  await record(path.basename(file), {
    file,
    sha256: hash(bytes),
    bytes: bytes.length,
    pages,
    visualReview: 'pending actual first/last page and document review',
  })
}
async function install() {
  await ui.list()
  assert(!(await ui.exists(action('details', id))), 'Fresh profile expected')
  await ui.click('[data-plugin-action="install"]')
  await ui.picker(archive)
  await app.until(
    () =>
      app.execute(
        "return JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{\"records\":[]}').records.some(r=>r.manifest.id===arguments[0])",
        id,
      ),
    'plugin installed',
    30000,
  )
  await ui.details(id)
  await ui.ready(action('approve', id))
  await record('installed-unapproved')
  await ui.click(action('approve', id))
  await ui.click(action('enable', id))
  await ui.ready(action('disable', id))
  await openPanel()
  await record('approved-enabled-sidebar')
}
async function editor() {
  await ui.closeMenu()
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+1')
  await app.until(async () => (await app.probe()).mode === 'source', 'source mode')
}
try {
  app = await startProduction(sourcePath, output, { diagnostics: false })
  x('windowsize', ui.windowId(), '1280', '900')
  await install()
  if (stage === 'html' || stage === 'large') {
    const file = path.join(output, 'complete.html')
    await startOutput()
    await savePath(file)
    await done()
    await verifyHtml(file)
    if (stage === 'html') {
      await setField('resources', 'omit')
      const omitted = path.join(output, 'without-images.html')
      await startOutput()
      await savePath(omitted)
      await done()
      await verifyHtml(omitted, false)
    }
  } else if (stage === 'pdf') {
    await setField('format', 'pdf')
    for (const [paper, orientation] of [
      ['a4', 'portrait'],
      ['letter', 'landscape'],
    ]) {
      await setField('pageSize', paper)
      await setField('orientation', orientation)
      const file = path.join(output, `${paper}-${orientation}.pdf`)
      await startOutput()
      await savePath(file)
      await done()
      await verifyPdf(file, orientation === 'landscape')
    }
  } else if (stage === 'cancel') {
    await startOutput()
    await waitDialog('Choose output destination')
    x('key', '--clearmodifiers', 'Escape')
    await app.until(async () => (await panelText()).includes('已取消'), 'cancel displayed')
    await record('save-picker-cancelled')
    const file = path.join(output, 'retry.html')
    await startOutput()
    await savePath(file)
    await done()
    await verifyHtml(file)
  } else if (stage === 'selection') {
    await editor()
    await app.key('ctrl+Home')
    await app.key('shift+End')
    assert((await app.probe()).selection.length > 0)
    await setField('scope', 'selection')
    const file = path.join(output, 'selection.html')
    await startOutput()
    await savePath(file)
    await done()
    await verifyHtml(file, false, true)
    const captured = hash(await readFile(file))
    await editor()
    await app.key('ctrl+End')
    await app.text(' P5-LATER-EDIT')
    assert.equal(hash(await readFile(file)), captured, 'Previous captured output remains immutable')
    await app.until(async () => (await app.probe()).dirty, 'later edit applied')
    await setField('scope', 'document')
    const later = path.join(output, 'later-version.html')
    await startOutput()
    await savePath(later)
    await done()
    assert(
      (await readFile(later, 'utf8')).includes('P5-LATER-EDIT'),
      'Fresh capture includes later edit',
    )
    assert.equal(hash(await readFile(file)), captured, 'Older capture remains unchanged')
    await editor()
    await app.key('ctrl+z')
    await record('captured-selection-unchanged-after-edit-undo')
  } else if (stage === 'disable') {
    await ui.details(id)
    await ui.click(action('disable', id))
    await ui.ready(action('enable', id))
    await editor()
    await app.key('ctrl+End')
    await app.text(' P5-DISABLED-EDIT')
    await app.until(async () => (await app.probe()).dirty, 'disabled plugin still permits editing')
    await app.key('ctrl+z')
    await app.key('ctrl+s')
    await app.until(
      async () => !(await app.probe()).dirty,
      'normal save after disabled edit and undo',
    )
    await record('disabled-edit-undo-save')
  } else if (stage === 'overwrite') {
    await startOutput()
    await savePath(sourcePath)
    await app.until(
      async () => /未完成|无法|不能|拒绝|保护/.test(await panelText()),
      'source overwrite visibly rejected',
    )
    await record('source-overwrite-refused')
    const existing = path.join(output, 'existing.html')
    const original = Buffer.from('P5-EXISTING-OUTPUT-MUST-SURVIVE-CANCEL')
    await writeFile(existing, original)
    await startOutput()
    await savePath(existing)
    await app.delay(400)
    x('key', '--clearmodifiers', 'alt+n')
    await app.until(async () => (await panelText()).includes('已取消'), 'overwrite declined')
    assert.deepEqual(await readFile(existing), original)
    await record('existing-overwrite-declined')
    await startOutput()
    await savePath(existing)
    await app.delay(400)
    x('key', '--clearmodifiers', 'alt+y')
    await done()
    await verifyHtml(existing)
    const other = path.join(output, 'another-open.md'),
      otherText = '# Another open document P5-OPEN-PROTECTION\n'
    await writeFile(other, otherText)
    await ui.closeMenu()
    await app.key('ctrl+o')
    await ui.picker(other)
    await app.until(async () => (await app.probe()).path === other, 'another document opened')
    await startOutput()
    await savePath(sourcePath)
    await app.until(
      async () => /未完成|无法|不能|拒绝|保护/.test(await panelText()),
      'other open source protected',
    )
    assert.equal(await readFile(other, 'utf8'), otherText)
    await record('other-open-document-overwrite-refused')
  } else {
    await setField('format', 'print')
    await startOutput()
    const window = await waitDialog('Print document')
    execFileSync('import', ['-window', window, path.join(output, 'print-dialog.png')])
    if (stage === 'print-cancel') {
      x('key', '--clearmodifiers', 'Escape')
      await app.until(async () => (await panelText()).includes('已取消'), 'print cancellation')
      await record('native-print-cancelled')
    } else {
      // GTK's Print to File page exposes Name and Save in folder mnemonics.
      // Verify the real file after interaction; a screenshot never satisfies this case.
      x('key', '--clearmodifiers', 'Home')
      await app.delay(300)
      x('key', '--clearmodifiers', 'alt+n', 'ctrl+a')
      x('type', '--clearmodifiers', '--', path.join(output, 'printed.pdf'))
      x('key', '--clearmodifiers', 'alt+p')
      await done()
      await access(path.join(output, 'printed.pdf'))
      await verifyPdf(path.join(output, 'printed.pdf'), false)
    }
  }
  await writeFile(
    path.join(output, 'completion.json'),
    JSON.stringify(
      {
        stage,
        passed: true,
        checked: results.map((r) => r.name),
        visualReview: 'pending',
        sourceSha256: hash(await readFile(sourcePath)),
      },
      null,
      2,
    ) + '\n',
  )
} catch (error) {
  await writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({ stage, error: String(error), stack: error.stack, results }, null, 2) + '\n',
  )
  if (app) await app.shot('failure').catch(() => {})
  throw error
} finally {
  await app?.close()
}

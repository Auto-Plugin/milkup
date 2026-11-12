import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const hash = (b) => createHash('sha256').update(b).digest('hex')
export async function checkInstalledDocuments(ui, options) {
  const { document, output, pid, birth, image } = options
  assert(/^\d+$/.test(pid) && /^\d+$/.test(birth) && path.isAbsolute(image))
  const { execute, state, chord, typeText, until, actions } = ui
  async function click(selector) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const scroll = await execute(
        `const e=document.querySelector(arguments[0]);if(!e)return null;const r=e.getBoundingClientRect();let a=e.parentElement;while(a&&!(a.scrollHeight>a.clientHeight&&/auto|scroll/.test(getComputedStyle(a).overflowY)))a=a.parentElement;if(!a)return null;const v=a.getBoundingClientRect(),top=Math.max(v.top,0),bottom=Math.min(v.bottom,innerHeight);if(r.top>=top&&r.bottom<=bottom)return null;return {x:Math.round(Math.max(1,Math.min(innerWidth-2,(v.left+v.right)/2))),y:Math.round((top+bottom)/2),deltaY:Math.round(r.top-(top+bottom)/2)}`,
        selector,
      )
      if (!scroll) break
      await actions('wheel', [
        { type: 'scroll', origin: 'viewport', duration: 200, deltaX: 0, ...scroll },
      ])
    }
    await ui.click(selector)
  }
  const report = {
    status: 'running',
    files: {},
    exports: [],
    checkpoints: [],
    nativeDialogs: [],
    close: {},
  }
  const persist = () =>
    writeFile(path.join(output, 'installed-document-health.json'), JSON.stringify(report, null, 2))
  const markerA = 'MILKUP_IDENTITY_ALPHA_7E36'
  const markerB = 'MILKUP_IDENTITY_BRAVO_9C42'
  const bPath = path.join(output, 'identity-bravo.md')
  const expected = new Map([
    [document, await readFile(document)],
    [bPath, Buffer.from(`# Bravo\n\n${markerB}\n`)],
  ])
  await writeFile(bPath, expected.get(bPath), { flag: 'wx' })
  async function checkFiles() {
    for (const [file, bytes] of expected)
      assert((await readFile(file)).equals(bytes), `Wrong document changed: ${path.basename(file)}`)
    assert(report.checkpoints.length < 32)
    report.checkpoints.push({
      activePath: (await state()).path,
      hashes: Object.fromEntries([...expected].map(([p, b]) => [path.basename(p), hash(b)])),
    })
  }
  async function focus() {
    await chord('1')
    await until(async () => (await state()).mode === 'source', 'source editing mode')
    const sourceLine = await execute(
      `const root=document.querySelector('.milkup-editor');if(!root)return null;const b=root.getBoundingClientRect();const e=[...root.querySelectorAll('.milkup-line')].find(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.top>=b.top&&r.bottom<=Math.min(b.bottom,innerHeight)});return e?'.milkup-line[data-line="'+e.dataset.line+'"]':null`,
    )
    assert(sourceLine, 'Actual visible source line required')
    await click(sourceLine)
    await until(async () => (await state()).editorFocused, 'editor real focus')
    await chord('\uE010')
  }
  async function append(file, suffix, save = true) {
    assert.equal(path.resolve((await state()).path).toLowerCase(), path.resolve(file).toLowerCase())
    await focus()
    await typeText(suffix)
    await until(async () => (await state()).dirty, 'typed current document is dirty')
    const next = Buffer.concat([expected.get(file), Buffer.from(suffix)])
    if (save) {
      await chord('s')
      await until(
        async () => !(await state()).dirty && (await readFile(file)).equals(next),
        'current file saved exactly',
      )
      expected.set(file, next)
      await checkFiles()
    }
    return next
  }
  async function nativeDialog(mode, target, trigger) {
    const receipt = path.join(output, `native-dialog-${report.nativeDialogs.length}.json`)
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
      report.nativeDialogs.push(proof)
      await persist()
      assert.equal(code, 0, log)
      assert(!overflow, 'Complete bounded native helper logs')
      assert.equal(proof.status, 'passed')
      assert.equal(proof.input.path, target)
      assert(
        proof.input.accepted && proof.input.nativeSendInput && proof.input.filenameReadbackExact,
      )
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await ended.catch(() => {})
      await writeFile(receipt + '.log', log)
    }
  }
  async function open(file, discard = false) {
    await nativeDialog('open', file, async () => {
      await chord('o')
      if (discard) {
        await until(
          () => execute(`return !document.querySelector('[data-close-confirm]')?.hidden`),
          'dirty document switch confirmation',
        )
        await click('.dialog-button[data-close-confirm-action="discard"]')
      }
    })
    await until(async () => {
      const s = await state()
      return (
        s.loading === 'ready' &&
        path.resolve(s.path).toLowerCase() === path.resolve(file).toLowerCase()
      )
    }, 'exact file-open identity')
    await checkFiles()
  }
  async function exportPanel() {
    if (!(await state()).menu) await click('[data-menu-toggle]')
    await click('[data-menu-section="plugins"]')
    const card = await until(
      async () =>
        (await state()).cards.find((c) => c.id === 'milkup.export-print' && c.busy !== 'true'),
      'export plugin available',
    )
    if (card.checked !== 'true')
      await click('.plugin-summary-card[data-plugin-id="milkup.export-print"] [role="switch"]')
    await until(
      async () =>
        (await state()).cards.some(
          (c) => c.id === 'milkup.export-print' && c.checked === 'true' && c.busy !== 'true',
        ),
      'export plugin enabled',
    )
    await click('[data-menu-close]')
    if (
      !(await execute(
        `return document.querySelector('[data-sidebar-toggle]')?.getAttribute('aria-pressed')==='true'`,
      ))
    )
      await click('[data-sidebar-toggle]')
    const other = await execute(
      `return [...document.querySelectorAll('[data-plugin-slot="sidebar-panel"] section')].filter(e=>e.getAttribute('aria-label')!=='导出与打印'&&e.querySelector('.plugin-ui-panel-toggle')?.getAttribute('aria-expanded')==='true').map(e=>e.dataset.pluginUi)`,
    )
    for (const key of other) await click(`[data-plugin-ui="${key}"] .plugin-ui-panel-toggle`)
    const panel = 'section[aria-label="导出与打印"]'
    if (
      await execute(
        `return document.querySelector(arguments[0])?.dataset.collapsed==='true'`,
        panel,
      )
    )
      await click(panel + ' .plugin-ui-panel-toggle')
    return panel
  }
  async function exportCurrent(file, marker, other) {
    const panel = await exportPanel()
    for (const format of ['html', 'pdf']) {
      await click(`${panel} [data-plugin-field-control="format"]`)
      const keys = ['\uE011', ...(format === 'pdf' ? ['\uE015'] : []), '\uE007']
      await actions(
        'key',
        keys.flatMap((value) => [
          { type: 'keyDown', value },
          { type: 'keyUp', value },
        ]),
      )
      await until(
        () =>
          execute(
            `return document.querySelector(arguments[0])?.value===arguments[1]`,
            `${panel} [data-plugin-field-control="format"]`,
            format,
          ),
        'export format selected by real input',
      )
      const target = path.join(output, `${file === document ? 'alpha' : 'bravo'}.${format}`)
      await nativeDialog(format, target, () =>
        click(`${panel} [data-plugin-command="exportPrint.start"]`),
      )
      await until(
        async () => {
          try {
            const s = await stat(target)
            return s.size > 100 && s.size <= 8 * 1024 * 1024
          } catch {
            return false
          }
        },
        'published output file',
        45000,
      )
      await until(
        () =>
          execute(
            `return [...document.querySelectorAll(arguments[0]+' [role="status"]')].some(e=>e.textContent.includes('已保存'))`,
            panel,
          ),
        'product reports successful export',
      )
      const bytes = await readFile(target)
      if (format === 'html') {
        assert(bytes.toString().includes(marker))
        assert(!bytes.toString().includes(other))
      } else assert(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
      report.exports.push({
        format,
        file: path.basename(target),
        source: path.basename(file),
        expectedMarker: marker,
        excludedMarker: other,
        bytes: bytes.length,
        sha256: hash(bytes),
        contentCheck: format === 'pdf' ? 'pending-independent-pdf-text-audit' : 'passed',
      })
      await checkFiles()
      await persist()
    }
    await click('[data-sidebar-toggle]')
    await until(
      () =>
        execute(
          `return document.querySelector('[data-sidebar-toggle]')?.getAttribute('aria-pressed')==='false'`,
        ),
      'export sidebar closed by visible toggle',
    )
    await ui.capture(file === document ? 'document-alpha.png' : 'document-bravo.png')
  }
  try {
    await persist()
    await append(document, `${markerA}\n`)
    await exportCurrent(document, markerA, markerB)
    await open(bPath)
    await append(bPath, 'BRAVO-EDIT-SAVED\n')
    await exportCurrent(bPath, markerB, markerA)
    await append(bPath, 'BRAVO-DISCARD-ONLY\n', false)
    await open(document, true)
    report.close.discardOnSwitchPreservedDisk = true
    const pending = await append(document, 'ALPHA-CLOSE-SAVED\n', false)
    await checkFiles()
    await click('[data-window-control="close"]')
    await until(
      () => execute(`return !document.querySelector('[data-close-confirm]')?.hidden`),
      'unsaved window close confirmation',
    )
    await click('.dialog-button[data-close-confirm-action="cancel"]')
    await until(async () => (await state()).dirty, 'cancel retains dirty current buffer')
    await checkFiles()
    report.close.cancelPreservedDisk = true
    report.close.cancelPreservedBuffer = await execute(
      `return [...document.querySelectorAll('.milkup-line')].some(e=>e.textContent.includes('ALPHA-CLOSE-SAVED'))`,
    )
    assert(report.close.cancelPreservedBuffer)
    await click('[data-window-control="close"]')
    await until(
      () => execute(`return !document.querySelector('[data-close-confirm]')?.hidden`),
      'second unsaved close confirmation',
    )
    report.close.saveRequested = true
    await ui.capture('document-unsaved-close.png')
    await persist()
    try {
      await click('.dialog-button[data-close-confirm-action="save"]')
    } catch (error) {
      report.close.saveClickResponse = String(error)
    }
    await until(
      async () => (await readFile(document)).equals(pending),
      'save-and-close writes current A file',
    )
    expected.set(document, pending)
    for (const [file, bytes] of expected)
      assert((await readFile(file)).equals(bytes), 'Close saved only current document')
    for (const [file, bytes] of expected)
      report.files[path.basename(file)] = { bytes: bytes.length, sha256: hash(bytes) }
    report.status = 'passed-ui-await-native-exit-and-pdf-audit'
    return { report, saved: report.files[path.basename(document)] }
  } catch (error) {
    report.status = 'failed'
    report.error = error.stack
    throw error
  } finally {
    await persist()
  }
}

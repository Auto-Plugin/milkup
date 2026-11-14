// Opt-in Linux production-path acceptance. All UI input uses XTest/GTK;
// execute() observes shipped DOM only. This covers four self-authored fixtures,
// not the official 50-image corpus, Windows, system IME, or installation.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { beta5Fixture, observeBeta5 } from '../helpers/native-beta5-fixture.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
import { x } from '../helpers/native-updates-fixture.mjs'

const required = (key) => (assert(process.env[key], `Set ${key}`), process.env[key])
const sha = (value) => createHash('sha256').update(value).digest('hex')
const pluginId = 'milkup.diagrams'
const expectedVersion = '2.0.0-beta.7'
const expectedPluginVersion = '1.3.0'
const reviewedPackage = {
  manifestSha256: 'bf619c6e213a8d1f9a7eb9c9808234c20c037970dba3c8a931fd6188ad074421',
  contentSha256: '299e683daece532238d0a46f6dffaf0c3a36d57a70597c42dccba5a26e7e998c',
}
const visibleSource = (state, text) =>
  state.lines.some(
    (line) =>
      line.text === text &&
      !line.hidden &&
      line.display !== 'none' &&
      line.rect?.width > 0 &&
      line.rect?.height > 0 &&
      line.rect.bottom > state.editor.top &&
      line.rect.top < state.editor.bottom,
  )

const temporary = async (value) => {
  const canonical = await realpath(value)
  assert(
    canonical.startsWith('/tmp/') && canonical === path.resolve(value),
    'Canonical isolated /tmp path',
  )
  return canonical
}
const originals = {
  ordinary: [
    '# Native Mermaid 中文😀',
    '',
    '```mermaid',
    'flowchart LR',
    'A[Draft 草稿] --> B[Review 审阅]',
    '```',
    '',
    'Outside é 👩🏽‍💻',
    '',
  ].join('\r\n'),
  wide: [
    '# Native wide Mermaid',
    '',
    '```mermaid',
    'flowchart LR',
    ...Array.from({ length: 16 }, (_, i) => `N${i + 1}[Stage ${i + 1} native width]`),
    ...Array.from({ length: 15 }, (_, i) => `N${i + 1} --> N${i + 2}`),
    '```',
    '',
    'Outside wide diagram',
    '',
  ].join('\n'),
  c4: [
    '# Native C4',
    '',
    '```mermaid',
    'C4Component',
    'Component(parser, "Parser", "TypeScript", "Reads notes")',
    'Component(view, "View", "TypeScript", "Shows notes")',
    'Rel(parser, view, "Presents")',
    '```',
    '',
    'Outside C4 diagram',
    '',
  ].join('\n'),
  invalid: [
    '# Native invalid Mermaid',
    '',
    '```mermaid',
    'unknownNativeMermaidGrammar',
    'A --> B',
    '```',
    '',
    'Outside invalid diagram',
    '',
  ].join('\n'),
}

async function main() {
  assert.equal(required('MILKUP_NATIVE_MERMAID_PRIVATE_RUN'), '1')
  assert.equal(required('MILKUP_NATIVE_EXCLUSIVE_DISPLAY'), '1')
  assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
  const display = required('DISPLAY')
  assert(/^:\d+(?:\.\d+)?$/.test(display))
  const endpoint = new URL(required('TAURI_DRIVER_URL'))
  assert(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port)
  const binary = await temporary(required('TAURI_APP_PATH'))
  assert(!binary.includes('/target/'), 'Freeze a copy of the compiled binary')
  const binarySha256 = required('MILKUP_NATIVE_EXPECTED_BINARY_SHA256')
  assert.equal(sha(await readFile(binary)), binarySha256)
  const profile = await temporary(required('MILKUP_NATIVE_PROFILE_ROOT'))
  const environmentKeys = [
    'DISPLAY',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME',
    'XDG_RUNTIME_DIR',
  ]
  for (const key of environmentKeys.slice(1)) {
    const directory = await temporary(required(key))
    assert(directory.startsWith(profile + path.sep))
    if (key !== 'XDG_RUNTIME_DIR')
      assert.equal((await readdir(directory)).length, 0, `Fresh ${key}`)
  }
  const driverRecordPath = await temporary(required('MILKUP_NATIVE_DRIVER_ENV_RECORD'))
  const driverRecordBytes = await readFile(driverRecordPath)
  const driverRecord = JSON.parse(driverRecordBytes)
  for (const key of environmentKeys) assert.equal(driverRecord.environment?.[key], process.env[key])
  assert.equal(driverRecord.driverPort, Number(endpoint.port))
  await mkdir(required('MILKUP_NATIVE_EVIDENCE_DIR'), { recursive: true })
  const output = await temporary(process.env.MILKUP_NATIVE_EVIDENCE_DIR)
  const paths = Object.fromEntries(
    Object.keys(originals).map((key) => [key, path.join(output, key + '.md')]),
  )
  const sourceBytes = await readFile(new URL(import.meta.url))
  const startedAt = new Date().toISOString()
  const token = randomUUID()
  const inputs = [],
    rows = [],
    locks = []
  let app,
    ui,
    owner,
    runtime,
    failure,
    cleanup,
    reportOwned = false,
    active = 'ordinary'
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
  const candidate = {
    head: git('rev-parse', 'HEAD'),
    trackedDiffSha256: sha(execFileSync('git', ['diff', '--binary', 'HEAD'])),
    status: git('status', '--short'),
    note: 'Working-tree snapshot at harness startup; binary SHA is independently frozen. This is not a claim of a committed release.',
  }
  const catalogPath = path.join(
    process.env.XDG_DATA_HOME,
    'app.milkup.desktop/plugins/catalog-v1.json',
  )
  const catalog = async () => {
    try {
      const bytes = await readFile(catalogPath)
      return { sha256: sha(bytes), data: JSON.parse(bytes) }
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }
  const persist = async () => {
    if (!reportOwned) return
    await writeFile(
      path.join(output, 'mermaid-private.json'),
      JSON.stringify(
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          status: failure ? 'failed' : cleanup ? 'passed' : 'running',
          binary,
          binarySha256,
          expectedVersion,
          expectedPluginVersion,
          candidate,
          harnessSha256: sha(sourceBytes),
          platform: process.platform,
          architecture: process.arch,
          display,
          profile,
          driverRecord: {
            path: driverRecordPath,
            sha256: sha(driverRecordBytes),
            record: driverRecord,
          },
          runtime,
          owner: owner?.identity,
          fixtures: Object.fromEntries(
            Object.entries(originals).map(([key, source]) => [
              key,
              { path: paths[key], bytes: Buffer.byteLength(source), sha256: sha(source) },
            ]),
          ),
          inputs,
          rows,
          failure,
          cleanup,
          boundaries: [
            'Four declared self-authored documents only; not the 50-image corpus or full grammar coverage.',
            'Actual Linux product binary and native XTest/GTK input; DOM observations only, diagnostics injection disabled.',
            'No Windows, installation, update/rollback, system IME, high-DPI or OS-wide network-denial claim.',
            'Decoded dimensions and pixel screenshots are separate evidence; visual review is not automatically passing.',
          ],
        },
        null,
        2,
      ) + '\n',
    )
  }
  const state = async () => ({
    ...(await observeBeta5(app)),
    probe: await app.probe(),
    visuals: await app.execute(`
const editor=document.querySelector('.milkup-editor'),b=editor?.getBoundingClientRect();
const visible=e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return c.display!=='none'&&c.visibility!=='hidden'&&r.width>0&&r.height>0&&r.right>Math.max(0,b?.left??0)&&r.left<Math.min(innerWidth,b?.right??innerWidth)&&r.bottom>Math.max(0,b?.top??0)&&r.top<Math.min(innerHeight,b?.bottom??innerHeight)};
return {images:[...document.querySelectorAll('[data-document-presentation] img')].map(e=>({visible:visible(e),complete:e.complete,naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight,src:e.currentSrc,alt:e.alt,rect:e.getBoundingClientRect().toJSON(),parent:{scrollWidth:e.parentElement?.scrollWidth,clientWidth:e.parentElement?.clientWidth},style:{width:getComputedStyle(e).width,maxWidth:getComputedStyle(e).maxWidth}})),vectorCount:document.querySelectorAll('[data-document-presentation] svg').length,pluginText:document.querySelector('.plugin-manager')?.textContent?.slice(0,12000),body:document.body.textContent?.slice(0,12000)};`),
    catalog: await catalog(),
    fileSha256: sha(await readFile(paths[active])),
  })
  const wait = (predicate, label, timeout = 25000) =>
    app.until(async () => predicate(await state()), label, timeout)
  const shot = async (name) => {
    await app.shot(name + '-webview')
    execFileSync(
      '/usr/bin/import',
      ['-display', display, '-window', 'root', path.join(output, name + '-system.png')],
      { env: process.env, timeout: 10000 },
    )
    return Promise.all(
      ['webview', 'system'].map(async (kind) => {
        const file = name + '-' + kind + '.png'
        return {
          file,
          sha256: sha(await readFile(path.join(output, file))),
          visuallyReviewed: false,
        }
      }),
    )
  }
  const step = async (label, run) => {
    const row = {
      name: String(rows.length + 1).padStart(2, '0') + '-' + label,
      startedAt: new Date().toISOString(),
      passed: false,
    }
    rows.push(row)
    try {
      row.before = await state()
      await run(row)
      row.after = await state()
      assert.equal(row.after.probe.path, paths[active])
      row.screenshots = await shot(row.name)
      row.passed = true
    } catch (error) {
      row.error = String(error)
      row.stack = error.stack
      row.after = await state().catch(() => null)
      row.screenshots = await shot(row.name + '-failure').catch(() => [])
      throw error
    } finally {
      row.finishedAt = new Date().toISOString()
      await persist()
      console.log(row.passed ? 'PASS' : 'FAIL', row.name)
    }
  }
  const save = async (expected = originals[active]) => {
    await app.key('ctrl+s')
    await app.until(
      async () => {
        const p = await app.probe()
        return (
          !p.dirty && !p.saving && (await readFile(paths[active])).equals(Buffer.from(expected))
        )
      },
      'Exact original newline/Unicode save bytes',
      30000,
    )
    rows.at(-1).saved = {
      sha256: sha(expected),
      bytes: Buffer.byteLength(expected),
      probe: await app.probe(),
    }
  }
  const rendered = (yes) =>
    wait(
      (s) =>
        yes
          ? s.mode === 'live' &&
            s.visuals.vectorCount === 0 &&
            s.visuals.images.some(
              (i) =>
                i.visible &&
                i.complete &&
                i.naturalWidth > 0 &&
                i.naturalHeight > 0 &&
                i.src.startsWith('blob:'),
            )
          : s.previews.length === 0 && s.visuals.images.length === 0 && s.visuals.vectorCount === 0,
      yes ? 'Visible decoded host PNG in actual document' : 'Source visible without diagram',
    )
  const switchPlugin = async (enabled) => {
    await ui.list()
    const before = await state()
    assert.notEqual(before.cards.find((c) => c.id === pluginId)?.checked, String(enabled))
    await ui.pointer(`.plugin-summary-card[data-plugin-id="${pluginId}"] [role="switch"]`)
    await wait(
      (s) =>
        s.cards.find((c) => c.id === pluginId)?.checked === String(enabled) &&
        s.cards.find((c) => c.id === pluginId)?.busy !== 'true',
      'Plugin switch settles',
    )
    const after = await state()
    assert.deepEqual(
      after.cards.map((c) => c.id),
      before.cards.map((c) => c.id),
      'Stable plugin card order',
    )
    assert.equal(after.probe.version, before.probe.version)
    assert.equal(after.probe.dirty, before.probe.dirty)
  }
  const open = async (name) => {
    await ui.closeMenu()
    await app.key('ctrl+o')
    await ui.picker(paths[name])
    active = name
    await wait(
      (s) => s.probe.path === paths[name] && s.probe.loading === 'ready',
      'Open fixture ' + name,
      30000,
    )
    await ui.position(originals[name], 0)
  }
  try {
    for (const lock of [
      path.join(profile, 'private-mermaid.lock'),
      `/tmp/milkup-private-mermaid-display-${/^:(\d+)/.exec(display)[1]}.lock`,
    ]) {
      await writeFile(lock, JSON.stringify({ pid: process.pid, token, startedAt, output }) + '\n', {
        flag: 'wx',
      })
      locks.push(lock)
    }
    let existing = ''
    try {
      existing = x('search', '--class', 'milkup-desktop')
    } catch (error) {
      if (error.status !== 1) throw error
    }
    assert.equal(existing, '', 'No existing Milkup on dedicated display')
    await writeFile(path.join(output, 'mermaid-private.json'), '{}\n', { flag: 'wx' })
    reportOwned = true
    await writeFile(path.join(output, 'harness-startup-source.mjs'), sourceBytes, { flag: 'wx' })
    for (const [key, source] of Object.entries(originals))
      await writeFile(paths[key], source, { flag: 'wx' })
    await persist()
    app = await startProduction(paths[active], output, { diagnostics: false })
    owner = await ownedApplication(binary, paths[active])
    const key = app.key,
      text = app.text
    app.key = async (value) => {
      inputs.push({ at: new Date().toISOString(), kind: 'XTest-key', value })
      return key(value)
    }
    app.text = async (value) => {
      assert(/^[\x20-\x7e]*$/.test(value))
      inputs.push({ at: new Date().toISOString(), kind: 'XTest-text', value })
      return text(value)
    }
    ui = beta5Fixture(app)
    const pointer = ui.pointer
    ui.pointer = async (selector, options) => {
      inputs.push({ at: new Date().toISOString(), kind: 'XTest-pointer', selector })
      return pointer(selector, options)
    }
    runtime = await app.execute(
      'return {protocol:location.protocol,hostname:location.hostname,userAgent:navigator.userAgent,diagnostics:typeof window.__productionDiagnostics,developmentProbe:typeof window.__searchProbe,devicePixelRatio}',
    )
    assert(
      (runtime.protocol === 'tauri:' && runtime.hostname === 'localhost') ||
        (['http:', 'https:'].includes(runtime.protocol) && runtime.hostname === 'tauri.localhost'),
    )
    assert.equal(runtime.diagnostics, 'undefined')
    assert.equal(runtime.developmentProbe, 'undefined')
    runtime.webkitGtk = execFileSync('pkg-config', ['--modversion', 'webkit2gtk-4.1'], {
      encoding: 'utf8',
    }).trim()
    runtime.provenance =
      'Existing local sysroot WebKitGTK; no runtime downloaded or installed for this run'
    await step('beta7-bundled-worker13-disabled-source', async (row) => {
      x('windowsize', ui.windowId(), '1280', '800')
      await app.key('ctrl+0')
      await ui.menu()
      await ui.click('[data-menu-section="about"]')
      await wait((s) => s.appVersion === expectedVersion, 'Exact beta.7 About version')
      await ui.details(pluginId)
      const details = (await state()).visuals.pluginText
      assert(details?.includes(expectedPluginVersion), 'Bundled Worker 1.3.0 shown')
      row.initialCatalog = await catalog()
      const entry = row.initialCatalog?.data?.payload?.entries?.find((item) => item.id === pluginId)
      assert(entry?.pending?.generation, 'Exact bundled Diagrams pending generation exists')
      assert.equal(entry.active, null, 'Fresh unapproved package is not active')
      assert.equal(entry.pending.phase, 'prepared')
      const initial = entry.pending.generation
      assert.equal(initial.manifest.id, pluginId)
      assert.equal(initial.manifest.host, 'worker')
      assert.equal(initial.manifest.version, expectedPluginVersion)
      assert.equal(initial.manifestSha256, reviewedPackage.manifestSha256)
      assert.equal(initial.contentSha256, reviewedPackage.contentSha256)
      assert.equal(initial.verified, false, 'Fresh prepared package has not run')
      row.reviewedPendingGeneration = initial
      await ui.list()
      assert.equal((await state()).cards.find((c) => c.id === pluginId)?.checked, 'false')
      await ui.closeMenu()
      await ui.position(originals.ordinary, 0)
      await rendered(false)
      assert.equal((await app.probe()).dirty, false)
    })
    await step('enable-return-real-png-and-byte-stability', async (row) => {
      const before = await app.probe()
      await switchPlugin(true)
      await ui.closeMenu()
      await rendered(true)
      const after = await app.probe()
      assert.equal(after.version, before.version)
      assert.equal(after.dirty, before.dirty)
      const accepted = await state()
      const entry = accepted.catalog?.data?.payload?.entries?.find((item) => item.id === pluginId)
      assert(entry?.active && entry.enabled, 'Enabled Diagrams has an accepted active generation')
      assert.equal(entry.pending, null)
      assert.equal(entry.active.manifest.id, pluginId)
      assert.equal(entry.active.manifest.host, 'worker')
      assert.equal(entry.active.manifest.version, expectedPluginVersion)
      assert.equal(entry.active.manifestSha256, reviewedPackage.manifestSha256)
      assert.equal(entry.active.contentSha256, reviewedPackage.contentSha256)
      assert.equal(entry.active.verified, true)
      row.reviewedActiveGeneration = entry.active
      row.png = accepted.visuals.images
      await save()
    })
    const offset = originals.ordinary.indexOf('Draft')
    await step('source-mode-fence-and-caret', async () => {
      await ui.position(originals.ordinary, offset, 'source')
      await rendered(false)
      const s = await state()
      assert(visibleSource(s, '```mermaid'), 'Opening fence is actually visible')
      assert(visibleSource(s, '```'), 'Closing fence is actually visible')
      assert(
        visibleSource(s, 'A[Draft 草稿] --> B[Review 审阅]'),
        'Diagram source is actually visible',
      )
      assert.equal(s.cursor, offset)
      assert.equal(s.probe.dirty, false)
      await save()
    })
    const edited = originals.ordinary.slice(0, offset) + 'X' + originals.ordinary.slice(offset)
    await step('native-edit-dirty-save-and-replacement', async (row) => {
      const version = (await app.probe()).version
      await app.text('X')
      await wait(
        (s) => s.probe.version === version + 1 && s.probe.dirty,
        'Native source edit increments version and dirties',
      )
      row.dirtyState = await app.probe()
      await save(edited)
      await ui.position(edited, 0)
      await rendered(true)
      row.editedPng = (await state()).visuals.images
      const initialSources = rows.find((item) => item.png)?.png.map((image) => image.src) ?? []
      assert(initialSources.length > 0)
      assert(
        row.editedPng.some(
          (image) => image.visible && image.complete && !initialSources.includes(image.src),
        ),
        'Edited source has a new decoded image URL',
      )
      row.visualReviewRequired =
        'Confirm the actual new PNG says XDraft 草稿, not Draft 草稿; a new Blob URL alone does not prove pixels changed.'
    })
    await step('undo-restores-exact-original-bytes', async () => {
      await ui.position(edited, 0, 'source')
      const version = (await app.probe()).version
      await app.key('ctrl+z')
      await wait((s) => s.probe.version === version + 1, 'Undo source edit')
      await save()
      await ui.position(originals.ordinary, 0)
      await rendered(true)
    })
    await step('disable-restores-source-without-dirtying', async () => {
      await switchPlugin(false)
      await ui.closeMenu()
      await rendered(false)
      assert.equal((await app.probe()).dirty, false)
      await save()
    })
    await step('reenable-renders-without-reopen', async () => {
      await switchPlugin(true)
      await ui.closeMenu()
      await rendered(true)
      assert.equal((await app.probe()).dirty, false)
      await save()
    })
    await step('wide-natural-size-is-not-shrunk', async (row) => {
      await open('wide')
      await rendered(true)
      const s = await state(),
        image = s.visuals.images.find((i) => i.visible)
      assert(image.naturalWidth > s.editor.width, 'Wide graph exceeds viewport naturally')
      assert(Math.abs(image.rect.width - image.naturalWidth) < 1, 'No fit-to-width scale')
      assert(image.naturalHeight >= 40, 'Wide graph has readable natural-height budget')
      row.wideImage = image
      await save()
    })
    await step('c4-product-pixels-for-review', async (row) => {
      await open('c4')
      await rendered(true)
      row.c4Image = (await state()).visuals.images
      await save()
    })
    await step('invalid-grammar-visible-source-and-diagnostic', async () => {
      await open('invalid')
      await wait(
        (s) => s.visuals.images.length === 0 && s.notices.some((n) => n.visible && n.text.trim()),
        'Invalid syntax diagnostic with no image',
      )
      const failed = await state()
      assert(
        visibleSource(failed, 'unknownNativeMermaidGrammar'),
        'Rejected diagram source stays visibly editable',
      )
      assert.equal(failed.probe.dirty, false)
      await save()
    })
    await step('final-disable-and-exact-files', async () => {
      await switchPlugin(false)
      await ui.closeMenu()
      await rendered(false)
      await save()
      for (const [key, source] of Object.entries(originals))
        assert(
          (await readFile(paths[key])).equals(Buffer.from(source)),
          'Final fixture bytes ' + key,
        )
      assert.equal(sha(await readFile(binary)), binarySha256)
    })
  } catch (error) {
    failure = { message: String(error), stack: error.stack, at: new Date().toISOString() }
    if (app && !rows.at(-1)?.error) {
      failure.state = await state().catch(() => null)
      failure.screenshots = await shot('unhandled-failure').catch(() => [])
    }
    throw error
  } finally {
    await persist()
    try {
      await app?.close()
      let processObservation
      if (owner) {
        const deadline = Date.now() + 5000
        do {
          try {
            const raw = await readFile(`/proc/${owner.identity.pid}/stat`, 'utf8')
            const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ')
            processObservation = {
              pid: owner.identity.pid,
              birth: fields[19],
              state: fields[0],
              exited: fields[19] !== owner.identity.birth || fields[0] === 'Z',
            }
          } catch (error) {
            if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error
            processObservation = { pid: owner.identity.pid, exited: true, absent: true }
          }
          if (processObservation.exited) break
          await new Promise((resolve) => setTimeout(resolve, 100))
        } while (Date.now() < deadline)
        assert(processObservation.exited, 'Owned application must stop after session close')
      }
      const driverStatus = await (
        await fetch(endpoint + 'status', { signal: AbortSignal.timeout(3000) })
      ).json()
      assert.equal(driverStatus.value?.ready, true, 'Driver has no active session after close')
      cleanup = {
        sessionClosed: true,
        processObservation,
        driverStatus,
        at: new Date().toISOString(),
      }
    } catch (error) {
      cleanup = { sessionClosed: false, error: String(error) }
      failure ??= cleanup
    }
    for (const lock of locks)
      if (JSON.parse(await readFile(lock)).token === token) await unlink(lock)
    await persist()
    if (cleanup?.sessionClosed === false)
      throw new Error('Native cleanup verification failed: ' + cleanup.error)
  }
}
await main()

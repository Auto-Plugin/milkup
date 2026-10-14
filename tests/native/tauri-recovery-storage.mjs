import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, readdir, open, chmod, unlink, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
const root = process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? '/workspace/.milkup-v2-phase18/storage'
const profile =
  process.env.MILKUP_RECOVERY_PROFILE ??
  '/workspace/.milkup-v2-phase18/runtime-storage/data/app.milkup.desktop/recovery-v1'
await mkdir(root, { recursive: true })
const file = path.join(root, 'original.md'),
  original = Buffer.from('# 原文\r\n中文 😀\r\n')
await writeFile(file, original)
const results = []
let protectedDirectory
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function latest() {
  const records = []
  for (const name of await readdir(profile))
    try {
      const r = JSON.parse(await readFile(path.join(profile, name, 'manifest.json'), 'utf8'))
      if (r.originalPath === file) records.push(r)
    } catch {}
  return records.sort((a, b) => b.createdAt - a.createdAt)[0]
}
const payload = (r) => path.join(profile, r.id, r.payload)
let app = await startProduction(file, root)
const ready = () =>
  app.until(
    () =>
      app.execute(
        'return document.querySelector("#app").dataset.recoveryPhase==="ready"&&document.querySelector("#app").dataset.recoveryVersion===document.querySelector("[data-stat=version]").textContent',
      ),
    'complete recovery point',
  )
const shot = async (name) => {
  await app.shot(name + '-webview')
  await app.delay(250)
  execFileSync('import', ['-window', 'root', path.join(root, name + '.png')], {
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
  })
}
const visibleFeedback = async (selector, label) => {
  const bounds = await app.execute(
    'const e=document.querySelector(arguments[0]),r=e.getBoundingClientRect(),p=e.closest(".confirm-dialog").getBoundingClientRect();return {hidden:e.hidden,text:e.textContent,top:r.top,bottom:r.bottom,height:r.height,areaTop:p.top,areaBottom:p.bottom}',
    selector,
  )
  await writeFile(path.join(root, label + '-bounds.json'), JSON.stringify(bounds, null, 2))
  assert(
    !bounds.hidden &&
      bounds.height > 0 &&
      bounds.top >= bounds.areaTop &&
      bounds.bottom <= bounds.areaBottom,
    label + ' is inside the visible dialog',
  )
}
const check = async (name, fn) => {
  await fn()
  results.push({ name, ok: true })
  await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
  console.log('PASS ' + name)
}
const filler = path.join(profile, 'test-owned-quota-reservation')
let point
try {
  await app.focus('.milkup-input-proxy')
  await app.text('BEFORE')
  await ready()
  point = await latest()
  const initial = await readFile(payload(point))
  assert(initial.equals(Buffer.concat([Buffer.from('BEFORE'), original])))
  await check(
    'global quota refuses a new point and visibly preserves the last complete checkpoint',
    async () => {
      const handle = await open(filler, 'wx')
      await handle.truncate(2 * 1024 * 1024 * 1024)
      await handle.close()
      await app.text('AFTER')
      await app.until(
        () =>
          app.execute(
            'return document.querySelector("#app").dataset.recoveryPhase==="error"&&!document.querySelector("[data-recovery-warning]").hidden',
          ),
        'visible quota error',
      )
      assert(
        await app.execute(
          'return document.querySelector("[data-recovery-warning]").textContent.includes("容量上限")',
        ),
      )
      assert.equal((await latest()).version, point.version)
      assert((await readFile(payload(point))).equals(initial))
      assert((await readFile(file)).equals(original))
      assert.equal((await stat(filler)).size, 2 * 1024 * 1024 * 1024)
      await shot('quota-warning')
    },
  )
  await check(
    'manual original-file save remains possible when recovery storage is full',
    async () => {
      await app.key('ctrl+s')
      const expected = Buffer.concat([Buffer.from('BEFOREAFTER'), original])
      await app.until(async () => {
        const p = await app.probe()
        return !p.saving && !p.dirty && (await readFile(file)).equals(expected)
      }, 'manual save despite recovery quota')
      assert((await readFile(payload(point))).equals(initial))
      assert.equal((await stat(filler)).size, 2 * 1024 * 1024 * 1024)
      await shot('manual-save-despite-quota')
    },
  )
  // This sparse, all-zero reservation is created by this harness, not recovery data.
  await unlink(filler)
  await app.focus('.milkup-input-proxy')
  await app.text('WRITE')
  await ready()
  point = await latest()
  const protectedBytes = await readFile(payload(point))
  protectedDirectory = path.join(profile, point.id)
  await check(
    'real filesystem permission failure is visible and does not replace the published record',
    async () => {
      await chmod(protectedDirectory, 0o500)
      await app.text('DENIED')
      await app.until(
        () =>
          app.execute(
            'return document.querySelector("#app").dataset.recoveryPhase==="error"&&!document.querySelector("[data-recovery-warning]").hidden',
          ),
        'visible permission failure',
      )
      assert(
        await app.execute(
          'return document.querySelector("[data-recovery-warning]").textContent.includes("无法写入")',
        ),
      )
      assert.equal((await latest()).version, point.version)
      assert((await readFile(payload(point))).equals(protectedBytes))
      await shot('permission-warning')
    },
  )
  await check(
    'explicit retry after permissions recover writes the latest accepted revision',
    async () => {
      await chmod(protectedDirectory, 0o700)
      await app.click('[data-recovery-retry]')
      await ready()
      point = await latest()
      const expected = Buffer.concat([Buffer.from('BEFOREAFTERWRITEDENIED'), original])
      assert((await readFile(payload(point))).equals(expected))
      assert(await app.execute('return document.querySelector("[data-recovery-warning]").hidden'))
      await shot('retry-success')
    },
  )
  // Exercise the recovery dialog at the smallest supported physical window and native 200%.
  await app.click('[data-menu-toggle]')
  await app.click('[data-menu-section="appearance"]')
  await app.focus('[data-appearance-theme]')
  await app.key('End')
  await app.until(
    () => app.execute('return document.documentElement.dataset.theme==="dark"'),
    'dark recovery theme',
  )
  await app.key('Escape')
  for (const scale of [1.25, 1.5, 2]) {
    await app.key('ctrl+plus')
    await app.until(
      () =>
        app.execute(
          'return Number(document.querySelector("#app").dataset.appearanceZoom)===arguments[0]',
          scale,
        ),
      'recovery native scale',
    )
  }
  const expected = await readFile(payload(point))
  const handle = await open(filler, 'wx')
  await handle.truncate(2 * 1024 * 1024 * 1024)
  await handle.close()
  const owner = await ownedApplication(app.application, file)
  const termination = await owner.signal('SIGKILL')
  await writeFile(path.join(root, 'termination.json'), JSON.stringify(termination, null, 2))
  await app.close()
  app = await startProduction(file, root)
  const ids = execFileSync('xdotool', ['search', '--onlyvisible', '--class', 'milkup-desktop'], {
    encoding: 'utf8',
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
  })
    .trim()
    .split('\n')
  const restarted = await ownedApplication(app.application, file)
  const windows = ids.filter((id) =>
    execFileSync('xprop', ['-id', id, '_NET_WM_PID'], {
      encoding: 'utf8',
      env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
    }).includes('= ' + restarted.identity.pid),
  )
  assert.equal(windows.length, 1)
  execFileSync('xdotool', ['windowsize', '--sync', windows[0], '760', '520'], {
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
  })
  await app.until(
    () => app.execute(`return !!document.querySelector('[data-recovery-restore="${point.id}"]')`),
    'recovery prompt',
  )
  await check(
    'quota blocks internal materialization but leaves a visible error and the candidate available',
    async () => {
      await app.click(`[data-recovery-restore="${point.id}"]`)
      await app.until(
        () =>
          app.execute(
            'return !document.querySelector(".recovery-overlay").hidden&&!document.querySelector("[data-recovery-error]").hidden',
          ),
        'quota recovery error',
      )
      assert(
        await app.execute(
          'return document.querySelector("[data-recovery-error]").textContent.includes("容量上限")',
        ),
      )
      assert((await readFile(payload(point))).equals(expected))
      assert.equal((await latest()).disposition, 'pending')
      await visibleFeedback('[data-recovery-error]', 'recovery-quota')
      await shot('recovery-quota-details')
    },
  )
  const exported = path.join(root, 'exported-copy.md')
  await check(
    'verified export to a new path works at quota without deleting or archiving the unique checkpoint',
    async () => {
      // Only file-picker selection uses the existing production test path seam.
      // The UI button, native validation, filesystem write and checksum are real.
      await app.execute(
        'localStorage.setItem("milkup.desktop.nativeTestPaths",JSON.stringify({saveAs:arguments[0]}))',
        exported,
      )
      await app.click(`[data-recovery-export="${point.id}"]`)
      await app.until(
        () => app.execute('return !document.querySelector("[data-recovery-export-result]").hidden'),
        'export confirmation',
      )
      assert((await readFile(exported)).equals(expected))
      assert.equal((await latest()).disposition, 'pending')
      assert((await readFile(payload(point))).equals(expected))
      assert.equal((await stat(filler)).size, 2 * 1024 * 1024 * 1024)
      await writeFile(
        path.join(root, 'export.json'),
        JSON.stringify(
          {
            bytes: expected.length,
            checkpointSha256: hash(expected),
            exportSha256: hash(await readFile(exported)),
            picker: 'existing native test-path selection seam; not OS dialog acceptance',
          },
          null,
          2,
        ),
      )
      await visibleFeedback('[data-recovery-export-result]', 'export-complete')
      await shot('export-complete')
    },
  )
  await check(
    'export refuses an existing file and retains both external bytes and recovery data',
    async () => {
      await writeFile(exported, 'EXTERNAL CONTENT')
      await app.click(`[data-recovery-export="${point.id}"]`)
      await app.until(
        () =>
          app.execute(
            'return !document.querySelector("[data-recovery-error]").hidden&&document.querySelector("[data-recovery-error]").textContent.includes("目标文件已存在")&&!document.querySelector("[data-recovery-close]").disabled',
          ),
        'export collision',
      )
      assert(
        await app.execute('return document.querySelector("[data-recovery-export-result]").hidden'),
      )
      assert.equal(await readFile(exported, 'utf8'), 'EXTERNAL CONTENT')
      assert((await readFile(payload(point))).equals(expected))
      assert.equal((await latest()).disposition, 'pending')
      await visibleFeedback('[data-recovery-error]', 'export-conflict')
      await shot('export-conflict')
    },
  )
} catch (error) {
  results.push({ ok: false, error: String(error), state: await app.probe().catch(() => null) })
  await shot('failure').catch(() => {})
  throw error
} finally {
  if (protectedDirectory) await chmod(protectedDirectory, 0o700).catch(() => {})
  await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
  await app.close()
}
console.log(JSON.stringify({ passed: results.length }))

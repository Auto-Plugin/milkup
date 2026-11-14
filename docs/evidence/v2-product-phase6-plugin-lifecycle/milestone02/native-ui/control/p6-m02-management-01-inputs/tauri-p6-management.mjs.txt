// P6 management extension acceptance. Root owns execution; --preflight starts no UI.
// All mutations use the shipped controls + GTK picker + native keyboard. Native
// plugin_catalog_read is observation only, not proof of an ordinary plugin capability.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { nativeFixture, action, x } from '../helpers/native-updates-fixture.mjs'
import {
  catalogFixtureArchive,
  catalogFixtureId,
  catalogSource,
} from '../helpers/p6-catalog-fixtures.mjs'

const required = (key) => (assert(process.env[key], `Set ${key}`), process.env[key])
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const output = path.resolve(required('MILKUP_NATIVE_EVIDENCE_DIR'))
const profile = path.resolve(required('MILKUP_NATIVE_PROFILE_ROOT'))
const binary = await realpath(required('TAURI_APP_PATH'))
const archivePath = await realpath(required('MILKUP_P6_MANAGEMENT_ARCHIVE'))
const archiveBytes = await readFile(archivePath)
const archive = JSON.parse(archiveBytes)
const id = 'milkup.management',
  fixtureId = catalogFixtureId
const modal = `[data-plugin-ui="${id}:management-panel"]`
const command = (name) => `${modal} [data-plugin-command="management.${name}"]`
const menuEntry = `[data-plugin-menu-entry="${id}:management-panel"]`
assert(
  profile.startsWith('/tmp/milkup-p6-profiles/') && profile !== '/tmp/milkup-p6-profiles',
  'Dedicated owned profile required',
)
assert(!binary.includes('/target/'), 'Frozen production binary copy required')
assert.equal(sha(await readFile(binary)), required('MILKUP_NATIVE_EXPECTED_BINARY_SHA256'))
assert.equal(sha(archiveBytes), required('MILKUP_P6_MANAGEMENT_EXPECTED_SHA256'))
assert.equal(archive.format, 'milkup-plugin')
assert.equal(archive.manifest.id, id)
assert.equal(archive.manifest.version, '1.0.0')
assert.equal(archive.manifest.host, 'worker')
assert.deepEqual(archive.manifest.permissions, ['app:plugins'])
assert.equal(archive.files.length, 1)
assert.equal(archive.files[0].path, 'dist/plugin.js')
assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
await mkdir(output, { recursive: true })
await writeFile(path.join(output, 'management-run.lock'), new Date().toISOString(), { flag: 'wx' })
const json = (name, value) =>
  writeFile(path.join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n')
const source = path.join(output, 'source.md')
await writeFile(source, catalogSource, { flag: 'wx' })
const base = catalogFixtureArchive('base')
base.manifest.settings = {
  schema: { showHints: { type: 'boolean' } },
  defaults: { showHints: true },
}
base.manifest.engines = { milkup: '^2.0.0-0', pluginSdk: '>=0.3.6 <0.4.0' }
const candidate = structuredClone(base)
candidate.manifest.version = '1.0.2'
candidate.manifest.permissions = ['document:read', 'network:access']
candidate.manifest.networkOrigins = ['https://p6-management-never-contact.invalid']
const failure = structuredClone(base)
failure.manifest.version = '1.0.3'
failure.files[0].content =
  "export default { activate() { throw new Error('P6_MANAGEMENT_EXPECTED_FAILURE') } }"
const fixtures = {}
for (const [kind, value] of Object.entries({ base, candidate, failure })) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n')
  const file = path.join(output, kind + '.milkup-plugin')
  await writeFile(file, bytes, { flag: 'wx' })
  fixtures[kind] = { path: file, sha256: sha(bytes), manifest: value.manifest }
}
await json('preflight', {
  profile,
  binary,
  binarySha256: sha(await readFile(binary)),
  archivePath,
  archiveSha256: sha(archiveBytes),
  manifest: archive.manifest,
  fixtures,
  methods: {
    writes: 'shipped controls, GTK picker, native Return key',
    observations: 'DOM + readonly native plugin_catalog_read',
    plugin: 'independently built public SDK package, no private plugin imports',
    limits: 'Linux only; script preparation is not execution evidence',
  },
})
if (process.argv.includes('--preflight')) process.exit(0)
assert.equal(process.env.MILKUP_P6_BINARY_CONFIRMED, '1')
assert.equal(process.env.MILKUP_NATIVE_EXCLUSIVE_DISPLAY, '1')
let app,
  passed = false
const ui = nativeFixture(() => app),
  events = []
async function catalog() {
  const key = '__p6ManagementRead_' + randomUUID().replaceAll('-', '')
  await app.execute(
    `window[arguments[0]]={done:false}; const key=arguments[0]; window.__TAURI_INTERNALS__.invoke('plugin_catalog_read').then(value=>window[key]={done:true,value},error=>window[key]={done:true,error:String(error)});`,
    key,
  )
  const result = await app.until(
    () => app.execute('return window[arguments[0]]?.done ? window[arguments[0]] : null', key),
    'read native catalog',
  )
  await app.execute('delete window[arguments[0]]', key)
  assert(!result.error, result.error)
  return result.value
}
const entry = async (pluginId) => (await catalog()).entries.find((item) => item.id === pluginId)
async function observe(name) {
  events.push({
    name,
    at: new Date().toISOString(),
    catalog: await catalog(),
    document: await app.probe(),
    modalText: await app.execute(
      'return document.querySelector(arguments[0])?.textContent ?? null',
      modal,
    ),
    shellText: await app.execute(
      'return document.querySelector("[data-plugin-manager]")?.textContent ?? null',
    ),
  })
  await json('events', events)
  await app.shot(name)
}
async function closeModal() {
  if (await ui.exists(modal)) {
    await ui.click(`${modal} .plugin-ui-close`)
    await app.until(async () => !(await ui.exists(modal)), 'management modal closed')
  }
}
async function install(file, pluginId, version) {
  await closeModal()
  await ui.list()
  await ui.click('[data-plugin-action="install"]')
  await ui.picker(file)
  await app.until(
    async () => {
      const current = await entry(pluginId)
      return (
        current?.pending?.generation.manifest.version === version ||
        current?.active?.manifest.version === version
      )
    },
    `package ${pluginId} ${version} staged`,
    30000,
  )
}
async function approveExact(pluginId) {
  await ui.details(pluginId)
  const current = await entry(pluginId),
    generation = current.pending?.generation ?? current.active
  assert(generation)
  if (generation.approvedFingerprint === generation.capabilityFingerprint) return
  const selector = action('approve', pluginId)
  await ui.ready(selector)
  const shown = await app.execute(
    'const e=document.querySelector(arguments[0]);return {fingerprint:e.dataset.pluginFingerprint,revision:Number(e.dataset.pluginEntryRevision)}',
    selector,
  )
  assert.equal(shown.fingerprint, generation.capabilityFingerprint)
  assert.equal(shown.revision, current.revision)
  await ui.click(selector)
  await app.until(async () => {
    const next = await entry(pluginId),
      g = next.pending?.generation ?? next.active
    return g?.approvedFingerprint === generation.capabilityFingerprint
  }, 'exact displayed capabilities approved')
}
async function activate(pluginId) {
  await approveExact(pluginId)
  await ui.details(pluginId)
  const current = await entry(pluginId)
  if (current.pending || !current.enabled) await ui.click(action('enable', pluginId))
  await app.until(
    async () => {
      const e = await entry(pluginId)
      return e?.enabled && !e.pending && !e.startAttempt
    },
    `verified ${pluginId} active`,
    30000,
  )
  await ui.ready(action('disable', pluginId))
}
async function openModal() {
  await closeModal()
  await ui.menu()
  await ui.click(menuEntry)
  await ui.ready(command('refresh'))
  await app.until(
    () =>
      app.execute('return document.querySelectorAll(arguments[0]).length > 0', command('details')),
    'management catalog ready',
  )
}
const fixtureCard = `${command('details')}[aria-label="${base.manifest.name}"]`
async function selectFixture() {
  await openModal()
  await ui.click(fixtureCard)
  await ui.ready(command('hostDetails'))
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(arguments[0])?.textContent.includes("设置说明")',
        modal,
      ),
    'readonly schema rendered',
  )
}
async function navigate(view) {
  const before = await catalog()
  await ui.click(command(view === 'settings' ? 'hostSettings' : 'hostDetails'))
  await app.until(async () => !(await ui.exists(modal)), 'plugin navigation closes modal')
  await ui.ready('#plugin-detail-title')
  assert.equal(
    await app.execute('return document.querySelector("#plugin-detail-title")?.textContent'),
    base.manifest.name,
  )
  if (view === 'settings') await ui.ready('[data-plugin-settings-schema]')
  assert.deepEqual(
    await catalog(),
    before,
    'opening trusted host UI must not mutate native authority',
  )
  await observe('trusted-' + view + '-navigation')
}
try {
  const launchOutput = path.join(output, 'launch-1')
  await mkdir(launchOutput)
  app = await startProduction(source, launchOutput, { diagnostics: false })
  x('windowsize', ui.windowId(), '1280', '900')
  await app.until(async () => (await catalog()).version === 1, 'catalog initialized', 45000)
  assert(!(await entry(fixtureId)), 'Fresh fixture ID required')
  const preinstalled = await entry(id)
  assert(
    !preinstalled?.enabled && (!preinstalled?.active || !preinstalled.active.approvedFingerprint),
    'Management must start unapproved/disabled in an owned fresh profile',
  )
  await install(fixtures.base.path, fixtureId, '1.0.0')
  await activate(fixtureId)
  await install(archivePath, id, archive.manifest.version)
  const unapproved = await entry(id),
    pending = unapproved.pending?.generation
  assert(
    pending && pending.approvedFingerprint !== pending.capabilityFingerprint,
    'Local import cannot self-approve app:plugins',
  )
  assert(!(await ui.exists(menuEntry)), 'Unapproved extension has no active UI contribution')
  await observe('management-unapproved')
  await activate(id)
  await openModal()
  const rows = await app.execute(
    'return [...document.querySelectorAll(arguments[0])].map(e=>({label:e.getAttribute("aria-label"),children:[...e.children].map(c=>c.textContent),text:e.textContent}))',
    command('details'),
  )
  assert(rows.length > 0)
  for (const row of rows)
    assert.equal(row.children.length, 3, 'Only logo, title and description in each list card')
  const card = rows.find((item) => item.label === base.manifest.name)
  assert.deepEqual(card.children, [
    Array.from(base.manifest.name)[0],
    base.manifest.name,
    base.manifest.description,
  ])
  await json('minimal-cards', rows)
  await observe('management-minimal-list')
  await ui.click(fixtureCard)
  await ui.ready(command('hostSettings'))
  const details = await app.execute(
    'return document.querySelector(arguments[0]).textContent',
    modal,
  )
  for (const text of ['兼容性', 'SDK 版本', '设置说明', 'showHints', '默认：true'])
    assert(details.includes(text), text)
  assert.equal(
    await app.execute(
      'return document.querySelectorAll(arguments[0]+" input,"+arguments[0]+" select,"+arguments[0]+" textarea").length',
      modal,
    ),
    0,
    'Settings schema is read-only',
  )
  assert(
    !details.includes(profile) && !details.includes(output),
    'No native paths in public details',
  )
  await observe('management-readonly-details')
  await navigate('details')
  await selectFixture()
  await navigate('settings')
  await install(fixtures.candidate.path, fixtureId, '1.0.2')
  const pendingBefore = await entry(fixtureId)
  assert(pendingBefore.pending && pendingBefore.pending.generation.approvedFingerprint === null)
  await selectFixture()
  const change = await app.execute('return document.querySelector(arguments[0]).textContent', modal)
  for (const text of [
    '待审候选',
    '候选指纹',
    '权限新增（需宿主审阅）',
    'document:read',
    'network:access',
    '网络范围新增（需宿主审阅）',
    candidate.manifest.networkOrigins[0],
  ])
    assert(change.includes(text), text)
  assert.equal(
    await app.execute(
      'return document.querySelectorAll(arguments[0]+" [data-plugin-action]").length',
      modal,
    ),
    0,
    'Extension contains no host mutation controls',
  )
  await observe('management-candidate-differences')
  await navigate('details')
  await ui.click(action('reject-candidate', fixtureId))
  await app.until(
    async () => !(await entry(fixtureId)).pending,
    'candidate rejected in trusted shell',
  )
  await install(fixtures.failure.path, fixtureId, '1.0.3')
  await approveExact(fixtureId)
  await ui.details(fixtureId)
  await ui.click(action('enable', fixtureId))
  await app.until(
    async () => {
      const current = await entry(fixtureId)
      return (
        !current.pending &&
        current.active?.manifest.version === '1.0.0' &&
        current.enabled &&
        current.diagnostics.length > 0
      )
    },
    'failed candidate restored old version with native diagnostics',
    30000,
  )
  await selectFixture()
  const diagnosed = await app.execute(
    'return document.querySelector(arguments[0]).textContent',
    modal,
  )
  const failureEntry = await entry(fixtureId)
  assert(
    failureEntry.diagnostics.every((message) => diagnosed.includes(message)),
    'Public details display native diagnostic guidance',
  )
  assert(
    !diagnosed.includes(profile) && !diagnosed.includes(output),
    'Failure diagnostics do not expose native paths',
  )
  await observe('management-failure-diagnostics')
  // Leave an unapproved candidate for the independent safety shell to reject
  // after the explanatory extension is disabled.
  await closeModal()
  await install(fixtures.candidate.path, fixtureId, '1.0.2')
  await closeModal()
  await ui.details(id)
  await ui.click(action('disable', id))
  await app.until(
    async () => !(await entry(id)).enabled && !(await ui.exists(menuEntry)),
    'management extension disabled and UI removed',
  )
  await ui.details(fixtureId)
  await ui.click(action('reject-candidate', fixtureId))
  await app.until(
    async () => !(await entry(fixtureId)).pending,
    'host safety shell rejects unapproved candidate without extension',
  )
  if ((await entry(fixtureId)).enabled) {
    await ui.click(action('disable', fixtureId))
    await app.until(async () => !(await entry(fixtureId)).enabled, 'fixture disabled')
  }
  await activate(fixtureId)
  await ui.click('[data-plugin-command="catalogFixture.ping"]')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector("[data-notice]")?.textContent.includes("P6_BASE_ALIVE")',
      ),
    'independent safety shell recovered original fixture',
  )
  assert.equal((await entry(fixtureId)).active.manifest.version, '1.0.0')
  assert.equal((await entry(id)).enabled, false)
  assert.equal(sha(await readFile(source)), sha(catalogSource), 'Source bytes unchanged')
  await observe('management-disabled-host-recovery')
  passed = true
} catch (error) {
  await json('failure', { error: String(error), stack: error.stack })
  if (app) await observe('failure-observation').catch(() => {})
  throw error
} finally {
  await app?.close()
  await json('completion', {
    passed,
    binarySha256: sha(await readFile(binary)),
    archiveSha256: sha(archiveBytes),
    sourceSha256: sha(await readFile(source)),
    limitations: [
      'Linux only',
      'Native catalog reads are trusted-host observations, not plugin IPC authorization evidence',
      'Disable and safety-shell recovery tested; arbitrary process crash recovery belongs to separate catalog harness',
      'No network request made by fixture; origin change is declaration/reapproval evidence',
    ],
  })
}

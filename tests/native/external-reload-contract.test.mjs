// Exact production reload function and bridge validation with a controlled native read.
// Run: node --test tests/native/external-reload-contract.test.mjs
// This is a race contract, not a native installed acceptance result.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'

const source = readFileSync('apps/desktop/src/main.ts', 'utf8')
const bridge = readFileSync('packages/tauri-bridge/src/session/document-session.ts', 'utf8')
const endings = readFileSync('packages/tauri-bridge/src/file/line-ending.ts', 'utf8')
function fn(text, name) {
  const at = text.indexOf('function ' + name + '(')
  assert(at >= 0, name + ' exists in production')
  const start = text.slice(Math.max(0, at - 6), at) === 'async ' ? at - 6 : at
  const end = text.indexOf('\n}', at)
  assert(end > at)
  return text.slice(start, end + 2)
}
const code = [
  source.includes('let externalReloadSequence = 0') ? 'let externalReloadSequence = 0' : '',
  fn(source, 'reloadExternalDocument'),
  fn(bridge, 'recordFileReloadResult'),
  fn(bridge, 'assertReloadResultMatchesSession'),
  fn(bridge, 'freezeSession'),
  fn(endings, 'detectLineEnding'),
].join('\n')
function setup() {
  const reads = [],
    effects = []
  const c = {
    session: {
      documentId: 'A',
      documentVersion: 1,
      savedVersion: 1,
      dirty: false,
      file: { path: '/synthetic/a.md' },
      externalChangeState: 'modified-clean',
      diskSnapshotHash: 'old',
      readonly: false,
    },
    state: { doc: { text: 'ORIGINAL' } },
    view: { inputDOM: { focus: () => effects.push('focus') } },
    fileService: {
      reloadFile: (admitted) =>
        new Promise((resolve, reject) => reads.push({ admitted, resolve, reject })),
    },
    EditorState: class {
      constructor(options) {
        Object.assign(this, options)
      }
    },
    MemoryTextDocument: class {
      constructor(text) {
        this.text = text
      }
    },
    scheduleLargeDocumentPreviewClose: () => effects.push('close-large'),
    metadataFromOpenFileResult: (r) => r,
    resolveDesktopOpenPolicy: (r) => {
      effects.push('open-policy')
      return r
    },
    recordRecentFile: (_recent, file) => {
      effects.push('recent')
      return [file]
    },
    recentFiles: [],
    watchCurrentFile: () => effects.push('watch'),
    applyEditorViewState: () => effects.push('paint'),
    renderSession: () => effects.push('render'),
    busy: false,
    saving: false,
    closeConfirmOpen: false,
    messages: { notices: { reloadCancelled: 'cancelled', reloadedExternal: 'reloaded' } },
    reloadLargeExternalDocument: async () => effects.push('large-reload'),
  }
  c.isDocumentBusy = () => c.busy
  c.isDocumentSaving = () => c.saving
  vm.createContext(c)
  vm.runInContext(stripTypeScriptTypes(code), c)
  const response = (text = 'EXTERNAL', overrides = {}) => ({
    documentId: 'A',
    file: { path: '/synthetic/a.md' },
    text,
    diskSnapshotHash: text,
    readonly: false,
    ...overrides,
  })
  return { c, reads, effects, response }
}
test('normal clean reload validates and commits native response', async () => {
  const f = setup(),
    p = f.c.reloadExternalDocument()
  f.reads[0].resolve(f.response('EXTERNAL\r\n'))
  await p
  assert.equal(f.c.state.doc.text, 'EXTERNAL\r\n')
  assert.equal(f.c.session.documentVersion, 2)
  assert.equal(f.c.session.savedVersion, 2)
  assert.equal(f.c.session.dirty, false)
  assert.equal(f.c.session.lineEnding, 'crlf')
  assert.deepEqual(f.effects, [
    'close-large',
    'open-policy',
    'recent',
    'watch',
    'paint',
    'render',
    'focus',
  ])
  assert.equal(f.c.session.diskSnapshotHash, 'EXTERNAL\r\n')
  assert.equal(f.c.session.externalChangeState, 'none')
  assert.equal(f.c.currentOpenPolicy.text, 'EXTERNAL\r\n')
  assert.equal(f.c.recentFiles[0].path, '/synthetic/a.md')
})
test('edits after admission survive; original bridge must never run on stale session', async () => {
  const f = setup(),
    p = f.c.reloadExternalDocument()
  f.c.state = { doc: { text: 'UNSAVED-UNIQUE' } }
  f.c.session = { ...f.c.session, documentVersion: 2, dirty: true, externalChangeState: 'conflict' }
  const state = f.c.state,
    session = f.c.session
  f.reads[0].resolve(f.response())
  await p
  assert.equal(f.c.state, state)
  assert.equal(f.c.session, session)
  assert(!f.effects.includes('paint'))
  assert(!f.effects.includes('focus'))
})
test('late read cannot overwrite another document or steal its focus/notice', async () => {
  const f = setup(),
    p = f.c.reloadExternalDocument()
  f.c.state = { doc: { text: 'DOCUMENT-B-UNSAVED' } }
  f.c.session = { ...f.c.session, documentId: 'B', file: { path: '/synthetic/b.md' }, dirty: true }
  f.c.notice = 'document-B-notice'
  const state = f.c.state,
    session = f.c.session
  f.reads[0].resolve(f.response())
  await p
  assert.equal(f.c.state, state)
  assert.equal(f.c.session, session)
  assert.equal(f.c.notice, 'document-B-notice')
  assert.deepEqual(f.effects, [])
})
for (const condition of [
  'version',
  'document',
  'path',
  'snapshot',
  'dirty',
  'external',
  'view',
  'busy',
  'saving',
  'close',
]) {
  test('admission invalidated during native read: ' + condition, async () => {
    const f = setup(),
      p = f.c.reloadExternalDocument()
    if (condition === 'version') f.c.session = { ...f.c.session, documentVersion: 2 }
    if (condition === 'document') f.c.state = { doc: { text: 'NEW-DOCUMENT-OBJECT' } }
    if (condition === 'path')
      f.c.session = { ...f.c.session, file: { path: '/synthetic/renamed.md' } }
    if (condition === 'snapshot') f.c.session = { ...f.c.session, diskSnapshotHash: 'saved-later' }
    if (condition === 'dirty') f.c.session = { ...f.c.session, dirty: true }
    if (condition === 'external')
      f.c.session = { ...f.c.session, externalChangeState: 'deleted-clean' }
    if (condition === 'view') f.c.view = undefined
    if (condition === 'busy') f.c.busy = true
    if (condition === 'saving') f.c.saving = true
    if (condition === 'close') f.c.closeConfirmOpen = true
    const state = f.c.state,
      session = f.c.session
    f.reads[0].resolve(f.response())
    await p
    assert.equal(f.c.state, state)
    assert.equal(f.c.session, session)
    assert(!f.effects.includes('paint'))
    assert(!f.effects.includes('focus'))
  })
}
test('selection-only state replacement does not cancel a valid reload', async () => {
  const f = setup(),
    p = f.c.reloadExternalDocument()
  f.c.state = { ...f.c.state, selection: { head: 1 } }
  f.reads[0].resolve(f.response())
  await p
  assert.equal(f.c.state.doc.text, 'EXTERNAL')
})
for (const reverse of [false, true])
  test('only newest admitted read commits; completion order ' + reverse, async () => {
    const f = setup(),
      first = f.c.reloadExternalDocument(),
      second = f.c.reloadExternalDocument()
    if (reverse) {
      f.reads[1].resolve(f.response('NEWEST'))
      await second
      f.reads[0].resolve(f.response('STALE'))
      await first
    } else {
      f.reads[0].resolve(f.response('STALE'))
      await first
      assert.equal(f.c.state.doc.text, 'ORIGINAL')
      f.reads[1].resolve(f.response('NEWEST'))
      await second
    }
    assert.equal(f.c.state.doc.text, 'NEWEST')
    assert.equal(f.effects.filter((e) => e === 'paint').length, 1)
  })
test('latest cancellation cannot resurrect an older read', async () => {
  const f = setup(),
    state = f.c.state,
    first = f.c.reloadExternalDocument(),
    second = f.c.reloadExternalDocument()
  f.reads[1].resolve(undefined)
  await second
  f.reads[0].resolve(f.response())
  await first
  assert.equal(f.c.state, state)
  assert.equal(f.c.notice, 'cancelled')
  assert(!f.effects.includes('paint'))
})
test('read rejection preserves editor and session', async () => {
  const f = setup(),
    state = f.c.state,
    session = f.c.session,
    p = f.c.reloadExternalDocument()
  f.reads[0].reject(new Error('native read failed'))
  await assert.rejects(p, /native read failed/)
  assert.equal(f.c.state, state)
  assert.equal(f.c.session, session)
})
for (const mismatch of [{ documentId: 'WRONG' }, { file: { path: '/synthetic/wrong.md' } }])
  test(
    'native identity rejection happens before any editor mutation: ' + JSON.stringify(mismatch),
    async () => {
      const f = setup(),
        state = f.c.state,
        session = f.c.session,
        p = f.c.reloadExternalDocument()
      f.reads[0].resolve(f.response('WRONG', mismatch))
      await assert.rejects(p, /does not match/)
      assert.equal(f.c.state, state)
      assert.equal(f.c.session, session)
      assert.deepEqual(f.effects, [], 'native identity validation precedes all commit side effects')
    },
  )
test('already dirty/conflicting document never admits a native reload', async () => {
  const f = setup()
  f.c.session = { ...f.c.session, dirty: true, externalChangeState: 'conflict' }
  const state = f.c.state
  await f.c.reloadExternalDocument()
  assert.equal(f.reads.length, 0)
  assert.equal(f.c.state, state)
})

test('normal reload retains native readonly metadata and large-document routing', async () => {
  const f = setup(),
    p = f.c.reloadExternalDocument()
  f.reads[0].resolve(f.response('READONLY', { readonly: true }))
  await p
  assert.equal(f.c.session.readonly, true)
  const large = setup()
  large.c.view = undefined
  large.c.largeDocumentPreview = {}
  await large.c.reloadExternalDocument()
  assert.equal(large.reads.length, 0)
  assert.deepEqual(large.effects, ['large-reload'])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { mermaidVisibilityScript } from './mermaid-visibility-observer.mjs'

// Deterministic DOM/clock model tests the injected observer's contracts, not a
// browser's painting, performance or the application's Mermaid correctness.
function fixture(options = {}) {
  let now = 0,
    next = 0
  const frames = new Map(),
    timers = new Map()
  const box = (x, y, w = 100, h = 20) => ({ left: x, top: y, right: x + w, bottom: y + h })
  const element = (rect, parentElement = null) => ({
    nodeType: 1,
    childNodes: [],
    matches: () => false,
    rect,
    parentElement,
    isConnected: true,
    hidden: false,
    style: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      overflowX: 'visible',
      overflowY: 'visible',
    },
    clientLeft: 0,
    clientTop: 0,
    clientWidth: rect.right - rect.left,
    clientHeight: rect.bottom - rect.top,
    getBoundingClientRect() {
      return this.rect
    },
    getClientRects() {
      return [this.rect]
    },
  })
  const editor = element(box(10, 10, 300, 100))
  editor.style.overflowY = 'auto'
  const block = element(box(10, 200), editor),
    image = element(box(10, 200), block)
  image.complete = true
  image.naturalWidth = 100
  image.naturalHeight = 20
  const line = element(box(10, 200), editor)
  line.dataset = { from: '10', to: '30' }
  line.classList = { contains: () => false }
  line.childNodes = [{ nodeType: 3, textContent: 'source', parentElement: line }]
  line.style.display = 'none'
  const preceding = element(box(10, 15), editor)
  preceding.dataset = { from: '0', to: '10' }
  preceding.classList = { contains: () => false }
  block.querySelector = () => image
  editor.querySelector = () => block
  editor.querySelectorAll = () => [line, preceding]
  const doc = {
    visibilityState: 'visible',
    path: 'C:\\isolated\\old.md',
    loading: 'ready',
    querySelector(selector) {
      if (selector === '[data-stat="path"]') return { textContent: this.path }
      if (selector === '#app') return { dataset: { loading: this.loading } }
      return editor
    },
    createRange: () => ({
      selectNodeContents(node) {
        this.node = node
      },
      getClientRects() {
        return this.node.parentElement.getClientRects()
      },
    }),
  }
  const context = vm.createContext({
    window: {},
    document: doc,
    innerWidth: 800,
    innerHeight: 600,
    performance: { now: () => now, timeOrigin: 10000 },
    getComputedStyle: (e) => e.style,
    requestAnimationFrame: (cb) => {
      frames.set(++next, cb)
      return next
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (cb, ms) => {
      timers.set(++next, { cb, at: now + ms })
      return next
    },
    clearTimeout: (id) => timers.delete(id),
    arguments: [{ from: 10, to: 30, scenario: 'cold-entry', ...options }],
  })
  vm.runInContext('(function(){' + mermaidVisibilityScript + '}).apply(null, arguments)', context)
  return {
    image,
    line,
    block,
    editor,
    doc,
    context,
    get report() {
      return JSON.parse(JSON.stringify(context.window.__mermaidVisibilityProbe.report))
    },
    get pending() {
      return frames.size + timers.size
    },
    frame(at) {
      now = at
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((cb) => cb())
    },
    time(at) {
      now = at
      for (const [id, t] of [...timers])
        if (t.at <= now) {
          timers.delete(id)
          t.cb()
        }
    },
    reveal() {
      for (const e of [image, line, block]) e.rect = box(10, 25)
    },
  }
}

test('prearmed probe ignores old document offsets and requires target ready, then rejects navigation', () => {
  const f = fixture({ expectedDocument: 'C:\\isolated\\target.md' })
  f.reveal()
  f.frame(16)
  assert.equal(f.report.samples, 0)
  assert.equal(f.report.decoded, null, 'Old decoded graph is not target evidence')
  f.doc.path = 'c:/ISOLATED/target.md'
  f.doc.loading = 'loading'
  f.frame(32)
  assert.equal(f.report.samples, 0)
  f.doc.loading = 'ready'
  f.image.complete = false
  f.frame(48)
  assert.equal(f.report.documentMatchedAt, 48)
  assert.equal(f.report.waitingDocumentFrames, 2)
  assert.equal(f.report.samples, 1)
  f.doc.path = 'C:\\isolated\\another.md'
  f.frame(64)
  assert.equal(f.report.stopReason, 'document-changed')
  assert.equal(f.report.complete, false)
  assert.equal(f.pending, 0)
})

test('prearmed wait remains bounded and cannot finish using a late unrelated image', () => {
  const f = fixture({ expectedDocument: 'C:\\isolated\\target.md', maxFrames: 2 })
  f.frame(16)
  f.frame(32)
  assert.equal(f.report.stopReason, 'frame-budget')
  assert.equal(f.report.complete, false)
  assert.equal(f.pending, 0)
})

test('decoded but clipped below editor is not visible even inside the desktop viewport', () => {
  const f = fixture()
  f.frame(16)
  assert.equal(f.report.firstVisible, null)
  assert.equal(f.report.decoded, null)
  f.reveal()
  f.frame(32)
  assert.equal(f.report.firstVisible, 32)
  assert.equal(f.report.decoded, 32)
  assert.equal(f.report.complete, true)
  assert.equal(f.report.sourceVisibleFrames, 0)
  assert.equal(f.pending, 0)
})
test('cold-entry source exposure is preserved even when the eventual wait is below 100ms', () => {
  const f = fixture()
  f.reveal()
  f.image.complete = false
  f.line.style.display = 'block'
  f.frame(16)
  f.frame(32)
  f.image.complete = true
  f.line.style.display = 'none'
  f.frame(48)
  assert.equal(f.report.sourceVisibleFrames, 2)
  assert.equal(f.report.sourceFirstVisible, 16)
  assert.equal(f.report.sourceLastVisible, 32)
  assert.equal(f.report.decoded - f.report.firstVisible, 32)
  assert.equal(f.report.transitions.length, 2)
  assert.equal(f.report.scenario, 'cold-entry')
})
test('horizontal clipping, hidden ancestors and a hidden document cannot satisfy decode', () => {
  const f = fixture()
  f.reveal()
  f.editor.style.overflowX = 'hidden'
  f.editor.clientWidth = 0
  f.frame(16)
  assert.equal(f.report.decoded, null)
  f.editor.clientWidth = 300
  f.editor.style.opacity = '0'
  f.frame(32)
  assert.equal(f.report.decoded, null)
  f.editor.style.opacity = '1'
  f.doc.visibilityState = 'hidden'
  f.frame(48)
  assert.equal(f.report.decoded, null)
  f.doc.visibilityState = 'visible'
  f.frame(64)
  assert.equal(f.report.decoded, 64)
})
test('large frame gaps are retained and stopped observers cannot report success', () => {
  const f = fixture()
  f.frame(16)
  f.frame(2000)
  assert.equal(f.report.maxSampleGapMs, 1984)
  f.context.window.__mermaidVisibilityProbe.stop()
  f.reveal()
  f.frame(2016)
  assert.equal(f.report.complete, false)
  assert.equal(f.report.stopReason, 'stopped')
  assert.equal(f.pending, 0)
})
test('wall deadline stops even when rAF never runs; frame budget also fails closed', () => {
  const f = fixture({ maxMs: 100 })
  f.time(100)
  assert.equal(f.report.complete, false)
  assert.equal(f.report.stopReason, 'deadline')
  assert.equal(f.pending, 0)
  const g = fixture({ maxFrames: 1 })
  g.frame(16)
  assert.equal(g.report.complete, false)
  assert.equal(g.report.stopReason, 'frame-budget')
})
test('transition overflow retains the failure even if an image later becomes visible', () => {
  const f = fixture()
  f.reveal()
  f.image.complete = false
  for (let i = 0; i < 66; i++) {
    f.line.style.display = i % 2 ? 'none' : 'block'
    f.frame(16 * (i + 1))
  }
  f.image.complete = true
  f.frame(1100)
  assert.equal(f.report.overflow, true)
  assert.equal(f.report.transitions.length, 64)
  assert.equal(f.report.complete, false)
})
test('invalid scope and budgets rejected; installing another observer cancels the first', () => {
  for (const args of [
    { from: -1 },
    { to: 10 },
    { scenario: 'cold' },
    { maxMs: 60001 },
    { maxFrames: 3601 },
  ])
    assert.throws(() => fixture(args))
  const f = fixture()
  const old = f.context.window.__mermaidVisibilityProbe
  vm.runInContext('(function(){' + mermaidVisibilityScript + '}).apply(null, arguments)', f.context)
  assert.equal(old.report.stopReason, 'stopped')
  assert.equal(f.pending, 2)
})

test('an already decoded first sample is explicitly left-censored, not an exact first-paint time', () => {
  const f = fixture({ scenario: 'document-open' })
  f.reveal()
  f.frame(16)
  const initial = f.context.window.__mermaidInitialVisibilityProbe.report
  assert.equal(initial.complete, true)
  assert.equal(initial.decodedAtFirstSample, true)
  assert.equal(initial.scenario, 'document-open')
  // A subsequent warmed-entry observer cannot overwrite the startup evidence.
  f.context.arguments[0].scenario = 'prefetch-ready'
  vm.runInContext('(function(){' + mermaidVisibilityScript + '}).apply(null, arguments)', f.context)
  assert.equal(f.context.window.__mermaidInitialVisibilityProbe.report, initial)
})

test('a source-line host containing only the diagram must not count as visible Markdown', () => {
  const f = fixture()
  f.reveal()
  f.line.style.display = 'block'
  f.block.matches = (selector) => selector.includes('[data-document-presentation]')
  f.line.childNodes = [f.block]
  f.block.parentElement = f.line
  f.frame(16)
  assert.equal(f.report.complete, true)
  assert.equal(f.report.sourceVisibleFrames, 0)
})

import { MemoryDocumentSource, Selection } from '@milkup/core'
import { SourceDocumentView } from '../source-document-view'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentPresentation, type PresentationSnapshot } from '../document-presentation'

const managers: DocumentPresentation[] = []
afterEach(() => {
  managers.splice(0).forEach((manager) => manager.destroy())
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
async function settle() {
  for (let n = 0; n < 10; n++) await Promise.resolve()
}
function pointer(target: EventTarget, name: string, extras: Record<string, unknown> = {}) {
  const event = new MouseEvent(name, { bubbles: true, button: 0, buttons: 1 })
  Object.defineProperties(
    event,
    Object.fromEntries(
      Object.entries({ pointerId: 1, isPrimary: true, ...extras }).map(([key, value]) => [
        key,
        { value },
      ]),
    ),
  )
  target.dispatchEvent(event)
}
async function fixture() {
  const root = document.createElement('div'),
    content = document.createElement('div'),
    line = document.createElement('div')
  line.className = 'milkup-line'
  Object.assign(line.dataset, { line: '1', from: '0', to: '10' })
  line.textContent = 'link tail!'
  root.append(content)
  content.append(line)
  document.body.append(root)
  const state: PresentationSnapshot = {
    mode: 'live',
    sourceIdentity: {},
    sourceVersion: 0,
    documentVersion: 0,
    selection: { anchor: 10, head: 10 },
    lineCount: 1,
    read: (from, to) => 'link tail!'.slice(from, to),
  }
  let provided = 0
  const navigate = vi.fn()
  const config = {
    onNavigate: navigate,
    provide: async ({
      sourceIdentity: _i,
      sourceVersion: _v,
      documentVersion: _d,
      ...window
    }: any) => {
      provided++
      return {
        declarations: [{ id: 'fixture', contexts: ['text' as const] }],
        request: {
          ...window,
          documentId: 'pointer',
          version: 0,
          contextKnown: true,
          protectedRanges: [],
          blocks: [],
          theme: 'light' as const,
          target: 'screen' as const,
        },
        result: {
          complete: true,
          fragments: [
            {
              from: 0,
              to: 4,
              layout: 'inline' as const,
              accessibleText: 'link',
              content: {
                type: 'reference' as const,
                label: 'Jump',
                target: { documentId: 'pointer', version: 0, from: 5, to: 9 },
              },
            },
          ],
        },
      }
    },
  }
  const manager = new DocumentPresentation(
    root,
    content,
    config,
    () => ({ ...state, selection: { ...state.selection } }),
    () => {},
    () => {},
  )
  managers.push(manager)
  manager.schedule()
  await settle()
  const button = content.querySelector<HTMLElement>('button')!
  expect(button).not.toBeNull()
  return { manager, root, content, state, button, navigate, config, provided: () => provided }
}
for (const cause of [
  'up',
  'cancel',
  'blur',
  'hidden',
  'no-buttons',
  'escape',
  'input',
  'source',
  'version',
  'document-version',
  'selection',
  'mode',
  'config',
  'destroy',
]) {
  it(`releases a reference layout wait on ${cause}`, async () => {
    const f = await fixture()
    pointer(f.button, 'pointerdown')
    let done = false
    const pending = f.manager.waitForReferencePointer()!.then(() => {
      done = true
    })
    await settle()
    expect(done).toBe(false)
    if (cause === 'up') {
      pointer(document, 'pointerup')
      await settle()
      expect(done).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (cause === 'cancel') pointer(document, 'pointercancel')
    if (cause === 'blur') window.dispatchEvent(new Event('blur'))
    if (cause === 'hidden') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    }
    if (cause === 'no-buttons') pointer(document, 'pointermove', { buttons: 0 })
    if (cause === 'escape')
      f.button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    if (cause === 'input') f.root.dispatchEvent(new Event('beforeinput'))
    if (cause === 'source') Object.assign(f.state, { sourceIdentity: {} })
    if (cause === 'version') Object.assign(f.state, { sourceVersion: 1 })
    if (cause === 'document-version') Object.assign(f.state, { documentVersion: 1 })
    if (cause === 'selection') Object.assign(f.state, { selection: { anchor: 9, head: 9 } })
    if (cause === 'mode') Object.assign(f.state, { mode: 'source' })
    if (cause === 'config') f.manager.setConfig(undefined)
    if (cause === 'destroy') f.manager.destroy()
    f.manager.hasReferencePointer()
    await pending
    expect(done).toBe(true)
    expect(f.navigate).not.toHaveBeenCalled()
  })
}
it('does not hold secondary or non-primary pointer gestures', async () => {
  const f = await fixture()
  for (const extras of [{ button: 2 }, { isPrimary: false }, { ctrlKey: true }]) {
    pointer(f.button, 'pointerdown', extras)
    expect(f.manager.waitForReferencePointer()).toBeUndefined()
  }
})
it('an aborted provider releases its own waiter without ending a valid pointer gesture', async () => {
  const f = await fixture(),
    abort = new AbortController()
  pointer(f.button, 'pointerdown')
  const pending = f.manager.waitForReferencePointer(abort.signal)!
  abort.abort()
  await pending
  expect(f.manager.hasReferencePointer()).toBe(true)
})
it('provider-settled pointer waiting does not consume the host preparation deadline', async () => {
  const f = await fixture()
  vi.useFakeTimers()
  pointer(f.button, 'pointerdown')
  f.manager.refresh()
  await settle()
  expect(f.provided()).toBe(2)
  await vi.advanceTimersByTimeAsync(10001)
  expect(f.content.querySelector('button')).toBe(f.button)
  expect(f.root.querySelector('[data-document-presentation-notice]')).toBeNull()
  expect(f.navigate).not.toHaveBeenCalled()
  pointer(document, 'pointerup')
  f.button.click()
  expect(f.navigate).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(0)
  expect(f.content.querySelector('button')).not.toBe(f.button)
})

it('ignores a second pointer without ending or activating the primary gesture', async () => {
  const f = await fixture()
  pointer(f.button, 'pointerdown')
  const pending = f.manager.waitForReferencePointer()!
  pointer(f.button, 'pointerdown', { pointerId: 2, isPrimary: false })
  pointer(document, 'pointerup', { pointerId: 2 })
  pointer(f.button, 'pointerdown', { button: 2 })
  expect(f.manager.hasReferencePointer()).toBe(true)
  expect(f.navigate).not.toHaveBeenCalled()
  pointer(document, 'pointercancel')
  await pending
})

for (const end of ['up', 'source-change', 'destroy']) {
  it(`coalesces Source windows and settles every waiter after ${end}`, async () => {
    const f = await fixture()
    const parent = document.createElement('main')
    document.body.append(parent)
    const source = new MemoryDocumentSource({
      documentId: 'pointer',
      text: 'link tail!\n' + 'retained\n'.repeat(100),
    })
    const view = new SourceDocumentView({
      parent,
      source,
      mode: 'live',
      documentPresentation: f.config,
      virtualViewport: { enabled: true, viewportHeight: 126, overscanLines: 2 },
    })
    try {
      await view.revealSelection(1, Selection.cursor(10))
      await settle()
      const button = view.contentDOM.querySelector('button')!
      expect(button).not.toBeNull()
      pointer(button, 'pointerdown')
      const pending = [
        view.renderVisibleWindow(),
        view.renderVisibleWindow(),
        view.renderVisibleWindow(),
      ]
      await settle()
      const internal = view as unknown as {
        deferredPresentationRender?: { request: { id: number }; promise: Promise<void> }
        latestAppliedRequestId: number
      }
      expect(internal.deferredPresentationRender).toBeDefined()
      const latest = internal.deferredPresentationRender!.request.id
      expect(view.contentDOM.contains(button)).toBe(true)
      if (end === 'up') {
        pointer(document, 'pointerup')
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (end === 'source-change')
        view.updateSource(new MemoryDocumentSource({ documentId: 'new', text: 'new document' }))
      if (end === 'destroy') view.destroy()
      await Promise.all(pending)
      expect(internal.deferredPresentationRender).toBeUndefined()
      if (end === 'up') expect(internal.latestAppliedRequestId).toBeGreaterThanOrEqual(latest)
      if (end === 'source-change') {
        await view.renderVisibleWindow()
        expect(view.contentDOM.textContent).toContain('new document')
        expect(view.contentDOM.textContent).not.toContain('retained')
      }
      expect((await source.readLineWindow(1, source.lineCount)).text).toBe(
        'link tail!\n' + 'retained\n'.repeat(100),
      )
    } finally {
      view.destroy()
    }
  })
}
it('keeps legacy unguarded missing-line navigation compatible', async () => {
  const view = new SourceDocumentView({
    parent: document.body,
    source: new MemoryDocumentSource({ documentId: 'legacy', text: 'line\n'.repeat(100) }),
    virtualViewport: { enabled: true, viewportHeight: 100, overscanLines: 2 },
  })
  try {
    await view.renderVisibleWindow()
    vi.spyOn(view, 'scrollToLine').mockResolvedValue(undefined)
    await expect(view.revealSelection(99)).resolves.toBeUndefined()
    expect(view.selection.main.head).toBe(0)
  } finally {
    view.destroy()
  }
})

it('keeps a settled response waiting when a new primary gesture replaces the released lease', async () => {
  const f = await fixture()
  vi.useFakeTimers()
  pointer(f.button, 'pointerdown')
  f.manager.refresh()
  await settle()
  expect(f.provided()).toBe(2)
  expect(f.content.querySelector('button')).toBe(f.button)

  // The input task for a new press can run before the preceding up's timer.
  // Starting it synchronously releases the old waiter and creates the new lease
  // before that waiter's promise continuation gets its microtask turn.
  pointer(document, 'pointerup')
  pointer(f.button, 'pointerdown')
  await settle()
  console.info(
    'pointer-handoff',
    JSON.stringify({
      originalConnected: f.button.isConnected,
      sameButton: f.content.querySelector('button') === f.button,
      activeLease: f.manager.hasReferencePointer(),
      provided: f.provided(),
      navigationCalls: f.navigate.mock.calls.length,
    }),
  )
  expect(f.content.querySelector('button')).toBe(f.button)
  expect(f.manager.hasReferencePointer()).toBe(true)
  expect(f.navigate).not.toHaveBeenCalled()

  pointer(document, 'pointerup')
  f.button.click()
  await vi.advanceTimersByTimeAsync(0)
  expect(f.navigate).toHaveBeenCalledTimes(1)
  expect(f.content.querySelector('button')).not.toBe(f.button)
})

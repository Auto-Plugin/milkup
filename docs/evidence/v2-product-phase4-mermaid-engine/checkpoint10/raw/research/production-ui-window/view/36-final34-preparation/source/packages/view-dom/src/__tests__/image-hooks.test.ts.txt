import { EditorState, MemoryDocumentSource, MemoryTextDocument, Selection } from '@milkup/core'
import { afterEach, expect, it, vi } from 'vitest'
import { EditorView, SourceDocumentView, type ResolvedImageResource } from '../index'
import { managedImageURL } from '../image-presentation'

const views: Array<EditorView | SourceDocumentView> = []
afterEach(() => views.splice(0).forEach((view) => view.destroy()))
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
for (const windowed of [false, true]) {
  it(`routes only empty clipboard payloads to the controlled fallback (${windowed})`, async () => {
    const emptyPaste = vi.fn((_context: unknown) => true)
    const doc = new MemoryTextDocument('中文😀 tail')
    const config = {
      parent: document.createElement('main'),
      onEmptyPaste: emptyPaste,
      editable: true,
    }
    const view = windowed
      ? new SourceDocumentView({
          ...config,
          source: new MemoryDocumentSource({ documentId: 'empty-paste', document: doc }),
        })
      : new EditorView({
          ...config,
          state: new EditorState({ doc, selection: Selection.range(2, 4) }),
        })
    views.push(view)
    if (view instanceof SourceDocumentView) await view.revealSelection(1, Selection.range(2, 4))
    const dispatch = (payload: object) => {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: payload })
      view.inputDOM.dispatchEvent(event)
      return event
    }
    const event = dispatch({ files: [], items: [], types: [], getData: () => '' })
    expect(emptyPaste).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    const context = emptyPaste.mock.calls[0]?.[0] as unknown as {
      selection: object
      event: Event
      signal: AbortSignal
    }
    expect(context.selection).toEqual({ anchor: 2, head: 4 })
    expect(context.event).toBe(event)
    view.setEditable(false)
    expect(context.signal.aborted).toBe(true)
    view.setEditable(true)
    for (const payload of [
      { files: [], items: [], types: ['text/plain'], getData: () => '' },
      { files: [], items: [{ kind: 'string', type: 'text/html' }], types: [], getData: () => '' },
      {
        files: [new File(['x'], 'file.txt', { type: 'text/plain' })],
        items: [],
        types: [],
        getData: () => '',
      },
      {
        files: [],
        items: [],
        types: [],
        getData: (type: string) => (type === 'text/html' ? '<b>x</b>' : ''),
      },
      {
        files: [],
        items: [],
        types: [],
        getData: (type: string) => (type === 'text/plain' ? 'text' : ''),
      },
    ])
      dispatch(payload)
    expect(emptyPaste).toHaveBeenCalledTimes(1)
  })
  it(`leaves an unclaimed empty paste unprevented (${windowed})`, () => {
    const emptyPaste = vi.fn((_context: unknown) => false)
    const doc = new MemoryTextDocument('text')
    const config = {
      parent: document.createElement('main'),
      onEmptyPaste: emptyPaste,
      editable: true,
    }
    const view = windowed
      ? new SourceDocumentView({
          ...config,
          source: new MemoryDocumentSource({ documentId: 'unclaimed', document: doc }),
        })
      : new EditorView({ ...config, state: new EditorState({ doc }) })
    views.push(view)
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [], items: [], types: [], getData: () => '' },
    })
    view.inputDOM.dispatchEvent(event)
    expect(emptyPaste).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })

  it(`renders an escaped closing bracket in image alt text (${windowed})`, async () => {
    const doc = new MemoryTextDocument('![图 \\[A\\] \\\\](assets/local.png)\nend')
    const resolver = vi.fn(async () => ({
      url: 'blob:escaped-alt',
      mimeType: 'image/png',
      width: 64,
      height: 64,
      dispose: () => {},
    }))
    const config = {
      parent: document.createElement('main'),
      mode: 'live' as const,
      imageResolver: resolver,
    }
    const view = windowed
      ? new SourceDocumentView({
          ...config,
          source: new MemoryDocumentSource({ documentId: 'escaped-alt', document: doc }),
        })
      : new EditorView({ ...config, state: new EditorState({ doc }) })
    views.push(view)
    await settle()
    await settle()
    const image = view.contentDOM.querySelector('img')
    expect(image?.getAttribute('src')).toBe('blob:escaped-alt')
    expect(image?.alt).toBe('图 [A] \\')
  })
  it(`refreshes a newly available local image without a document transaction (${windowed})`, async () => {
    const doc = new MemoryTextDocument('![image](assets/local.png)\nend')
    const dispose = vi.fn()
    let available = false
    const resolver = vi.fn(async () =>
      available
        ? { url: 'blob:restored', mimeType: 'image/png', width: 64, height: 64, dispose }
        : undefined,
    )
    const config = {
      parent: document.createElement('main'),
      mode: 'live' as const,
      imageResolver: resolver,
    }
    const view = windowed
      ? new SourceDocumentView({
          ...config,
          source: new MemoryDocumentSource({ documentId: 'refresh', document: doc }),
        })
      : new EditorView({ ...config, state: new EditorState({ doc }) })
    views.push(view)
    await settle()
    await settle()
    expect(view.contentDOM.querySelector('img')).toBeNull()
    const revision = view.selectionRevision
    available = true
    view.refreshResourceImages()
    await settle()
    await settle()
    expect(view.contentDOM.querySelector('img')?.getAttribute('src')).toBe('blob:restored')
    expect(view.selectionRevision).toBe(revision)
    expect(doc.text).toBe('![image](assets/local.png)\nend')
  })
  it(`delivers real paste files with the event-time selection and aborts on disable (${windowed})`, async () => {
    const paste = vi.fn()
    const doc = new MemoryTextDocument('中文😀 tail')
    const config = { parent: document.createElement('main'), onImagePaste: paste }
    const view = windowed
      ? new SourceDocumentView({
          ...config,
          source: new MemoryDocumentSource({ documentId: 'image-test', document: doc }),
          editable: true,
        })
      : new EditorView({
          ...config,
          state: new EditorState({ doc, selection: Selection.range(2, 4) }),
        })
    views.push(view)
    if (view instanceof SourceDocumentView) await view.revealSelection(1, Selection.range(2, 4))
    const file = new File(['png'], 'local.png', { type: 'image/png' })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files: [file], getData: () => '' } })
    view.inputDOM.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(paste).toHaveBeenCalledTimes(1)
    expect(paste.mock.calls[0]?.[0]).toEqual([file])
    expect(paste.mock.calls[0]?.[1].selection).toEqual({ anchor: 2, head: 4 })
    expect(paste.mock.calls[0]?.[1].event).toBe(event)
    view.setEditable(false)
    expect(paste.mock.calls[0]?.[1].signal.aborted).toBe(true)
    expect(doc.text).toBe('中文😀 tail')
    const blocked = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(blocked, 'clipboardData', { value: { files: [file], getData: () => '' } })
    view.inputDOM.dispatchEvent(blocked)
    expect(paste).toHaveBeenCalledTimes(1)
  })
  it(`renders only resolver-owned blobs, preserves text, and disposes on destroy (${windowed})`, async () => {
    const text = '![中文](assets/local.png)\n\n![remote](https://example.com/x.png)\nend'
    const doc = new MemoryTextDocument(text)
    const dispose = vi.fn(),
      resolver = vi.fn(async () => ({
        url: 'blob:local-test',
        mimeType: 'image/png',
        width: 800,
        height: 600,
        dispose,
      }))
    const config = {
      parent: document.createElement('main'),
      mode: 'live' as const,
      imageResolver: resolver,
    }
    const view = windowed
      ? new SourceDocumentView({
          ...config,
          source: new MemoryDocumentSource({ documentId: 'image-test', document: doc }),
        })
      : new EditorView({
          ...config,
          state: new EditorState({ doc, selection: Selection.cursor(text.length) }),
        })
    views.push(view)
    await settle()
    await settle()
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(view.contentDOM.querySelector('img')?.getAttribute('src')).toBe('blob:local-test')
    expect(view.contentDOM.querySelector('img')?.style.maxHeight).toBe('480px')
    expect(doc.text).toBe(text)
    view.destroy()
    views.pop()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
  it(`reports selection ABA changes and composition without changing content (${windowed})`, async () => {
    const doc = new MemoryTextDocument('中文😀 tail')
    const view = windowed
      ? new SourceDocumentView({
          parent: document.createElement('main'),
          source: new MemoryDocumentSource({ documentId: 'revision', document: doc }),
        })
      : new EditorView({ parent: document.createElement('main'), state: new EditorState({ doc }) })
    views.push(view)
    const before = view.selectionRevision
    if (view instanceof SourceDocumentView) {
      await view.revealSelection(1, Selection.cursor(2))
      await view.revealSelection(1, Selection.cursor(0))
    } else {
      view.updateState(view.state.applyTransaction({ selection: Selection.cursor(2) }))
      view.updateState(view.state.applyTransaction({ selection: Selection.cursor(0) }))
    }
    expect(view.selectionRevision).toBeGreaterThan(before)
    const focused = view.selectionRevision
    view.inputDOM.focus()
    expect(view.selectionRevision).toBe(focused)
    view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    expect(view.isComposing).toBe(true)
    view.inputDOM.dispatchEvent(new CompositionEvent('compositionend', { data: '' }))
    expect(view.isComposing).toBe(false)
    expect(doc.text).toBe('中文😀 tail')
  })
  it(`disposes a late resolver response after the view is destroyed (${windowed})`, async () => {
    let resolve!: (resource: ResolvedImageResource) => void
    const resolver = vi.fn(
      () =>
        new Promise<ResolvedImageResource>((done) => {
          resolve = done
        }),
    )
    const doc = new MemoryTextDocument('![image](assets/local.png)\nend')
    const config = {
      parent: document.createElement('main'),
      mode: 'live' as const,
      imageResolver: resolver,
    }
    const view = windowed
      ? new SourceDocumentView({
          ...config,
          source: new MemoryDocumentSource({ documentId: 'late', document: doc }),
        })
      : new EditorView({ ...config, state: new EditorState({ doc }) })
    views.push(view)
    await settle()
    await settle()
    expect(resolver).toHaveBeenCalledTimes(1)
    view.destroy()
    views.pop()
    const dispose = vi.fn()
    resolve({ url: 'blob:late', mimeType: 'image/png', width: 10, height: 10, dispose })
    await settle()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(view.contentDOM.querySelector('img')).toBeNull()
  })
  it(`renders nested strikethrough with mapped Unicode content (${windowed})`, async () => {
    const text = '~~中文 **bold** 😀~~ tail\nend'
    const doc = new MemoryTextDocument(text)
    const config = { parent: document.createElement('main'), mode: 'live' as const }
    const view = windowed
      ? new SourceDocumentView({
          ...config,
          source: new MemoryDocumentSource({ documentId: 'strike', document: doc }),
        })
      : new EditorView({
          ...config,
          state: new EditorState({ doc, selection: Selection.cursor(text.length) }),
        })
    views.push(view)
    if (view instanceof SourceDocumentView)
      await view.revealSelection(2, Selection.cursor(text.length))
    await settle()
    const strike = view.contentDOM.querySelector<HTMLElement>('.milkup-inline-strikethrough')
    expect(strike?.style.textDecoration).toBe('line-through')
    expect(strike?.querySelector('.milkup-inline-strong')?.textContent).toContain('bold')
    expect(strike?.dataset.from).toBe('0')
    expect(strike?.dataset.to).toBe(String(text.indexOf(' tail')))
    expect(doc.text).toBe(text)
  })
}

it('rejects remote, absolute, traversal and encoded path escapes before resource lookup', () => {
  for (const value of [
    'https://site/x.png',
    'file:///tmp/x.png',
    '/tmp/x.png',
    '../assets/x.png',
    'assets/../x.png',
    'assets/%2e%2e%2fx.png',
    'assets%5cimage.png',
    'assets/x.svg',
    'data:image/png;base64,AA',
  ])
    expect(managedImageURL(value)).toBe(false)
  expect(managedImageURL('guide.v2.assets/local.png')).toBe(true)
})

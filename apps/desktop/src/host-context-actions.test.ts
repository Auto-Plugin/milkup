import { describe, expect, it, vi } from 'vitest'
import { EditorState, MemoryDocumentSource, MemoryTextDocument, Selection } from '@milkup/core'
import { createDocumentSession, recordDocumentTransaction } from '@milkup/tauri-bridge'
import { createDesktopEditingService, type DesktopEditingCurrent } from './editing-service'
import { createHostContextActions, type HostContextSnapshot } from './host-context-actions'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function fixture(text = '前😀后\r\nnext\r\n', deferredClipboard = false) {
  let state = new EditorState({ doc: new MemoryTextDocument(text) })
  let session = createDocumentSession({ documentId: 'doc' })
  let source = new MemoryDocumentSource({ documentId: 'doc', document: state.doc })
  const attributes = {
    identity: {},
    version: 0,
    selectionRevision: 0,
    saveLocationGeneration: 0,
    readonly: false,
    busy: false,
    mode: 'memory' as 'memory' | 'windowed',
  }
  const current = (): DesktopEditingCurrent => ({
    ...attributes,
    documentId: 'doc',
    source,
    selection: state.selection,
    lineEnding: text.includes('\r\n') ? 'crlf' : 'lf',
  })
  const captureSnapshot = (): HostContextSnapshot => ({
    ...current(),
    canUndo: state.history.canUndo,
    canRedo: state.history.canRedo,
  })
  const isCurrent = (expected: HostContextSnapshot) => {
    const actual = current()
    return (
      actual.identity === expected.identity &&
      actual.source === expected.source &&
      actual.version === expected.version &&
      actual.source.version === expected.version &&
      actual.selectionRevision === expected.selectionRevision &&
      actual.saveLocationGeneration === expected.saveLocationGeneration &&
      actual.selection === expected.selection
    )
  }
  const commit = vi.fn(async (batch, guard: () => void) => {
    guard()
    state = state.applyTransaction(batch)
    session = recordDocumentTransaction(session, batch)
    attributes.version = session.documentVersion
    source = new MemoryDocumentSource({
      documentId: 'doc',
      document: state.doc,
      version: attributes.version,
    })
    return { documentId: 'doc', version: attributes.version }
  })
  const service = createDesktopEditingService({
    current,
    runExclusive: async (action) => action(),
    commit,
  })
  const owner = service.adapterForHost()
  const deferredWrite = vi.fn(async (text: Promise<string>) => {
    await text
  })
  const clipboard = {
    readText: vi.fn(async () => '粘贴'),
    writeText: vi.fn(async (_text: string) => {}),
    ...(deferredClipboard ? { writeTextDeferred: deferredWrite } : {}),
  }
  const select = (anchor: number, head = anchor) => {
    attributes.selectionRevision++
    state = state.applyTransaction({ selection: Selection.range(anchor, head) })
  }
  const selectAll = vi.fn(async (snapshot: HostContextSnapshot, signal: AbortSignal) => {
    if (signal.aborted || !isCurrent(snapshot)) throw new Error('Unexpected stale selection')
    select(0, state.doc.length)
  })
  const history = vi.fn(
    async (direction: 'undo' | 'redo', snapshot: HostContextSnapshot, signal: AbortSignal) => {
      if (signal.aborted || !isCurrent(snapshot)) throw new Error('Unexpected stale history')
      state = direction === 'undo' ? state.undo() : state.redo()
      attributes.version++
      attributes.selectionRevision++
      source = new MemoryDocumentSource({
        documentId: 'doc',
        document: state.doc,
        version: attributes.version,
      })
    },
  )
  const actions = createHostContextActions({
    editing: owner.adapter,
    clipboard,
    captureSnapshot,
    isCurrent,
    selectAll,
    history,
  })
  const run = (id: string, signal?: AbortSignal) =>
    actions.run(id, captureSnapshot(), undefined, signal ? { signal } : undefined)
  return {
    actions,
    attributes,
    captureSnapshot,
    clipboard,
    commit,
    current,
    deferredWrite,
    history,
    owner,
    run,
    select,
    selectAll,
    state: () => state,
    session: () => session,
    replaceSource: () => {
      source = new MemoryDocumentSource({
        documentId: 'doc',
        document: state.doc,
        version: attributes.version,
      })
    },
  }
}

describe('host context commands', () => {
  it('owns basic commands and a bounded insertion hierarchy independently of plugins', () => {
    const f = fixture()
    const items = f.actions.items(f.captureSnapshot())
    expect(items.map((item) => item.id)).toEqual([
      'host.copy',
      'host.cut',
      'host.paste',
      'host.select-all',
      'host.undo',
      'host.redo',
      'host.insert',
    ])
    expect(items.every((item) => item.icon)).toBe(true)
    const insertion = items.find((item) => item.id === 'host.insert')!.children!
    const headings = insertion.find((item) => item.id === 'host.insert.heading')!.children!
    expect(headings.map((item) => item.id)).toEqual(
      Array.from({ length: 6 }, (_, index) => `host.insert.heading-${index + 1}`),
    )
    expect(insertion.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'host.insert.bullet-list',
        'host.insert.ordered-list',
        'host.insert.task-list',
        'host.insert.quote',
        'host.insert.code-block',
        'host.insert.link',
        'host.insert.image',
        'host.insert.table',
        'host.insert.horizontal-rule',
      ]),
    )
  })

  it('copies a reverse Unicode/CRLF selection in readonly without dirtying or history', async () => {
    const f = fixture()
    f.select(6, 1)
    f.attributes.readonly = true
    await f.run('host.copy')
    expect(f.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('😀后\r\n')
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.state().selection.main).toMatchObject({ anchor: 6, head: 1 })
    expect(f.state().history.canUndo).toBe(false)
    expect(f.session()).toMatchObject({ dirty: false, documentVersion: 0 })
  })

  it('waits for successful clipboard write before cut, and restores reverse selection with undo', async () => {
    const f = fixture()
    f.select(6, 1)
    const writing = deferred<void>()
    f.clipboard.writeText.mockReturnValueOnce(writing.promise)
    const pending = f.run('host.cut')
    await vi.waitFor(() => expect(f.clipboard.writeText).toHaveBeenCalledOnce())
    expect(f.state().doc.text).toBe('前😀后\r\nnext\r\n')
    expect(f.commit).not.toHaveBeenCalled()
    writing.resolve()
    await pending
    expect(f.state().doc.text).toBe('前next\r\n')
    expect(f.state().selection.main).toMatchObject({ anchor: 1, head: 1 })
    expect(f.state().undo().doc.text).toBe('前😀后\r\nnext\r\n')
    expect(f.state().undo().selection.main).toMatchObject({ anchor: 6, head: 1 })
    expect(f.commit.mock.calls[0]![0].historyGroup).toBe('isolate')
  })

  it('starts a deferred system copy synchronously while its bounded readonly source capture is pending', async () => {
    const f = fixture('前😀后\r\nnext\r\n', true)
    f.select(6, 1)
    f.attributes.readonly = true
    const read = vi.spyOn(f.current().source, 'readLineWindow')
    const pending = f.run('host.copy')
    expect(f.deferredWrite).toHaveBeenCalledOnce()
    expect(read).not.toHaveBeenCalled()
    expect(f.clipboard.writeText).not.toHaveBeenCalled()
    await pending
    await expect(f.deferredWrite.mock.calls[0]![0]).resolves.toBe('😀后\r\n')
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('does not cut until the deferred platform write resolves after reading its text item', async () => {
    const f = fixture('前😀后\r\nnext\r\n', true)
    f.select(6, 1)
    const writing = deferred<void>()
    f.deferredWrite.mockImplementationOnce(async (text) => {
      await text
      await writing.promise
    })
    const pending = f.run('host.cut')
    expect(f.deferredWrite).toHaveBeenCalledOnce()
    await expect(f.deferredWrite.mock.calls[0]![0]).resolves.toBe('😀后\r\n')
    expect(f.commit).not.toHaveBeenCalled()
    writing.resolve()
    await pending
    expect(f.state().doc.text).toBe('前next\r\n')
    expect(f.state().undo().selection.main).toMatchObject({ anchor: 6, head: 1 })
  })

  it('preserves source budget errors when the deferred clipboard rejects its text promise', async () => {
    const f = fixture('x'.repeat(70_000), true)
    f.select(0, 70_000)
    await expect(f.run('host.cut')).rejects.toMatchObject({ code: 'too-large' })
    expect(f.deferredWrite).toHaveBeenCalledOnce()
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('releases captured leases after an immediate deferred clipboard refusal', async () => {
    const f = fixture('hello', true)
    f.select(0, 5)
    f.deferredWrite.mockImplementation(() => {
      throw new DOMException('Denied', 'NotAllowedError')
    })
    for (let attempt = 0; attempt < 10; attempt++)
      await expect(f.run('host.cut')).rejects.toMatchObject({ code: 'clipboard-write' })
    expect(f.state().doc.text).toBe('hello')
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('cancels a deferred cut and ignores its late clipboard success', async () => {
    const f = fixture('hello', true)
    f.select(0, 5)
    const writing = deferred<void>()
    f.deferredWrite.mockImplementationOnce(async (text) => {
      await text
      await writing.promise
    })
    const controller = new AbortController()
    const pending = f.run('host.cut', controller.signal)
    await f.deferredWrite.mock.calls[0]![0]
    const rejected = expect(pending).rejects.toMatchObject({ code: 'aborted' })
    controller.abort()
    await rejected
    writing.resolve()
    await Promise.resolve()
    expect(f.state().doc.text).toBe('hello')
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('reports clipboard denial and never deletes the cut selection', async () => {
    const f = fixture()
    f.select(1, 3)
    f.clipboard.writeText.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    await expect(f.run('host.cut')).rejects.toMatchObject({
      code: 'clipboard-write',
      message: expect.stringMatching(/剪贴板.*(权限|拒绝|失败)/),
    })
    expect(f.state().doc.text).toBe('前😀后\r\nnext\r\n')
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('starts paste clipboard access synchronously in the invocation gesture, before capture', async () => {
    const f = fixture()
    const reading = deferred<string>()
    const read = vi.spyOn(f.current().source, 'readLineWindow')
    f.clipboard.readText.mockReturnValueOnce(reading.promise)
    const pending = f.run('host.paste')
    expect(f.clipboard.readText).toHaveBeenCalledOnce()
    expect(read).not.toHaveBeenCalled()
    reading.resolve('line 1\n😀\n')
    await pending
    expect(f.state().doc.text).toBe('line 1\r\n😀\r\n前😀后\r\nnext\r\n')
    expect(f.state().undo().doc.text).toBe('前😀后\r\nnext\r\n')
  })

  it.each([
    'identity',
    'version',
    'selectionRevision',
    'saveLocationGeneration',
    'source',
  ] as const)('drops a paste that arrives after %s changed', async (field) => {
    const f = fixture()
    const reading = deferred<string>()
    f.clipboard.readText.mockReturnValueOnce(reading.promise)
    const pending = f.run('host.paste')
    if (field === 'source') f.replaceSource()
    else if (field === 'identity') f.attributes.identity = {}
    else f.attributes[field]++
    reading.resolve('late edit')
    await expect(pending).rejects.toMatchObject({ code: 'stale' })
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.state().history.canUndo).toBe(false)
  })

  it('does not cut if selection moves while the system clipboard is writing', async () => {
    const f = fixture()
    f.select(1, 3)
    const writing = deferred<void>()
    f.clipboard.writeText.mockReturnValueOnce(writing.promise)
    const pending = f.run('host.cut')
    await vi.waitFor(() => expect(f.clipboard.writeText).toHaveBeenCalledOnce())
    f.select(4)
    writing.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'stale' })
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('cancels a cut while clipboard permission is unresolved and ignores its late success', async () => {
    const f = fixture()
    f.select(1, 3)
    const writing = deferred<void>()
    const controller = new AbortController()
    f.clipboard.writeText.mockReturnValueOnce(writing.promise)
    const pending = f.run('host.cut', controller.signal)
    await vi.waitFor(() => expect(f.clipboard.writeText).toHaveBeenCalledOnce())
    const rejected = expect(pending).rejects.toMatchObject({ code: 'aborted' })
    controller.abort()
    await rejected
    writing.resolve()
    await Promise.resolve()
    expect(f.state().doc.text).toBe('前😀后\r\nnext\r\n')
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('rejects a second clipboard command until the first finishes', async () => {
    const f = fixture()
    const reading = deferred<string>()
    f.clipboard.readText.mockReturnValueOnce(reading.promise)
    const first = f.run('host.paste')
    await expect(f.run('host.paste')).rejects.toMatchObject({ code: 'busy' })
    expect(f.clipboard.readText).toHaveBeenCalledOnce()
    reading.resolve('one')
    await first
    expect(f.state().doc.text).toBe('one前😀后\r\nnext\r\n')
    expect(f.commit).toHaveBeenCalledOnce()
  })

  it.each(['abort', 'dispose'] as const)('cancels an unresolved paste on %s', async (kind) => {
    const f = fixture()
    const reading = deferred<string>()
    const controller = new AbortController()
    f.clipboard.readText.mockReturnValueOnce(reading.promise)
    const pending = f.run('host.paste', controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'aborted' })
    if (kind === 'abort') controller.abort()
    else f.actions.dispose()
    await rejected
    reading.resolve('late edit')
    await Promise.resolve()
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('surfaces rejected clipboard reads and releases busy state for retry', async () => {
    const f = fixture()
    f.clipboard.readText.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    await expect(f.run('host.paste')).rejects.toMatchObject({ code: 'clipboard-read' })
    expect(f.commit).not.toHaveBeenCalled()
    await f.run('host.paste')
    expect(f.state().doc.text).toBe('粘贴前😀后\r\nnext\r\n')
  })

  it('does not delete a selected range when the text clipboard is empty', async () => {
    const f = fixture()
    f.select(1, 3)
    f.clipboard.readText.mockResolvedValueOnce('')
    await f.run('host.paste')
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.state().selection.main).toMatchObject({ anchor: 1, head: 3 })
  })

  it.each(['host.cut', 'host.paste', 'host.undo', 'host.redo', 'host.insert.heading-1'])(
    'rejects readonly %s before clipboard or mutation',
    async (id) => {
      const f = fixture()
      f.select(1, 3)
      f.attributes.readonly = true
      await expect(f.run(id)).rejects.toMatchObject({ code: 'readonly' })
      expect(f.clipboard.readText).not.toHaveBeenCalled()
      expect(f.clipboard.writeText).not.toHaveBeenCalled()
      expect(f.commit).not.toHaveBeenCalled()
      expect(f.history).not.toHaveBeenCalled()
    },
  )

  it('rechecks readonly after an asynchronous clipboard read', async () => {
    const f = fixture()
    const reading = deferred<string>()
    f.clipboard.readText.mockReturnValueOnce(reading.promise)
    const pending = f.run('host.paste')
    f.attributes.readonly = true
    reading.resolve('late edit')
    await expect(pending).rejects.toMatchObject({ code: 'readonly' })
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('delegates whole-document selection for readonly windowed documents without reading text', async () => {
    const f = fixture('x'.repeat(70_000))
    f.attributes.readonly = true
    f.attributes.mode = 'windowed'
    const read = vi.spyOn(f.current().source, 'readLineWindow')
    await f.run('host.select-all')
    expect(f.selectAll).toHaveBeenCalledOnce()
    expect(f.state().selection.main).toMatchObject({ anchor: 0, head: 70_000 })
    expect(read).not.toHaveBeenCalled()
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.state().history.canUndo).toBe(false)
  })

  it('uses bounded editing capture and clear limits for huge selections and lines', async () => {
    const f = fixture('x'.repeat(70_000))
    f.select(0, 70_000)
    const read = vi.spyOn(f.current().source, 'readLineWindow')
    await expect(f.run('host.copy')).rejects.toMatchObject({
      code: 'too-large',
      message: expect.stringMatching(/65.?536|64 Ki/),
    })
    expect(read).not.toHaveBeenCalled()
    f.select(0, 1)
    await expect(f.run('host.copy')).rejects.toMatchObject({ code: 'too-large' })
    expect(read.mock.calls.every((call) => call[2] !== undefined && call[2]! <= 65_536)).toBe(true)
    expect(f.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('rejects too many selected lines without copying a partial prefix', async () => {
    const text = Array.from({ length: 300 }, () => 'x').join('\n')
    const f = fixture(text)
    f.select(0, text.length)
    await expect(f.run('host.copy')).rejects.toMatchObject({ code: 'too-large' })
    expect(f.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('rejects expanded oversized paste and leaves the selected source intact', async () => {
    const f = fixture()
    f.select(1, 3)
    f.clipboard.readText.mockResolvedValueOnce('\n'.repeat(40_000))
    await expect(f.run('host.paste')).rejects.toMatchObject({ code: 'too-large' })
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('never splits graphemes or CRLF during cut', async () => {
    for (const [anchor, head] of [
      [2, 3],
      [4, 5],
    ]) {
      const f = fixture()
      f.select(anchor!, head!)
      await expect(f.run('host.cut')).rejects.toMatchObject({ code: 'invalid-input' })
      expect(f.clipboard.writeText).not.toHaveBeenCalled()
      expect(f.commit).not.toHaveBeenCalled()
    }
  })

  it('reuses native-capable history callbacks and keeps one undo entry per insertion', async () => {
    const f = fixture('hello')
    f.attributes.mode = 'windowed'
    await f.run('host.insert.heading-2')
    expect(f.state().doc.text).toBe('## hello')
    await f.run('host.undo')
    expect(f.state().doc.text).toBe('hello')
    await f.run('host.redo')
    expect(f.state().doc.text).toBe('## hello')
    expect(f.history.mock.calls.map((call) => call[0])).toEqual(['undo', 'redo'])
  })

  it('prefixes selected CRLF lines, preserves reverse selection, and excludes the following line', async () => {
    const f = fixture('one\r\ntwo\r\nthree')
    f.select(10, 0)
    await f.run('host.insert.task-list')
    expect(f.state().doc.text).toBe('- [ ] one\r\n- [ ] two\r\nthree')
    expect(f.state().selection.main).toMatchObject({ anchor: 22, head: 6 })
    expect(f.state().undo().selection.main).toMatchObject({ anchor: 10, head: 0 })
    expect(f.state().undo().doc.text).toBe('one\r\ntwo\r\nthree')
  })

  it.each([
    ['heading-1', '# hello'],
    ['heading-6', '###### hello'],
    ['bullet-list', '- hello'],
    ['ordered-list', '1. hello'],
    ['quote', '> hello'],
  ])('inserts %s through the host transaction owner', async (id, expected) => {
    const f = fixture('hello')
    await f.run(`host.insert.${id}`)
    expect(f.state().doc.text).toBe(expected)
    expect(f.state().undo().doc.text).toBe('hello')
    expect(f.commit).toHaveBeenCalledOnce()
  })

  it.each(['link', 'image', 'code-block', 'table', 'horizontal-rule'])(
    'inserts a useful %s template with a single undo entry',
    async (id) => {
      const f = fixture('')
      await f.run(`host.insert.${id}`)
      expect(f.state().doc.text).not.toBe('')
      if (id === 'link') expect(f.state().doc.text).toBe('[链接文字](https://example.com)')
      if (id === 'image')
        expect(f.state().doc.text).toBe('![图片说明](https://example.com/image.png)')
      if (id === 'code-block') expect(f.state().doc.text).toBe('```\n代码\n```')
      if (id === 'table') expect(f.state().doc.text).toContain('| --- | --- |')
      if (id === 'horizontal-rule') expect(f.state().doc.text).toBe('---')
      expect(f.state().undo().doc.text).toBe('')
      expect(f.commit).toHaveBeenCalledOnce()
    },
  )

  it('chooses a longer code fence when selected text contains triple backticks', async () => {
    const f = fixture('a\n```\nb')
    f.select(0, 7)
    await f.run('host.insert.code-block')
    expect(f.state().doc.text).toBe('````\na\n```\nb\n````')
  })

  it('rejects stale menu snapshots and unknown IDs before touching the clipboard', async () => {
    const f = fixture()
    const snapshot = f.captureSnapshot()
    f.select(3)
    await expect(f.actions.run('host.paste', snapshot)).rejects.toMatchObject({ code: 'stale' })
    await expect(f.run('plugin.arbitrary-command')).rejects.toMatchObject({ code: 'unsupported' })
    expect(f.clipboard.readText).not.toHaveBeenCalled()
  })
})

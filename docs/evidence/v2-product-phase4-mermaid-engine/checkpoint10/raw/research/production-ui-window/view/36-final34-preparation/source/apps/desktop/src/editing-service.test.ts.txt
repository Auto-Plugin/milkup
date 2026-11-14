import { describe, expect, it, vi } from 'vitest'
import { EditorState, MemoryDocumentSource, MemoryTextDocument, Selection } from '@milkup/core'
import { createDocumentSession, recordDocumentTransaction } from '@milkup/tauri-bridge'
import { createDesktopEditingService, type DesktopEditingCurrent } from './editing-service'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture(text = '中文 **bold**\r\nsecond\r\n') {
  let state = new EditorState({
    doc: new MemoryTextDocument(text),
    selection: Selection.range(5, 9),
  })
  let version = 0
  let session = createDocumentSession({ documentId: 'doc' })
  let source = new MemoryDocumentSource({ documentId: 'doc', document: state.doc, version })
  const attributes = {
    identity: {},
    selectionRevision: 0,
    saveLocationGeneration: 0,
    readonly: false,
    busy: false,
    mode: 'memory' as 'memory' | 'windowed',
  }
  const current = (): DesktopEditingCurrent => ({
    ...attributes,
    documentId: 'doc',
    version,
    source,
    selection: state.selection,
  })
  const commit = vi.fn(async (batch, guard: () => void) => {
    guard()
    state = state.applyTransaction(batch)
    session = recordDocumentTransaction(session, batch)
    version = session.documentVersion
    source = new MemoryDocumentSource({ documentId: 'doc', document: state.doc, version })
    return { documentId: 'doc', version }
  })
  const service = createDesktopEditingService({
    current,
    runExclusive: async (action) => action(),
    commit,
  })
  const owner = service.adapterForPlugin('test.formatting')
  const select = (anchor: number, head = anchor) => {
    attributes.selectionRevision++
    state = state.applyTransaction({ selection: Selection.range(anchor, head) })
  }
  return {
    service,
    owner,
    attributes,
    current,
    commit,
    select,
    state: () => state,
    session: () => session,
    setSource: (next: MemoryDocumentSource) => {
      source = next
    },
  }
}

describe('bounded desktop editing leases', () => {
  it('captures complete CRLF lines, reverse selection and valid CST markers', async () => {
    const f = fixture()
    f.select(9, 5)
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    expect(snapshot.text).toBe('中文 **bold**')
    expect(snapshot.selection).toEqual({ anchor: 9, head: 5 })
    expect(snapshot.lineEnding).toBe('crlf')
    expect(snapshot.context).toEqual({ kind: 'text', complete: true })
    expect(snapshot.syntax?.nodes).toContainEqual(
      expect.objectContaining({
        type: 'strong',
        from: 3,
        to: 11,
        markerRanges: [
          { from: 3, to: 5 },
          { from: 9, to: 11 },
        ],
      }),
    )
  })

  it('applies one isolated undo entry with absolute selection and consumes the lease', async () => {
    const f = fixture()
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    const result = await f.owner.adapter.apply({
      snapshotId: snapshot.id,
      changes: [
        { from: 3, to: 5, insert: '' },
        { from: 9, to: 11, insert: '' },
      ],
      selection: { anchor: 3, head: 7 },
    })
    expect(result.version).toBe(1)
    expect(f.state().doc.text).toBe('中文 bold\r\nsecond\r\n')
    expect(f.state().undo().doc.text).toBe('中文 **bold**\r\nsecond\r\n')
    expect(f.state().undo().selection.main.head).toBe(9)
    expect(f.commit.mock.calls[0]![0].historyGroup).toBe('isolate')
    await expect(
      f.owner.adapter.apply({ snapshotId: snapshot.id, changes: [] }),
    ).rejects.toMatchObject({ code: 'invalid-snapshot' })
  })

  it('does not let a text-only view context downgrade an unsafe HTML block', async () => {
    const f = fixture('<script>\nconst value = 1\n</script>\n')
    f.select(9, 14)
    const service = createDesktopEditingService({
      current: f.current,
      runExclusive: async (action) => action(),
      commit: f.commit,
      context: async () => ({ kind: 'text', complete: true }),
    })
    const snapshot = await service
      .adapterForPlugin('html-guard')
      .adapter.capture({ extent: 'lines' })
    expect(snapshot.context).toEqual({ kind: 'unknown', complete: false })
    expect(snapshot.syntax?.nodes).toEqual([])
  })

  it('changes selection without marking the document dirty or advancing its version/history', async () => {
    const f = fixture()
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    const result = await f.owner.adapter.apply({
      snapshotId: snapshot.id,
      changes: [],
      selection: { anchor: 0, head: 11 },
    })
    expect(result.version).toBe(0)
    expect(f.session()).toMatchObject({ dirty: false, documentVersion: 0 })
    expect(f.state().selection.main).toMatchObject({ anchor: 0, head: 11 })
    expect(f.state().history.canUndo).toBe(false)
  })

  it('computes the post-edit cursor line from bounded CRLF text', async () => {
    const f = fixture()
    f.select(13)
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    await f.owner.adapter.apply({
      snapshotId: snapshot.id,
      changes: [{ from: 0, to: 0, insert: '新行\r\n' }],
      selection: { anchor: 4, head: 4 },
    })
    expect(f.commit.mock.calls[0]![0].selectionAfterLine).toBe(3)
  })

  it.each(['selectionRevision', 'saveLocationGeneration'] as const)(
    'rejects changed %s before writing',
    async (field) => {
      const f = fixture()
      const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
      f.attributes[field]++
      await expect(
        f.owner.adapter.apply({
          snapshotId: snapshot.id,
          changes: [{ from: 0, to: 0, insert: '#' }],
        }),
      ).rejects.toMatchObject({ code: 'stale' })
      expect(f.commit).not.toHaveBeenCalled()
    },
  )

  it.each(['readonly', 'busy'] as const)('rechecks %s at apply', async (field) => {
    const f = fixture()
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    f.attributes[field] = true
    await expect(
      f.owner.adapter.apply({ snapshotId: snapshot.id, changes: [] }),
    ).rejects.toMatchObject({ code: field })
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('rejects document identity or source replacement with the same public ID/version', async () => {
    const f = fixture()
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    f.attributes.identity = {}
    await expect(
      f.owner.adapter.apply({ snapshotId: snapshot.id, changes: [] }),
    ).rejects.toMatchObject({ code: 'stale' })
  })

  it('does not include the next line when selection ends at its start', async () => {
    const f = fixture('one\r\ntwo\r\n')
    f.select(0, 5)
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    expect(snapshot.text).toBe('one\r\n')
    expect(snapshot.lineCount).toBe(1)
    expect(snapshot.selection.head).toBe(5)
  })

  it('captures selection without silently expanding the editable range', async () => {
    const f = fixture()
    const snapshot = await f.owner.adapter.capture({ extent: 'selection' })
    expect(snapshot.text).toBe('bold')
    expect(snapshot.from).toBe(5)
    await expect(
      f.owner.adapter.apply({
        snapshotId: snapshot.id,
        changes: [{ from: -1, to: 0, insert: '' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('rejects grapheme and CRLF splits without changing the document', async () => {
    const f = fixture('👩🏽‍💻 é\r\nnext')
    f.select(0, 7)
    const snapshot = await f.owner.adapter.capture({ extent: 'lines', afterLines: 1 })
    for (const from of [1, 2, 9, 11]) {
      await expect(
        f.owner.adapter.apply({
          snapshotId: snapshot.id,
          changes: [{ from, to: from, insert: '!' }],
        }),
      ).rejects.toMatchObject({ code: 'invalid-input' })
    }
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('keeps a failed atomic commit retryable', async () => {
    const f = fixture()
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    f.commit.mockRejectedValueOnce(new Error('native failure'))
    const request = { snapshotId: snapshot.id, changes: [{ from: 0, to: 0, insert: '# ' }] }
    await expect(f.owner.adapter.apply(request)).rejects.toMatchObject({ code: 'unavailable' })
    expect(f.state().doc.text).toBe('中文 **bold**\r\nsecond\r\n')
    await expect(f.owner.adapter.apply(request)).resolves.toMatchObject({ version: 1 })
  })

  it('releases only owned leases and revokes in-flight capture after disable', async () => {
    const f = fixture()
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    const other = f.service.adapterForPlugin('other.plugin')
    await expect(other.adapter.release(snapshot.id)).rejects.toMatchObject({
      code: 'invalid-snapshot',
    })
    await f.owner.adapter.release(snapshot.id)
    await f.owner.adapter.release(snapshot.id)
    const gate = deferred()
    const source = f.current().source
    const read = source.readLineWindow.bind(source)
    vi.spyOn(source, 'readLineWindow').mockImplementation(async (...args) => {
      await gate.promise
      return read(...args)
    })
    const pending = f.owner.adapter.capture({ extent: 'lines' })
    f.owner.dispose()
    gate.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'revoked' })
  })

  it('rejects oversized lines and limits active snapshots', async () => {
    const huge = fixture('a'.repeat(65537))
    huge.select(0)
    await expect(huge.owner.adapter.capture({ extent: 'lines' })).rejects.toMatchObject({
      code: 'too-large',
    })
    const f = fixture()
    for (let i = 0; i < 8; i++) await f.owner.adapter.capture({ extent: 'lines' })
    await expect(f.owner.adapter.capture({ extent: 'lines' })).rejects.toMatchObject({
      code: 'too-large',
    })
  })

  it('reports code context when capturing a line inside a bounded known fence', async () => {
    const f = fixture('```md\n**literal**\n```\n')
    f.select(8, 10)
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    expect(snapshot.context?.kind).toBe('code')
    expect(snapshot.syntax?.nodes.some((node) => node.type === 'strong')).toBeFalsy()
  })

  it('does not claim complete inline syntax when a wrapper crosses the captured lines', async () => {
    const f = fixture('**first\nsecond**\n')
    f.select(2, 7)
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    expect(snapshot.context).toEqual({ kind: 'text', complete: false })
    expect(snapshot.syntax?.nodes.some((node) => node.type === 'strong')).toBe(false)
  })

  it('reports code for a mixed selection crossing a fenced block', async () => {
    const text = 'before\n```\ncode\n```\nafter'
    const f = fixture(text)
    f.select(0, text.length)
    expect((await f.owner.adapter.capture({ extent: 'lines' })).context?.kind).toBe('code')
  })

  it('returns complete strike metadata and keeps inline code as a distinct node', async () => {
    const f = fixture('~~删除~~ and `code`')
    f.select(2, 4)
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    expect(snapshot.syntax?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'strikethrough', from: 0, to: 6 }),
        expect.objectContaining({ type: 'inlineCode', status: 'valid' }),
      ]),
    )
  })

  it('uses bounded native-compatible reads and reports unknown distant syntax', async () => {
    const f = fixture(Array.from({ length: 1000 }, () => 'x').join('\n'))
    f.attributes.mode = 'windowed'
    f.select(1000, 1001)
    const source = f.current().source
    const calls = vi.spyOn(source, 'readLineWindow')
    vi.spyOn(source, 'lineAtPosition').mockRejectedValue(new Error('unbounded lookup forbidden'))
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    expect(snapshot.text).toBe('x')
    expect(snapshot.mode).toBe('windowed')
    expect(snapshot.context).toEqual({ kind: 'unknown', complete: false })
    expect(
      calls.mock.calls.every(
        ([from, to, budget]) => to - from < 256 && typeof budget === 'number' && budget <= 65536,
      ),
    ).toBe(true)
  })

  it('invalidates a capture if source identity changes during an awaited read', async () => {
    const f = fixture()
    const source = f.current().source
    const original = source.readLineWindow.bind(source)
    vi.spyOn(source, 'readLineWindow').mockImplementationOnce(async (...args) => {
      const result = await original(...args)
      f.setSource(new MemoryDocumentSource({ documentId: 'doc', text: 'replacement' }))
      return result
    })
    await expect(f.owner.adapter.capture({ extent: 'lines' })).rejects.toMatchObject({
      code: 'stale',
    })
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('rechecks the host guard at the actual commit point', async () => {
    const f = fixture()
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    f.commit.mockImplementationOnce(async (_batch, guard) => {
      f.attributes.readonly = true
      guard()
      return { documentId: 'doc', version: 1 }
    })
    await expect(
      f.owner.adapter.apply({ snapshotId: snapshot.id, changes: [] }),
    ).rejects.toMatchObject({ code: 'readonly' })
    expect(f.state().doc.text).toBe('中文 **bold**\r\nsecond\r\n')
  })

  it('rejects precommit abort but reports a completed commit after a late abort', async () => {
    const f = fixture()
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    const before = new AbortController()
    before.abort()
    const request = { snapshotId: snapshot.id, changes: [{ from: 0, to: 0, insert: '!' }] }
    await expect(f.owner.adapter.apply(request, { signal: before.signal })).rejects.toMatchObject({
      code: 'aborted',
    })
    expect(f.commit).not.toHaveBeenCalled()
    const after = new AbortController()
    const original = f.commit.getMockImplementation()!
    f.commit.mockImplementationOnce(async (batch, guard) => {
      const result = await original(batch, guard)
      after.abort()
      return result
    })
    await expect(f.owner.adapter.apply(request, { signal: after.signal })).resolves.toEqual({
      documentId: 'doc',
      version: 1,
    })
    expect(f.state().doc.text.startsWith('!')).toBe(true)
  })

  it('copies queued requests and prevents concurrent lease reuse', async () => {
    const f = fixture()
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    const change = { from: 0, to: 0, insert: '!' }
    const request = { snapshotId: snapshot.id, changes: [change] }
    const first = f.owner.adapter.apply(request)
    change.insert = 'MUTATED'
    const second = f.owner.adapter.apply(request)
    await expect(first).resolves.toMatchObject({ version: 1 })
    await expect(second).rejects.toMatchObject({ code: 'invalid-snapshot' })
    expect(f.state().doc.text.startsWith('!')).toBe(true)
    expect(f.commit).toHaveBeenCalledOnce()
  })

  it('rejects unknown operations, malformed edits and resource IDs before committing', async () => {
    const f = fixture()
    const snapshot = await f.owner.adapter.capture({ extent: 'lines' })
    const edits = [
      [{ from: 0, to: 50, insert: '' }],
      [{ from: NaN, to: 0, insert: '' }],
      [
        { from: 0, to: 2, insert: '' },
        { from: 1, to: 1, insert: '' },
      ],
      [{ from: 0, to: 0, insert: '\ud800' }],
    ]
    for (const changes of edits)
      await expect(
        f.owner.adapter.apply({ snapshotId: snapshot.id, changes }),
      ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(
      f.owner.adapter.apply({ snapshotId: snapshot.id, changes: [], assetIds: ['asset'] }),
    ).rejects.toMatchObject({ code: 'unsupported' })
    await expect(
      f.owner.adapter.table({ snapshotId: snapshot.id, operation: 'unknown' } as never),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    expect(f.commit).not.toHaveBeenCalled()
  })
})

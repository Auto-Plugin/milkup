import { describe, expect, it, vi } from 'vitest'
import { MemoryDocumentSource } from '@milkup/core'
import * as converter from '@milkup/export'
import { createDesktopOutputService } from './output-service'

function setup(text = '# 中文\n\n正文 **保留**') {
  let current = {
    source: new MemoryDocumentSource({ documentId: 'doc', text, version: 4 }),
    identity: {},
    selection: { anchor: 0, head: 4 },
    title: '笔记.md',
    sourcePath: '/notes/笔记.md',
    saveLocationGeneration: 0,
  }
  const calls: { command: string; args: Record<string, unknown> }[] = []
  const invoke = vi.fn(async (command: string, args: Record<string, unknown>): Promise<unknown> => {
    calls.push({ command, args })
    if (command === 'output_prepare') return { id: 'native_job' }
    if (command === 'output_choose_target') return { id: 'native_job', name: '笔记.html' }
    if (command === 'output_write_html') return { name: '笔记.html', bytes: 1000 }
    if (command === 'output_abort') return true
    throw new Error(command)
  })
  const service = createDesktopOutputService({
    current: () => current,
    invoke,
    renderers: () => [],
    render: async () => ({ fragments: [], complete: true }),
  })
  return {
    service,
    invoke,
    calls,
    current: () => current,
    change: () => {
      current = {
        ...current,
        source: new MemoryDocumentSource({ documentId: 'doc', text: 'new content', version: 5 }),
      }
    },
  }
}
const request = { format: 'html', scope: 'document', resources: 'omit' } as const

describe('controlled desktop output', () => {
  it('writes a complete immutable captured version after subsequent edits', async () => {
    const f = setup()
    const { adapter } = f.service.adapterForPlugin('test')
    const snapshot = await adapter.capture(request)
    expect(snapshot.version).toBe(4)
    expect(JSON.stringify(snapshot)).not.toContain('/notes/')
    f.change()
    const target = await adapter.chooseTarget({ snapshotId: snapshot.id })
    expect(target.status).toBe('ready')
    if (target.status !== 'ready') throw new Error('target')
    await expect(adapter.write(target.id)).resolves.toMatchObject({ status: 'written' })
    const html = f.calls.find((x) => x.command === 'output_write_html')?.args.html as string
    expect(html).toContain('中文')
    expect(html).toContain('正文')
    expect(html).not.toContain('new content')
    await expect(adapter.write(target.id)).rejects.toMatchObject({ code: 'invalid-token' })
  })
  it('rejects a document version change during capture before allocating a native job', async () => {
    const f = setup()
    const source = f.current().source
    const read = source.readLineWindow.bind(source)
    source.readLineWindow = async (...args) => {
      const value = await read(...args)
      f.change()
      return value
    }
    await expect(f.service.adapterForPlugin('test').adapter.capture(request)).rejects.toMatchObject(
      { code: 'stale' },
    )
    expect(f.calls).toEqual([])
  })
  it('aborts owned jobs on disposal and isolates plugin handles', async () => {
    const f = setup()
    const a = f.service.adapterForPlugin('a')
    const b = f.service.adapterForPlugin('b')
    const snapshot = await a.adapter.capture(request)
    await expect(b.adapter.chooseTarget({ snapshotId: snapshot.id })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    await a.dispose()
    expect(f.calls).toContainEqual({ command: 'output_abort', args: { jobId: 'native_job' } })
    await expect(a.adapter.capture(request)).rejects.toMatchObject({ code: 'revoked' })
  })
  it('reports committed writes when cancellation arrives after native commit', async () => {
    const f = setup()
    const a = f.service.adapterForPlugin('a')
    const snapshot = await a.adapter.capture(request)
    const target = await a.adapter.chooseTarget({ snapshotId: snapshot.id })
    if (target.status !== 'ready') throw new Error('target')
    const controller = new AbortController()
    f.invoke.mockImplementation(async (command, args) => {
      if (command === 'output_write_html') {
        controller.abort()
        return { name: '笔记.html', bytes: 1000 }
      }
      return true
    })
    await expect(a.adapter.write(target.id, { signal: controller.signal })).resolves.toMatchObject({
      status: 'written',
    })
  })
  it('preserves an unknown print submission result when cancellation arrives late', async () => {
    const f = setup()
    const adapter = f.service.adapterForPlugin('a').adapter
    const snapshot = await adapter.capture({ ...request, format: 'print' })
    const controller = new AbortController()
    f.invoke.mockImplementation(async (command) => {
      if (command === 'output_print') {
        controller.abort()
        throw '[output:unavailable] Print submission status is unknown; check printer queue'
      }
      return true
    })
    await expect(adapter.print(snapshot.id, { signal: controller.signal })).rejects.toMatchObject({
      code: 'unavailable',
    })
  })
  it('preserves acknowledged print submission when cancellation arrives late', async () => {
    const f = setup()
    const adapter = f.service.adapterForPlugin('a').adapter
    const snapshot = await adapter.capture({ ...request, format: 'print' })
    const controller = new AbortController()
    f.invoke.mockImplementation(async (command) => {
      if (command === 'output_print') {
        controller.abort()
        return { status: 'printed' }
      }
      return true
    })
    await expect(adapter.print(snapshot.id, { signal: controller.signal })).resolves.toEqual({
      status: 'printed',
    })
  })
  it('rejects oversized source before reads and preserves native outputs on cancelled chooser', async () => {
    const f = setup('x'.repeat(2 * 1024 * 1024 + 1))
    const read = vi.spyOn(f.current().source, 'readLineWindow')
    await expect(f.service.adapterForPlugin('a').adapter.capture(request)).rejects.toMatchObject({
      code: 'too-large',
    })
    expect(read).not.toHaveBeenCalled()
    expect(f.calls).toEqual([])
  })
  it('preserves CRLF, Unicode and blank lines across bounded source windows', async () => {
    const text = ('中文😀 ' + 'x'.repeat(90) + '\r\n').repeat(1600) + '\r\nend'
    const f = setup(text)
    const source = f.current().source
    const original = source.readLineWindow.bind(source)
    const windows: number[] = []
    source.readLineWindow = async (...args) => {
      const result = await original(...args)
      windows.push(result.text.length)
      return result
    }
    const adapter = f.service.adapterForPlugin('a').adapter
    const snapshot = await adapter.capture(request)
    expect(snapshot.to).toBe(text.length)
    expect(windows.length).toBeGreaterThan(1)
    expect(windows.every((length) => length <= 131072)).toBe(true)
    const target = await adapter.chooseTarget({ snapshotId: snapshot.id })
    if (target.status !== 'ready') throw new Error('target')
    await adapter.write(target.id)
    const html = f.calls.find((x) => x.command === 'output_write_html')!.args.html as string
    expect(html.match(/中文😀/gu)?.length).toBe(1600)
    expect(html).toContain('end')
  })
  it('keeps a selected absolute range and warns about unavailable rich context', async () => {
    const f = setup('序文\n选中😀内容\n尾部')
    f.current().selection.anchor = 3
    f.current().selection.head = 11
    const adapter = f.service.adapterForPlugin('a').adapter
    const snapshot = await adapter.capture({ ...request, scope: 'selection' })
    expect(snapshot.from).toBe(3)
    expect(snapshot.to).toBe(11)
    expect(
      snapshot.warnings.some((warning) => warning.code === 'presentation-selection-context'),
    ).toBe(true)
  })
  it('cleans a late native preparation when capture was cancelled', async () => {
    const f = setup()
    const controller = new AbortController()
    const original = f.invoke.getMockImplementation()!
    f.invoke.mockImplementation(async (command, args) => {
      const value = await original(command, args)
      if (command === 'output_prepare') controller.abort()
      return value
    })
    await expect(
      f.service.adapterForPlugin('a').adapter.capture(request, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' })
    expect(f.calls.at(-1)).toEqual({ command: 'output_abort', args: { jobId: 'native_job' } })
  })
  it('makes unavailable and remote images visible without network requests', async () => {
    const f = setup('![本地](missing.png)\n\n![远程](https://example.invalid/image.png)')
    const adapter = f.service.adapterForPlugin('a').adapter
    const snapshot = await adapter.capture({ ...request, resources: 'embed' })
    expect(snapshot.warnings.length).toBeGreaterThan(0)
    expect(f.calls.filter((call) => call.command === 'resources_resolve_image')).toEqual([
      {
        command: 'resources_resolve_image',
        args: { documentId: 'doc', relativeUrl: 'missing.png' },
      },
    ])
  })
  it('does not allocate a target on chooser cancellation or write afterwards', async () => {
    const f = setup()
    const adapter = f.service.adapterForPlugin('a').adapter
    const snapshot = await adapter.capture(request)
    const original = f.invoke.getMockImplementation()!
    f.invoke.mockImplementation(async (command, args) =>
      command === 'output_choose_target' ? null : original(command, args),
    )
    await expect(adapter.chooseTarget({ snapshotId: snapshot.id })).resolves.toEqual({
      status: 'cancelled',
    })
    await expect(adapter.chooseTarget({ snapshotId: snapshot.id })).rejects.toMatchObject({
      code: 'invalid-token',
    })
    expect(f.calls.filter((call) => call.command.startsWith('output_write'))).toEqual([])
  })
  it('captures adjacent long lines without exceeding the per-read budget', async () => {
    const text = 'a'.repeat(100000) + '\r\n' + 'b'.repeat(100000)
    const f = setup(text)
    const snapshot = await f.service.adapterForPlugin('a').adapter.capture(request)
    expect(snapshot.to).toBe(text.length)
  })
  it('preserves a final bare CR instead of silently truncating source metadata', async () => {
    const f = setup('ending\r')
    const snapshot = await f.service.adapterForPlugin('a').adapter.capture(request)
    expect(snapshot.to).toBe(7)
  })
  it('maps native rejection after cancellation to aborted while retaining the success contract', async () => {
    const f = setup()
    const adapter = f.service.adapterForPlugin('a').adapter
    const snapshot = await adapter.capture(request)
    const target = await adapter.chooseTarget({ snapshotId: snapshot.id })
    if (target.status !== 'ready') throw new Error('target')
    const controller = new AbortController()
    f.invoke.mockImplementation(async (command) => {
      if (command === 'output_write_html') {
        controller.abort()
        throw 'Output cancelled'
      }
      return true
    })
    await expect(adapter.write(target.id, { signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    })
  })
  it('rejects HTML above the native transfer budget before asking for a destination', async () => {
    const render = vi
      .spyOn(converter, 'renderStaticMarkdownDocument')
      .mockReturnValue({ html: 'x'.repeat(32 * 1024 * 1024 + 1), warnings: [] })
    try {
      const f = setup()
      await expect(f.service.adapterForPlugin('a').adapter.capture(request)).rejects.toMatchObject({
        code: 'too-large',
      })
      expect(f.calls).toEqual([])
    } finally {
      render.mockRestore()
    }
  })
  it('shrinks windows for the native string budget error and bounds every boundary lookup', async () => {
    const f = setup(('row 中文' + 'x'.repeat(100) + '\n').repeat(2000))
    const source = f.current().source
    const read = source.readLineWindow.bind(source)
    source.lineAtPosition = async () => {
      throw new Error('Unbounded native lineAtPosition is forbidden during capture')
    }
    source.readLineWindow = async (from, to, budget) => {
      expect(budget).toBe(131072)
      try {
        return await read(from, to, budget)
      } catch (error) {
        if (error instanceof RangeError) throw 'Line window exceeds text budget'
        throw error
      }
    }
    const snapshot = await f.service.adapterForPlugin('a').adapter.capture(request)
    expect(snapshot.to).toBe(source.length)
  })

  it('keeps released snapshot allocations reserved until in-flight choosers settle', async () => {
    const f = setup()
    const adapter = f.service.adapterForPlugin('a').adapter
    const original = f.invoke.getMockImplementation()!
    const complete: Array<(value: null) => void> = []
    f.invoke.mockImplementation((command, args) =>
      command === 'output_choose_target'
        ? new Promise((resolve) => complete.push(resolve))
        : original(command, args),
    )
    const pending: Array<Promise<unknown>> = []
    for (let index = 0; index < 4; index++) {
      const snapshot = await adapter.capture(request)
      pending.push(adapter.chooseTarget({ snapshotId: snapshot.id }).catch((error) => error))
      await adapter.release(snapshot.id)
    }
    await expect(adapter.capture(request)).rejects.toMatchObject({ code: 'busy' })
    complete.forEach((resolve) => resolve(null))
    await Promise.all(pending)
    await expect(adapter.capture(request)).resolves.toMatchObject({ version: 4 })
  })
  it('uses UTF-16 length metadata for windowed Unicode and preserves terminal CR', async () => {
    const text = '中文😀\r\n'.repeat(1000) + '结束\r'
    const memory = new MemoryDocumentSource({ documentId: 'large', text, version: 3 })
    const source = {
      documentId: 'large',
      version: 3,
      lineCount: memory.lineCount,
      readLineWindow: memory.readLineWindow.bind(memory),
      lineAtPosition: async () => {
        throw new Error('unbounded lookup')
      },
      positionAtLineOffset: memory.positionAtLineOffset.bind(memory),
      snapshot: () => ({
        documentId: 'large',
        version: 3,
        lineCount: memory.lineCount,
        length: new TextEncoder().encode(text).length,
      }),
    }
    const readLengthUtf16 = vi.fn(async () => text.length)
    const service = createDesktopOutputService({
      current: () => ({
        source,
        identity: source,
        selection: { anchor: 0, head: 0 },
        title: '窗口化',
        saveLocationGeneration: 0,
        readLengthUtf16,
      }),
      invoke: async (command) => (command === 'output_prepare' ? { id: 'large_job' } : true),
      renderers: () => [],
      render: async () => ({ fragments: [], complete: true }),
    })
    const snapshot = await service.adapterForPlugin('a').adapter.capture(request)
    expect(snapshot.to).toBe(text.length)
    expect(snapshot.to).not.toBe(new TextEncoder().encode(text).length)
    expect(readLengthUtf16).toHaveBeenCalledTimes(1)
  })
  it.each([-1, Number.NaN, 999999])(
    'rejects malformed selection offset %s without native output',
    async (anchor) => {
      const f = setup('中文😀正文')
      f.current().selection.anchor = anchor
      await expect(
        f.service.adapterForPlugin('a').adapter.capture({ ...request, scope: 'selection' }),
      ).rejects.toMatchObject({ code: 'invalid-input' })
      expect(f.calls).toEqual([])
    },
  )
  it('rejects a selected half-surrogate instead of corrupting Unicode', async () => {
    const f = setup('中文😀正文')
    f.current().selection.anchor = 3
    f.current().selection.head = 5
    await expect(
      f.service.adapterForPlugin('a').adapter.capture({ ...request, scope: 'selection' }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })
})

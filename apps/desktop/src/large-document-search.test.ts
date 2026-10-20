import { describe, expect, it, vi } from 'vitest'
import { MemoryDocumentSource } from '@milkup/core'
import { LargeDocumentSearchController, prepareLargeReplacement } from './large-document-search'
import type { LargeSearchService } from './large-search-service'
function service(): LargeSearchService {
  return {
    begin: vi.fn().mockResolvedValue(undefined),
    append: vi.fn(),
    step: vi.fn().mockResolvedValue({
      complete: true,
      matchCount: 5000,
      scannedLineCount: 1,
      nativeMs: 1,
      indexBytes: 80,
    }),
    page: vi.fn().mockResolvedValue({ matches: [], matchOffset: 0, matchCount: 5000 }),
    cancel: vi.fn().mockResolvedValue(undefined),
    beginReplacement: vi.fn().mockResolvedValue({ ready: false }),
    stepReplacement: vi.fn().mockResolvedValue({ ready: true }),
    commitReplacement: vi.fn(),
    cancelReplacement: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn(),
  }
}
const source = () => new MemoryDocumentSource({ documentId: 'doc', version: 0, text: 'hello' })
describe('native bounded search lifecycle', () => {
  it('keeps complete counts and requests a bounded page around global result indices', async () => {
    const native = service(),
      controller = new LargeDocumentSearchController(native)
    expect(await controller.run({ query: ' hello ', source: source() })).toMatchObject({
      phase: 'done',
      complete: true,
      matchCount: 5000,
    })
    await controller.page(4900)
    expect(native.page).toHaveBeenLastCalledWith(expect.any(String), 4900)
  })
  it('cancels a superseded begin even when the command resolves late', async () => {
    const native = service()
    let finish!: () => void
    vi.mocked(native.begin).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const controller = new LargeDocumentSearchController(native),
      updates = vi.fn()
    const first = controller.run({ query: 'first', source: source(), onUpdate: updates })
    await controller.run({ query: 'second', source: source() })
    finish()
    expect((await first).phase).toBe('cancelled')
    expect(updates.mock.calls.map((args) => args[0].phase)).toEqual(['searching'])
    expect(native.cancel).toHaveBeenCalled()
  })
  it('ignores a late scan from the previous document after a new document search finishes', async () => {
    const native = service()
    let finish!: (value: Awaited<ReturnType<LargeSearchService['step']>>) => void
    vi.mocked(native.step).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const controller = new LargeDocumentSearchController(native),
      previousUpdates = vi.fn(),
      nextUpdates = vi.fn()
    const previous = controller.run({
      query: 'hello',
      source: source(),
      onUpdate: previousUpdates,
    })
    await vi.waitFor(() => expect(native.step).toHaveBeenCalledTimes(1))
    const next = await controller.run({
      query: 'hello',
      source: new MemoryDocumentSource({ documentId: 'other-document', version: 0, text: 'hello' }),
      onUpdate: nextUpdates,
    })
    finish({
      complete: true,
      matchCount: 99,
      scannedLineCount: 1,
      scannedBytes: 5,
      nativeMs: 1,
      indexBytes: 80,
    })
    expect((await previous).phase).toBe('cancelled')
    expect(next).toMatchObject({ phase: 'done', matchCount: 5000 })
    expect(previousUpdates.mock.calls.map(([state]) => state.phase)).toEqual(['searching'])
    expect(nextUpdates.mock.calls.at(-1)?.[0]).toBe(next)
    expect(native.page).toHaveBeenCalledTimes(1)
    expect(native.cancel).toHaveBeenCalled()
  })
  it('never commits a cancelled replacement preparation', async () => {
    const native = service(),
      abort = new AbortController()
    await expect(
      prepareLargeReplacement(
        native,
        {
          documentId: 'doc',
          expectedVersion: 0,
          searchId: 's',
          replacementId: 'r',
          insert: 'x',
          selectedIndex: null,
        },
        abort.signal,
        () => abort.abort(),
      ),
    ).rejects.toThrow('cancelled')
    expect(native.cancelReplacement).toHaveBeenCalledWith('r')
    expect(native.commitReplacement).not.toHaveBeenCalled()
    expect(native.stepReplacement).not.toHaveBeenCalled()
  })
  it('cleans failed replacement preparation and leaves commit to the guarded edit queue', async () => {
    const native = service()
    vi.mocked(native.stepReplacement).mockRejectedValue(new Error('disk full'))
    await expect(
      prepareLargeReplacement(
        native,
        {
          documentId: 'doc',
          expectedVersion: 0,
          searchId: 's',
          replacementId: 'r',
          insert: 'x',
          selectedIndex: 0,
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('disk full')
    expect(native.cancelReplacement).toHaveBeenCalledWith('r')
    expect(native.commitReplacement).not.toHaveBeenCalled()
  })
})

it('rejects results if the document version changes during a native scan', async () => {
  const native = service(),
    document = source(),
    updates = vi.fn()
  vi.mocked(native.step).mockImplementation(async () => {
    Object.defineProperty(document, 'version', { value: 1 })
    return {
      complete: true,
      matchCount: 1,
      scannedLineCount: 1,
      scannedBytes: 5,
      nativeMs: 1,
      indexBytes: 80,
    }
  })
  const controller = new LargeDocumentSearchController(native)
  expect(
    await controller.run({ query: 'hello', source: document, onUpdate: updates }),
  ).toMatchObject({ phase: 'cancelled', complete: false })
  expect(native.page).not.toHaveBeenCalled()
  expect(native.cancel).toHaveBeenCalled()
  expect(updates.mock.calls.some(([state]) => state.phase === 'done')).toBe(false)
})

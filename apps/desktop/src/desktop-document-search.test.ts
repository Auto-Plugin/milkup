import { EditorState, MemoryDocumentSource, MemoryTextDocument } from '@milkup/core'
import type { DocumentLineWindow } from '@milkup/core'
import { describe, expect, it } from 'vitest'

import { DesktopDocumentSearchController, type DesktopSearchState } from './desktop-document-search'

describe('DesktopDocumentSearchController', () => {
  it('searches a memory editor document through line windows', async () => {
    const controller = new DesktopDocumentSearchController()
    const updates: DesktopSearchState[] = []

    const result = await controller.run({
      query: 'beta',
      state: new EditorState({
        doc: new MemoryTextDocument(['alpha beta', 'Beta gamma', 'tail'].join('\n')),
      }),
      documentId: 'doc-1',
      version: 3,
      windowSizeLines: 1,
      onUpdate: (state) => updates.push(state),
    })

    expect(result.phase).toBe('done')
    expect(result.complete).toBe(true)
    expect(result.matches).toEqual([
      { from: 6, to: 10, line: 1, lineOffset: 6, text: 'beta' },
      { from: 11, to: 15, line: 2, lineOffset: 0, text: 'Beta' },
    ])
    expect(updates[0]).toMatchObject({ phase: 'searching', query: 'beta' })
  })

  it('searches a source-backed document without full text materialization', async () => {
    const source = new RecordingSource({
      documentId: 'large-doc',
      text: ['one', 'target', 'two', 'target'].join('\n'),
    })
    const controller = new DesktopDocumentSearchController()

    const result = await controller.run({
      query: 'target',
      source,
      maxResults: 1,
      windowSizeLines: 1,
    })

    expect(result.phase).toBe('done')
    expect(result.complete).toBe(false)
    expect(result.matches).toEqual([{ from: 4, to: 10, line: 2, lineOffset: 0, text: 'target' }])
    expect(source.requests).toEqual([
      { fromLine: 1, toLine: 1 },
      { fromLine: 2, toLine: 2 },
    ])
  })

  it('cancels the previous search when a new one starts', async () => {
    const source = new SlowRecordingSource({
      documentId: 'large-doc',
      text: ['first', 'second'].join('\n'),
    })
    const controller = new DesktopDocumentSearchController()
    const first = controller.run({
      query: 'first',
      source,
      windowSizeLines: 2,
    })
    await source.waitForPendingReads(1)
    const second = controller.run({
      query: 'second',
      source,
      windowSizeLines: 2,
    })

    await source.waitForPendingReads(2)
    await source.releaseAll()

    await expect(first).resolves.toMatchObject({ phase: 'cancelled' })
    await expect(second).resolves.toMatchObject({
      phase: 'done',
      matches: [{ from: 6, to: 12, line: 2, lineOffset: 0, text: 'second' }],
    })
  })

  it('returns idle state for blank queries', async () => {
    const controller = new DesktopDocumentSearchController()

    await expect(
      controller.run({
        query: '  ',
        state: new EditorState({ doc: new MemoryTextDocument('text') }),
      }),
    ).resolves.toMatchObject({ phase: 'idle', complete: true })
  })
})

class RecordingSource extends MemoryDocumentSource {
  readonly requests: Array<{ fromLine: number; toLine: number }> = []

  override async readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow> {
    this.requests.push({ fromLine, toLine })
    return super.readLineWindow(fromLine, toLine)
  }
}

class SlowRecordingSource extends RecordingSource {
  private resolvers: Array<() => void> = []
  private waiters: Array<() => void> = []

  override async readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow> {
    await new Promise<void>((resolve) => {
      this.resolvers.push(resolve)
      this.notifyWaiters()
    })
    return super.readLineWindow(fromLine, toLine)
  }

  async waitForPendingReads(count: number): Promise<void> {
    while (this.resolvers.length < count) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
      })
    }
  }

  async releaseAll(): Promise<void> {
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()
      resolve?.()
      await Promise.resolve()
    }
  }

  private notifyWaiters(): void {
    const waiters = this.waiters.splice(0, this.waiters.length)

    for (const resolve of waiters) {
      resolve()
    }
  }
}

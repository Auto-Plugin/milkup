import { describe, expect, it } from 'vitest'

import {
  MemoryDocumentStore,
  searchDocumentLineWindows,
  searchDocumentStore,
  type StoreSearchEvent,
} from '../index'

describe('searchDocumentStore', () => {
  it('finds string matches with global UTF-16 offsets across line windows', async () => {
    const store = new MemoryDocumentStore({
      documentId: 'search-doc',
      text: ['alpha beta', 'Beta gamma', 'delta beta'].join('\n'),
    })

    await expect(
      searchDocumentStore(store, {
        query: 'beta',
        windowSizeLines: 2,
      }),
    ).resolves.toMatchObject({
      documentId: 'search-doc',
      version: 0,
      query: 'beta',
      scannedLineCount: 3,
      complete: true,
      matches: [
        { from: 6, to: 10, line: 1, lineOffset: 6, text: 'beta' },
        { from: 11, to: 15, line: 2, lineOffset: 0, text: 'Beta' },
        { from: 28, to: 32, line: 3, lineOffset: 6, text: 'beta' },
      ],
    })
  })

  it('supports case-sensitive string search', async () => {
    const store = new MemoryDocumentStore({
      documentId: 'search-doc',
      text: 'Beta beta BETA',
    })

    const result = await searchDocumentStore(store, {
      query: 'Beta',
      caseSensitive: true,
    })

    expect(result.matches).toEqual([{ from: 0, to: 4, line: 1, lineOffset: 0, text: 'Beta' }])
  })

  it('supports RegExp search without requiring callers to pass a global regex', async () => {
    const store = new MemoryDocumentStore({
      documentId: 'search-doc',
      text: 'item-1\nitem-20\nother',
    })

    const result = await searchDocumentStore(store, {
      query: /item-\d+/,
      windowSizeLines: 1,
    })

    expect(result.matches).toEqual([
      { from: 0, to: 6, line: 1, lineOffset: 0, text: 'item-1' },
      { from: 7, to: 14, line: 2, lineOffset: 0, text: 'item-20' },
    ])
  })

  it('keeps scanning after maxResults while retaining a bounded result list', async () => {
    const store = new MemoryDocumentStore({
      documentId: 'search-doc',
      text: ['hit', 'hit', 'hit', 'hit'].join('\n'),
    })

    const result = await searchDocumentStore(store, {
      query: 'hit',
      maxResults: 2,
      windowSizeLines: 1,
    })

    expect(result.complete).toBe(false)
    expect(result.scannedLineCount).toBe(4)
    expect(result.matches).toEqual([
      { from: 0, to: 3, line: 1, lineOffset: 0, text: 'hit' },
      { from: 4, to: 7, line: 2, lineOffset: 0, text: 'hit' },
    ])
  })

  it('streams matches and a final completion event from line windows', async () => {
    const store = new MemoryDocumentStore({
      documentId: 'search-doc',
      text: ['hit one', 'miss', 'hit two'].join('\n'),
    })

    const events: StoreSearchEvent[] = []

    for await (const event of searchDocumentLineWindows(store, {
      query: 'hit',
      windowSizeLines: 1,
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      {
        type: 'match',
        documentId: 'search-doc',
        version: 0,
        query: 'hit',
        match: { from: 0, to: 3, line: 1, lineOffset: 0, text: 'hit' },
        scannedLineCount: 1,
      },
      {
        type: 'progress',
        documentId: 'search-doc',
        version: 0,
        query: 'hit',
        scannedLineCount: 1,
        matchCount: 1,
      },
      {
        type: 'progress',
        documentId: 'search-doc',
        version: 0,
        query: 'hit',
        scannedLineCount: 2,
        matchCount: 1,
      },
      {
        type: 'match',
        documentId: 'search-doc',
        version: 0,
        query: 'hit',
        match: { from: 13, to: 16, line: 3, lineOffset: 0, text: 'hit' },
        scannedLineCount: 3,
      },
      {
        type: 'progress',
        documentId: 'search-doc',
        version: 0,
        query: 'hit',
        scannedLineCount: 3,
        matchCount: 2,
      },
      {
        type: 'done',
        documentId: 'search-doc',
        version: 0,
        query: 'hit',
        scannedLineCount: 3,
        complete: true,
        matchCount: 2,
      },
    ])
  })

  it('honors abort signals before reading the next search window', async () => {
    const store = new MemoryDocumentStore({
      documentId: 'search-doc',
      text: ['hit', 'hit', 'hit'].join('\n'),
    })
    const abort = new AbortController()
    const events: StoreSearchEvent[] = []

    await expect(async () => {
      for await (const event of searchDocumentLineWindows(store, {
        query: 'hit',
        windowSizeLines: 1,
        signal: abort.signal,
      })) {
        events.push(event)
        abort.abort(new Error('cancelled'))
      }
    }).rejects.toThrow('cancelled')

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'match', scannedLineCount: 1 })
  })

  it('rejects empty and invalid search inputs', async () => {
    const store = new MemoryDocumentStore({ documentId: 'search-doc', text: 'text' })

    await expect(searchDocumentStore(store, { query: '' })).rejects.toThrow('must not be empty')
    await expect(searchDocumentStore(store, { query: 't', maxResults: 0 })).rejects.toThrow(
      'maxResults',
    )
    await expect(searchDocumentStore(store, { query: 't', windowSizeLines: 0 })).rejects.toThrow(
      'windowSizeLines',
    )
  })
})

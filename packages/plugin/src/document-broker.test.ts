import { MemoryDocumentSource } from '@milkup/core'
import { describe, expect, it } from 'vitest'

import {
  createPluginDocumentBroker,
  createPluginDocumentHostCapabilities,
  type PluginDocumentScanEvent,
  type PluginDocumentScanSource,
} from './document-broker'

describe('plugin document broker', () => {
  it('streams Markdown headings across line windows and ignores fenced code', async () => {
    const source = new MemoryDocumentSource({
      documentId: 'outline-doc',
      text: ['# One', '```md', '# ignored', '```', '## Two ##', 'tail'].join('\n'),
      version: 4,
    })
    const broker = createPluginDocumentBroker({ pluginId: 'outline', source: () => source })
    const events = await collectEvents(
      createPluginDocumentHostCapabilities(broker).scan({
        query: { kind: 'markdownHeadings' },
        windowSizeLines: 1,
        batchSize: 1,
      }),
    )
    const headings = events
      .filter((event) => event.type === 'batch')
      .flatMap((event) => event.items)

    expect(headings).toMatchObject([
      { kind: 'heading', level: 1, label: 'One', line: 1, lineOffset: 0 },
      { kind: 'heading', level: 2, label: 'Two', line: 5, lineOffset: 0 },
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      complete: true,
      reason: 'complete',
      scannedLineCount: 6,
      totalLineCount: 6,
      resultCount: 2,
      version: 4,
    })
  })

  it('supports text and restricted regular expression scans with captures', async () => {
    const source = new MemoryDocumentSource({
      documentId: 'find-doc',
      text: ['TODO first', 'skip', 'TODO second'].join('\n'),
    })
    const broker = createPluginDocumentBroker({ pluginId: 'finder', source: () => source })
    const host = createPluginDocumentHostCapabilities(broker)
    const textEvents = await collectEvents(
      host.scan({ query: { kind: 'text', text: 'todo' }, windowSizeLines: 2 }),
    )
    const regexpEvents = await collectEvents(
      host.scan({
        query: { kind: 'regexp', pattern: 'TODO\\s+(\\w+)' },
        windowSizeLines: 3,
      }),
    )

    expect(batchItems(textEvents)).toMatchObject([
      { kind: 'match', line: 1, lineOffset: 0, text: 'TODO' },
      { kind: 'match', line: 3, lineOffset: 0, text: 'TODO' },
    ])
    expect(batchItems(regexpEvents)).toMatchObject([
      { kind: 'match', text: 'TODO first', captures: ['first'] },
      { kind: 'match', text: 'TODO second', captures: ['second'] },
    ])
    await expect(
      collectEvents(host.scan({ query: { kind: 'regexp', pattern: '(a+)+$' } })),
    ).rejects.toThrow('unsafe nested quantifier')
  })

  it('invalidates an active scan when the document version changes', async () => {
    let source: PluginDocumentScanSource = new MemoryDocumentSource({
      documentId: 'changing-doc',
      text: ['# One', 'tail'].join('\n'),
      version: 1,
    })
    const broker = createPluginDocumentBroker({ pluginId: 'outline', source: () => source })
    const started = await broker.start({
      query: { kind: 'markdownHeadings' },
      windowSizeLines: 1,
    })

    await expect(broker.next(started.scanId)).resolves.toMatchObject({ type: 'batch' })
    source = new MemoryDocumentSource({
      documentId: 'changing-doc',
      text: '# Changed',
      version: 2,
    })

    await expect(broker.next(started.scanId)).resolves.toMatchObject({
      type: 'done',
      complete: false,
      reason: 'invalidated',
      version: 1,
      currentVersion: 2,
    })
  })

  it('cancels scans when an async iteration stops early', async () => {
    const source = new MemoryDocumentSource({ documentId: 'doc', text: '# One' })
    const broker = createPluginDocumentBroker({ pluginId: 'outline', source: () => source })
    const scanner = createPluginDocumentHostCapabilities(broker).scan({
      query: { kind: 'markdownHeadings' },
    })
    let scanId = ''

    for await (const event of scanner) {
      scanId = event.scanId
      break
    }

    await expect(broker.next(scanId)).rejects.toThrow(`Unknown document scan: ${scanId}`)
  })

  it('releases a failed scan so it no longer consumes the concurrency limit', async () => {
    const failingSource: PluginDocumentScanSource = {
      documentId: 'broken-doc',
      version: 0,
      lineCount: 1,
      readLineWindow: async () => {
        throw new Error('read failed')
      },
    }
    const broker = createPluginDocumentBroker({
      pluginId: 'outline',
      source: () => failingSource,
      maxConcurrentScans: 1,
    })
    const first = await broker.start({ query: { kind: 'markdownHeadings' } })

    await expect(broker.next(first.scanId)).rejects.toThrow('read failed')
    await expect(broker.start({ query: { kind: 'markdownHeadings' } })).resolves.toMatchObject({
      documentId: 'broken-doc',
    })
  })
})

async function collectEvents(
  scanner: AsyncIterable<PluginDocumentScanEvent>,
): Promise<readonly PluginDocumentScanEvent[]> {
  const events: PluginDocumentScanEvent[] = []
  for await (const event of scanner) events.push(event)
  return events
}

function batchItems(events: readonly PluginDocumentScanEvent[]) {
  return events.filter((event) => event.type === 'batch').flatMap((event) => event.items)
}

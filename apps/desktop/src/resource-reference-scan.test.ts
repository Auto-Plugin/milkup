import { describe, expect, it, vi } from 'vitest'
import { MemoryDocumentSource } from '@milkup/core'
import {
  scanResourceReferences,
  scanDocumentResourceReferences,
  RESOURCE_SCAN_LIMIT,
} from './resource-reference-scan'

describe('bounded Save As image reference scan', () => {
  it('collects and deduplicates local images while leaving external URLs alone', () => {
    expect(
      scanResourceReferences(
        '![a](assets/a.png) ![b](note.assets/b.webp) ![c](https://example.com/a.png) ![](assets/a.png)',
      ),
    ).toEqual(['assets/a.png', 'note.assets/b.webp'])
  })
  it('preserves handwritten local references for native authority rejection', () => {
    expect(scanResourceReferences('![](../private.png) ![](/tmp/x.png)')).toEqual([
      '../private.png',
      '/tmp/x.png',
    ])
  })
  it('supports escaped alt brackets, balanced destinations, angle URLs and titles', () => {
    expect(
      scanResourceReferences(
        '![a \\[b\\]](assets/a\\(1\\).png "caption") ![x](<assets/a b.png> \'title\')',
      ),
    ).toEqual(['assets/a(1).png', 'assets/a b.png'])
  })
  it('ignores code fences, indented code, inline code and escaped image markers', () => {
    expect(
      scanResourceReferences(
        '```md\n![](private.png)\n```\n\n    ![](indented.png)\n\n`![](inline.png)` \\![x](escaped.png)\n![](assets/real.png)',
      ),
    ).toEqual(['assets/real.png'])
  })
  it('handles unmatched inline backticks as literal text, not an excuse to omit images', () => {
    expect(scanResourceReferences('unmatched ` text ![](assets/real.png)')).toEqual([
      'assets/real.png',
    ])
  })
  it('does not close a multi-backtick code span using a shorter run', () => {
    expect(scanResourceReferences('`` code ` ![](ignored.png) `` ![](assets/real.png)')).toEqual([
      'assets/real.png',
    ])
  })
  it('ignores image-looking content inside blockquote and list code fences', () => {
    expect(
      scanResourceReferences(
        '> ```md\n> ![](quoted-code.png)\n> ```\n\n- ```\n  ![](list-code.png)\n  ```\n\n![](assets/real.png)',
      ),
    ).toEqual(['assets/real.png'])
  })
  it('finds real images after a list-contained fence ends with its container', () => {
    expect(scanResourceReferences('- ```\n  ![](ignored.png)\n![](assets/outside.png)')).toEqual([
      'assets/outside.png',
    ])
  })
  it('keeps inline images in headings, lists, nested quotes and tables', () => {
    expect(
      scanResourceReferences(
        '# ![](assets/h.png)\n\n- ![](assets/l.png)\n  - ![](assets/n.png)\n\n> > ![](assets/q.png)\n\n| image |\n| --- |\n| ![](assets/t.png) |',
      ),
    ).toEqual(['assets/h.png', 'assets/l.png', 'assets/n.png', 'assets/q.png', 'assets/t.png'])
  })
  it('does not skip a paragraph continuation merely because it is indented', () => {
    expect(scanResourceReferences('paragraph\n    ![](assets/real.png)')).toEqual([
      'assets/real.png',
    ])
  })
  it('excludes comments and HTML code blocks', () => {
    expect(
      scanResourceReferences(
        '<!-- ![](comment.png) -->\n\n<pre>\n![](html-code.png)\n</pre>\n\n![](assets/real.png)',
      ),
    ).toEqual(['assets/real.png'])
  })
  it.each([
    '![x][id]\n[id]: assets/a.png',
    '![id][]\n[id]: assets/a.png',
    '![id]\n[id]: assets/a.png',
    '![x](assets/a.png',
    '![x](assets/a&amp;b.png)',
  ])('fails explicitly for unproven image syntax %s', (text) => {
    expect(() => scanResourceReferences(text)).toThrowError(
      expect.objectContaining({ code: 'unsupported-syntax' }),
    )
  })
  it('does not reject reference-like text in code', () => {
    expect(scanResourceReferences('`![id][x]`\n\n```\n![id][]\n```')).toEqual([])
  })
  it('limits total image count even if all URLs are the same', () => {
    expect(() => scanResourceReferences('![](assets/a.png) '.repeat(4097))).toThrowError(
      expect.objectContaining({ code: 'too-large' }),
    )
  })
  it('allows oversized plain text while rejecting oversized potential image text', () => {
    expect(scanResourceReferences('x'.repeat(RESOURCE_SCAN_LIMIT + 1))).toEqual([])
    expect(() => scanResourceReferences('x'.repeat(RESOURCE_SCAN_LIMIT) + '![x]')).toThrowError(
      expect.objectContaining({ code: 'too-large' }),
    )
  })
  it('reads a document source in bounded windows and keeps fence state across them', async () => {
    const text = '```\n' + 'code\n'.repeat(300) + '![x](ignored.png)\n```\n![](assets/real.png)\r\n'
    const source = new MemoryDocumentSource({ documentId: 'd', version: 7, text })
    const read = vi.spyOn(source, 'readLineWindow')
    expect(await scanDocumentResourceReferences(source)).toEqual({
      documentId: 'd',
      version: 7,
      references: ['assets/real.png'],
    })
    expect(
      read.mock.calls.every(
        ([from, to, budget]) => to - from < 128 && budget! <= RESOURCE_SCAN_LIMIT,
      ),
    ).toBe(true)
  })
  it('checks potential markers across native UTF8 chunk boundaries', async () => {
    const source = new MemoryDocumentSource({ documentId: 'd', text: '![](assets/a.png)' })
    async function* chunks() {
      yield '!'
      yield ''
      yield '[](assets/a.png)'
    }
    expect((await scanDocumentResourceReferences(source, { chunks: chunks() })).references).toEqual(
      ['assets/a.png'],
    )
  })
  it('does not materialize a large source through line reads when native chunks are supplied', async () => {
    const source = new MemoryDocumentSource({ documentId: 'd', text: 'x' })
    vi.spyOn(source, 'snapshot').mockReturnValue({ documentId: 'd', version: 0, lineCount: 1 })
    const read = vi.spyOn(source, 'readLineWindow')
    async function* chunks() {
      for (let i = 0; i < 80; i++) yield 'x'.repeat(65536)
    }
    expect((await scanDocumentResourceReferences(source, { chunks: chunks() })).references).toEqual(
      [],
    )
    expect(read).not.toHaveBeenCalled()
  })
  it('fails if document version changes during streaming', async () => {
    const source = new MemoryDocumentSource({ documentId: 'd', text: 'hello' })
    let version = 0
    vi.spyOn(source, 'snapshot').mockImplementation(() => ({
      documentId: 'd',
      version,
      lineCount: 1,
      length: 5,
    }))
    async function* chunks() {
      yield 'hello'
      version++
    }
    await expect(
      scanDocumentResourceReferences(source, { chunks: chunks() }),
    ).rejects.toMatchObject({ code: 'invalidated' })
  })
  it('stops on abort instead of returning a partial reference set', async () => {
    const source = new MemoryDocumentSource({ documentId: 'd', text: 'hello' })
    const abort = new AbortController()
    async function* chunks() {
      yield 'hello'
      abort.abort()
      yield '![](assets/a.png)'
    }
    await expect(
      scanDocumentResourceReferences(source, { chunks: chunks(), signal: abort.signal }),
    ).rejects.toMatchObject({ code: 'aborted' })
  })
  it('does not turn heavily indented list code into an image', () => {
    expect(scanResourceReferences('-     ![](code.png)\n\n![](assets/real.png)')).toEqual([
      'assets/real.png',
    ])
  })
  it('excludes complete inline HTML comments', () => {
    expect(scanResourceReferences('text <!-- ![](comment.png) --> ![](assets/real.png)')).toEqual([
      'assets/real.png',
    ])
  })
  it('rejects a supplied stream that is shorter than its declared snapshot', async () => {
    const source = new MemoryDocumentSource({
      documentId: 'd',
      text: 'safe ![](assets/omitted.png)',
    })
    async function* chunks() {
      yield 'safe'
    }
    await expect(
      scanDocumentResourceReferences(source, { chunks: chunks() }),
    ).rejects.toMatchObject({ code: 'invalidated' })
  })
  it('keeps quote lazy continuations inside one inline-code context', () => {
    expect(scanResourceReferences('> `code\n![](ignored.png)\n`\n\n![](assets/real.png)')).toEqual([
      'assets/real.png',
    ])
  })
  it('does not misclassify indented quote paragraph continuations as code', () => {
    expect(scanResourceReferences('> paragraph\n    ![](assets/real.png)')).toEqual([
      'assets/real.png',
    ])
  })
  it('keeps list lazy continuations inside one inline-code context', () => {
    expect(scanResourceReferences('- `code\n![](ignored.png)\n`\n\n![](assets/real.png)')).toEqual([
      'assets/real.png',
    ])
  })
})

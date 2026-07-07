import { describe, expect, it } from 'vitest'

import { createPlainTextPdfProvider } from './plain-text-pdf'
import { exportDocument, exportDocumentAsync, resolveExportDocument } from './scoped-export'

const documents = [
  { documentId: 'doc-a', title: 'A', text: '# A\n' },
  { documentId: 'doc-b', title: 'B', text: '# B\n' },
  { documentId: 'doc-c', title: 'C', text: '<unsafe>' },
  {
    documentId: 'doc-rich',
    title: 'Rich',
    text: [
      '# Title',
      '',
      'A **strong** and *em* [link](https://example.com).',
      '',
      '- one',
      '- two',
      '',
      '```ts',
      'const ok = true',
      '```',
    ].join('\n'),
  },
  {
    documentId: 'doc-assets',
    title: 'Assets',
    text: '![Diagram](assets/diagram 1.png)\n\nSee [Guide](docs/guide.md).',
  },
  {
    documentId: 'doc-table',
    title: 'Table',
    text: '| Name | Value |\n| :--- | ---: |\n| alpha | **ok** |\n',
  },
  {
    documentId: 'doc-math',
    title: 'Math',
    text: '$$\na=b\n$$\n\n$inline$',
  },
]

describe('scoped export', () => {
  it('resolves documents by explicit documentId instead of collection order', () => {
    expect(resolveExportDocument(documents, { documentId: 'doc-b', format: 'markdown' })).toEqual(
      documents[1],
    )
  })

  it('exports the requested document as Markdown', () => {
    expect(exportDocument(documents, { documentId: 'doc-b', format: 'markdown' })).toEqual({
      documentId: 'doc-b',
      format: 'markdown',
      content: '# B\n',
    })
  })

  it('exports parsed Markdown as HTML without depending on DOM state', () => {
    const html = exportDocument(documents, { documentId: 'doc-rich', format: 'html' }).content

    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain(
      '<p>A <strong>strong</strong> and <em>em</em> <a href="https://example.com">link</a>.</p>',
    )
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(html).toContain('<pre><code class="language-ts">const ok = true</code></pre>')
  })

  it('resolves image and relative link URLs during HTML export', () => {
    const resolved: string[] = []
    const html = exportDocument(documents, {
      documentId: 'doc-assets',
      format: 'html',
      resolveUrl: (url, kind) => {
        resolved.push(`${kind}:${url}`)
        return `file:///D:/notes/${url}`
      },
    }).content

    expect(html).toContain('<img src="file:///D:/notes/assets/diagram 1.png" alt="Diagram">')
    expect(html).toContain('<a href="file:///D:/notes/docs/guide.md">Guide</a>')
    expect(resolved).toEqual(['image:assets/diagram 1.png', 'link:docs/guide.md'])
  })

  it('exports pipe tables as semantic HTML tables', () => {
    const html = exportDocument(documents, { documentId: 'doc-table', format: 'html' }).content

    expect(html).toContain('<table><thead><tr>')
    expect(html).toContain('<th style="text-align:left">Name</th>')
    expect(html).toContain('<th style="text-align:right">Value</th>')
    expect(html).toContain('<tbody><tr><td style="text-align:left">alpha</td>')
    expect(html).toContain('<td style="text-align:right"><strong>ok</strong></td>')
  })

  it('exports math-like paragraphs as safe placeholders until math rendering exists', () => {
    const html = exportDocument(documents, { documentId: 'doc-math', format: 'html' }).content

    expect(html).toContain('<div class="math math-display" data-math="a=b">a=b</div>')
    expect(html).toContain('<span class="math math-inline" data-math="inline">inline</span>')
  })

  it('includes requested theme styles in HTML export without depending on current DOM styles', () => {
    const html = exportDocument(documents, {
      documentId: 'doc-b',
      format: 'html',
      themeStyles: 'body { color: #123456; }</style><script>alert(1)</script>',
    }).content

    expect(html).toContain('<style>body { color: #123456; }<\\/style>')
    expect(html).toContain('<h1>B</h1>')
    expect(html).not.toContain('</style><script>')
  })

  it('exports PDF through an explicit provider fed by scoped rendered HTML', async () => {
    const calls: Array<{ documentId: string; html: string; themeStyles: string | undefined }> = []
    const pdf = new Uint8Array([37, 80, 68, 70])
    const result = await exportDocumentAsync(documents, {
      documentId: 'doc-b',
      format: 'pdf',
      themeStyles: 'body { font-family: sans-serif; }',
      pdfProvider: async (input) => {
        calls.push({
          documentId: input.documentId,
          html: input.html,
          themeStyles: input.themeStyles,
        })
        return pdf
      },
    })

    expect(result).toEqual({
      documentId: 'doc-b',
      format: 'pdf',
      content: pdf,
    })
    expect(calls).toEqual([
      {
        documentId: 'doc-b',
        html: expect.stringContaining('<h1>B</h1>'),
        themeStyles: 'body { font-family: sans-serif; }',
      },
    ])
  })

  it('exports a valid baseline PDF with the built-in plain text provider', () => {
    const result = exportDocument(documents, {
      documentId: 'doc-rich',
      format: 'pdf',
      pdfProvider: createPlainTextPdfProvider(),
    })
    const pdf = result.content

    expect(pdf).toBeInstanceOf(Uint8Array)

    if (!(pdf instanceof Uint8Array)) {
      throw new Error('Expected PDF export content to be bytes')
    }

    const text = new TextDecoder().decode(pdf)

    expect(result.documentId).toBe('doc-rich')
    expect(result.format).toBe('pdf')
    expect(text).toMatch(/^%PDF-1\.4/)
    expect(text).toContain('/Type /Catalog')
    expect(text).toContain('/BaseFont /Helvetica')
    expect(text).toContain('/Contents 4 0 R')
    expect(text).toContain('(Title) Tj')
    expect(text).toContain('(A strong and em link.) Tj')
    expect(text).toContain('(const ok = true) Tj')
    expect(text).toContain('%%EOF')
  })

  it('rejects PDF export without an explicit provider', () => {
    expect(() => exportDocument(documents, { documentId: 'doc-b', format: 'pdf' })).toThrow(
      'pdfProvider',
    )
  })

  it('escapes raw HTML when exporting parsed Markdown as HTML', () => {
    expect(exportDocument(documents, { documentId: 'doc-c', format: 'html' }).content).toContain(
      '&lt;unsafe&gt;',
    )
  })

  it('rejects missing document contexts', () => {
    expect(() => exportDocument(documents, { documentId: 'missing', format: 'markdown' })).toThrow(
      'was not found',
    )
  })
})

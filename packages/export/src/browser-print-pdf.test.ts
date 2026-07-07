import { describe, expect, it } from 'vitest'

import { createBrowserPrintPdfProvider } from './browser-print-pdf'
import { exportDocumentAsync } from './scoped-export'

const pdfBytes = new TextEncoder().encode('%PDF-1.7\n%%EOF\n')

describe('createBrowserPrintPdfProvider', () => {
  it('adapts scoped rendered HTML to a host browser/native PDF renderer', async () => {
    const jobs: unknown[] = []
    const provider = createBrowserPrintPdfProvider({
      renderer: async (job) => {
        jobs.push(job)
        return pdfBytes
      },
      fontStrategy: {
        fontFamilies: ['Source Han Sans SC'],
        fallbackFamilies: ['Noto Sans CJK SC', 'Microsoft YaHei'],
        languageHint: 'zh-Hans',
        embeddingMode: 'require-embed',
      },
    })

    const result = await exportDocumentAsync(
      [
        { documentId: 'other', title: 'Other', text: '# Wrong\n' },
        { documentId: 'cjk-doc', title: 'CJK', text: '# 标题\n\n正文 **加粗**\n' },
      ],
      {
        documentId: 'cjk-doc',
        format: 'pdf',
        themeStyles: 'body { font-family: "Source Han Sans SC", sans-serif; }',
        pdfProvider: provider,
      },
    )

    expect(result).toEqual({
      documentId: 'cjk-doc',
      format: 'pdf',
      content: pdfBytes,
    })
    expect(jobs).toEqual([
      {
        documentId: 'cjk-doc',
        title: 'CJK',
        html: expect.stringContaining('<h1>标题</h1>'),
        fontStrategy: {
          fontFamilies: ['Source Han Sans SC'],
          fallbackFamilies: ['Noto Sans CJK SC', 'Microsoft YaHei'],
          languageHint: 'zh-Hans',
          embeddingMode: 'require-embed',
        },
      },
    ])
    expect((jobs[0] as { readonly html: string }).html).not.toContain('Wrong')
  })

  it('rejects renderer output that is not a PDF by default', async () => {
    const provider = createBrowserPrintPdfProvider({
      renderer: () => new TextEncoder().encode('<html></html>'),
    })

    await expect(
      exportDocumentAsync([{ documentId: 'doc', text: '# Doc\n' }], {
        documentId: 'doc',
        format: 'pdf',
        pdfProvider: provider,
      }),
    ).rejects.toThrow('PDF bytes')
  })
})

import { exportDocument } from '@milkup/export'
import { describe, expect, it } from 'vitest'

import { v1Issue } from './helpers/metadata'

const issue = v1Issue({
  area: 'file',
  lesson: 'Export actions must resolve an explicit documentId instead of ambient active tab state.',
  risk: 'v1 could export the first tab even when another tab was active.',
  source: 'https://github.com/Auto-Plugin/milkup/issues/178',
})

describe('v1 regression: active document export uses explicit document context', () => {
  it('exports each requested tab by documentId and never falls back to the first tab', () => {
    expect(issue.source).toContain('/178')

    const documents = [
      { documentId: 'doc-first', title: 'First', text: '# First\n' },
      { documentId: 'doc-active', title: 'Active', text: '# Active\n' },
      { documentId: 'doc-third', title: 'Third', text: '# Third\n' },
    ]

    expect(exportDocument(documents, { documentId: 'doc-active', format: 'markdown' })).toEqual({
      documentId: 'doc-active',
      format: 'markdown',
      content: '# Active\n',
    })
    expect(exportDocument(documents, { documentId: 'doc-third', format: 'markdown' })).toEqual({
      documentId: 'doc-third',
      format: 'markdown',
      content: '# Third\n',
    })
    expect(
      exportDocument(documents, { documentId: 'doc-first', format: 'html' }).content,
    ).toContain('<title>First</title>')
    expect(() =>
      exportDocument(documents, { documentId: 'doc-missing', format: 'markdown' }),
    ).toThrow('was not found')
  })
})

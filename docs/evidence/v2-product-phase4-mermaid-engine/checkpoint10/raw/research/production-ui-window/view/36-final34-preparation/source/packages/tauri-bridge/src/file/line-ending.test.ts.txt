import { describe, expect, it } from 'vitest'

import {
  createDocumentSession,
  createDocumentSessionFromOpenResult,
} from '../session/document-session'
import { detectLineEnding, normalizeLineEndings, prepareTextForFileSave } from './line-ending'

describe('line ending policy', () => {
  it('detects the dominant line ending from opened text', () => {
    expect(detectLineEnding('a\nb\n')).toBe('lf')
    expect(detectLineEnding('a\r\nb\r\n')).toBe('crlf')
    expect(detectLineEnding('a\r\nb\nc\r\n')).toBe('crlf')
    expect(detectLineEnding('single line')).toBe('lf')
  })

  it('normalizes all line endings to the requested save style', () => {
    const mixed = 'a\r\nb\nc\rd'

    expect(normalizeLineEndings(mixed, 'lf')).toBe('a\nb\nc\nd')
    expect(normalizeLineEndings(mixed, 'crlf')).toBe('a\r\nb\r\nc\r\nd')
  })

  it('records line ending policy when opening a file', () => {
    const session = createDocumentSessionFromOpenResult({
      documentId: 'doc-1',
      file: { path: 'D:/notes/crlf.md' },
      text: '# Title\r\n\r\nbody\r\n',
      diskSnapshotHash: 'hash-crlf',
    })

    expect(session.lineEnding).toBe('crlf')
  })

  it('prepares save text using the session line ending policy', () => {
    const crlf = createDocumentSession({
      documentId: 'doc-1',
      file: { path: 'D:/notes/crlf.md' },
      lineEnding: 'crlf',
    })
    const lf = createDocumentSession({
      documentId: 'doc-2',
      file: { path: 'D:/notes/lf.md' },
      lineEnding: 'lf',
    })

    expect(prepareTextForFileSave(crlf, 'a\r\nb\nc')).toBe('a\r\nb\r\nc')
    expect(prepareTextForFileSave(lf, 'a\r\nb\nc')).toBe('a\nb\nc')
  })
})

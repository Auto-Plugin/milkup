import type { DocumentSession } from '../session/document-session'

export type LineEnding = 'lf' | 'crlf'

export function detectLineEnding(text: string): LineEnding {
  let crlfCount = 0
  let lfCount = 0

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)

    if (code !== 10) {
      continue
    }

    lfCount += 1

    if (index > 0 && text.charCodeAt(index - 1) === 13) {
      crlfCount += 1
    }
  }

  const bareLfCount = lfCount - crlfCount
  return crlfCount > bareLfCount ? 'crlf' : 'lf'
}

export function normalizeLineEndings(text: string, lineEnding: LineEnding): string {
  const normalized = text.replace(/\r\n|\r|\n/g, '\n')
  return lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
}

export function prepareTextForFileSave(session: DocumentSession, text: string): string {
  return normalizeLineEndings(text, session.lineEnding)
}

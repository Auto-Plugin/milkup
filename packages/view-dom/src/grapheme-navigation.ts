import type { TextDocument } from '@milkup/core'

// Keep storage/DOM positions in UTF-16, but move editing keys by visible graphemes.
// Segment only the current line, never the entire document on each key press.
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function previousGraphemePosition(doc: TextDocument, position: number): number {
  const line = doc.lineAt(position)
  if (position === line.from) return line.number > 1 ? doc.line(line.number - 1).to : 0
  const segment = segmenter.segment(line.text).containing(position - line.from - 1)
  return line.from + (segment?.index ?? line.text.length)
}

export function nextGraphemePosition(doc: TextDocument, position: number): number {
  const line = doc.lineAt(position)
  const segment = segmenter.segment(line.text).containing(position - line.from)
  if (segment) return line.from + segment.index + segment.segment.length
  return line.number < doc.lineCount ? doc.line(line.number + 1).from : doc.length
}

export function snapGraphemePosition(
  doc: TextDocument,
  position: number,
  direction: 'backward' | 'forward' = 'backward',
): number {
  const line = doc.lineAt(position)
  const offset = position - line.from
  const segment = segmenter.segment(line.text).containing(offset)
  if (!segment || segment.index === offset) return position
  return line.from + segment.index + (direction === 'forward' ? segment.segment.length : 0)
}

import type { EditorDocumentSource, Line } from '@milkup/core'

/** Locate a version-bound UTF-16 range using complete, bounded native lines.
 * Byte lengths and optional source.length are deliberately not used. */
export async function locateDocumentPresentationTarget(
  source: Pick<EditorDocumentSource, 'lineCount' | 'readLineWindow'>,
  target: { readonly from: number; readonly to?: number },
  operation: { readonly signal: AbortSignal; readonly assertCurrent: () => void },
): Promise<{ readonly fromLine: number; readonly toLine: number }> {
  const guard = () => {
    operation.signal.throwIfAborted()
    operation.assertCurrent()
  }
  guard()
  const end = target.to ?? target.from
  const lineCount = source.lineCount
  if (
    !Number.isSafeInteger(target.from) ||
    !Number.isSafeInteger(end) ||
    target.from < 0 ||
    end < target.from ||
    !Number.isSafeInteger(lineCount) ||
    lineCount < 1
  )
    throw new RangeError('Invalid document location')

  const lines = new Map<number, Line>()
  let reads = 0
  const read = async (number: number): Promise<Line> => {
    guard()
    const cached = lines.get(number)
    if (cached) return cached
    if (++reads > 128) throw new RangeError('Document location exceeds lookup budget')
    let window: Awaited<ReturnType<typeof source.readLineWindow>>
    try {
      window = await source.readLineWindow(number, number, 65536)
    } catch (error) {
      guard()
      throw error
    }
    guard()
    const line = window.lines[0]
    if (
      window.lines.length !== 1 ||
      !line ||
      line.number !== number ||
      !Number.isSafeInteger(line.from) ||
      !Number.isSafeInteger(line.to) ||
      line.from < 0 ||
      line.to < line.from ||
      line.text.length !== line.to - line.from ||
      line.text.length > 65536 ||
      window.text !== line.text ||
      window.from !== line.from ||
      window.to !== line.to
    )
      throw new RangeError('Invalid complete document line')
    lines.set(number, line)
    return line
  }
  const locate = async (position: number): Promise<number> => {
    let low = 1,
      high = lineCount,
      found: Line | undefined
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2)
      const line = await read(middle)
      guard()
      if (line.from <= position) {
        found = line
        low = middle + 1
      } else high = middle - 1
    }
    // A position in CRLF belongs to the preceding line. Only the last line can
    // prove the document's end; its UTF-16 offset includes every prior newline.
    if (!found || (found.number === lineCount && position > found.to)) {
      throw new RangeError('Document location is out of bounds')
    }
    return found.number
  }
  const fromLine = await locate(target.from)
  guard()
  const toLine = end === target.from ? fromLine : await locate(end)
  guard()
  return Object.freeze({ fromLine, toLine })
}

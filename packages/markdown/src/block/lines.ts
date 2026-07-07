export interface SourceLine {
  readonly number: number
  readonly from: number
  readonly contentTo: number
  readonly to: number
  readonly text: string
}

export function scanLines(source: string): readonly SourceLine[] {
  const lines: SourceLine[] = []
  let pos = 0
  let number = 1

  while (pos < source.length) {
    const newline = source.indexOf('\n', pos)
    const hasNewline = newline !== -1
    const lineBreakStart = hasNewline ? newline : source.length
    const to = hasNewline ? newline + 1 : source.length
    const contentTo =
      lineBreakStart > pos && source.charCodeAt(lineBreakStart - 1) === 13
        ? lineBreakStart - 1
        : lineBreakStart

    lines.push(
      Object.freeze({
        number,
        from: pos,
        contentTo,
        to,
        text: source.slice(pos, contentTo),
      }),
    )

    pos = to
    number += 1
  }

  return Object.freeze(lines)
}

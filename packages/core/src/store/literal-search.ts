export interface LiteralLineMatch {
  readonly from: number
  readonly to: number
  readonly text: string
}

// This is the established literal/toLocaleLowerCase search policy. Yield hits
// instead of allocating an array per dense line; map case expansions lazily.
export function createLiteralLineMatcher(query: string, caseSensitive = false) {
  if (!query.length) throw new RangeError('Search query must not be empty')
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  return function* (line: string): Generator<LiteralLineMatch> {
    const haystack = caseSensitive ? line : line.toLocaleLowerCase()
    const expanded = haystack.length !== line.length
    const points = line[Symbol.iterator]()
    let sourceOffset = 0,
      foldedEnd = 0
    let boundary: { from: number; to: number } | undefined
    const map = (index: number) => {
      while (index >= foldedEnd) {
        const next = points.next()
        if (next.done) return undefined
        boundary = { from: sourceOffset, to: sourceOffset + next.value.length }
        sourceOffset += next.value.length
        foldedEnd += next.value.toLocaleLowerCase().length
      }
      return boundary
    }
    let found = haystack.indexOf(needle),
      lastEnd = 0
    while (found >= 0) {
      const end = found + needle.length
      const from = expanded ? (map(found)?.from ?? found) : found
      const to = expanded ? (map(end - 1)?.to ?? end) : end
      if (from >= lastEnd) {
        yield { from, to, text: line.slice(from, to) }
        lastEnd = to
      }
      found = haystack.indexOf(needle, Math.max(end, found + 1))
    }
  }
}

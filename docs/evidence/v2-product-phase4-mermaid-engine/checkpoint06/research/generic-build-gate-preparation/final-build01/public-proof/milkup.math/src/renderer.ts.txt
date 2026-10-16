import type {
  SdkDocumentPresentationRequest,
  SdkDocumentPresentationResult,
  SdkDocumentPresentationFragment,
} from '@milkup/plugin-sdk'
import { renderFormula } from './math'

interface Candidate {
  from: number
  to: number
  body: string
  display: boolean
}
function escaped(text: string, index: number): boolean {
  let count = 0
  while (index > 0 && text[--index] === '\\') count++
  return count % 2 === 1
}

/** Delimiters are plugin business; all offsets remain bound to the supplied host snapshot. */
export function renderMathDocument(
  request: SdkDocumentPresentationRequest,
  options: { readonly signal: AbortSignal },
): SdkDocumentPresentationResult {
  if (
    options.signal.aborted ||
    !request.contextKnown ||
    request.source.length !== request.to - request.from ||
    request.source.length > 65536
  )
    return { fragments: [], complete: false }
  const source = request.source,
    base = request.from
  const opaque = new Uint8Array(source.length)
  const text = new Uint8Array(source.length)
  for (const range of [
    ...request.protectedRanges,
    ...request.blocks.filter((x) => x.kind !== 'text'),
  ])
    opaque.fill(1, Math.max(0, range.from - base), Math.min(source.length, range.to - base))
  for (const block of request.blocks)
    if (block.kind === 'text')
      text.fill(1, Math.max(0, block.from - base), Math.min(source.length, block.to - base))
  const blockedPrefix = new Uint32Array(source.length + 1)
  const unknownPrefix = new Uint32Array(source.length + 1)
  for (let i = 0; i < source.length; i++) {
    blockedPrefix[i + 1] = blockedPrefix[i]! + opaque[i]!
    unknownPrefix[i + 1] = unknownPrefix[i]! + (!text[i] && !/\s/.test(source[i]!) ? 1 : 0)
  }
  const candidates: Candidate[] = []
  const blocked = (from: number, to: number) => blockedPrefix[to] !== blockedPrefix[from]
  // Host-classified text plus blank separators only; never infer prose from missing context.
  const known = (from: number, to: number) =>
    !blocked(from, to) && unknownPrefix[to] === unknownPrefix[from]
  for (const block of request.blocks) {
    if (
      block.kind !== 'fence' ||
      !block.complete ||
      block.info?.trim().split(/\s+/)[0] !== 'math' ||
      block.from < base ||
      block.to > request.to
    )
      continue
    const pieces: string[] = []
    let last = block.from
    let valid = true
    for (const range of block.contentRanges) {
      if (range.from < last || range.to < range.from || range.to > block.to) {
        valid = false
        break
      }
      const piece = source.slice(range.from - base, range.to - base)
      if (pieces.length && !pieces[pieces.length - 1]!.endsWith('\n')) pieces.push('\n')
      pieces.push(piece)
      last = range.to
    }
    if (valid)
      candidates.push({
        from: block.from - base,
        to: block.to - base,
        body: pieces.join(''),
        display: true,
      })
  }
  const lines: Array<{ from: number; to: number; end: number; value: string }> = []
  let offset = 0
  for (const line of source.split('\n')) {
    const value = line.replace(/\r$/, '')
    // Fragment boundaries cover line content, never the CR of a CRLF terminator.
    // Keep the raw width separately so the next line retains its UTF-16 offset.
    const rawEnd = offset + line.length
    lines.push({
      from: offset,
      to: offset + value.length,
      end: Math.min(rawEnd + 1, source.length),
      value,
    })
    offset = rawEnd + 1
  }
  for (let i = 0; i < lines.length; i++) {
    if (options.signal.aborted) return { fragments: [], complete: false }
    const line = lines[i]!
    if ((i === 0 && !request.completeStart) || (i === lines.length - 1 && !request.completeEnd))
      continue
    if (line.value.trim() === '$$' && known(line.from, line.to)) {
      let found = false
      for (let j = i + 1; j < lines.length; j++) {
        const end = lines[j]!
        if (blocked(line.from, end.to)) break
        if (end.value.trim() !== '$$') continue
        if (j === lines.length - 1 && !request.completeEnd) break
        if (known(line.from, end.to)) {
          candidates.push({
            from: line.from,
            to: end.to,
            body: source.slice(line.end, end.from).replace(/\r?\n$/, ''),
            display: true,
          })
          i = j
          found = true
        }
        break
      }
      if (found) continue
      // An unclosed display block retains its entire remaining source.
      break
    }
    let opening = -1
    for (let p = line.from; p < line.to; p++) {
      if (blocked(p, p + 1)) {
        opening = -1
        continue
      }
      if (source[p] !== '$' || escaped(source, p)) continue
      if (source[p - 1] === '$' || source[p + 1] === '$') {
        opening = -1
        continue
      }
      const closes =
        opening >= 0 &&
        p > opening + 1 &&
        !/\s/.test(source[p - 1]!) &&
        !/[0-9]/.test(source[p + 1] ?? '')
      if (closes) {
        if (known(opening, p + 1))
          candidates.push({
            from: opening,
            to: p + 1,
            body: source.slice(opening + 1, p),
            display: false,
          })
        opening = -1
      } else {
        // An unescaped dollar cannot be a TeX body character. Restart once,
        // rather than rescanning a suffix for each malformed opening marker.
        opening = p + 1 < line.to && !/\s/.test(source[p + 1]!) ? p : -1
      }
    }
  }

  const fragments: SdkDocumentPresentationFragment[] = []
  let complete = true,
    bytes = 0,
    nodes = 0,
    lastEnd = -1
  for (const candidate of candidates.sort((a, b) => a.from - b.from || a.to - b.to)) {
    if (options.signal.aborted) return { fragments: [], complete: false }
    if (candidate.from < lastEnd) continue
    if (fragments.length >= 128) {
      complete = false
      break
    }
    const raw = source.slice(candidate.from, candidate.to)
    const common = {
      from: base + candidate.from,
      to: base + candidate.to,
      layout: candidate.display ? ('block' as const) : ('inline' as const),
      accessibleText:
        raw.length <= 8192
          ? raw
          : raw.slice(0, 8170).replace(/[\uD800-\uDBFF]$/, '') + '…（源码过长）',
    }
    let fragment: SdkDocumentPresentationFragment
    try {
      fragment = {
        ...common,
        content: { type: 'math', tree: renderFormula(candidate.body, candidate.display) },
        status: 'ready',
      }
    } catch {
      fragment = {
        ...common,
        content: { type: 'text', text: raw },
        status: 'error',
        message: '公式不受支持、包含禁止内容或超过限制；已保留源码。',
      }
    }
    const serialized = JSON.stringify(fragment)
    const size = new TextEncoder().encode(serialized).length
    const count = (serialized.match(/"tag":/g)?.length ?? 0) + 1
    // Leave room for the result envelope and semantic parent nodes.
    if (bytes + size > 250 * 1024 || nodes + count > 4000) {
      complete = false
      break
    }
    bytes += size
    nodes += count
    fragments.push(fragment)
    lastEnd = candidate.to
  }
  return { fragments, complete }
}

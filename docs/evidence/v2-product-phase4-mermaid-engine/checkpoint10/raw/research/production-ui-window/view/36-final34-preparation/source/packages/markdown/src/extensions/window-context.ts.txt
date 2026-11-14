import { parseInline } from '../inline/parser'
import type { SourceRange, SyntaxNode } from '../cst/node'

export interface MarkdownContextLine {
  readonly number: number
  readonly from: number
  readonly to: number
  readonly text: string
}
export interface MarkdownContextSource {
  readonly documentId: string
  readonly version: number
  readonly lineCount: number
  readLineWindow(
    fromLine: number,
    toLine: number,
    maxTextLength?: number,
  ): Promise<{
    readonly from: number
    readonly to: number
    readonly text: string
    readonly lines: readonly MarkdownContextLine[]
  }>
}
export interface MarkdownContextWindow extends SourceRange {
  readonly documentId: string
  readonly version: number
  readonly source: string
  readonly fromLine: number
  readonly toLine: number
  readonly completeStart: boolean
  readonly completeEnd: boolean
}
export interface MarkdownContextBlock extends SourceRange {
  readonly kind: 'text' | 'fence' | 'code' | 'unknown'
  readonly complete: boolean
  readonly info?: string
  readonly contentRanges: readonly SourceRange[]
}
export interface MarkdownWindowContext {
  readonly pending: boolean
  readonly scannedThroughLine: number
  readonly scannedChars: number
  readonly reason?: 'budget' | 'unknown' | 'oversized'
  readonly contextKnown: boolean
  readonly protectedRanges: readonly SourceRange[]
  readonly blocks: readonly MarkdownContextBlock[]
}
interface State {
  fence?: { marker: string; length: number; info: string }
  html?: string
  uncertain?: boolean
  inlineTicks?: number
}
const MAX_WINDOW = 65_536,
  MAX_LINES = 256
function nextState(state: State): State {
  return { ...state, ...(state.fence ? { fence: { ...state.fence } } : {}) }
}
function htmlOpening(text: string): string | undefined {
  const special = /^ {0,3}<(script|pre|style|textarea)(?:[\t >]|$)/i.exec(text)
  if (special) return `</${special[1]!.toLowerCase()}>`
  if (/^ {0,3}<!--/.test(text)) return '-->'
  if (/^ {0,3}<\?/.test(text)) return '?>'
  if (/^ {0,3}<!\[CDATA\[/.test(text)) return ']]>'
  if (/^ {0,3}<![A-Z]/.test(text)) return '>'
  if (/^ {0,3}<\/?[A-Za-z][\w-]*(?:[\t >\/]|$)/.test(text)) return 'blank'
  return undefined
}
/** A conservative finite state for opaque Markdown regions; no extension syntax. */
function classify(
  line: MarkdownContextLine,
  state: State,
): { kind: MarkdownContextBlock['kind']; opened?: boolean; closed?: boolean; info?: string } {
  const text = line.text
  if (state.uncertain) return { kind: 'unknown' }
  if (state.fence) {
    const f = state.fence
    const close = /^ {0,3}(`+|~+)[\t ]*$/.exec(text)
    if (close && close[1]![0] === f.marker && close[1]!.length >= f.length) {
      delete state.fence
      return { kind: 'fence', closed: true, info: f.info }
    }
    return { kind: 'fence', info: f.info }
  }
  if (state.html) {
    if (state.html === 'blank' && !text.trim()) {
      delete state.html
      return { kind: 'text' }
    }
    const end = state.html
    if (end !== 'blank' && text.toLowerCase().includes(end.toLowerCase())) delete state.html
    return { kind: 'code' }
  }
  // The existing parser does not prove the extent of nested container blocks.
  if (
    /^ {0,3}(?:>|[-+*][\t ]|\d+[.)][\t ])/.test(text) &&
    /(?:`{3,}|~{3,}|<\/?[A-Za-z!])/.test(text)
  ) {
    state.uncertain = true
    return { kind: 'unknown' }
  }
  const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text)
  if (opening && !(opening[1]![0] === '`' && opening[2]!.includes('`'))) {
    state.fence = {
      marker: opening[1]![0]!,
      length: opening[1]!.length,
      info: opening[2]!.trim().slice(0, 256),
    }
    delete state.inlineTicks
    return { kind: 'fence', opened: true, info: state.fence.info }
  }
  const html = htmlOpening(text)
  if (html) {
    if (html === 'blank' || !text.toLowerCase().includes(html.toLowerCase())) state.html = html
    return { kind: 'code' }
  }
  if (/^(?: {4}|\t)/.test(text)) return { kind: 'code' }
  return { kind: 'text' }
}
function inlineProtected(text: string, from: number, state: State): SourceRange[] {
  const ranges: SourceRange[] = []
  // Carry code runs through soft line breaks. An unfinished span stays source.
  let start = state.inlineTicks ? 0 : -1
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && !state.inlineTicks) {
      i += 2
      continue
    }
    if (text[i] !== '`') {
      i++
      continue
    }
    let end = i + 1
    while (text[end] === '`') end++
    const length = end - i
    if (state.inlineTicks === length) {
      ranges.push({ from: from + start, to: from + end })
      delete state.inlineTicks
      start = -1
    } else if (!state.inlineTicks) {
      state.inlineTicks = length
      start = i
    }
    i = end
  }
  if (state.inlineTicks) ranges.push({ from: from + Math.max(0, start), to: from + text.length })
  const visit = (node: SyntaxNode): void => {
    if (node.type === 'inlineCode') ranges.push({ from: from + node.from, to: from + node.to })
    if (node.type === 'link' || node.type === 'image') {
      const target = node.contentRanges?.[1]
      if (target) ranges.push({ from: from + target.from, to: from + target.to })
    }
    for (const child of node.children ?? []) visit(child)
  }
  for (const node of parseInline(text)) visit(node)
  // Inline HTML is conservatively opaque for this entire line.
  if (/<\/?[A-Za-z!][^>]*>/.test(text)) ranges.push({ from, to: from + text.length })
  return ranges
}
function linesOf(window: MarkdownContextWindow): MarkdownContextLine[] {
  let from = window.from
  return window.source
    .split('\n')
    .map((raw, index) => {
      const text = raw.replace(/\r$/, '')
      const line = { number: window.fromLine + index, from, to: from + text.length, text }
      from += raw.length + 1
      return line
    })
    .slice(0, window.toLine - window.fromLine + 1)
}
function fallback(
  window: MarkdownContextWindow,
  progress: {
    pending?: boolean
    scannedThroughLine?: number
    scannedChars?: number
    reason?: 'budget' | 'unknown' | 'oversized'
  } = {},
): MarkdownWindowContext {
  return {
    pending: false,
    scannedThroughLine: 0,
    scannedChars: 0,
    reason: 'unknown',
    ...progress,
    contextKnown: false,
    protectedRanges: [{ from: window.from, to: window.to }],
    blocks: [
      { kind: 'unknown', from: window.from, to: window.to, complete: false, contentRanges: [] },
    ],
  }
}
function analyze(
  window: MarkdownContextWindow,
  initial: State,
): { result: MarkdownWindowContext; state: State } {
  const state = nextState(initial),
    blocks: MarkdownContextBlock[] = [],
    protectedRanges: SourceRange[] = []
  const lines = linesOf(window)
  let fence:
    { from: number; contentFrom: number; info: string; completeStart: boolean } | undefined =
    state.fence
      ? {
          from: window.from,
          contentFrom: window.from,
          info: state.fence.info,
          completeStart: false,
        }
      : undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!,
      after = lines[i + 1]?.from ?? window.to
    const kind = classify(line, state)
    if (kind.kind === 'fence') {
      if (kind.opened)
        fence = { from: line.from, contentFrom: after, info: kind.info ?? '', completeStart: true }
      if (kind.closed && fence) {
        blocks.push({
          kind: 'fence',
          from: fence.from,
          to: line.to,
          complete: fence.completeStart,
          info: fence.info,
          contentRanges: [{ from: Math.min(fence.contentFrom, line.from), to: line.from }],
        })
        protectedRanges.push({ from: fence.from, to: line.to })
        fence = undefined
      }
      continue
    }
    blocks.push({
      kind: kind.kind,
      from: line.from,
      to: line.to,
      complete: kind.kind !== 'unknown',
      contentRanges: kind.kind === 'text' ? [{ from: line.from, to: line.to }] : [],
    })
    if (kind.kind !== 'text') protectedRanges.push({ from: line.from, to: line.to })
    else protectedRanges.push(...inlineProtected(line.text, line.from, state))
  }
  if (fence) {
    blocks.push({
      kind: 'fence',
      from: fence.from,
      to: window.to,
      complete: false,
      info: fence.info,
      contentRanges: [{ from: Math.min(fence.contentFrom, window.to), to: window.to }],
    })
    protectedRanges.push({ from: fence.from, to: window.to })
  }
  blocks.sort((a, b) => a.from - b.from)
  protectedRanges.sort((a, b) => a.from - b.from || a.to - b.to)
  const merged: SourceRange[] = []
  for (const r of protectedRanges) {
    if (r.to <= r.from) continue
    const last = merged.at(-1)
    if (last && r.from <= last.to)
      merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, r.to) }
    else merged.push(r)
  }
  return {
    result: {
      pending: false,
      scannedThroughLine: window.toLine,
      scannedChars: 0,
      ...(state.uncertain ? { reason: 'unknown' as const } : {}),
      contextKnown: !state.uncertain,
      blocks,
      protectedRanges: merged,
    },
    state,
  }
}

export function createMarkdownWindowContextReader(options: {
  readonly source: () => MarkdownContextSource | undefined
  readonly maxScanChars?: number
  readonly maxScanLines?: number
}) {
  let cachedSource: MarkdownContextSource | undefined,
    cachedVersion = -1
  const checkpoints = new Map<number, State>()
  const clear = () => {
    cachedSource = undefined
    cachedVersion = -1
    checkpoints.clear()
  }
  return {
    clear,
    async read(
      window: MarkdownContextWindow,
      operation: {
        readonly signal?: AbortSignal
        readonly maxScanChars?: number
        readonly maxScanLines?: number
      } = {},
    ): Promise<MarkdownWindowContext> {
      const source = options.source(),
        version = source?.version
      const guard = () => {
        operation.signal?.throwIfAborted()
        if (
          !source ||
          options.source() !== source ||
          source.version !== version ||
          source.documentId !== window.documentId ||
          version !== window.version
        )
          throw new Error('stale Markdown context')
      }
      guard()
      if (
        window.source.length !== window.to - window.from ||
        window.source.length > MAX_WINDOW ||
        window.toLine - window.fromLine + 1 > MAX_LINES ||
        window.fromLine < 1 ||
        window.toLine < window.fromLine
      )
        return fallback(window, { reason: 'oversized' })
      if (cachedSource !== source || cachedVersion !== version) {
        clear()
        cachedSource = source
        cachedVersion = version!
        checkpoints.set(1, {})
      }
      let line = 1,
        state: State = {}
      for (const [candidate, value] of checkpoints)
        if (candidate <= window.fromLine && candidate >= line) {
          line = candidate
          state = nextState(value)
        }
      const boundedBudget = (remaining: number | undefined, maximum: number): number => {
        if (
          !Number.isSafeInteger(maximum) ||
          maximum < 0 ||
          (remaining !== undefined && (!Number.isSafeInteger(remaining) || remaining < 0))
        )
          throw new RangeError('Invalid Markdown context budget')
        return Math.min(remaining ?? maximum, maximum)
      }
      const initialChars = boundedBudget(operation.maxScanChars, options.maxScanChars ?? 1_048_576)
      let chars = initialChars,
        remainingLines = boundedBudget(operation.maxScanLines, options.maxScanLines ?? 8192)
      while (line < window.fromLine) {
        guard()
        if (chars <= 0 || remainingLines <= 0)
          return fallback(window, {
            pending: true,
            scannedThroughLine: line - 1,
            scannedChars: initialChars - chars,
            reason: 'budget',
          })
        let end = Math.min(window.fromLine - 1, line + Math.min(128, remainingLines) - 1)
        let page: Awaited<ReturnType<MarkdownContextSource['readLineWindow']>>
        for (;;) {
          try {
            page = await source!.readLineWindow(line, end, Math.min(MAX_WINDOW, chars))
            break
          } catch (error) {
            guard()
            if (!(error instanceof RangeError)) return fallback(window)
            if (end === line)
              return fallback(window, {
                pending: chars < MAX_WINDOW,
                scannedThroughLine: line - 1,
                scannedChars: initialChars - chars,
                reason: chars < MAX_WINDOW ? 'budget' : 'oversized',
              })
            end = line + Math.floor((end - line) / 2)
          }
        }
        guard()
        if (page!.text.length > chars || page!.lines.length !== end - line + 1)
          return fallback(window)
        chars -= page!.text.length
        remainingLines -= page!.lines.length
        for (const row of page!.lines) {
          const kind = classify(row, state)
          if (kind.kind === 'text') inlineProtected(row.text, row.from, state)
        }
        line = end + 1
        checkpoints.set(line, nextState(state))
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        guard()
        if (checkpoints.size > 256) {
          const first = [...checkpoints.keys()].find((key) => key !== 1)
          if (first !== undefined) checkpoints.delete(first)
        }
      }
      guard()
      return { ...analyze(window, state).result, scannedChars: initialChars - chars }
    },
  }
}

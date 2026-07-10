import type { DocumentLine, DocumentLineWindow } from '@milkup/core'

export type PluginDocumentScanQuery =
  | {
      readonly kind: 'text'
      readonly text: string
      readonly caseSensitive?: boolean
    }
  | {
      readonly kind: 'regexp'
      readonly pattern: string
      readonly flags?: string
    }
  | {
      readonly kind: 'markdownHeadings'
      readonly levels?: readonly number[]
    }

export interface PluginDocumentScanRequest {
  readonly query: PluginDocumentScanQuery
  readonly batchSize?: number
  readonly windowSizeLines?: number
  readonly maxResults?: number
}

export interface PluginDocumentScanSource {
  readonly documentId: string
  readonly version: number
  readonly lineCount: number
  readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow>
}

export interface PluginDocumentScanStartResult {
  readonly scanId: string
  readonly documentId: string
  readonly version: number
  readonly lineCount: number
}

export interface PluginDocumentScanMatch {
  readonly id: string
  readonly kind: 'match'
  readonly from: number
  readonly to: number
  readonly line: number
  readonly lineOffset: number
  readonly text: string
  readonly textTruncated?: boolean
  readonly captures?: readonly string[]
}

export interface PluginDocumentScanHeading {
  readonly id: string
  readonly kind: 'heading'
  readonly from: number
  readonly to: number
  readonly line: number
  readonly lineOffset: number
  readonly level: number
  readonly label: string
  readonly labelTruncated?: boolean
  readonly labelFrom: number
  readonly labelTo: number
}

export type PluginDocumentScanItem = PluginDocumentScanMatch | PluginDocumentScanHeading
type PluginDocumentScanItemInput =
  Omit<PluginDocumentScanMatch, 'id'> | Omit<PluginDocumentScanHeading, 'id'>

interface PluginDocumentScanEventBase {
  readonly scanId: string
  readonly documentId: string
  readonly version: number
  readonly scannedLineCount: number
  readonly totalLineCount: number
  readonly resultCount: number
}

export type PluginDocumentScanEvent =
  | (PluginDocumentScanEventBase & {
      readonly type: 'batch'
      readonly items: readonly PluginDocumentScanItem[]
    })
  | (PluginDocumentScanEventBase & {
      readonly type: 'progress'
    })
  | (PluginDocumentScanEventBase & {
      readonly type: 'done'
      readonly complete: boolean
      readonly reason: 'complete' | 'cancelled' | 'invalidated' | 'truncated'
      readonly currentVersion?: number
    })

export interface PluginDocumentBroker {
  start(request: PluginDocumentScanRequest): Promise<PluginDocumentScanStartResult>
  next(scanId: string): Promise<PluginDocumentScanEvent>
  cancel(scanId: string): Promise<void>
}

export interface ManagedPluginDocumentBroker extends PluginDocumentBroker {
  cancelAll(): Promise<void>
}

export interface PluginDocumentScanner extends AsyncIterable<PluginDocumentScanEvent> {
  cancel(): Promise<void>
}

export interface PluginDocumentHost {
  scan(request: PluginDocumentScanRequest): PluginDocumentScanner
}

export interface PluginDocumentBrokerConfig {
  readonly pluginId: string
  readonly source: () => PluginDocumentScanSource | undefined
  readonly maxConcurrentScans?: number
}

interface ScanSession {
  readonly id: string
  readonly source: PluginDocumentScanSource
  readonly query: CompiledQuery
  readonly batchSize: number
  readonly windowSizeLines: number
  readonly maxResults: number
  readonly pending: PluginDocumentScanItem[]
  nextLine: number
  scannedLineCount: number
  resultCount: number
  fence: MarkdownFence | undefined
  terminalReason: 'truncated' | undefined
}

type CompiledQuery =
  | { readonly kind: 'text' | 'regexp'; readonly expression: RegExp }
  | { readonly kind: 'markdownHeadings'; readonly levels: ReadonlySet<number> }

interface MarkdownFence {
  readonly marker: '`' | '~'
  readonly length: number
}

const DEFAULT_BATCH_SIZE = 64
const MAX_BATCH_SIZE = 256
const DEFAULT_WINDOW_SIZE_LINES = 512
const MAX_WINDOW_SIZE_LINES = 4_096
const DEFAULT_MAX_RESULTS = 10_000
const MAX_RESULTS = 50_000
const MAX_PATTERN_LENGTH = 256
const MAX_RESULT_TEXT_LENGTH = 4_096
const MAX_REGEXP_LINE_LENGTH = 64 * 1_024

export function createPluginDocumentBroker(
  config: PluginDocumentBrokerConfig,
): ManagedPluginDocumentBroker {
  const sessions = new Map<string, ScanSession>()
  const maxConcurrentScans = normalizeInteger(
    config.maxConcurrentScans,
    2,
    1,
    8,
    'maxConcurrentScans',
  )
  let nextScanId = 0

  return Object.freeze({
    start: async (request: PluginDocumentScanRequest): Promise<PluginDocumentScanStartResult> => {
      const source = config.source()

      if (!source) {
        throw new Error('No active document is available for scanning')
      }

      if (sessions.size >= maxConcurrentScans) {
        throw new Error(`Plugin document scan limit reached: ${maxConcurrentScans}`)
      }

      const id = `${config.pluginId}:${Date.now().toString(36)}:${(nextScanId++).toString(36)}`
      sessions.set(id, {
        id,
        source,
        query: compileQuery(request.query),
        batchSize: normalizeInteger(
          request.batchSize,
          DEFAULT_BATCH_SIZE,
          1,
          MAX_BATCH_SIZE,
          'batchSize',
        ),
        windowSizeLines: normalizeInteger(
          request.windowSizeLines,
          DEFAULT_WINDOW_SIZE_LINES,
          1,
          MAX_WINDOW_SIZE_LINES,
          'windowSizeLines',
        ),
        maxResults: normalizeInteger(
          request.maxResults,
          DEFAULT_MAX_RESULTS,
          1,
          MAX_RESULTS,
          'maxResults',
        ),
        pending: [],
        nextLine: 1,
        scannedLineCount: 0,
        resultCount: 0,
        fence: undefined,
        terminalReason: undefined,
      })

      return Object.freeze({
        scanId: id,
        documentId: source.documentId,
        version: source.version,
        lineCount: source.lineCount,
      })
    },
    next: async (scanId: string): Promise<PluginDocumentScanEvent> => {
      const session = sessions.get(scanId)

      if (!session) {
        throw new Error(`Unknown document scan: ${scanId}`)
      }

      const current = config.source()

      if (
        !current ||
        current.documentId !== session.source.documentId ||
        current.version !== session.source.version
      ) {
        sessions.delete(scanId)
        return freezeDoneEvent(session, 'invalidated', false, current?.version)
      }

      if (session.pending.length > 0) {
        return takeBatch(session)
      }

      if (session.terminalReason) {
        sessions.delete(scanId)
        return freezeDoneEvent(session, session.terminalReason, false)
      }

      if (session.nextLine > session.source.lineCount) {
        sessions.delete(scanId)
        return freezeDoneEvent(session, 'complete', true)
      }

      const fromLine = session.nextLine
      const toLine = Math.min(session.source.lineCount, fromLine + session.windowSizeLines - 1)
      let window: DocumentLineWindow

      try {
        window = await session.source.readLineWindow(fromLine, toLine)
      } catch (error) {
        sessions.delete(scanId)
        throw error
      }

      const latest = config.source()

      if (
        !latest ||
        latest.documentId !== session.source.documentId ||
        latest.version !== session.source.version
      ) {
        sessions.delete(scanId)
        return freezeDoneEvent(session, 'invalidated', false, latest?.version)
      }

      try {
        scanWindow(session, window.lines)
      } catch (error) {
        sessions.delete(scanId)
        throw error
      }
      session.nextLine = toLine + 1
      session.scannedLineCount += window.lines.length

      return session.pending.length > 0 ? takeBatch(session) : freezeProgressEvent(session)
    },
    cancel: async (scanId: string): Promise<void> => {
      sessions.delete(scanId)
    },
    cancelAll: async (): Promise<void> => {
      sessions.clear()
    },
  })
}

export function createPluginDocumentHostCapabilities(
  broker: PluginDocumentBroker,
): PluginDocumentHost {
  return Object.freeze({
    scan: (request: PluginDocumentScanRequest): PluginDocumentScanner => {
      let started: PluginDocumentScanStartResult | undefined
      let finished = false

      const scanner: PluginDocumentScanner = {
        [Symbol.asyncIterator](): AsyncIterator<PluginDocumentScanEvent> {
          return {
            next: async (): Promise<IteratorResult<PluginDocumentScanEvent>> => {
              if (finished) {
                return { value: undefined, done: true }
              }

              started ??= await broker.start(request)
              const event = await broker.next(started.scanId)

              if (event.type === 'done') {
                finished = true
              }

              return { value: event, done: false }
            },
            return: async (): Promise<IteratorResult<PluginDocumentScanEvent>> => {
              await scanner.cancel()
              return { value: undefined, done: true }
            },
          }
        },
        cancel: async (): Promise<void> => {
          if (!finished && started) {
            await broker.cancel(started.scanId)
          }
          finished = true
        },
      }

      return Object.freeze(scanner)
    },
  })
}

function compileQuery(query: PluginDocumentScanQuery): CompiledQuery {
  if (query.kind === 'markdownHeadings') {
    const levels = query.levels ?? [1, 2, 3, 4, 5, 6]

    if (
      levels.length === 0 ||
      levels.some((level) => !Number.isInteger(level) || level < 1 || level > 6)
    ) {
      throw new Error('Markdown heading levels must contain integers from 1 to 6')
    }

    return Object.freeze({ kind: query.kind, levels: new Set(levels) })
  }

  if (query.kind === 'text') {
    if (query.text.length === 0 || query.text.length > MAX_PATTERN_LENGTH) {
      throw new Error(`Text scan query must contain 1-${MAX_PATTERN_LENGTH} characters`)
    }

    return Object.freeze({
      kind: query.kind,
      expression: new RegExp(escapeRegExp(query.text), query.caseSensitive ? 'gu' : 'giu'),
    })
  }

  assertSafeRegExp(query.pattern, query.flags ?? '')
  return Object.freeze({
    kind: query.kind,
    expression: new RegExp(query.pattern, normalizeRegExpFlags(query.flags ?? '')),
  })
}

function scanWindow(session: ScanSession, lines: readonly DocumentLine[]): void {
  for (const line of lines) {
    if (session.resultCount >= session.maxResults) {
      session.terminalReason = 'truncated'
      return
    }

    if (session.query.kind === 'markdownHeadings') {
      const heading = scanMarkdownHeading(session, line)

      if (heading) {
        addResult(session, heading)
      }
      continue
    }

    if (line.text.length > MAX_REGEXP_LINE_LENGTH && session.query.kind === 'regexp') {
      throw new Error(
        `Regular expression scanning does not support lines longer than ${MAX_REGEXP_LINE_LENGTH} characters`,
      )
    }

    session.query.expression.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = session.query.expression.exec(line.text))) {
      const value = match[0]
      const from = line.from + match.index
      const text = truncateText(value)
      addResult(session, {
        kind: 'match',
        from,
        to: from + value.length,
        line: line.number,
        lineOffset: match.index,
        text: text.value,
        ...(text.truncated ? { textTruncated: true } : {}),
        ...(match.length > 1
          ? {
              captures: Object.freeze(
                match.slice(1).map((capture) => truncateText(capture ?? '').value),
              ),
            }
          : {}),
      })

      if (session.resultCount >= session.maxResults) {
        session.terminalReason = 'truncated'
        return
      }

      if (value.length === 0) {
        session.query.expression.lastIndex += 1
      }
    }
  }
}

function scanMarkdownHeading(
  session: ScanSession,
  line: DocumentLine,
): Omit<PluginDocumentScanHeading, 'id'> | undefined {
  const query = session.query

  if (query.kind !== 'markdownHeadings') {
    return undefined
  }

  if (session.fence) {
    if (isClosingFence(line.text, session.fence)) {
      session.fence = undefined
    }
    return undefined
  }

  const openingFence = /^( {0,3})(`{3,}|~{3,})/.exec(line.text)?.[2]

  if (openingFence) {
    session.fence = {
      marker: openingFence[0] as '`' | '~',
      length: openingFence.length,
    }
    return undefined
  }

  if (/^ {4}/.test(line.text)) {
    return undefined
  }

  const match = /^( {0,3})(#{1,6})([ \t]+|$)(.*)$/.exec(line.text)
  const marker = match?.[2]

  if (!match || !marker || !query.levels.has(marker.length)) {
    return undefined
  }

  const separator = match[3] ?? ''
  const content = match[4] ?? ''
  const contentStart = match[1]!.length + marker.length + separator.length
  const normalizedLabel = content
    .trim()
    .replace(/[ \t]+#+[ \t]*$/, '')
    .trimEnd()
  const label = truncateText(normalizedLabel)

  return Object.freeze({
    kind: 'heading',
    from: line.from,
    to: line.to,
    line: line.number,
    lineOffset: match[1]!.length,
    level: marker.length,
    label: label.value,
    ...(label.truncated ? { labelTruncated: true } : {}),
    labelFrom: line.from + contentStart,
    labelTo: line.from + contentStart + normalizedLabel.length,
  })
}

function addResult(session: ScanSession, item: PluginDocumentScanItemInput): void {
  session.resultCount += 1
  session.pending.push(
    Object.freeze({
      ...item,
      id: `${session.id}:${session.resultCount}`,
    }) as PluginDocumentScanItem,
  )
}

function takeBatch(session: ScanSession): PluginDocumentScanEvent {
  return Object.freeze({
    ...eventBase(session),
    type: 'batch',
    items: Object.freeze(session.pending.splice(0, session.batchSize)),
  })
}

function freezeProgressEvent(session: ScanSession): PluginDocumentScanEvent {
  return Object.freeze({ ...eventBase(session), type: 'progress' })
}

function freezeDoneEvent(
  session: ScanSession,
  reason: Extract<PluginDocumentScanEvent, { readonly type: 'done' }>['reason'],
  complete: boolean,
  currentVersion?: number,
): PluginDocumentScanEvent {
  return Object.freeze({
    ...eventBase(session),
    type: 'done',
    complete,
    reason,
    ...(currentVersion === undefined ? {} : { currentVersion }),
  })
}

function eventBase(session: ScanSession): PluginDocumentScanEventBase {
  return {
    scanId: session.id,
    documentId: session.source.documentId,
    version: session.source.version,
    scannedLineCount: session.scannedLineCount,
    totalLineCount: session.source.lineCount,
    resultCount: session.resultCount,
  }
}

function assertSafeRegExp(pattern: string, flags: string): void {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Regular expression must contain 1-${MAX_PATTERN_LENGTH} characters`)
  }

  if (/[^imsu]/.test(flags) || new Set(flags).size !== flags.length) {
    throw new Error('Regular expression flags may only contain i, m, s, and u once')
  }

  if (/\\[1-9]|\(\?<=[^)]|\(\?<!/.test(pattern)) {
    throw new Error('Regular expression backreferences and lookbehind are not supported')
  }

  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) {
    throw new Error('Regular expression contains a potentially unsafe nested quantifier')
  }

  try {
    new RegExp(pattern, normalizeRegExpFlags(flags))
  } catch (error) {
    throw new Error(`Invalid regular expression: ${error instanceof Error ? error.message : error}`)
  }
}

function normalizeRegExpFlags(flags: string): string {
  return [...new Set(`${flags}gu`)].join('')
}

function isClosingFence(text: string, fence: MarkdownFence): boolean {
  const trimmed = text.replace(/^ {0,3}/, '')
  const markerLength = countLeadingCharacter(trimmed, fence.marker)
  return markerLength >= fence.length && trimmed.slice(markerLength).trim().length === 0
}

function countLeadingCharacter(text: string, character: string): number {
  let length = 0
  while (text[length] === character) length += 1
  return length
}

function truncateText(text: string): { readonly value: string; readonly truncated: boolean } {
  return text.length <= MAX_RESULT_TEXT_LENGTH
    ? { value: text, truncated: false }
    : { value: text.slice(0, MAX_RESULT_TEXT_LENGTH), truncated: true }
}

function normalizeInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const normalized = value ?? fallback

  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`)
  }

  return normalized
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

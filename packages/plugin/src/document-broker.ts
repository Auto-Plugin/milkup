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
  /** Heading results belong to the line confirming their syntax. A Setext
   * heading can therefore start before fromLine when its underline is inside. */
  readonly fromLine?: number
  readonly toLine?: number
}

export interface PluginDocumentScanSource {
  readonly documentId: string
  readonly version: number
  readonly lineCount: number
  readLineWindow(
    fromLine: number,
    toLine: number,
    maxTextLength?: number,
  ): Promise<DocumentLineWindow>
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
  readonly yieldToMainThread?: () => Promise<void>
  /** Host-only instrumentation; never included in document RPC responses. */
  readonly onDiagnostics?: (diagnostics: PluginDocumentScanDiagnostics) => void
}

export interface PluginDocumentScanDiagnostics {
  readonly scanId: string
  readonly reason: 'complete' | 'cancelled' | 'invalidated' | 'truncated' | 'error'
  readonly nextCount: number
  readonly progressCount: number
  readonly readCount: number
  readonly readTextUtf16: number
  readonly readMs: number
  readonly yieldCount: number
  readonly yieldMs: number
  readonly scanCpuMs: number
  readonly maxScanCpuMs: number
}

type ScanMetrics = {
  -readonly [
    K in keyof Omit<PluginDocumentScanDiagnostics, 'scanId' | 'reason'>
  ]: PluginDocumentScanDiagnostics[K]
}

interface ScanSession {
  readonly id: string
  readonly source: PluginDocumentScanSource
  readonly version: number
  readonly startLine: number
  readonly query: CompiledQuery
  readonly batchSize: number
  readonly windowSizeLines: number
  readonly maxResults: number
  readonly endLine: number
  readonly pending: PluginDocumentScanItem[]
  nextLine: number
  scannedLineCount: number
  resultCount: number
  context: HeadingContext
  readSizeLines: number
  readonly metrics: ScanMetrics | undefined
  readonly onDiagnostics: PluginDocumentBrokerConfig['onDiagnostics']
  reported: boolean
  terminalReason: 'truncated' | undefined
}

type CompiledQuery =
  | { readonly kind: 'text' | 'regexp'; readonly expression: RegExp }
  | { readonly kind: 'markdownHeadings'; readonly levels: ReadonlySet<number> }

interface MarkdownFence {
  readonly marker: '`' | '~'
  readonly length: number
}

interface HeadingParagraph {
  readonly from: number
  readonly line: number
  readonly lineOffset: number
  readonly labelFrom: number
  readonly labelTo: number
  readonly label: string
  readonly truncated: boolean
  readonly lastLineHasPipe: boolean
}

interface HeadingContext {
  readonly fence?: MarkdownFence
  readonly paragraph?: HeadingParagraph
  readonly lazyContainer?: boolean
  readonly table?: boolean
  readonly html?: RegExp | 'blank'
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
const MAX_COOPERATIVE_SCAN_LINES = 512
const MAX_SCAN_TEXT_LENGTH = 262_144
const MAX_HEADING_CHECKPOINTS = 256

export function createPluginDocumentBroker(
  config: PluginDocumentBrokerConfig,
): ManagedPluginDocumentBroker {
  const sessions = new Map<string, ScanSession>()
  const yieldToMainThread = config.yieldToMainThread ?? yieldToBackgroundTask
  const maxConcurrentScans = normalizeInteger(
    config.maxConcurrentScans,
    2,
    1,
    8,
    'maxConcurrentScans',
  )
  let nextScanId = 0
  let contextDocumentId = ''
  let contextVersion = -1
  const headingCheckpoints = new Map<number, HeadingContext>()

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
      const fromLine = normalizeInteger(request.fromLine, 1, 1, source.lineCount, 'fromLine')
      const requestedToLine = request.toLine ?? source.lineCount
      if (!Number.isInteger(requestedToLine) || requestedToLine < fromLine) {
        throw new Error(`toLine must be an integer from ${fromLine} to ${source.lineCount}`)
      }
      const toLine = Math.min(source.lineCount, requestedToLine)
      const query = compileQuery(request.query)
      if (contextDocumentId !== source.documentId || contextVersion !== source.version) {
        headingCheckpoints.clear()
        contextDocumentId = source.documentId
        contextVersion = source.version
      }
      // Heading ranges need the fence state preceding their first line. Reuse
      // only version-matched checkpoints; otherwise cooperatively scan the prefix.
      let nextLine = query.kind === 'markdownHeadings' ? 1 : fromLine
      let context: HeadingContext = {}
      if (query.kind === 'markdownHeadings') {
        for (const [line, state] of headingCheckpoints) {
          if (line <= fromLine && line > nextLine) {
            nextLine = line
            context = state
          }
        }
      }
      sessions.set(id, {
        id,
        source,
        version: source.version,
        startLine: fromLine,
        query,
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
        endLine: toLine,
        pending: [],
        nextLine,
        scannedLineCount: 0,
        resultCount: 0,
        context,
        readSizeLines: MAX_COOPERATIVE_SCAN_LINES,
        metrics: config.onDiagnostics
          ? {
              nextCount: 0,
              progressCount: 0,
              readCount: 0,
              readTextUtf16: 0,
              readMs: 0,
              yieldCount: 0,
              yieldMs: 0,
              scanCpuMs: 0,
              maxScanCpuMs: 0,
            }
          : undefined,
        onDiagnostics: config.onDiagnostics,
        reported: false,
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

      if (session.metrics) session.metrics.nextCount += 1
      const current = config.source()

      if (
        !current ||
        current.documentId !== session.source.documentId ||
        current.version !== session.version
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

      if (session.nextLine > session.endLine) {
        sessions.delete(scanId)
        return freezeDoneEvent(session, 'complete', true)
      }

      const deadline = performance.now() + 16
      const roundEndLine = Math.min(session.endLine, session.nextLine + session.windowSizeLines - 1)
      for (let iteration = 0; ; iteration += 1) {
        const fromLine = session.nextLine
        let toLine = Math.min(
          roundEndLine,
          fromLine + Math.min(session.windowSizeLines, session.readSizeLines) - 1,
        )
        let window: DocumentLineWindow

        try {
          const yieldStarted = session.metrics ? performance.now() : 0
          await yieldToMainThread()
          if (session.metrics) {
            session.metrics.yieldCount += 1
            session.metrics.yieldMs += performance.now() - yieldStarted
          }
          if (!sessions.has(scanId)) return freezeDoneEvent(session, 'cancelled', false)
          for (;;) {
            try {
              const readStarted = session.metrics ? performance.now() : 0
              try {
                window = await session.source.readLineWindow(fromLine, toLine, MAX_SCAN_TEXT_LENGTH)
                if (session.metrics) session.metrics.readTextUtf16 += window.text.length
              } finally {
                if (session.metrics) {
                  session.metrics.readCount += 1
                  session.metrics.readMs += performance.now() - readStarted
                }
              }
              if (window.text.length > MAX_SCAN_TEXT_LENGTH)
                throw new RangeError('Line window exceeds text budget')
              break
            } catch (error) {
              if (!sessions.has(scanId)) return freezeDoneEvent(session, 'cancelled', false)
              const latest = config.source()
              if (
                !latest ||
                latest.documentId !== session.source.documentId ||
                latest.version !== session.version
              ) {
                sessions.delete(scanId)
                return freezeDoneEvent(session, 'invalidated', false, latest?.version)
              }
              if (!/text budget/i.test(String(error)) || fromLine === toLine) throw error
              toLine = fromLine + Math.floor((toLine - fromLine) / 2)
              session.readSizeLines = toLine - fromLine + 1
            }
          }
        } catch (error) {
          sessions.delete(scanId)
          reportDiagnostics(session, 'error')
          throw error
        }

        const latest = config.source()
        if (!sessions.has(scanId)) return freezeDoneEvent(session, 'cancelled', false)

        if (
          !latest ||
          latest.documentId !== session.source.documentId ||
          latest.version !== session.version
        ) {
          sessions.delete(scanId)
          return freezeDoneEvent(session, 'invalidated', false, latest?.version)
        }

        try {
          const scanStarted = session.metrics ? performance.now() : 0
          scanWindow(session, window.lines)
          if (session.metrics) {
            const elapsed = performance.now() - scanStarted
            session.metrics.scanCpuMs += elapsed
            session.metrics.maxScanCpuMs = Math.max(session.metrics.maxScanCpuMs, elapsed)
          }
        } catch (error) {
          sessions.delete(scanId)
          reportDiagnostics(session, 'error')
          throw error
        }
        session.nextLine = toLine + 1
        session.scannedLineCount += window.lines.filter(
          (line) => line.number >= session.startLine,
        ).length
        if (session.query.kind === 'markdownHeadings' && !session.terminalReason) {
          headingCheckpoints.set(session.nextLine, session.context)
          while (headingCheckpoints.size > MAX_HEADING_CHECKPOINTS)
            headingCheckpoints.delete(headingCheckpoints.keys().next().value!)
        }

        if (
          session.pending.length >= session.batchSize ||
          session.terminalReason ||
          session.nextLine > roundEndLine ||
          iteration >= 3 ||
          performance.now() >= deadline
        ) {
          return session.pending.length > 0 ? takeBatch(session) : freezeProgressEvent(session)
        }
      }
    },
    cancel: async (scanId: string): Promise<void> => {
      const session = sessions.get(scanId)
      if (session) reportDiagnostics(session, 'cancelled')
      sessions.delete(scanId)
    },
    cancelAll: async (): Promise<void> => {
      for (const session of sessions.values()) reportDiagnostics(session, 'cancelled')
      sessions.clear()
      headingCheckpoints.clear()
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
              if (finished) {
                await broker.cancel(started.scanId)
                return { value: undefined, done: true }
              }
              const event = await broker.next(started.scanId)
              if (finished) return { value: undefined, done: true }

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
          if (finished) return
          finished = true
          if (started) await broker.cancel(started.scanId)
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

      if (heading && line.number >= session.startLine) {
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

  const context = session.context
  const text = line.text
  if (context.fence) {
    if (isClosingFence(text, context.fence)) session.context = {}
    return undefined
  }
  if (context.html) {
    if (context.html === 'blank' ? /^[ \t]*$/.test(text) : context.html.test(text))
      session.context = {}
    return undefined
  }
  if (/^[ \t]*$/.test(text)) {
    session.context = {}
    return undefined
  }
  const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(text)
  if (opening && !(opening[2]![0] === '`' && opening[3]!.includes('`'))) {
    session.context = { fence: { marker: opening[2]![0] as '`' | '~', length: opening[2]!.length } }
    return undefined
  }
  const html = htmlBlockEnd(text, context.paragraph !== undefined)
  if (html) {
    session.context = html !== 'blank' && html.test(text) ? {} : { html }
    return undefined
  }
  const atx = /^( {0,3})(#{1,6})([ \t]+|$)(.*)$/.exec(text)
  if (atx) {
    session.context = {}
    const level = atx[2]!.length
    if (!query.levels.has(level)) return undefined
    const content = atx[4]!
    const normalized = content.replace(/(?:^|[ \t]+)#+[ \t]*$/, '').replace(/[ \t]+$/, '')
    const start = atx[1]!.length + atx[2]!.length + atx[3]!.length
    const label = truncateText(normalized)
    return Object.freeze({
      kind: 'heading',
      from: line.from,
      to: line.to,
      line: line.number,
      lineOffset: atx[1]!.length,
      level,
      label: label.value,
      ...(label.truncated ? { labelTruncated: true } : {}),
      labelFrom: line.from + start,
      labelTo: line.from + start + normalized.length,
    })
  }
  const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(text)
  if (underline && context.paragraph && !context.lazyContainer) {
    session.context = {}
    const level = underline[1]![0] === '=' ? 1 : 2
    if (!query.levels.has(level)) return undefined
    const paragraph = context.paragraph
    // The confirming underline owns a ranged result, while navigation retains
    // the paragraph's real first line, possibly in the preceding scan range.
    return Object.freeze({
      kind: 'heading',
      from: paragraph.from,
      to: line.to,
      line: paragraph.line,
      lineOffset: paragraph.lineOffset,
      level,
      label: paragraph.label,
      ...(paragraph.truncated ? { labelTruncated: true } : {}),
      labelFrom: paragraph.labelFrom,
      labelTo: paragraph.labelTo,
    })
  }
  if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text)) {
    session.context = {}
    return undefined
  }
  if (
    /^ {0,3}>/.test(text) ||
    (/^ {0,3}(?:[-+*](?:[ \t]+|$)|\d{1,9}[.)](?:[ \t]+|$))/.test(text) &&
      (!context.paragraph || /^ {0,3}(?:[-+*]|1[.)])[ \t]+\S/.test(text)))
  ) {
    session.context = { lazyContainer: true }
    return undefined
  }
  if (context.lazyContainer) return undefined
  if (
    (context.table && text.includes('|')) ||
    (context.paragraph?.lastLineHasPipe &&
      /^ *\|? *:?-{3,}:? *(?:\| *:?-{3,}:? *)+\|? *$/.test(text))
  ) {
    session.context = { table: true }
    return undefined
  }
  if (!context.paragraph && /^(?: {4}| {0,3}\t)/.test(text)) {
    session.context = {}
    return undefined
  }
  const content = text.replace(/^[ \t]+|[ \t]+$/g, '')
  const leading = text.match(/^[ \t]*/)?.[0].length ?? 0
  const previous = context.paragraph
  const label = previous?.truncated
    ? { value: previous.label, truncated: true }
    : truncateText(previous ? previous.label + '\n' + content : content)
  session.context = {
    paragraph: {
      from: previous?.from ?? line.from,
      line: previous?.line ?? line.number,
      lineOffset: previous?.lineOffset ?? leading,
      labelFrom: previous?.labelFrom ?? line.from + leading,
      labelTo: line.from + text.replace(/[ \t]+$/, '').length,
      label: label.value,
      truncated: previous?.truncated === true || label.truncated,
      lastLineHasPipe: text.includes('|'),
    },
  }
  return undefined
}

// Opaque HTML block boundaries are recognized for heading context only.
function htmlBlockEnd(text: string, inParagraph: boolean): RegExp | 'blank' | undefined {
  const special = /^ {0,3}<(script|pre|style|textarea)(?:[ \t>]|$)/i.exec(text)
  if (special) return new RegExp(`</${special[1]}>`, 'i')
  if (/^ {0,3}<!--/.test(text)) return /-->/
  if (/^ {0,3}<\?/.test(text)) return /\?>/
  if (/^ {0,3}<!\[CDATA\[/.test(text)) return /\]\]>/
  if (/^ {0,3}<![A-Z]/.test(text)) return />/
  if (
    /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t/>]|$)/i.test(
      text,
    )
  )
    return 'blank'
  if (
    !inParagraph &&
    /^ {0,3}(?:<\/[a-zA-Z][\w-]*[ \t]*>|<[a-zA-Z][\w-]*(?:[ \t]+[a-zA-Z_:][\w.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>)[ \t]*$/.test(
      text,
    )
  )
    return 'blank'
  return undefined
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
  if (session.metrics) session.metrics.progressCount += 1
  return Object.freeze({ ...eventBase(session), type: 'progress' })
}

function freezeDoneEvent(
  session: ScanSession,
  reason: Extract<PluginDocumentScanEvent, { readonly type: 'done' }>['reason'],
  complete: boolean,
  currentVersion?: number,
): PluginDocumentScanEvent {
  reportDiagnostics(session, reason)
  return Object.freeze({
    ...eventBase(session),
    type: 'done',
    complete,
    reason,
    ...(currentVersion === undefined ? {} : { currentVersion }),
  })
}

function reportDiagnostics(
  session: ScanSession,
  reason: PluginDocumentScanDiagnostics['reason'],
): void {
  if (!session.metrics || !session.onDiagnostics || session.reported) return
  session.reported = true
  try {
    session.onDiagnostics(Object.freeze({ scanId: session.id, reason, ...session.metrics }))
  } catch {
    // Observability must not change the scan result or its cleanup.
  }
}

function eventBase(session: ScanSession): PluginDocumentScanEventBase {
  return {
    scanId: session.id,
    documentId: session.source.documentId,
    version: session.version,
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

async function yieldToBackgroundTask(): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: {
        postTask(callback: () => void, options: { priority: 'background' }): Promise<unknown>
      }
    }
  ).scheduler

  if (scheduler) {
    await scheduler.postTask(() => undefined, { priority: 'background' })
    return
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

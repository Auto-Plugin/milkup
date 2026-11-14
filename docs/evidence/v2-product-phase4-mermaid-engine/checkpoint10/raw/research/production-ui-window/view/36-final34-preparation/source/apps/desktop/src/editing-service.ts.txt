import {
  ChangeSet,
  Selection,
  type DocumentLineWindow,
  type EditorDocumentSource,
  type Line,
} from '@milkup/core'
import { parseInline, parseMarkdown, type SyntaxNode } from '@milkup/markdown'
import {
  PluginEditingError,
  copyPluginEditingApplyRequest,
  copyPluginEditingCaptureRequest,
  copyPluginEditingSnapshot,
  copyPluginEditingTableRequest,
  type PluginEditingApplyRequest,
  type PluginEditingApplyResult,
  type PluginEditingBrokerAdapter,
  type PluginEditingCaptureRequest,
  type PluginEditingOperationOptions,
  type PluginEditingSnapshot,
  type PluginEditingTableRequest,
} from '@milkup/plugin'

export interface DesktopEditingCurrent {
  readonly identity: object
  readonly source: EditorDocumentSource
  readonly documentId: string
  readonly version: number
  readonly selection: Selection
  readonly selectionRevision: number
  readonly saveLocationGeneration: number
  readonly readonly: boolean
  readonly busy: boolean
  readonly mode: 'memory' | 'windowed'
  readonly lineEnding?: 'lf' | 'crlf'
}

export interface DesktopEditingBatch {
  readonly snapshot: PluginEditingSnapshot
  readonly changes: ChangeSet
  readonly deletedTextByChange: readonly string[]
  readonly selectionBefore: Selection
  readonly selectionAfter: Selection
  readonly selectionAfterLine: number
  /** Also usable directly as an ordinary core Transaction. */
  readonly selection: Selection
  readonly historyGroup: 'isolate'
  readonly origin: { readonly type: 'command'; readonly id: string }
  readonly assetIds?: readonly string[]
}

export interface DesktopEditingWindow {
  readonly from: number
  readonly to: number
  readonly text: string
  readonly startLine: number
  readonly lineCount: number
  readonly selection: Selection
}

export interface DesktopEditingServiceOptions {
  current(): DesktopEditingCurrent | undefined
  /** Share the source-view edit queue; do not flush that queue from inside it. */
  runExclusive<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T>
  /** Atomic memory/native CAS. Invoke guard immediately before the commit point.
   * Reject only when no commit occurred; rollback any preparation on failure.
   * A successful commit must resolve even if signal aborts afterwards. */
  commit(
    batch: DesktopEditingBatch,
    guard: () => void,
    signal?: AbortSignal,
  ): Promise<PluginEditingApplyResult>
  context?(
    window: DesktopEditingWindow,
    current: DesktopEditingCurrent,
    signal: AbortSignal,
  ): Promise<
    NonNullable<PluginEditingSnapshot['context']> & {
      readonly table?: PluginEditingSnapshot['table']
      readonly syntax?: PluginEditingSnapshot['syntax']
    }
  >
  /** Reuse the view's table builder, returning snapshot-relative edits only. */
  table?(
    snapshot: PluginEditingSnapshot,
    request: PluginEditingTableRequest,
    current: DesktopEditingCurrent,
    signal: AbortSignal,
  ): Promise<Omit<PluginEditingApplyRequest, 'snapshotId' | 'assetIds'>>
  readonly supportsAssets?: boolean
}

const MAX_TEXT = 65_536
const MAX_LINES = 256
const MAX_CHANGES = 64
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
type Lease = { readonly snapshot: PluginEditingSnapshot; readonly expected: DesktopEditingCurrent }

export function createDesktopEditingService(options: DesktopEditingServiceOptions) {
  let queue: Promise<unknown> = Promise.resolve()
  let serviceDisposed = false
  const owners = new Set<() => void>()

  function adapterForPlugin(pluginId: string) {
    let disposed = false
    let sequence = 0
    let pending = 0
    const prefix = `${crypto.randomUUID()}_`
    const leases = new Map<string, Lease>()
    const lifetime = new AbortController()
    const active = () => {
      if (disposed || serviceDisposed) fail('revoked')
    }
    const issued = (id: string) => {
      if (!id.startsWith(prefix)) return false
      const suffix = id.slice(prefix.length),
        value = Number(suffix)
      return /^[1-9]\d*$/.test(suffix) && Number.isSafeInteger(value) && value <= sequence
    }
    const dispose = () => {
      disposed = true
      lifetime.abort()
      leases.clear()
      owners.delete(dispose)
    }
    owners.add(dispose)

    function run<T>(
      operation: (signal: AbortSignal) => Promise<T>,
      operationOptions?: PluginEditingOperationOptions,
    ): Promise<T> {
      try {
        active()
        if (pending >= 16) fail('busy')
      } catch (error) {
        return Promise.reject(error)
      }
      pending++
      const controller = new AbortController()
      const abort = () => controller.abort()
      lifetime.signal.addEventListener('abort', abort, { once: true })
      operationOptions?.signal?.addEventListener('abort', abort, { once: true })
      if (lifetime.signal.aborted || operationOptions?.signal?.aborted) abort()
      const task = queue.then(() => {
        active()
        checkSignal(controller.signal)
        return options.runExclusive(() => operation(controller.signal), controller.signal)
      })
      queue = task.catch(() => undefined)
      return task
        .catch((error: unknown) => {
          throw normalizeError(error)
        })
        .finally(() => {
          pending--
          lifetime.signal.removeEventListener('abort', abort)
          operationOptions?.signal?.removeEventListener('abort', abort)
        })
    }

    function guard(expected: DesktopEditingCurrent, signal: AbortSignal) {
      active()
      checkSignal(signal)
      const current = available(options.current())
      if (
        current.identity !== expected.identity ||
        current.source !== expected.source ||
        current.documentId !== expected.documentId ||
        current.version !== expected.version ||
        current.source.version !== expected.version ||
        current.selectionRevision !== expected.selectionRevision ||
        current.saveLocationGeneration !== expected.saveLocationGeneration ||
        !sameSelection(current.selection, expected.selection)
      )
        fail('stale')
    }

    const apply = async (lease: Lease, request: PluginEditingApplyRequest, signal: AbortSignal) => {
      guard(lease.expected, signal)
      const batch = prepareBatch(lease, request, pluginId, options.supportsAssets === true)
      const result = await options.commit(batch, () => guard(lease.expected, signal), signal)
      // The adapter's successful return is the commit point. Never report a
      // committed operation as aborted because disposal happened during paint.
      leases.delete(lease.snapshot.id)
      return result
    }

    const adapter: PluginEditingBrokerAdapter = {
      capture(request, operationOptions) {
        try {
          request = copyPluginEditingCaptureRequest(request)
        } catch (error) {
          return Promise.reject(error)
        }
        return run(async (signal) => {
          active()
          if (leases.size >= 8) fail('too-large')
          const expected = available(options.current())
          guard(expected, signal)
          const snapshot = await capture(
            expected,
            request,
            `${prefix}${++sequence}`,
            signal,
            options,
            () => guard(expected, signal),
          )
          guard(expected, signal)
          leases.set(snapshot.id, { snapshot, expected })
          return snapshot
        }, operationOptions)
      },
      apply(request, operationOptions) {
        try {
          request = copyPluginEditingApplyRequest(request)
        } catch (error) {
          return Promise.reject(error)
        }
        return run(async (signal) => {
          const lease = leases.get(request.snapshotId)
          if (!lease) fail('invalid-snapshot')
          return apply(lease, request, signal)
        }, operationOptions)
      },
      table(request, operationOptions) {
        try {
          request = copyPluginEditingTableRequest(request)
        } catch (error) {
          return Promise.reject(error)
        }
        return run(async (signal) => {
          const lease = leases.get(request.snapshotId)
          if (!lease) fail('invalid-snapshot')
          guard(lease.expected, signal)
          if (
            !options.table ||
            !lease.snapshot.context?.complete ||
            lease.snapshot.context.kind === 'unknown' ||
            lease.snapshot.context.kind === 'code'
          )
            fail('unsupported')
          const plan = await options.table(lease.snapshot, request, lease.expected, signal)
          guard(lease.expected, signal)
          return apply(lease, { ...plan, snapshotId: request.snapshotId }, signal)
        }, operationOptions)
      },
      release(id, operationOptions) {
        return run(async () => {
          if (typeof id !== 'string' || !issued(id)) fail('invalid-snapshot')
          leases.delete(id)
        }, operationOptions)
      },
    }
    return Object.freeze({ adapter: Object.freeze(adapter), dispose })
  }
  return Object.freeze({
    adapterForPlugin,
    dispose: () => {
      serviceDisposed = true
      for (const dispose of [...owners]) dispose()
    },
  })
}

async function capture(
  expected: DesktopEditingCurrent,
  request: PluginEditingCaptureRequest,
  id: string,
  signal: AbortSignal,
  options: DesktopEditingServiceOptions,
  guard: () => void,
): Promise<PluginEditingSnapshot> {
  if (!request || !['lines', 'selection'].includes(request.extent)) fail('invalid-input')
  const before = request.beforeLines ?? 0,
    after = request.afterLines ?? 0
  if (![before, after].every((n) => Number.isInteger(n) && n >= 0 && n <= 128))
    fail('invalid-input')
  if (request.extent === 'selection' && (before || after)) fail('invalid-input')
  if (expected.selection.ranges.length !== 1) fail('unsupported')
  const selected = expected.selection.main
  if (selected.to - selected.from > MAX_TEXT) fail('too-large')
  const source = expected.source
  let remaining = MAX_TEXT,
    reads = 0
  const cache = new Map<string, DocumentLineWindow>()
  async function read(from: number, to: number) {
    guard()
    const key = `${from}:${to}`
    const cached = cache.get(key)
    if (cached) return cached
    if (++reads > 64 || to - from + 1 > MAX_LINES) fail('too-large')
    let window: DocumentLineWindow
    try {
      window = await source.readLineWindow(from, to, remaining)
    } catch (error) {
      if (error instanceof RangeError || /budget|too large|text length/i.test(String(error)))
        fail('too-large')
      throw error
    }
    guard()
    if (
      window.text.length > remaining ||
      window.lines.length !== to - from + 1 ||
      window.to - window.from !== window.text.length
    )
      fail('too-large')
    remaining -= window.text.length
    cache.set(key, window)
    return window
  }
  async function lineAt(position: number): Promise<Line> {
    let low = 1,
      high = source.lineCount,
      found: Line | undefined
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const line = (await read(middle, middle)).lines[0]!
      if (line.from <= position) {
        found = line
        low = middle + 1
      } else high = middle - 1
    }
    if (!found || (found.number === source.lineCount && position > found.to)) fail('invalid-input')
    return found
  }
  const first = await lineAt(selected.from),
    last = await lineAt(selected.to)
  const selectedLast =
    !selected.empty && selected.to === last.from && last.number > first.number
      ? last.number - 1
      : last.number
  const startLine = Math.max(1, first.number - before),
    endLine = Math.min(source.lineCount, selectedLast + after)
  if (endLine - startLine + 1 > MAX_LINES) fail('too-large')
  // Reading a bounded prefix gives real fenced/HTML/paragraph context. Otherwise
  // the view adapter must provide a trusted checkpoint; a viewport parse alone
  // is never evidence that the selection is outside a code block.
  const readFrom = endLine < MAX_LINES ? 1 : startLine
  const readTo = Math.min(source.lineCount, endLine + 1, readFrom + MAX_LINES - 1)
  const window = await read(readFrom, readTo)
  const start = window.lines.find((line) => line.number === startLine)!
  const end = window.lines.find((line) => line.number === endLine)!
  const from = request.extent === 'selection' ? selected.from : start.from
  const to = request.extent === 'selection' ? selected.to : Math.max(end.to, selected.to)
  if (from < window.from || to > window.to) fail('invalid-input')
  const text = window.text.slice(from - window.from, to - window.from)
  assertBoundary(window.text, from - window.from)
  assertBoundary(window.text, to - window.from)
  assertBoundary(window.text, selected.anchor - window.from)
  assertBoundary(window.text, selected.head - window.from)
  const full = readFrom === 1
  const parsed = parseMarkdown(window.text)
  const syntaxNodes = flatten(parsed.root)
  for (const node of [...syntaxNodes]) {
    if (['heading', 'paragraph', 'blockquoteLine', 'listItem', 'tableCell'].includes(node.type)) {
      for (const range of node.contentRanges ?? []) {
        for (const inline of parseInline(window.text, range.from, range.to))
          syntaxNodes.push(...flatten(inline))
      }
    }
  }
  let context: NonNullable<PluginEditingSnapshot['context']> = { kind: 'unknown', complete: false }
  if (full) {
    const relevant = syntaxNodes.filter((node) =>
      selected.empty
        ? node.from <= selected.from - window.from && node.to > selected.from - window.from
        : node.from < selected.to - window.from && node.to > selected.from - window.from,
    )
    const code = relevant.find((node) => node.type === 'fencedCode' || node.type === 'indentedCode')
    const table = relevant.find((node) => node.type === 'table')
    const html = relevant.find(
      (node) => node.type === 'fallbackText' && node.data?.block === 'html',
    )
    context = code
      ? {
          kind: 'code',
          complete:
            code.status === 'valid' &&
            code.from + window.from >= from &&
            code.to + window.from <= to,
        }
      : table
        ? {
            kind: 'table',
            complete: table.from + window.from >= from && table.to + window.from <= to,
          }
        : html || parsed.root.status !== 'valid'
          ? { kind: 'unknown', complete: false }
          : { kind: 'text', complete: true }
  }
  let table: PluginEditingSnapshot['table'], trustedSyntax: PluginEditingSnapshot['syntax']
  if (options.context) {
    const trusted = await options.context(
      {
        from,
        to,
        text,
        startLine,
        lineCount: endLine - startLine + 1,
        selection: expected.selection,
      },
      expected,
      signal,
    )
    // A view can prove context beyond our bounded parse, but it cannot make a
    // positively identified unsafe HTML/fallback block safe ordinary text.
    if (!(full && context.kind === 'unknown'))
      context = { kind: trusted.kind, complete: trusted.complete }
    table = trusted.table
    trustedSyntax = trusted.syntax
    guard()
  }
  const relativeFrom = from - window.from,
    relativeTo = to - window.from
  if (
    context.kind === 'text' &&
    syntaxNodes.some(
      (node) =>
        ['emphasis', 'strong', 'strikethrough', 'inlineCode', 'link', 'image'].includes(
          node.type,
        ) &&
        node.from <= selected.to - window.from &&
        node.to >= selected.from - window.from &&
        (node.from < relativeFrom || node.to > relativeTo),
    )
  )
    context = { kind: 'text', complete: false }
  const nodes =
    context.kind === 'unknown'
      ? []
      : syntaxNodes
          .filter(
            (node) =>
              node.type !== 'document' && node.from >= relativeFrom && node.to <= relativeTo,
          )
          .map((node) => ({
            type: node.type,
            status: node.status,
            from: node.from - relativeFrom,
            to: node.to - relativeFrom,
            markerRanges: (node.markerRanges ?? []).map((r) => ({
              from: r.from - relativeFrom,
              to: r.to - relativeFrom,
            })),
            ...(node.contentRanges
              ? {
                  contentRanges: node.contentRanges.map((r) => ({
                    from: r.from - relativeFrom,
                    to: r.to - relativeFrom,
                  })),
                }
              : {}),
          }))
  if (
    nodes.length > 2048 ||
    nodes.some((node) => node.markerRanges.length > 64 || (node.contentRanges?.length ?? 0) > 64)
  )
    fail('too-large')
  return copyPluginEditingSnapshot({
    id,
    documentId: expected.documentId,
    version: expected.version,
    selectionRevision: expected.selectionRevision,
    saveLocationGeneration: expected.saveLocationGeneration,
    from,
    to,
    text,
    selection: { anchor: selected.anchor - from, head: selected.head - from },
    startLine,
    lineCount: endLine - startLine + 1,
    lineEnding: expected.lineEnding ?? (window.text.includes('\r\n') ? 'crlf' : 'lf'),
    mode: expected.mode,
    context,
    syntax: trustedSyntax ?? { nodes },
    ...(table ? { table } : {}),
  })
}

function prepareBatch(
  lease: Lease,
  request: PluginEditingApplyRequest,
  pluginId: string,
  supportsAssets: boolean,
): DesktopEditingBatch {
  request = copyPluginEditingApplyRequest(request, lease.snapshot)
  if (!Array.isArray(request.changes) || request.changes.length > MAX_CHANGES) fail('invalid-input')
  const snapshot = lease.snapshot
  let previous = 0,
    inserted = 0
  for (const change of request.changes) {
    if (
      !change ||
      !Number.isSafeInteger(change.from) ||
      !Number.isSafeInteger(change.to) ||
      change.from < previous ||
      change.to < change.from ||
      change.to > snapshot.text.length ||
      typeof change.insert !== 'string'
    )
      fail('invalid-input')
    assertBoundary(snapshot.text, change.from)
    assertBoundary(snapshot.text, change.to)
    if (!wellFormed(change.insert)) fail('invalid-input')
    inserted += change.insert.length
    if (inserted > MAX_TEXT) fail('too-large')
    previous = change.to
  }
  if (request.assetIds?.length && !supportsAssets) fail('unsupported')
  const local = ChangeSet.of(request.changes)
  let next = '',
    offset = 0
  for (const change of local.changes) {
    next += snapshot.text.slice(offset, change.from) + change.insert
    offset = change.to
  }
  next += snapshot.text.slice(offset)
  const mapped = request.selection ?? {
    anchor: local.mapPosition(snapshot.selection.anchor),
    head: local.mapPosition(snapshot.selection.head),
  }
  assertBoundary(next, mapped.anchor)
  assertBoundary(next, mapped.head)
  const selection = Selection.range(snapshot.from + mapped.anchor, snapshot.from + mapped.head)
  return {
    snapshot,
    changes: ChangeSet.of(
      local.changes.map((change) => ({
        ...change,
        from: snapshot.from + change.from,
        to: snapshot.from + change.to,
      })),
    ),
    deletedTextByChange: local.changes.map((change) => snapshot.text.slice(change.from, change.to)),
    selectionBefore: lease.expected.selection,
    selectionAfter: selection,
    selectionAfterLine: snapshot.startLine + (next.slice(0, mapped.head).match(/\n/g)?.length ?? 0),
    selection,
    historyGroup: 'isolate',
    origin: { type: 'command', id: `plugin.editing.${pluginId}` },
    ...(request.assetIds ? { assetIds: [...request.assetIds] } : {}),
  }
}

function available(current: DesktopEditingCurrent | undefined): DesktopEditingCurrent {
  if (!current) fail('unavailable')
  if (current.readonly) fail('readonly')
  if (current.busy) fail('busy')
  return current
}
function sameSelection(a: Selection, b: Selection): boolean {
  return (
    a.mainIndex === b.mainIndex &&
    a.ranges.length === b.ranges.length &&
    a.ranges.every(
      (range, i) =>
        range.anchor === b.ranges[i]!.anchor &&
        range.head === b.ranges[i]!.head &&
        range.affinity === b.ranges[i]!.affinity,
    )
  )
}
function assertBoundary(text: string, offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) fail('invalid-input')
  if (offset === text.length || offset === 0) return
  if (segmenter.segment(text).containing(offset)?.index !== offset) fail('invalid-input')
}
function wellFormed(text: string) {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}
function flatten(root: SyntaxNode): SyntaxNode[] {
  const nodes: SyntaxNode[] = [],
    pending = [root]
  while (pending.length) {
    const node = pending.pop()!
    nodes.push(node)
    if (node.children) pending.push(...node.children)
  }
  return nodes
}
function checkSignal(signal: AbortSignal) {
  if (signal.aborted) fail('aborted')
}
function fail(code: ConstructorParameters<typeof PluginEditingError>[0]): never {
  throw new PluginEditingError(code)
}
function normalizeError(error: unknown): PluginEditingError {
  return error instanceof PluginEditingError
    ? error
    : new PluginEditingError(
        error instanceof Error && error.name === 'AbortError' ? 'aborted' : 'unavailable',
      )
}

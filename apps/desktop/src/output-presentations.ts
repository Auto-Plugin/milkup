import {
  copyDocumentPresentationRequest,
  DOCUMENT_PRESENTATION_LIMITS,
  DocumentPresentationError,
  MemoryDocumentSource,
  MemoryTextDocument,
  type DocumentPresentationRequest,
  type DocumentPresentationResult,
  type DocumentRendererDeclaration,
} from '@milkup/core'
import { parseMarkdown, type MarkdownContextSource } from '@milkup/markdown'
import {
  createDesktopDocumentPresentationService,
  type DesktopDocumentRenderer,
} from './document-presentation-service'

export interface OutputPresentationOptions {
  readonly source: string
  readonly sourceOffset: number
  readonly documentId: string
  readonly version: number
  readonly fromLine: number
  readonly selection: { readonly anchor: number; readonly head: number }
  /** Only the host may assert a trusted document boundary for a selection. */
  readonly completeStart?: boolean
  readonly completeEnd?: boolean
  readonly renderers: () => readonly DesktopDocumentRenderer[]
  readonly render: (
    pluginId: string,
    rendererId: string,
    request: DocumentPresentationRequest,
    options: { readonly signal: AbortSignal },
  ) => Promise<DocumentPresentationResult>
  readonly signal: AbortSignal
  readonly assertCurrent: () => void
}
export interface OutputPresentationBatch {
  readonly request: DocumentPresentationRequest
  readonly result: DocumentPresentationResult
  readonly declarations: readonly DocumentRendererDeclaration[]
}
export interface OutputPresentationWarning {
  readonly code: string
  readonly message: string
}

/** Frozen-source export adapter. Rich output is optional; every rejected region
 * stays in the caller's original source and carries a visible fallback warning. */
export async function collectOutputPresentations(options: OutputPresentationOptions): Promise<{
  readonly presentations: readonly OutputPresentationBatch[]
  readonly warnings: readonly OutputPresentationWarning[]
}> {
  const presentations: OutputPresentationBatch[] = []
  const warnings: OutputPresentationWarning[] = []
  const warn = (code: string, message: string) => {
    if (!warnings.some((warning) => warning.code === code && warning.message === message))
      warnings.push({ code, message })
  }
  const guard = () => {
    if (options.signal.aborted) throw new DocumentPresentationError('aborted')
    options.assertCurrent()
  }
  guard()
  if (options.source.length > 2 * 1024 * 1024) {
    warn(
      'presentation-oversized',
      'Rich export exceeds the source limit; original Markdown is retained.',
    )
    return { presentations, warnings }
  }
  if (!(options.completeStart ?? options.sourceOffset === 0) || options.completeEnd === false) {
    warn(
      'presentation-selection-context',
      'The selection has incomplete document context; original Markdown is retained for rich content.',
    )
    return { presentations, warnings }
  }
  if (!options.source || !options.renderers().length) return { presentations, warnings }
  const document = new MemoryTextDocument(options.source)
  const memory = new MemoryDocumentSource({
    documentId: options.documentId,
    version: options.version,
    document,
  })
  const source: MarkdownContextSource = {
    documentId: options.documentId,
    version: options.version,
    lineCount: memory.lineCount,
    async readLineWindow(from, to, max) {
      guard()
      const window = await memory.readLineWindow(from, to, max)
      guard()
      return {
        ...window,
        from: window.from + options.sourceOffset,
        to: window.to + options.sourceOffset,
        lines: window.lines.map((line) => ({
          ...line,
          from: line.from + options.sourceOffset,
          to: line.to + options.sourceOffset,
        })),
      }
    },
  }
  const absoluteLines = (request: DocumentPresentationRequest) =>
    copyDocumentPresentationRequest({
      ...request,
      fromLine: request.fromLine + options.fromLine - 1,
      toLine: request.toLine + options.fromLine - 1,
    })
  const service = createDesktopDocumentPresentationService({
    current: () => {
      guard()
      return { source, identity: document }
    },
    theme: () => 'light',
    target: 'export',
    renderers: options.renderers,
    async render(pluginId, rendererId, request) {
      guard()
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      let abort: (() => void) | undefined
      try {
        const cancellation = new Promise<never>((_resolve, reject) => {
          abort = () => {
            controller.abort()
            reject(new DocumentPresentationError('aborted'))
          }
          options.signal.addEventListener('abort', abort, { once: true })
          timer = setTimeout(() => {
            controller.abort()
            reject(new DocumentPresentationError('timeout'))
          }, DOCUMENT_PRESENTATION_LIMITS.timeoutMs)
        })
        const result = await Promise.race([
          options.render(pluginId, rendererId, absoluteLines(request), {
            signal: controller.signal,
          }),
          cancellation,
        ])
        guard()
        if (!result.complete || result.fragments.some((fragment) => fragment.status === 'error'))
          warn(
            'presentation-incomplete',
            'Some rich content could not be rendered completely; original Markdown is retained where needed.',
          )
        return result
      } catch (error) {
        guard()
        const timeout = error instanceof DocumentPresentationError && error.code === 'timeout'
        warn(
          timeout ? 'presentation-timeout' : 'presentation-unavailable',
          timeout
            ? 'A rich renderer timed out; original Markdown is retained.'
            : 'A rich renderer was unavailable or rejected its input; original Markdown is retained.',
        )
        throw error
      } finally {
        clearTimeout(timer)
        if (abort) options.signal.removeEventListener('abort', abort)
      }
    },
  })
  const lineStarts = [0]
  for (let index = 0; index < options.source.length; index++)
    if (options.source.charCodeAt(index) === 10) lineStarts.push(index + 1)
  const lineAt = (offset: number) => {
    let low = 0,
      high = lineStarts.length
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2)
      if (lineStarts[middle]! <= offset) low = middle
      else high = middle
    }
    return low + 1
  }
  const fits = (from: number, to: number) =>
    to - from <= DOCUMENT_PRESENTATION_LIMITS.inputUtf16 &&
    lineAt(to) - lineAt(from) + 1 <= DOCUMENT_PRESENTATION_LIMITS.inputLines
  const chunks: { from: number; to: number }[] = []
  let pending: { from: number; to: number } | undefined
  const flush = () => {
    if (pending) chunks.push(pending)
    pending = undefined
  }
  // Host Markdown parsing supplies block boundaries; renderer syntax never
  // controls chunking. A fence/paragraph larger than the wire contract falls back
  // as one unit, so no renderer sees an invented mid-block opening state.
  const blocks = parseMarkdown(options.source).root.children ?? []
  for (const [index, block] of blocks.entries()) {
    const from = block.from,
      to = blocks[index + 1]?.from ?? options.source.length
    if (!fits(from, to)) {
      flush()
      warn(
        'presentation-oversized',
        'A Markdown block exceeds the rich renderer input limit; its original source is retained.',
      )
      continue
    }
    if (pending && !fits(pending.from, to)) flush()
    pending = { from: pending?.from ?? from, to }
  }
  flush()
  if (chunks.length > 1)
    warn(
      'presentation-windowed',
      'Rich content is rendered in bounded Markdown windows; extensions spanning windows retain their original source.',
    )
  for (const chunk of chunks) {
    guard()
    const text = options.source.slice(chunk.from, chunk.to)
    const response = await service.provide(
      {
        sourceIdentity: document,
        documentVersion: options.version,
        sourceVersion: options.version,
        source: text,
        from: chunk.from + options.sourceOffset,
        to: chunk.to + options.sourceOffset,
        fromLine: lineAt(chunk.from),
        toLine: lineAt(chunk.to),
        completeStart: true,
        completeEnd: true,
        selection: options.selection,
        width: 760,
      },
      { signal: options.signal },
    )
    guard()
    if (!response.result.complete)
      warn(
        'presentation-incomplete',
        'Some rich content could not be rendered completely; original Markdown is retained where needed.',
      )
    for (const block of response.request.blocks) {
      if (block.kind !== 'fence') continue
      const language = (block.info ?? '').trim().split(/\s+/u)[0] ?? ''
      const supported = response.declarations.some(
        (renderer) =>
          renderer.contexts.includes('fence') && renderer.fenceLanguages?.includes(language),
      )
      if (
        supported &&
        !response.result.fragments.some(
          (fragment) => fragment.from <= block.from && fragment.to >= block.to,
        )
      )
        warn(
          'presentation-unsupported',
          'A rich fenced block was unsupported or incomplete; its original Markdown is retained.',
        )
    }
    presentations.push({ ...response, request: absoluteLines(response.request) })
  }
  guard()
  return { presentations, warnings }
}

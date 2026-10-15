import type {
  SdkPluginDocumentHost,
  SdkDocumentPresentationRequest as Request,
  SdkDocumentPresentationResult as Result,
} from '@milkup/plugin-sdk'
import { FootnoteIndex } from './indexer'
import { present } from './presentation'
export function createFootnoteController(
  host: SdkPluginDocumentHost,
  limits: { maxChars?: number; maxLines?: number; delayMs?: number } = {},
) {
  let active = true,
    generation = 0,
    current:
      | { documentId: string; version: number; index: FootnoteIndex; abort: AbortController }
      | undefined,
    timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    generation++
    current?.abort.abort()
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  async function scan(job: NonNullable<typeof current>, epoch: number) {
    let next = 1,
      chars = 0,
      lastUpdate = 0
    const maxChars = limits.maxChars ?? 8 * 1024 * 1024,
      maxLines = limits.maxLines ?? 200_000
    const valid = () =>
      active && current === job && generation === epoch && !job.abort.signal.aborted
    const refresh = async () => {
      if (valid())
        await host
          .invalidatePresentation({
            documentId: job.documentId,
            version: job.version,
            rendererId: 'footnotes',
          })
          .catch(() => undefined)
    }
    try {
      while (valid()) {
        if (next > maxLines || chars + 131072 > maxChars) {
          job.index.limit('scan-limit')
          break
        }
        const page = await host.readWindow(
          {
            documentId: job.documentId,
            version: job.version,
            fromLine: next,
            lineCount: Math.min(256, maxLines - next + 1),
          },
          { signal: job.abort.signal },
        )
        if (!valid()) return
        if (
          page.documentId !== job.documentId ||
          page.version !== job.version ||
          page.fromLine !== next ||
          page.toLine < next ||
          page.lines.length !== page.toLine - page.fromLine + 1
        )
          throw new Error('stale')
        chars += page.text.length
        if (chars > maxChars) {
          job.index.limit('scan-limit')
          break
        }
        for (const line of page.lines) job.index.consume(line)
        next = page.toLine + 1
        if (page.completeEnd) {
          job.index.finish()
          break
        }
        if (job.index.partialReason) break
        if (Date.now() - lastUpdate >= 250) {
          lastUpdate = Date.now()
          await refresh()
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    } catch (error) {
      if (!valid()) return
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'unavailable'
      job.index.limit(code)
    }
    await refresh()
  }
  return {
    render(request: Request, options: { signal: AbortSignal }): Result {
      if (!active || options.signal.aborted) return { fragments: [], complete: false }
      if (
        !current ||
        current.documentId !== request.documentId ||
        current.version !== request.version
      ) {
        stop()
        const job = {
          documentId: request.documentId,
          version: request.version,
          index: new FootnoteIndex(),
          abort: new AbortController(),
        }
        current = job
        const epoch = generation
        timer = setTimeout(() => {
          timer = undefined
          void scan(job, epoch)
        }, limits.delayMs ?? 80)
      }
      return present(request, current.index)
    },
    dispose() {
      if (!active) return
      active = false
      stop()
      current = undefined
    },
  }
}

import { DocumentPresentationError, type EditorDocumentSource, type Line } from '@milkup/core'
import {
  collectMarkdownImageResources,
  renderStaticMarkdownDocument,
  STATIC_EXPORT_LIMITS,
} from '@milkup/export'
import {
  PluginOutputError,
  PLUGIN_OUTPUT_ERROR_CODES,
  copyPluginOutputCaptureRequest,
  type PluginOutputBrokerAdapter,
  type PluginOutputCaptureRequest,
  type PluginOutputSnapshot,
  type PluginOutputOperationOptions,
} from '@milkup/plugin'
import type { DesktopDocumentPresentationOptions } from './document-presentation-service'
import { collectOutputPresentations, type OutputPresentationOptions } from './output-presentations'

export interface DesktopOutputCurrent {
  readonly source: EditorDocumentSource
  readonly identity: object
  readonly selection: { readonly anchor: number; readonly head: number }
  readonly sourcePath?: string
  readonly readLengthUtf16?: () => Promise<number>
  readonly title: string
  readonly saveLocationGeneration: number
}
export interface DesktopOutputServiceOptions {
  readonly current: () => DesktopOutputCurrent | undefined
  readonly invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>
  readonly renderers: DesktopDocumentPresentationOptions['renderers']
  readonly rendererGeneration?: (pluginId: string) => number
  readonly render: OutputPresentationOptions['render']
}
interface Captured {
  readonly metadata: PluginOutputSnapshot
  readonly jobId: string
  readonly request: PluginOutputCaptureRequest
  readonly html: string
  busy: boolean
  released: boolean
  counted: boolean
  targetId?: string
}
const fail = (code: ConstructorParameters<typeof PluginOutputError>[0]): never => {
  throw new PluginOutputError(code)
}
const clean = (value: string, max = 256) => value.replace(/[\x00-\x1f]/g, ' ').slice(0, max)
const token = () => crypto.randomUUID().replaceAll('-', '')

/** Host-owned immutable HTML, resources and native leases. Plugins only receive metadata. */
export function createDesktopOutputService(options: DesktopOutputServiceOptions) {
  let allocated = 0
  return {
    adapterForPlugin(_pluginId: string) {
      let disposed = false
      const captures = new Map<string, Captured>()
      const targets = new Map<string, Captured>()
      const operations = new Set<AbortController>()
      const active = () => {
        if (disposed) fail('revoked')
      }
      const abortNative = async (jobId: string) => {
        await options.invoke('output_abort', { jobId }).catch(() => undefined)
      }
      const forget = (capture: Captured) => {
        capture.released = true
        captures.delete(capture.metadata.id)
        if (capture.targetId) targets.delete(capture.targetId)
        // A revoked native operation still owns its HTML until it settles.
        if (!capture.busy && capture.counted) {
          capture.counted = false
          allocated--
        }
      }
      const find = (id: string, target = false) => {
        active()
        const item = (target ? targets : captures).get(id)
        if (!item) return fail('invalid-token')
        if (item.busy) return fail('busy')
        return item
      }
      async function operation<T>(
        opts: PluginOutputOperationOptions | undefined,
        run: (signal: AbortSignal) => Promise<T>,
      ): Promise<T> {
        active()
        if (opts?.signal?.aborted) fail('aborted')
        const controller = new AbortController()
        operations.add(controller)
        const abort = () => controller.abort()
        opts?.signal?.addEventListener('abort', abort, { once: true })
        const timer = setTimeout(abort, 240_000)
        try {
          return await run(controller.signal)
        } catch (error) {
          // Map only failed native operations. A successful publication stays
          // successful even when cancellation arrives after its commit point.
          if (controller.signal.aborted) fail(disposed ? 'revoked' : 'aborted')
          if (error instanceof PluginOutputError) throw error
          const code =
            typeof error === 'string' ? /^\[output:([a-z-]+)\]/u.exec(error)?.[1] : undefined
          if (code && PLUGIN_OUTPUT_ERROR_CODES.includes(code as never))
            fail(code as ConstructorParameters<typeof PluginOutputError>[0])
          throw error
        } finally {
          clearTimeout(timer)
          operations.delete(controller)
          opts?.signal?.removeEventListener('abort', abort)
        }
      }
      const adapter: PluginOutputBrokerAdapter = {
        capture(input, opts) {
          return operation(opts, async (signal) => {
            const request = copyPluginOutputCaptureRequest(input)
            if (allocated >= 4) fail('busy')
            allocated++
            let retained = false,
              jobId: string | undefined
            try {
              const initial = options.current()
              if (!initial) return fail('unavailable')
              const source = initial.source,
                version = source.version,
                documentId = source.documentId
              const assertCurrent = () => {
                if (signal.aborted) fail('aborted')
                active()
                const current = options.current()
                if (
                  !current ||
                  current.identity !== initial.identity ||
                  current.source !== source ||
                  source.version !== version ||
                  source.documentId !== documentId ||
                  current.sourcePath !== initial.sourcePath ||
                  current.saveLocationGeneration !== initial.saveLocationGeneration
                )
                  fail('stale')
              }
              assertCurrent()
              const length = source.length ?? (await initial.readLengthUtf16?.())
              assertCurrent()
              if (length === undefined || !Number.isSafeInteger(length) || length < 0)
                fail('unavailable')
              const selected = request.scope === 'selection'
              const from = selected ? Math.min(initial.selection.anchor, initial.selection.head) : 0
              const end = selected
                ? Math.max(initial.selection.anchor, initial.selection.head)
                : length
              if (
                !Number.isSafeInteger(from) ||
                from < 0 ||
                (end !== undefined &&
                  (!Number.isSafeInteger(end) || end < from || end > length!)) ||
                (selected && from === end)
              )
                fail('invalid-input')
              if (
                (end !== undefined && end - from > STATIC_EXPORT_LIMITS.sourceUtf16) ||
                (!selected && source.lineCount > 200_000)
              )
                fail('too-large')
              const budgetError = (error: unknown) =>
                (error instanceof RangeError && /text budget/i.test(error.message)) ||
                (typeof error === 'string' && /Line window exceeds text budget/i.test(error))
              const readLine = async (number: number) => {
                try {
                  const window = await source.readLineWindow(number, number, 131072)
                  assertCurrent()
                  const line = window.lines[0]
                  if (!line || line.number !== number || window.text.length > 131072)
                    return fail('unavailable')
                  return line
                } catch (error) {
                  assertCurrent()
                  if (budgetError(error)) return fail('too-large')
                  throw error
                }
              }
              const lineAt = async (position: number) => {
                let low = 1,
                  high = source.lineCount,
                  found: Line | undefined
                while (low <= high) {
                  const middle = Math.floor((low + high) / 2)
                  const line = await readLine(middle)
                  if (line.from <= position) {
                    found = line
                    low = middle + 1
                  } else high = middle - 1
                }
                if (!found || (found.number === source.lineCount && position > length!))
                  return fail('invalid-input')
                return found
              }
              const first = selected ? await lineAt(from) : await readLine(1)
              const last = selected ? await lineAt(end!) : undefined
              assertCurrent()
              const lastLine = last?.number ?? source.lineCount
              let line = first.number,
                previousEnd: number | undefined,
                text = ''
              const base = first.from
              while (line <= lastLine) {
                let toLine = Math.min(lastLine, line + 4095),
                  window
                for (;;) {
                  try {
                    window = await source.readLineWindow(line, toLine, 131072)
                    break
                  } catch (error) {
                    assertCurrent()
                    if (!budgetError(error)) throw error
                    if (toLine === line) return fail('too-large')
                    toLine = line + Math.floor((toLine - line) / 2)
                  }
                }
                assertCurrent()
                if (
                  window.fromLine !== line ||
                  window.toLine !== toLine ||
                  window.text.length > 131072 ||
                  window.to - window.from !== window.text.length
                )
                  fail('unavailable')
                // Core line windows exclude LF/CRLF terminators. Absolute UTF-16
                // positions recover the exact separator without re-reading a long
                // preceding line (two legal lines need not fit one read window).
                if (previousEnd !== undefined) {
                  const separatorLength = window.from - previousEnd
                  if (separatorLength !== 1 && separatorLength !== 2) fail('unavailable')
                  text += separatorLength === 2 ? '\r\n' : '\n'
                }
                text += window.text
                previousEnd = window.to
                if (text.length > STATIC_EXPORT_LIMITS.sourceUtf16 + first.text.length)
                  fail('too-large')
                line = toLine + 1
              }
              // The core Line contract also excludes a terminal CR. Preserve it
              // from the document length; any other unexplained gap is rejected.
              if (lastLine === source.lineCount && previousEnd !== undefined) {
                const trailing = length! - previousEnd
                if (trailing === 1) text += '\r'
                else if (trailing !== 0) fail('unavailable')
              }
              text = text.slice(from - base, end === undefined ? undefined : end - base)
              if (text.length > STATIC_EXPORT_LIMITS.sourceUtf16) fail('too-large')
              // Do not split an astral scalar when a selected range is malformed.
              if (/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(text)) fail('invalid-input')
              const rich = await collectOutputPresentations({
                source: text,
                sourceOffset: from,
                documentId,
                version,
                fromLine: first.number,
                selection: initial.selection,
                renderers: options.renderers,
                ...(options.rendererGeneration
                  ? { rendererGeneration: options.rendererGeneration }
                  : {}),
                render: options.render,
                signal,
                assertCurrent,
                completeStart: !selected,
                completeEnd: !selected,
              })
              assertCurrent()
              const images = new Map<string, string>()
              let imageBytes = 0
              if (request.resources === 'embed')
                for (const image of collectMarkdownImageResources(text)) {
                  if (images.has(image.url)) continue
                  images.set(image.url, '')
                  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(image.url)) continue
                  try {
                    const value = (await options.invoke('resources_resolve_image', {
                      documentId,
                      relativeUrl: image.url,
                    })) as { data: number[]; mimeType: string }
                    assertCurrent()
                    if (
                      !['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType) ||
                      !Array.isArray(value.data) ||
                      !value.data.length ||
                      value.data.length > 16 * 1024 * 1024 ||
                      value.data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
                    )
                      continue
                    imageBytes += value.data.length
                    if (imageBytes > STATIC_EXPORT_LIMITS.imageBytes) fail('too-large')
                    let binary = ''
                    for (let offset = 0; offset < value.data.length; offset += 8192)
                      binary += String.fromCharCode(...value.data.slice(offset, offset + 8192))
                    images.set(image.url, `data:${value.mimeType};base64,${btoa(binary)}`)
                  } catch (error) {
                    assertCurrent()
                    if (error instanceof PluginOutputError) throw error
                  }
                }
              const title = clean(initial.title)
              const result = renderStaticMarkdownDocument(text, {
                documentId,
                version,
                sourceOffset: from,
                title,
                presentations: rich.presentations,
                imageMode: request.resources,
                pageSize: request.pageSize ?? 'a4',
                landscape: request.landscape ?? false,
                resolveUrl: (url, kind) => (kind === 'image' ? (images.get(url) ?? '') : url),
              })
              assertCurrent()
              if (new TextEncoder().encode(result.html).byteLength > STATIC_EXPORT_LIMITS.htmlBytes)
                fail('too-large')
              const warnings = [...rich.warnings, ...result.warnings].map((w) => ({
                code: w.code,
                message: clean(w.message, 512),
              }))
              const unique = [
                ...new Map(warnings.map((w) => [w.code + '\0' + w.message, w])).values(),
              ]
              if (unique.length > 64)
                unique.splice(63, unique.length - 63, {
                  code: 'additional-warnings',
                  message:
                    'Additional unsupported content remains visible as source. Review the output before sharing.',
                })
              const prepared = (await options.invoke('output_prepare', {
                format: request.format,
                ...(initial.sourcePath ? { sourcePath: initial.sourcePath } : {}),
              })) as { id: string }
              jobId = prepared.id
              assertCurrent()
              const metadata = Object.freeze({
                id: token(),
                documentId,
                version,
                title,
                from,
                to: from + text.length,
                lineCount: lastLine - first.number + 1,
                warnings: Object.freeze(unique),
              })
              captures.set(metadata.id, {
                metadata,
                jobId,
                request,
                html: result.html,
                busy: false,
                released: false,
                counted: true,
              })
              retained = true
              return metadata
            } catch (error) {
              if (jobId) await abortNative(jobId)
              // Renderer identity changes invalidate this snapshot; they do not
              // revoke the initiating output plugin's permission.
              if (error instanceof DocumentPresentationError && error.code === 'revoked')
                fail('stale')
              if (error instanceof RangeError) fail('too-large')
              throw error
            } finally {
              if (!retained) allocated--
            }
          })
        },
        chooseTarget({ snapshotId }, opts) {
          return operation(opts, async (signal) => {
            const item = find(snapshotId)
            if (item.request.format === 'print' || item.targetId) fail('invalid-token')
            item.busy = true
            const abort = () => {
              void abortNative(item.jobId)
            }
            signal.addEventListener('abort', abort, { once: true })
            try {
              const chosen = (await options.invoke('output_choose_target', {
                jobId: item.jobId,
                title: item.metadata.title,
              })) as { id: string; name: string } | null
              if (signal.aborted || disposed || item.released) {
                await abortNative(item.jobId)
                forget(item)
                fail(signal.aborted ? 'aborted' : 'revoked')
              }
              if (!chosen) {
                forget(item)
                await abortNative(item.jobId)
                return { status: 'cancelled' } as const
              }
              const id = token()
              item.targetId = id
              targets.set(id, item)
              return { status: 'ready', id, name: chosen.name } as const
            } finally {
              item.busy = false
              if (item.released) forget(item)
              signal.removeEventListener('abort', abort)
            }
          })
        },
        write(targetId, opts) {
          return operation(opts, async (signal) => {
            const item = find(targetId, true)
            item.busy = true
            const abort = () => {
              void abortNative(item.jobId)
            }
            signal.addEventListener('abort', abort, { once: true })
            try {
              const value = (await options.invoke(
                item.request.format === 'html' ? 'output_write_html' : 'output_write_pdf',
                {
                  jobId: item.jobId,
                  html: item.html,
                  ...(item.request.format === 'pdf'
                    ? {
                        pageSize: item.request.pageSize ?? 'a4',
                        landscape: item.request.landscape ?? false,
                      }
                    : {}),
                },
              )) as { name: string; bytes: number }
              return { status: 'written', name: value.name, bytes: value.bytes } as const
            } finally {
              signal.removeEventListener('abort', abort)
              item.busy = false
              forget(item)
              await abortNative(item.jobId)
            }
          })
        },
        print(snapshotId, opts) {
          return operation(opts, async (signal) => {
            const item = find(snapshotId)
            if (item.request.format !== 'print') fail('invalid-token')
            item.busy = true
            const abort = () => {
              void abortNative(item.jobId)
            }
            signal.addEventListener('abort', abort, { once: true })
            try {
              const value = (await options.invoke('output_print', {
                jobId: item.jobId,
                html: item.html,
                pageSize: item.request.pageSize ?? 'a4',
                landscape: item.request.landscape ?? false,
              })) as { status: 'printed' | 'cancelled' }
              return { status: value.status }
            } finally {
              signal.removeEventListener('abort', abort)
              item.busy = false
              forget(item)
              await abortNative(item.jobId)
            }
          })
        },
        async release(id) {
          const item = captures.get(id) ?? targets.get(id)
          if (!item) return
          forget(item)
          await abortNative(item.jobId)
        },
      }
      return {
        adapter,
        async dispose() {
          if (disposed) return
          disposed = true
          for (const operation of operations) operation.abort()
          const owned = [...captures.values()]
          for (const item of owned) forget(item)
          await Promise.all(owned.map((item) => abortNative(item.jobId)))
        },
      }
    },
  }
}

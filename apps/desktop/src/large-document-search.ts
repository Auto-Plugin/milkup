import type { EditorDocumentSource } from '@milkup/core'
import type { DesktopSearchState } from './desktop-document-search'
import type {
  LargeSearchService,
  LargeSearchProgress,
  LargeReplaceRequest,
  LargeReplaceProgress,
} from './large-search-service'
export interface LargeSearchMetrics {
  calls: number
  ipcMs: number
  nativeMs: number
  workerMs: number
  fallbackUtf16Units: number
  indexBytes: number
  elapsedMs: number
}
interface Run {
  id: string
  query: string
  version: number
  source: EditorDocumentSource
  abort: AbortController
  began: Promise<void>
  worker?: Worker | undefined
  state: DesktopSearchState
  metrics: LargeSearchMetrics
}
export class LargeDocumentSearchController {
  private generation = 0
  private active: Run | undefined
  metrics: LargeSearchMetrics | undefined
  constructor(
    private readonly service: LargeSearchService,
    private readonly workerFactory = () =>
      new Worker(new URL('./large-search-worker.ts', import.meta.url), { type: 'module' }),
  ) {}
  cancel() {
    const run = this.active
    this.active = undefined
    if (!run) return
    run.abort.abort()
    run.worker?.terminate()
    void run.began.then(() => this.service.cancel(run.id)).catch(() => {})
  }
  async run(options: {
    query: string
    caseSensitive?: boolean
    source: EditorDocumentSource
    onUpdate?: (state: DesktopSearchState) => void
  }): Promise<DesktopSearchState> {
    this.cancel()
    const query = options.query.trim()
    const idle: DesktopSearchState = {
      phase: 'idle',
      query,
      matches: [],
      complete: true,
      scannedLineCount: 0,
    }
    if (!query) {
      options.onUpdate?.(idle)
      return idle
    }
    const id = crypto.randomUUID(),
      version = options.source.version,
      started = performance.now()
    const metrics: LargeSearchMetrics = {
      calls: 0,
      ipcMs: 0,
      nativeMs: 0,
      workerMs: 0,
      fallbackUtf16Units: 0,
      indexBytes: 0,
      elapsedMs: 0,
    }
    this.metrics = metrics
    const run: Run = {
      id,
      version,
      query,
      source: options.source,
      abort: new AbortController(),
      metrics,
      state: {
        ...idle,
        phase: 'searching',
        complete: false,
        matchCount: 0,
        matchOffset: 0,
        nativeSearchId: id,
      },
      began: this.service.begin({
        documentId: options.source.documentId,
        expectedVersion: version,
        searchId: id,
        generation: ++this.generation,
        query,
        caseSensitive: options.caseSensitive ?? false,
        asciiFoldSafe: 'I'.toLocaleLowerCase() === 'i',
      }),
    }
    this.active = run
    options.onUpdate?.(run.state)
    let emitted = performance.now()
    const current = () => {
      if (this.active !== run || run.abort.signal.aborted || run.source.version !== version)
        throw new Error('Search cancelled or document changed')
    }
    try {
      await run.began
      current()
      let progress: LargeSearchProgress
      do {
        current()
        const at = performance.now()
        progress = await this.service.step(id)
        metrics.calls++
        metrics.ipcMs += performance.now() - at
        metrics.nativeMs += progress.nativeMs
        current()
        if (progress.fallback) {
          metrics.fallbackUtf16Units += progress.fallback.text.length
          run.worker ??= this.workerFactory()
          progress = await this.scanWorker(run, progress.fallback, options.caseSensitive ?? false)
          current()
        }
        metrics.indexBytes = progress.indexBytes
        run.state = {
          ...run.state,
          scannedLineCount: progress.scannedLineCount,
          matchCount: progress.matchCount,
        }
        if (performance.now() - emitted >= 100) {
          options.onUpdate?.(run.state)
          emitted = performance.now()
        }
      } while (!progress.complete)
      const page = await this.service.page(id, 0)
      current()
      run.state = { ...run.state, ...page, phase: 'done', complete: true }
      metrics.elapsedMs = performance.now() - started
      options.onUpdate?.(run.state)
      return run.state
    } catch (error) {
      const cancelled =
        this.active !== run || run.abort.signal.aborted || run.source.version !== version
      const state: DesktopSearchState = {
        ...run.state,
        phase: cancelled ? 'cancelled' : 'failed',
        complete: false,
        message: String(error),
      }
      if (this.active === run) options.onUpdate?.(state)
      await run.began.then(() => this.service.cancel(id)).catch(() => {})
      return state
    } finally {
      run.worker?.terminate()
      run.worker = undefined
      metrics.elapsedMs = performance.now() - started
    }
  }
  async page(index: number): Promise<DesktopSearchState> {
    const run = this.active
    if (!run || run.state.phase !== 'done' || run.source.version !== run.version)
      throw new Error('Search results are no longer current')
    const page = await this.service.page(run.id, Math.max(0, index))
    if (this.active !== run || run.source.version !== run.version)
      throw new Error('Document changed while loading results')
    run.state = { ...run.state, ...page }
    return run.state
  }
  private scanWorker(
    run: Run,
    window: NonNullable<LargeSearchProgress['fallback']>,
    caseSensitive: boolean,
  ): Promise<LargeSearchProgress> {
    const worker = run.worker!
    return new Promise((resolve, reject) => {
      let last: LargeSearchProgress | undefined
      const abort = () => {
        worker.terminate()
        reject(new Error('Search cancelled'))
      }
      run.abort.signal.addEventListener('abort', abort, { once: true })
      const cleanup = () => run.abort.signal.removeEventListener('abort', abort)
      worker.onerror = (event) => {
        cleanup()
        reject(new Error(event.message))
      }
      worker.onmessage = (event) => {
        const data = event.data as {
          type: string
          values: ArrayBuffer
          done: boolean
          message: string
          scanMs: number
        }
        if (data.type === 'complete') {
          cleanup()
          run.metrics.workerMs += data.scanMs
          if (last) resolve(last)
          else reject(new Error('Missing Worker completion'))
          return
        }
        if (data.type === 'error') {
          cleanup()
          reject(new Error(data.message))
          return
        }
        const values = new Float64Array(data.values),
          matches: number[][] = []
        for (let i = 0; i < values.length; i += 4)
          matches.push([values[i]!, values[i + 1]!, values[i + 2]!, values[i + 3]!])
        const at = performance.now()
        void this.service.append(run.id, matches, data.done).then(
          (progress) => {
            run.metrics.calls++
            run.metrics.ipcMs += performance.now() - at
            run.metrics.nativeMs += progress.nativeMs
            last = progress
            if (!run.abort.signal.aborted) worker.postMessage({ type: 'ack' })
          },
          (error) => {
            cleanup()
            reject(error)
          },
        )
      }
      worker.postMessage({ type: 'scan', ...window, query: run.query, caseSensitive })
    })
  }
}
export async function prepareLargeReplacement(
  service: LargeSearchService,
  request: LargeReplaceRequest,
  signal: AbortSignal,
  onProgress: (state: LargeReplaceProgress) => void,
) {
  try {
    let progress = await service.beginReplacement(request)
    onProgress(progress)
    while (!progress.ready) {
      if (signal.aborted) throw new Error('Replacement cancelled')
      progress = await service.stepReplacement(request.replacementId)
      onProgress(progress)
    }
    if (signal.aborted) throw new Error('Replacement cancelled')
    return request.replacementId
  } catch (error) {
    await service.cancelReplacement(request.replacementId).catch(() => {})
    throw error
  }
}

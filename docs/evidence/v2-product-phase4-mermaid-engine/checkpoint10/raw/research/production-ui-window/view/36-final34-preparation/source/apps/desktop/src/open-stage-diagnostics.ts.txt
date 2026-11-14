export type OpenStageMark =
  | 'native-dialog-selected'
  | 'file-metadata'
  | 'file-read-start'
  | 'file-read-end'
  | 'plugin-check-start'
  | 'plugin-check-end'
  | 'memory-document-start'
  | 'memory-document-end'
  | 'markdown-parse-start'
  | 'markdown-parse-end'
  | 'editor-dom-commit'
  | 'first-editor-paint'
  | 'first-interactive-focus'

export interface OpenStageTiming {
  readonly stage: OpenStageMark
  readonly timestampMs: number
  readonly elapsedMs: number
  readonly deltaMs: number
  readonly detail?: string
}

export interface OpenStageDiagnostics {
  readonly id: number
  readonly label: string
  readonly timings: readonly OpenStageTiming[]
}

export interface OpenStageTracker {
  readonly id: number
  readonly label: string
  mark(stage: OpenStageMark, detail?: string): OpenStageTiming
  snapshot(): OpenStageDiagnostics
}

export interface OpenStageTrackerOptions {
  readonly label: string
  readonly now?: () => number
  readonly consoleDiagnostics?: boolean
}

let nextTrackerId = 1

export function createOpenStageTracker(options: OpenStageTrackerOptions): OpenStageTracker {
  const now = options.now ?? (() => performance.now())
  const startMs = now()
  let previousMs = startMs
  const timings: OpenStageTiming[] = []
  const id = nextTrackerId
  nextTrackerId += 1

  return {
    id,
    label: options.label,
    mark(stage: OpenStageMark, detail?: string): OpenStageTiming {
      const timestampMs = now()
      const timing: OpenStageTiming = Object.freeze({
        stage,
        timestampMs,
        elapsedMs: timestampMs - startMs,
        deltaMs: timestampMs - previousMs,
        ...(detail === undefined ? {} : { detail }),
      })
      previousMs = timestampMs
      timings.push(timing)

      if (options.consoleDiagnostics) {
        console.debug(
          `[milkup:open:${id}] ${stage} +${formatMs(timing.elapsedMs)} (${formatMs(
            timing.deltaMs,
          )})${detail ? ` ${detail}` : ''}`,
        )
      }

      return timing
    },
    snapshot(): OpenStageDiagnostics {
      return Object.freeze({
        id,
        label: options.label,
        timings: Object.freeze([...timings]),
      })
    },
  }
}

export function formatOpenStageDiagnostics(diagnostics: OpenStageDiagnostics | undefined): string {
  if (!diagnostics || diagnostics.timings.length === 0) {
    return '无'
  }

  return diagnostics.timings
    .map((timing) => {
      const detail = timing.detail ? ` ${timing.detail}` : ''
      return `${timing.stage}: ${formatMs(timing.elapsedMs)} (+${formatMs(
        timing.deltaMs,
      )})${detail}`
    })
    .join('\n')
}

function formatMs(value: number): string {
  return `${Math.round(value * 10) / 10}ms`
}

import { describe, expect, it } from 'vitest'

import {
  createOpenStageTracker,
  formatOpenStageDiagnostics,
} from './open-stage-diagnostics'

describe('open stage diagnostics', () => {
  it('records elapsed and delta timings in order', () => {
    const samples = [100, 125, 180]
    const tracker = createOpenStageTracker({
      label: 'test.md',
      now: () => samples.shift() ?? 180,
    })

    tracker.mark('file-read-start')
    tracker.mark('file-read-end', 'D:/notes/test.md')

    expect(tracker.snapshot()).toMatchObject({
      label: 'test.md',
      timings: [
        { stage: 'file-read-start', elapsedMs: 25, deltaMs: 25 },
        {
          stage: 'file-read-end',
          elapsedMs: 80,
          deltaMs: 55,
          detail: 'D:/notes/test.md',
        },
      ],
    })
  })

  it('formats the last open report for the developer panel', () => {
    const tracker = createOpenStageTracker({ label: 'test.md', now: () => 0 })
    tracker.mark('first-editor-paint')

    expect(formatOpenStageDiagnostics(tracker.snapshot())).toContain('first-editor-paint')
    expect(formatOpenStageDiagnostics(undefined)).toBe('无')
  })
})

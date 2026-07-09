import { ChangeSet, EditorState, MemoryTextDocument, Selection } from '@milkup/core'
import { readFileSync, writeFileSync } from 'node:fs'
import { cpus, freemem, platform, release, totalmem } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'

import { EditorView } from '../index'

const MIB = 1024 * 1024
const reportPath = process.env.MILKUP_VIEW_DOM_BENCHMARK_REPORT

describe('view-dom benchmark report', () => {
  it('writes an opt-in large-file renderer benchmark report', () => {
    if (!reportPath) {
      expect(true).toBe(true)
      return
    }

    const report = {
      generatedAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        release: release(),
        arch: process.arch,
        cpu: cpus()[0]?.model ?? 'unknown',
        cpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        freeMemoryBytesAfterRun: undefined as number | undefined,
        node: process.version,
        userAgent: navigator.userAgent,
      },
      benchmarks: {
        codingPlan175Kb: benchmarkCodingPlanFixture(),
        synthetic10MiBVirtualSource: benchmarkVirtualSourceFixture(10),
      },
      note:
        'This jsdom benchmark records view-dom construction/render/update costs and DOM bounds. It is retained renderer evidence, not a native desktop/WebView latency report.',
    }

    report.environment.freeMemoryBytesAfterRun = freemem()
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    expect(report.benchmarks.synthetic10MiBVirtualSource.renderedLineCount).toBeLessThan(300)
  }, 120_000)
})

function benchmarkCodingPlanFixture(): Record<string, unknown> {
  const text = readFileSync(resolve(__dirname, '../../../../docs/coding-plan.md'), 'utf8')
  const parent = document.createElement('main')
  const created = measure(() => {
    const state = new EditorState({
      doc: new MemoryTextDocument(text),
      selection: Selection.cursor(0),
    })
    const view = new EditorView({
      parent,
      state,
      mode: 'live',
    })

    return { state, view }
  })
  const { state, view } = created.value
  const middle = state.doc.line(Math.max(1, Math.floor(state.doc.lineCount / 2))).from
  const selectedMiddle = measure(() => {
    view.updateState(
      new EditorState({
        doc: state.doc,
        selection: Selection.cursor(middle),
        history: state.history,
      }),
    )
  })
  const typed = measure(() => {
    const next = state.applyTransaction({
      changes: ChangeSet.insert(middle, 'x'),
      selection: Selection.cursor(middle + 1),
      origin: { type: 'input.type', id: 'benchmark' },
    })
    view.updateState(next)
  })

  return {
    file: 'docs/coding-plan.md',
    bytes: Buffer.byteLength(text),
    lineCount: state.doc.lineCount,
    createAndInitialRenderMs: created.durationMs,
    selectionUpdateMiddleMs: selectedMiddle.durationMs,
    singleCharacterUpdateMiddleMs: typed.durationMs,
    renderedLineCount: view.contentDOM.querySelectorAll('.milkup-line').length,
  }
}

function benchmarkVirtualSourceFixture(sizeMiB: number): Record<string, unknown> {
  const text = createSyntheticMarkdown(sizeMiB * MIB)
  const parent = document.createElement('main')
  const created = measure(() => {
    const state = new EditorState({
      doc: new MemoryTextDocument(text),
      selection: Selection.cursor(0),
    })
    const view = new EditorView({
      parent,
      state,
      mode: 'source',
      virtualViewport: {
        enabled: true,
        lineHeight: 21,
        viewportHeight: 420,
        overscanLines: 12,
      },
    })

    return { state, view }
  })
  const { state, view } = created.value
  const tailLine = state.doc.line(Math.max(1, state.doc.lineCount - 10))
  const scrollTail = measure(() => {
    view.dom.scrollTop = Math.max(0, (tailLine.number - 1) * 21)
    view.dom.dispatchEvent(new Event('scroll'))
  })
  const cursorTail = measure(() => {
    view.updateState(
      new EditorState({
        doc: state.doc,
        selection: Selection.cursor(tailLine.from),
        history: state.history,
      }),
    )
    view.ensureCursorVisible({ viewportHeight: 420 })
  })
  const typed = measure(() => {
    const next = state.applyTransaction({
      changes: ChangeSet.insert(tailLine.from, 'x'),
      selection: Selection.cursor(tailLine.from + 1),
      origin: { type: 'input.type', id: 'benchmark' },
    })
    view.updateState(next)
  })

  return {
    requestedSizeMiB: sizeMiB,
    bytes: Buffer.byteLength(text),
    lineCount: state.doc.lineCount,
    createAndInitialRenderMs: created.durationMs,
    scrollTailWindowMs: scrollTail.durationMs,
    cursorTailEnsureVisibleMs: cursorTail.durationMs,
    singleCharacterUpdateTailMs: typed.durationMs,
    renderedLineCount: view.contentDOM.querySelectorAll('.milkup-line').length,
    renderedFromLine: view.contentDOM.dataset.fromLine,
    renderedToLine: view.contentDOM.dataset.toLine,
  }
}

function createSyntheticMarkdown(targetBytes: number): string {
  const chunks = ['# Synthetic View Benchmark\n\n']
  let bytes = Buffer.byteLength(chunks[0] ?? '')
  let index = 0

  while (bytes < targetBytes) {
    const line =
      index % 128 === 0
        ? `\n\`\`\`ts\nexport const marker${index} = ${index}\n\`\`\`\n\n`
        : `- repeated item ${String(index).padStart(9, '0')}: **bold** [link](./target.md) marker-${index}\n`
    const remaining = targetBytes - bytes
    const next = line.length <= remaining ? line : 'x'.repeat(remaining)

    chunks.push(next)
    bytes += next.length
    index += 1
  }

  return chunks.join('')
}

function measure<T>(run: () => T): { readonly value: T; readonly durationMs: number } {
  const startedAt = performance.now()
  const value = run()
  return {
    value,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  }
}

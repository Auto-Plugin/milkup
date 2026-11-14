import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  copyDocumentPresentationRequest,
  DOCUMENT_PRESENTATION_LIMITS,
  DocumentPresentationError,
  type DocumentPresentationRequest,
  type DocumentPresentationResult,
} from '@milkup/core'
import {
  createRpcPluginIsolationHost,
  createTrustedPluginRenderEndpoint,
  type PluginRenderControl,
  type IsolatedPluginDocumentRenderRequest,
} from '@milkup/plugin'
import { collectOutputPresentations } from './output-presentations'

const protocol = 'milkup.plugin.document-render.v1'
const declaration = { pluginId: 'queue-fixture', id: 'text', contexts: ['text'] as const }
const source = 'captured text\n'
function request(target: 'screen' | 'export') {
  return copyDocumentPresentationRequest({
    documentId: 'doc',
    version: 7,
    source,
    from: 0,
    to: source.length,
    fromLine: 1,
    toLine: 2,
    completeStart: true,
    completeEnd: true,
    contextKnown: true,
    blocks: [],
    protectedRanges: [],
    selection: { anchor: 0, head: 0 },
    theme: 'light',
    target,
    width: 760,
  })
}
function result(input: DocumentPresentationRequest): DocumentPresentationResult {
  return {
    complete: true,
    fragments: [
      {
        from: input.from,
        to: input.to,
        layout: 'inline',
        status: 'ready',
        content: { type: 'text', text: `rendered v${input.version}: ${input.source}` },
        accessibleText: 'rendered snapshot',
      },
    ],
  }
}
interface Trace {
  phase: 'enqueue' | 'dispatch' | 'cancel' | 'result' | 'deliver' | 'timeout'
  id?: string
  at: number
  target?: 'screen' | 'export'
  aborted?: boolean
}
/** Only the owner is simulated. The public isolation host uses the actual RPC
 * client's single-flight queue,
 * abort handling, settlement grammar and trusted-authority revocation run here.
 * The owner's 2s deadline starts on transport dispatch, never on queue admission.
 */
function isolationOwner(
  durations: number[],
  ignoreCancellation = false,
  frontendDelays: number[] = [],
) {
  const trace: Trace[] = []
  const requests: DocumentPresentationRequest[] = []
  let document = { source, version: 7 }
  const listeners = new Set<(value: unknown) => void>()
  const controls = new Set<(event: PluginRenderControl) => void>()
  const scheduled = new Set<ReturnType<typeof setTimeout>>()
  let active: { id: string; request: DocumentPresentationRequest; cancelled: boolean } | undefined
  let stopped = false
  let enabled = true
  let index = 0
  const emit = (value: unknown) => {
    for (const listener of listeners) listener(value)
  }
  const stop = vi.fn(() => {
    stopped = true
    enabled = false
    for (const timer of scheduled) clearTimeout(timer)
    scheduled.clear()
  })
  const endpoint = createTrustedPluginRenderEndpoint(
    {
      postMessage(value: unknown) {
        const message = value as {
          protocol: string
          type: 'render' | 'cancel'
          id: string
          payload?: IsolatedPluginDocumentRenderRequest
        }
        expect(message.protocol).toBe(protocol)
        if (message.type === 'cancel') {
          trace.push({ phase: 'cancel', id: message.id, at: Date.now() })
          if (active?.id === message.id) active.cancelled = true
          return
        }
        expect(stopped).toBe(false)
        expect(
          active,
          'RPC must wait for owner settlement before dispatching the next job',
        ).toBeUndefined()
        const job = { id: message.id, request: message.payload!.request, cancelled: false }
        active = job
        trace.push({ phase: 'dispatch', id: job.id, target: job.request.target, at: Date.now() })
        requests.push(job.request)
        const deliveryDelay = frontendDelays[index] ?? 0
        const execution = durations[index++]
        expect(execution).toBeDefined()
        const deadline = setTimeout(() => {
          if (active !== job || stopped) return
          trace.push({ phase: 'timeout', id: job.id, at: Date.now() })
          stop()
          for (const control of controls) control({ type: 'timeout', id: job.id })
          active = undefined
        }, DOCUMENT_PRESENTATION_LIMITS.timeoutMs)
        scheduled.add(deadline)
        const completion = setTimeout(() => {
          if (active !== job || stopped) return
          clearTimeout(deadline)
          scheduled.delete(deadline)
          active = undefined
          const aborted = job.cancelled && !ignoreCancellation
          trace.push({ phase: 'result', id: job.id, at: Date.now(), aborted })
          const response = {
            protocol,
            type: 'result',
            id: job.id,
            ok: !aborted,
            ...(aborted ? { error: 'aborted' } : { value: result(job.request) }),
          }
          // The trusted owner has accepted the result and cleared its execution
          // watchdog. Delivery to the frontend can still be delayed independently.
          const deliver = () => {
            trace.push({ phase: 'deliver', id: job.id, at: Date.now() })
            emit(response)
          }
          if (deliveryDelay) scheduled.add(setTimeout(deliver, deliveryDelay))
          else deliver()
        }, execution)
        scheduled.add(completion)
      },
      on(_type, listener) {
        listeners.add(listener)
      },
      off(_type, listener) {
        listeners.delete(listener)
      },
    },
    (listener) => {
      controls.add(listener)
      return () => controls.delete(listener)
    },
  )
  const revoked = vi.fn(() => {
    enabled = false
  })
  const host = createRpcPluginIsolationHost(endpoint, { onDocumentRenderTimeout: revoked })
  const render = (input: DocumentPresentationRequest, signal?: AbortSignal) => {
    trace.push({ phase: 'enqueue', target: input.target, at: Date.now() })
    return host.renderDocument!(
      { pluginId: declaration.pluginId, rendererId: declaration.id, request: input },
      signal ? { signal } : {},
    )
  }
  return {
    host,
    trace,
    requests,
    stop,
    revoked,
    render,
    edit(nextSource: string, version: number) {
      document = { source: nextSource, version }
    },
    capture(signal = new AbortController().signal) {
      const snapshot = document
      return collectOutputPresentations({
        source: snapshot.source,
        sourceOffset: 0,
        documentId: 'doc',
        version: snapshot.version,
        fromLine: 1,
        selection: { anchor: 0, head: 0 },
        signal,
        assertCurrent: () => {
          if (document !== snapshot) throw new DocumentPresentationError('revoked')
        },
        renderers: () => (enabled ? [declaration] : []),
        render: (_pluginId, _rendererId, input, operation) => render(input, operation.signal),
      })
    },
    emitLate(id: string) {
      emit({ protocol, type: 'result', id, ok: true, value: result(request('export')) })
    },
    dispose() {
      host.dispose()
      for (const timer of scheduled) clearTimeout(timer)
    },
  }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('output preparation through the real isolated renderer queue', () => {
  it('allows 1500ms screen ownership then 1500ms export execution without spending the execution deadline in queue', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
    vi.setSystemTime(0)
    const owner = isolationOwner([1500, 1500])
    try {
      const editor = owner.render(request('screen'))
      const output = owner.capture()
      await vi.advanceTimersByTimeAsync(0)
      expect(owner.trace.filter((event) => event.phase === 'enqueue')).toEqual([
        { phase: 'enqueue', target: 'screen', at: 0 },
        { phase: 'enqueue', target: 'export', at: 0 },
      ])
      expect(owner.trace.filter((event) => event.phase === 'dispatch')).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1500)
      await expect(editor).resolves.toEqual(result(request('screen')))
      expect(owner.trace.filter((event) => event.phase === 'dispatch')).toEqual([
        { phase: 'dispatch', id: 'render_1', target: 'screen', at: 0 },
        { phase: 'dispatch', id: 'render_2', target: 'export', at: 1500 },
      ])
      await vi.advanceTimersByTimeAsync(1500)
      const captured = await output
      expect(owner.stop).not.toHaveBeenCalled()
      expect(owner.revoked).not.toHaveBeenCalled()
      // Old adapter cancels render_2 at t=2000, only 500ms into its execution.
      expect(owner.trace.filter((event) => event.phase === 'cancel')).toEqual([])
      expect(captured.warnings).toEqual([])
      expect(captured.presentations.flatMap((batch) => batch.result.fragments)).toHaveLength(1)
      expect(captured.presentations[0]!.request.version).toBe(7)
    } finally {
      owner.dispose()
    }
  })

  it('keeps the owner 2s stop and revokes the whole capture when its provider is removed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
    vi.setSystemTime(0)
    const owner = isolationOwner([2001])
    try {
      const published = vi.fn()
      const output = owner.capture().then(published)
      const rejected = expect(output).rejects.toMatchObject({ code: 'revoked' })
      await vi.advanceTimersByTimeAsync(2000)
      await rejected
      expect(owner.trace.filter((event) => event.phase === 'timeout')).toEqual([
        { phase: 'timeout', id: 'render_1', at: 2000 },
      ])
      expect(owner.stop).toHaveBeenCalledOnce()
      expect(owner.revoked).toHaveBeenCalledOnce()
      expect(published).not.toHaveBeenCalled()
      await expect(owner.render(request('export'))).rejects.toMatchObject({ code: 'revoked' })
      owner.emitLate('render_1')
      expect(published).not.toHaveBeenCalled()
    } finally {
      owner.dispose()
    }
  })

  it('cancels queued export without dispatching it or cancelling the screen owner', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
    vi.setSystemTime(0)
    const owner = isolationOwner([1500])
    const controller = new AbortController()
    try {
      const editor = owner.render(request('screen'))
      const output = owner.capture(controller.signal)
      const rejected = expect(output).rejects.toMatchObject({ code: 'aborted' })
      await vi.advanceTimersByTimeAsync(500)
      controller.abort()
      await rejected
      await vi.advanceTimersByTimeAsync(1500)
      await expect(editor).resolves.toEqual(result(request('screen')))
      expect(owner.trace.filter((event) => event.phase === 'enqueue')).toHaveLength(2)
      expect(owner.trace.filter((event) => event.phase === 'dispatch')).toEqual([
        { phase: 'dispatch', id: 'render_1', target: 'screen', at: 0 },
      ])
      expect(owner.trace.filter((event) => event.phase === 'cancel')).toEqual([])
      expect(owner.stop).not.toHaveBeenCalled()
      expect(owner.revoked).not.toHaveBeenCalled()
    } finally {
      owner.dispose()
    }
  })

  it('discards a cancelled active result and waits for its owner settlement before advancing the queue', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
    vi.setSystemTime(0)
    const owner = isolationOwner([1500, 500], true)
    const controller = new AbortController()
    try {
      const cancelledOutput = owner.capture(controller.signal)
      const rejected = expect(cancelledOutput).rejects.toMatchObject({ code: 'aborted' })
      await vi.advanceTimersByTimeAsync(500)
      controller.abort()
      await rejected
      const next = owner.capture()
      await vi.advanceTimersByTimeAsync(0)
      expect(owner.trace.filter((event) => event.phase === 'dispatch')).toHaveLength(1)
      expect(owner.trace.filter((event) => event.phase === 'cancel')).toEqual([
        { phase: 'cancel', id: 'render_1', at: 500 },
      ])
      await vi.advanceTimersByTimeAsync(1000)
      expect(owner.trace.filter((event) => event.phase === 'dispatch').at(-1)).toEqual({
        phase: 'dispatch',
        id: 'render_2',
        target: 'export',
        at: 1500,
      })
      await vi.advanceTimersByTimeAsync(500)
      expect((await next).presentations.flatMap((batch) => batch.result.fragments)).toHaveLength(1)
      expect(owner.stop).not.toHaveBeenCalled()
      expect(owner.revoked).not.toHaveBeenCalled()
    } finally {
      owner.dispose()
    }
  })

  it('accepts a trusted in-time owner result delivered after 2s but before the preparation deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
    vi.setSystemTime(0)
    const owner = isolationOwner([1500], false, [1500])
    try {
      let delivered = false
      const output = owner.capture().then((value) => {
        delivered = true
        return value
      })
      await vi.advanceTimersByTimeAsync(1500)
      expect(owner.trace.filter((event) => event.phase === 'result')).toEqual([
        { phase: 'result', id: 'render_1', at: 1500, aborted: false },
      ])
      expect(delivered).toBe(false)
      await vi.advanceTimersByTimeAsync(1000)
      expect(delivered).toBe(false)
      expect(
        owner.trace.filter((event) => event.phase === 'timeout' || event.phase === 'cancel'),
      ).toEqual([])
      await vi.advanceTimersByTimeAsync(500)
      const captured = await output
      expect(owner.trace.filter((event) => event.phase === 'deliver')).toEqual([
        { phase: 'deliver', id: 'render_1', at: 3000 },
      ])
      expect(captured.warnings).toEqual([])
      expect(captured.presentations.flatMap((batch) => batch.result.fragments)).toHaveLength(1)
      expect(owner.stop).not.toHaveBeenCalled()
      expect(owner.revoked).not.toHaveBeenCalled()
    } finally {
      owner.dispose()
    }
  })

  it('rejects a late old-version capture after an edit while allowing the queued new-version capture', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
    vi.setSystemTime(0)
    const owner = isolationOwner([1500, 500], false, [1000])
    try {
      const stale = owner.capture()
      const rejected = expect(stale).rejects.toMatchObject({ code: 'revoked' })
      await vi.advanceTimersByTimeAsync(1600)
      // The owner accepted v7 before its execution deadline; its result has not
      // reached the frontend. Capture v8 must not consume that result.
      owner.edit('edited document v8\n', 8)
      const fresh = owner.capture()
      await vi.advanceTimersByTimeAsync(0)
      expect(owner.requests.map((input) => input.version)).toEqual([7])
      await vi.advanceTimersByTimeAsync(900)
      await rejected
      expect(owner.requests.map((input) => input.version)).toEqual([7, 8])
      expect(owner.trace.filter((event) => event.phase === 'dispatch').at(-1)).toEqual({
        phase: 'dispatch',
        id: 'render_2',
        target: 'export',
        at: 2500,
      })
      await vi.advanceTimersByTimeAsync(500)
      const captured = await fresh
      expect(captured.warnings).toEqual([])
      expect(captured.presentations[0]!.request.version).toBe(8)
      expect(captured.presentations[0]!.request.source).toBe('edited document v8\n')
      expect(captured.presentations.flatMap((batch) => batch.result.fragments)[0]!.content).toEqual(
        { type: 'text', text: 'rendered v8: edited document v8\n' },
      )
      expect(owner.stop).not.toHaveBeenCalled()
      expect(owner.revoked).not.toHaveBeenCalled()
    } finally {
      owner.dispose()
    }
  })

  it('removes expired queued export before the delayed editor result can dispatch it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
    vi.setSystemTime(0)
    const owner = isolationOwner([1500], false, [9500])
    try {
      const editor = owner.render(request('screen'))
      const output = owner.capture()
      await vi.advanceTimersByTimeAsync(9999)
      expect(owner.trace.filter((event) => event.phase === 'dispatch')).toHaveLength(1)
      expect(owner.trace.filter((event) => event.phase === 'enqueue')).toHaveLength(2)
      expect(owner.trace.filter((event) => event.phase === 'result')).toEqual([
        { phase: 'result', id: 'render_1', at: 1500, aborted: false },
      ])
      await vi.advanceTimersByTimeAsync(1)
      const captured = await output
      expect(captured.presentations.flatMap((batch) => batch.result.fragments)).toEqual([])
      expect(owner.trace.filter((event) => event.phase === 'cancel')).toEqual([])
      await vi.advanceTimersByTimeAsync(1000)
      await expect(editor).resolves.toEqual(result(request('screen')))
      expect(captured.warnings.some((warning) => warning.code === 'presentation-timeout')).toBe(
        true,
      )
      expect(owner.trace.filter((event) => event.phase === 'deliver')).toEqual([
        { phase: 'deliver', id: 'render_1', at: 11000 },
      ])
      expect(owner.trace.filter((event) => event.phase === 'dispatch')).toEqual([
        { phase: 'dispatch', id: 'render_1', target: 'screen', at: 0 },
      ])
      expect(owner.stop).not.toHaveBeenCalled()
      expect(owner.revoked).not.toHaveBeenCalled()
    } finally {
      owner.dispose()
    }
  })
})

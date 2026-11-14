import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectOutputPresentations, type OutputPresentationOptions } from './output-presentations'

afterEach(() => vi.useRealTimers())
const renderer = { pluginId: 'independent.index', id: 'references', contexts: ['text'] as const }
function fixture() {
  const abort = new AbortController()
  const render = vi.fn<OutputPresentationOptions['render']>(async () => ({
    complete: false,
    fragments: [],
    pending: true,
  }))
  const options: OutputPresentationOptions = {
    source: 'A reference\n',
    sourceOffset: 0,
    documentId: 'frozen',
    version: 3,
    fromLine: 1,
    selection: { anchor: 0, head: 0 },
    signal: abort.signal,
    assertCurrent() {},
    renderers: () => [renderer],
    render,
  }
  return { options, render, abort }
}
describe('explicit per-document preparation readiness', () => {
  it('waits for the first stable-version result and does not retain a temporary warning', async () => {
    vi.useFakeTimers()
    const { options, render } = fixture()
    render.mockResolvedValueOnce({ complete: false, fragments: [], pending: true })
    render.mockResolvedValue({ complete: true, fragments: [] })
    let settled = false
    const output = collectOutputPresentations(options).then((value) => {
      settled = true
      return value
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(250)
    const result = await output
    expect(render).toHaveBeenCalledTimes(2)
    expect(result.warnings).toEqual([])
    expect(result.presentations[0]?.result.complete).toBe(true)
  })
  it('does not retry permanent incomplete output from existing plugins', async () => {
    const { options, render } = fixture()
    render.mockResolvedValue({ complete: false, fragments: [] })
    const output = await collectOutputPresentations(options)
    expect(render).toHaveBeenCalledTimes(1)
    expect(output.warnings.some((w) => w.code === 'presentation-incomplete')).toBe(true)
  })
  it('bounds pending retries by the original absolute preparation deadline', async () => {
    vi.useFakeTimers()
    const { options, render } = fixture()
    const output = collectOutputPresentations(options)
    await vi.advanceTimersByTimeAsync(10_001)
    const result = await output
    expect(render.mock.calls.length).toBeGreaterThan(1)
    expect(render.mock.calls.length).toBeLessThanOrEqual(40)
    expect(result.warnings.some((w) => w.code === 'presentation-timeout')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels preparation between attempts without dispatching another request', async () => {
    vi.useFakeTimers()
    const { options, render, abort } = fixture()
    const output = collectOutputPresentations(options)
    const outcome = output.then(
      () => undefined,
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(0)
    abort.abort()
    expect(await outcome).toMatchObject({ code: 'aborted' })
    await vi.advanceTimersByTimeAsync(300)
    expect(render).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects a changed capture before another pending attempt', async () => {
    vi.useFakeTimers()
    const { options, render } = fixture()
    let current = true
    const output = collectOutputPresentations({
      ...options,
      assertCurrent() {
        if (!current) throw Error('capture changed')
      },
    })
    const outcome = output.then(
      () => undefined,
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(0)
    current = false
    await vi.advanceTimersByTimeAsync(250)
    expect(await outcome).toEqual(Error('capture changed'))
    expect(render).toHaveBeenCalledTimes(1)
  })
  it('does not dispatch again after the provider is disabled while preparing', async () => {
    vi.useFakeTimers()
    const { options, render } = fixture()
    let enabled = true
    const output = collectOutputPresentations({
      ...options,
      renderers: () => (enabled ? [renderer] : []),
    })
    const outcome = output.then(
      () => undefined,
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(0)
    enabled = false
    await vi.advanceTimersByTimeAsync(250)
    expect(await outcome).toMatchObject({ code: 'revoked' })
    expect(render).toHaveBeenCalledTimes(1)
  })
  it('does not reuse preparation after disable and re-enable of the same renderer ID', async () => {
    vi.useFakeTimers()
    const { options, render } = fixture()
    let generation = 1
    const output = collectOutputPresentations({ ...options, rendererGeneration: () => generation })
    const outcome = output.then(
      () => undefined,
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(0)
    generation = 2
    render.mockResolvedValue({ complete: true, fragments: [] })
    await vi.advanceTimersByTimeAsync(250)
    expect(await outcome).toMatchObject({ code: 'revoked' })
    expect(render).toHaveBeenCalledTimes(1)
  })
  it('revokes earlier completed windows when the provider changes during a later window', async () => {
    const { options } = fixture()
    let generation = 1,
      calls = 0
    const output = collectOutputPresentations({
      ...options,
      source: 'A\n\n'.repeat(160),
      rendererGeneration: () => generation,
      async render(_p, _r, request) {
        if (++calls > 1) {
          generation++
          return { complete: true, fragments: [] }
        }
        return {
          complete: true,
          fragments: [
            {
              from: request.from,
              to: request.from + 1,
              layout: 'inline',
              content: { type: 'text', text: 'old-instance' },
              accessibleText: 'old-instance',
            },
          ],
        }
      },
    })
    await expect(output).rejects.toMatchObject({ code: 'revoked' })
    expect(calls).toBeGreaterThan(1)
  })
  it('revokes a capture if a new provider joins while a later window is preparing', async () => {
    const { options } = fixture()
    let added = false,
      calls = 0
    const output = collectOutputPresentations({
      ...options,
      source: 'A\n\n'.repeat(160),
      rendererGeneration: () => 1,
      renderers: () => (added ? [renderer, { ...renderer, pluginId: 'new-provider' }] : [renderer]),
      async render() {
        if (++calls > 1) added = true
        return { complete: true, fragments: [] }
      },
    })
    await expect(output).rejects.toMatchObject({ code: 'revoked' })
  })
  it('never accepts a provider added and removed between the initial and final sets', async () => {
    const { options } = fixture()
    let added = false,
      firstCalls = 0,
      addedCalls = 0
    const output = collectOutputPresentations({
      ...options,
      source: 'A\n\n'.repeat(350),
      rendererGeneration: () => 1,
      renderers: () =>
        added ? [renderer, { ...renderer, pluginId: 'temporary-provider' }] : [renderer],
      async render(id, _r, request) {
        if (id === renderer.pluginId) {
          if (++firstCalls === 1) added = true
          else if (firstCalls === 3) added = false
          return { complete: true, fragments: [] }
        }
        addedCalls++
        return {
          complete: true,
          fragments: [
            {
              from: request.from,
              to: request.from + 1,
              layout: 'inline',
              content: { type: 'text', text: 'temporary' },
              accessibleText: 'temporary',
            },
          ],
        }
      },
    })
    await expect(output).rejects.toMatchObject({ code: 'revoked' })
    expect(addedCalls).toBe(0)
  })
  it('retries only the pending provider, retaining other completed providers', async () => {
    vi.useFakeTimers()
    const { options } = fixture()
    const counts = new Map<string, number>()
    const output = collectOutputPresentations({
      ...options,
      renderers: () => [renderer, { ...renderer, pluginId: 'independent.complete' }],
      async render(pluginId) {
        const n = (counts.get(pluginId) ?? 0) + 1
        counts.set(pluginId, n)
        return pluginId === renderer.pluginId && n < 3
          ? { complete: false, fragments: [], pending: true as const }
          : { complete: true, fragments: [] }
      },
    })
    await vi.advanceTimersByTimeAsync(500)
    expect((await output).warnings).toEqual([])
    expect(counts.get(renderer.pluginId)).toBe(3)
    expect(counts.get('independent.complete')).toBe(1)
  })
})

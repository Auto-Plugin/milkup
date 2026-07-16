import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocumentLoadingVisibilityController } from './document-loading-visibility'

describe('document loading visibility', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not reveal loading UI when an open finishes inside the delay', () => {
    const onChange = vi.fn()
    const controller = createDocumentLoadingVisibilityController({ delayMs: 150, onChange })

    controller.update({ phase: 'opening' })
    vi.advanceTimersByTime(100)
    controller.update({ phase: 'ready' })
    vi.advanceTimersByTime(100)

    expect(controller.visible).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reveals loading UI after the delay and keeps it through indexing', () => {
    const onChange = vi.fn()
    const controller = createDocumentLoadingVisibilityController({ delayMs: 150, onChange })

    controller.update({ phase: 'opening' })
    vi.advanceTimersByTime(150)
    controller.update({ phase: 'indexing' })

    expect(controller.visible).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)

    controller.update({ phase: 'ready' })
    expect(controller.visible).toBe(false)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('reveals closing and failed states immediately', () => {
    const controller = createDocumentLoadingVisibilityController({
      onChange: () => undefined,
    })

    controller.update({ phase: 'closing' })
    expect(controller.visible).toBe(true)

    controller.update({ phase: 'ready' })
    expect(controller.visible).toBe(false)

    controller.update({ phase: 'failed', message: 'nope' })
    expect(controller.visible).toBe(true)
  })

  it('can reveal startup loading without waiting for the delay', () => {
    const onChange = vi.fn()
    const controller = createDocumentLoadingVisibilityController({ delayMs: 150, onChange })

    controller.update({ phase: 'opening' })
    controller.reveal()

    expect(controller.visible).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(150)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

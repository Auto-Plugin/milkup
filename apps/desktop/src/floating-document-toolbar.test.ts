// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FloatingDocumentToolbar,
  placeFloatingToolbar,
  type FloatingDocumentToolbarHost,
} from './floating-document-toolbar'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('floating document toolbar geometry', () => {
  const boundary = { left: 100, top: 50, right: 500, bottom: 350 }
  const size = { width: 220, height: 36 }

  it('uses the visible anchor, flips below at the top, and shifts inside the right edge', () => {
    expect(
      placeFloatingToolbar({ left: 420, right: 440, top: 60, bottom: 80 }, boundary, size),
    ).toEqual({ left: 280, top: 88 })
    expect(
      placeFloatingToolbar({ left: 200, right: 220, top: 310, bottom: 330 }, boundary, size),
    ).toEqual({ left: 200, top: 266 })
  })

  it('stays within a short viewport when neither side can fit', () => {
    const placed = placeFloatingToolbar(
      { left: 150, right: 151, top: 65, bottom: 85 },
      { left: 100, top: 50, right: 400, bottom: 100 },
      size,
    )
    expect(placed.left).toBeGreaterThanOrEqual(100)
    expect(placed.left + size.width).toBeLessThanOrEqual(400)
    expect(placed.top).toBeGreaterThanOrEqual(50)
    expect(placed.top + size.height).toBeLessThanOrEqual(100)
  })
})

function fixture() {
  document.body.innerHTML =
    '<main><div id="editor"></div><div id="slot"><span>One</span><span>Two</span></div></main>'
  const slot = document.querySelector<HTMLElement>('#slot')!
  const editor = document.querySelector<HTMLElement>('#editor')!
  let geometry: ReturnType<FloatingDocumentToolbarHost['geometry']> = {
    documentId: 'doc-a',
    anchor: { left: 220, top: 240, right: 225, bottom: 264 },
    boundary: { left: 100, top: 50, right: 700, bottom: 500 },
  }
  let documentId = 'doc-a'
  const getGeometry = vi.fn(() => geometry)
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id)
  })
  const disconnect = vi.fn()
  const observe = vi.fn()
  let resize!: ResizeObserverCallback
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback
      }
      observe = observe
      disconnect = disconnect
    },
  )
  vi.spyOn(slot, 'getBoundingClientRect').mockImplementation(() => ({
    x: 220,
    y: 196,
    left: 220,
    right: 620,
    top: 196,
    bottom: 232,
    width: 400,
    height: 36,
    toJSON: () => ({}),
  }))
  const toolbar = new FloatingDocumentToolbar(
    slot,
    { geometry: getGeometry, observe: [editor] },
    () => documentId,
  )
  return {
    toolbar,
    slot,
    editor,
    getGeometry,
    disconnect,
    observe,
    frames,
    geometry: () => geometry!,
    setGeometry: (next: typeof geometry) => {
      geometry = next
    },
    setDocument: (id: string) => {
      documentId = id
    },
    resize: () => resize([], {} as ResizeObserver),
    frame: () => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((callback) => callback(0))
    },
  }
}

describe('floating document toolbar lifecycle', () => {
  it('follows host geometry on scroll and resize without rerendering plugin output', () => {
    const f = fixture()
    f.toolbar.refresh()
    expect(f.slot.hidden).toBe(false)
    expect(f.slot.style.top).toBe('196px')
    expect(f.observe).toHaveBeenCalledWith(f.editor)
    const content = f.slot.firstChild
    f.setGeometry({ ...f.geometry(), anchor: { left: 650, right: 650, top: 140, bottom: 164 } })
    f.editor.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    f.resize()
    expect(f.frames.size).toBe(1)
    f.frame()
    expect(f.slot.style.top).toBe('96px')
    expect(f.slot.style.left).toBe('292px')
    expect(f.slot.firstChild).toBe(content)
    f.toolbar.dispose()
  })

  it('hides detached/offscreen/wrong-document anchors and can recover on a later scroll', () => {
    const f = fixture()
    f.toolbar.refresh()
    const valid = f.geometry()
    f.setGeometry({ ...valid, anchor: { left: 150, right: 151, top: -40, bottom: -20 } })
    f.editor.dispatchEvent(new Event('scroll'))
    f.frame()
    expect(f.slot.hidden).toBe(true)
    f.setGeometry(valid)
    f.editor.dispatchEvent(new Event('scroll'))
    f.frame()
    expect(f.slot.hidden).toBe(false)
    f.setDocument('doc-b')
    f.toolbar.refresh()
    expect(f.slot.hidden).toBe(true)
    f.setDocument('doc-a')
    f.setGeometry(undefined)
    f.toolbar.refresh()
    expect(f.slot.hidden).toBe(true)
    f.toolbar.dispose()
  })

  it('keeps other contributions visible, then disconnects the empty slot immediately', () => {
    const f = fixture()
    f.toolbar.refresh()
    ;(f.slot.children[0] as HTMLElement).hidden = true
    f.toolbar.refresh()
    expect(f.slot.hidden).toBe(false)
    ;(f.slot.children[1] as HTMLElement).hidden = true
    f.editor.dispatchEvent(new Event('scroll'))
    f.toolbar.refresh()
    expect(f.slot.hidden).toBe(true)
    expect(f.disconnect).toHaveBeenCalledOnce()
    expect(f.frames.size).toBe(0)
    const reads = f.getGeometry.mock.calls.length
    f.editor.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    f.resize()
    f.frame()
    expect(f.getGeometry).toHaveBeenCalledTimes(reads)
    f.toolbar.dispose()
  })

  it('ignores queued observer callbacks, events, and refresh after disposal', () => {
    const f = fixture()
    f.toolbar.refresh()
    f.resize()
    const queued = [...f.frames.values()][0]!
    f.toolbar.dispose()
    const reads = f.getGeometry.mock.calls.length
    queued(0)
    f.resize()
    f.toolbar.refresh()
    f.editor.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    expect(f.slot.hidden).toBe(true)
    expect(f.frames.size).toBe(0)
    expect(f.getGeometry).toHaveBeenCalledTimes(reads)
    expect(f.disconnect).toHaveBeenCalledOnce()
  })

  it('reveals a focused command by scrolling only the overlay', () => {
    const f = fixture()
    f.toolbar.refresh()
    const button = document.createElement('button')
    f.slot.append(button)
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 650, right: 700 } as DOMRect)
    f.editor.scrollTop = 180
    f.toolbar.reveal(button)
    expect(f.slot.scrollLeft).toBe(84)
    expect(f.editor.scrollTop).toBe(180)
    f.toolbar.dispose()
  })
})

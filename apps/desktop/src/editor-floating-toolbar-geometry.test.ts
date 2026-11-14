// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { readEditorFloatingToolbarGeometry } from './editor-floating-toolbar-geometry'

function fixture() {
  document.body.innerHTML =
    '<main><div class="editor"><div class="cursors"><div class="milkup-cursor" data-position="20"></div></div><div class="selections"></div></div></main>'
  const editorRoot = document.querySelector('main')!
  const dom = document.querySelector<HTMLElement>('.editor')!
  const cursorLayerDOM = document.querySelector<HTMLElement>('.cursors')!
  const selectionLayerDOM = document.querySelector<HTMLElement>('.selections')!
  const cursor = document.querySelector<HTMLElement>('.milkup-cursor')!
  const rect = (element: Element, left: number, top: number, width: number, height: number) =>
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    })
  rect(editorRoot, 20, 30, 800, 500)
  rect(dom, 40, 50, 760, 450)
  const cursorRect = rect(cursor, 70, 120, 2, 24)
  return {
    editorRoot,
    dom,
    cursorLayerDOM,
    selectionLayerDOM,
    cursor,
    rect,
    cursorRect,
    options: {
      editorRoot,
      view: { dom, cursorLayerDOM, selectionLayerDOM },
      documentId: 'doc-a',
      selectionHead: 20,
      visible: true,
    },
  }
}

describe('editor floating toolbar geometry bridge', () => {
  it('uses the current rendered cursor and clips the editor viewport without reading source text', () => {
    const f = fixture()
    expect(readEditorFloatingToolbarGeometry(f.options)).toEqual({
      documentId: 'doc-a',
      anchor: { left: 70, right: 72, top: 120, bottom: 144 },
      boundary: { left: 40, right: 800, top: 50, bottom: 500 },
    })
    f.cursor.style.opacity = '0'
    expect(readEditorFloatingToolbarGeometry(f.options)).toBeDefined()
  })

  it('rejects stale cursor positions, offscreen anchors, detached views and unavailable editors', () => {
    const f = fixture()
    expect(readEditorFloatingToolbarGeometry({ ...f.options, selectionHead: 21 })).toBeUndefined()
    expect(readEditorFloatingToolbarGeometry({ ...f.options, visible: false })).toBeUndefined()
    f.cursor.style.visibility = 'hidden'
    expect(readEditorFloatingToolbarGeometry(f.options)).toBeUndefined()
    f.cursor.style.visibility = ''
    f.cursorRect.mockReturnValue({ left: 70, right: 72, top: 700, bottom: 724 } as DOMRect)
    expect(readEditorFloatingToolbarGeometry(f.options)).toBeUndefined()
    f.dom.remove()
    expect(readEditorFloatingToolbarGeometry(f.options)).toBeUndefined()
  })

  it('anchors a range with an offscreen head to a visible current selection segment', () => {
    const f = fixture()
    f.cursorRect.mockReturnValue({ left: 70, right: 72, top: 700, bottom: 724 } as DOMRect)
    for (const [from, to, y] of [
      [2, 8, 100],
      [8, 15, 160],
      [99, 100, 180],
    ]) {
      const segment = document.createElement('div')
      segment.className = 'milkup-selection'
      segment.dataset.from = String(from)
      segment.dataset.to = String(to)
      f.selectionLayerDOM.append(segment)
      f.rect(segment, 70, y!, 200, 24)
    }
    expect(readEditorFloatingToolbarGeometry({ ...f.options, selectionAnchor: 2 })?.anchor).toEqual(
      { left: 70, right: 270, top: 160, bottom: 184 },
    )
    expect(
      readEditorFloatingToolbarGeometry({ ...f.options, selectionHead: 2, selectionAnchor: 20 })
        ?.anchor,
    ).toEqual({ left: 70, right: 270, top: 100, bottom: 124 })
  })
})

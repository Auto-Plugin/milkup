import type { FloatingDocumentToolbarHost, FloatingToolbarRect } from './floating-document-toolbar'

export interface EditorFloatingToolbarGeometryOptions {
  readonly editorRoot: HTMLElement
  readonly view:
    | {
        readonly dom: HTMLElement
        readonly cursorLayerDOM: HTMLElement
        readonly selectionLayerDOM: HTMLElement
      }
    | undefined
  readonly documentId: string
  readonly selectionHead: number
  readonly selectionAnchor?: number | undefined
  readonly visible: boolean
}

/** The source and windowed views already map their own selection into DOM
 * overlays. Reuse those measured anchors; never estimate from line height,
 * query a plugin's markup, or read the entire document to place an overlay. */
export function readEditorFloatingToolbarGeometry(
  options: EditorFloatingToolbarGeometryOptions,
): ReturnType<FloatingDocumentToolbarHost['geometry']> {
  const { editorRoot, view, documentId, selectionHead, visible } = options
  if (
    !visible ||
    !view ||
    !editorRoot.isConnected ||
    !editorRoot.contains(view.dom) ||
    !Number.isSafeInteger(selectionHead) ||
    view.dom.closest('[hidden], [inert]')
  )
    return undefined
  const window = editorRoot.ownerDocument.defaultView
  if (!window) return undefined
  const visual = window.visualViewport
  const viewport = {
    left: visual?.offsetLeft ?? 0,
    top: visual?.offsetTop ?? 0,
    right: (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth),
    bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight),
  }
  const bounds = view.dom.getBoundingClientRect()
  // Exclude the editor's borders and native scrollbars from usable space.
  const editorBounds = {
    left: bounds.left + view.dom.clientLeft,
    top: bounds.top + view.dom.clientTop,
    right:
      view.dom.clientWidth > 0
        ? bounds.left + view.dom.clientLeft + view.dom.clientWidth
        : bounds.right,
    bottom:
      view.dom.clientHeight > 0
        ? bounds.top + view.dom.clientTop + view.dom.clientHeight
        : bounds.bottom,
  }
  const boundary = clipped(clipped(editorBounds, editorRoot.getBoundingClientRect()), viewport)
  if (!usable(boundary)) return undefined

  const visibleRect = (element: HTMLElement): FloatingToolbarRect | undefined => {
    const style = window.getComputedStyle(element)
    // Opacity is intentionally ignored: the caret blink must not blink the toolbar.
    if (element.closest('[hidden]') || style.visibility === 'hidden' || style.display === 'none')
      return undefined
    const rect = clipped(element.getBoundingClientRect(), boundary)
    return usable(rect) ? rect : undefined
  }
  const cursor = Array.from(
    view.cursorLayerDOM.querySelectorAll<HTMLElement>('.milkup-cursor'),
  ).find((node) => node.dataset.position === String(selectionHead))
  const caret = cursor && visibleRect(cursor)
  if (caret) return { documentId, anchor: caret, boundary }

  // A selection can extend past the viewport while some selected lines remain
  // visible. Use the visible segment nearest its head, including reversed ranges.
  const selectionAnchor = options.selectionAnchor ?? selectionHead
  if (!Number.isSafeInteger(selectionAnchor) || selectionAnchor === selectionHead) return undefined
  const from = Math.min(selectionHead, selectionAnchor)
  const to = Math.max(selectionHead, selectionAnchor)
  const forwards = selectionHead > selectionAnchor
  const segments = Array.from(
    view.selectionLayerDOM.querySelectorAll<HTMLElement>('.milkup-selection'),
  )
    .flatMap((element) => {
      const start = Number(element.dataset.from),
        end = Number(element.dataset.to)
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < from ||
        end > to ||
        end <= start
      )
        return []
      const rect = visibleRect(element)
      return rect ? [{ rect, start, end }] : []
    })
    .sort((a, b) =>
      forwards
        ? b.end - a.end || b.rect.bottom - a.rect.bottom
        : a.start - b.start || a.rect.top - b.rect.top,
    )
  const anchor = segments[0]?.rect
  return anchor ? { documentId, anchor, boundary } : undefined
}

function clipped(a: FloatingToolbarRect, b: FloatingToolbarRect): FloatingToolbarRect {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  }
}

function usable(rect: FloatingToolbarRect): boolean {
  return (
    Object.values(rect).every(Number.isFinite) && rect.right > rect.left && rect.bottom > rect.top
  )
}

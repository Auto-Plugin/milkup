/** Geometry is supplied by the editor host, never inferred from a plugin ID. */
export interface FloatingToolbarRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface FloatingDocumentToolbarHost {
  geometry():
    | {
        readonly documentId: string
        readonly anchor: FloatingToolbarRect
        readonly boundary: FloatingToolbarRect
      }
    | undefined
  readonly observe?: readonly Element[]
  /** Restore the editor's own selection/focus model after a keyboard command. */
  restoreEditorFocus?(): void
}

export function placeFloatingToolbar(
  anchor: FloatingToolbarRect,
  boundary: FloatingToolbarRect,
  size: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number } {
  const gap = 8
  const above = anchor.top - gap - size.height
  const below = anchor.bottom + gap
  const top =
    above >= boundary.top
      ? above
      : below + size.height <= boundary.bottom
        ? below
        : anchor.top - boundary.top > boundary.bottom - anchor.bottom
          ? above
          : below
  return {
    left: clamp(anchor.left, boundary.left, boundary.right - size.width),
    top: clamp(top, boundary.top, boundary.bottom - size.height),
  }
}

/** One overlay contains every contribution; no individual plugin owns positioning. */
export class FloatingDocumentToolbar {
  private frame: number | undefined
  private observer: ResizeObserver | undefined
  private listening = false
  private enabled = true
  private disposed = false

  constructor(
    private readonly slot: HTMLElement,
    private readonly host: FloatingDocumentToolbarHost,
    private readonly documentId: () => string,
  ) {
    slot.classList.add('floating-document-toolbar')
    slot.setAttribute('role', 'toolbar')
    slot.setAttribute('aria-label', '文档上下文操作')
    slot.hidden = true
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.refresh()
  }

  refresh(): void {
    if (this.disposed) return
    const hasContent = Array.from(this.slot.children).some(
      (child) => child instanceof HTMLElement && !child.hidden,
    )
    if (!this.enabled || !hasContent) {
      this.slot.hidden = true
      this.stopListening()
      return
    }
    this.startListening()
    this.position()
  }

  /** Scroll only the overlay. scrollIntoView can move the editor or outer page. */
  reveal(control: HTMLElement): void {
    if (this.slot.hidden || !this.slot.contains(control)) return
    const box = control.getBoundingClientRect()
    const viewport = this.slot.getBoundingClientRect()
    const padding = 4
    if (box.left < viewport.left + padding)
      this.slot.scrollLeft += box.left - viewport.left - padding
    else if (box.right > viewport.right - padding)
      this.slot.scrollLeft += box.right - viewport.right + padding
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.slot.hidden = true
    this.stopListening()
  }

  private readonly schedule = (): void => {
    if (this.disposed || !this.listening || this.frame !== undefined) return
    this.frame = this.slot.ownerDocument.defaultView?.requestAnimationFrame(() => {
      this.frame = undefined
      if (!this.disposed && this.listening) this.position()
    })
  }

  private position(): void {
    const window = this.slot.ownerDocument.defaultView
    const geometry = this.host.geometry()
    if (!window || !geometry || geometry.documentId !== this.documentId()) {
      this.slot.hidden = true
      return
    }
    const visual = window.visualViewport
    const left = visual?.offsetLeft ?? 0
    const top = visual?.offsetTop ?? 0
    const viewport = {
      left,
      top,
      right: left + (visual?.width ?? window.innerWidth),
      bottom: top + (visual?.height ?? window.innerHeight),
    }
    const boundary = intersect(geometry.boundary, viewport)
    const anchor = intersect(geometry.anchor, boundary)
    if (!validRect(boundary) || !validRect(anchor, true)) {
      this.slot.hidden = true
      return
    }
    const inset = Math.min(
      8,
      (boundary.right - boundary.left) / 4,
      (boundary.bottom - boundary.top) / 4,
    )
    const available = {
      left: boundary.left + inset,
      right: boundary.right - inset,
      top: boundary.top + inset,
      bottom: boundary.bottom - inset,
    }
    this.slot.style.maxWidth = `${available.right - available.left}px`
    this.slot.style.maxHeight = `${available.bottom - available.top}px`
    // Unhide only for synchronous measurement/placement; no stale-position paint.
    this.slot.hidden = false
    const size = this.slot.getBoundingClientRect()
    const placed = placeFloatingToolbar(anchor, available, size)
    this.slot.style.left = `${placed.left}px`
    this.slot.style.top = `${placed.top}px`
  }

  private startListening(): void {
    if (this.listening) return
    this.listening = true
    const document = this.slot.ownerDocument
    const window = document.defaultView
    document.addEventListener('scroll', this.schedule, true)
    document.addEventListener('selectionchange', this.schedule)
    window?.addEventListener('resize', this.schedule)
    window?.visualViewport?.addEventListener('resize', this.schedule)
    window?.visualViewport?.addEventListener('scroll', this.schedule)
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.schedule)
      this.observer.observe(this.slot)
      for (const target of this.host.observe ?? []) this.observer.observe(target)
    }
  }

  private stopListening(): void {
    const document = this.slot.ownerDocument
    const window = document.defaultView
    if (this.frame !== undefined) window?.cancelAnimationFrame(this.frame)
    this.frame = undefined
    this.observer?.disconnect()
    this.observer = undefined
    document.removeEventListener('scroll', this.schedule, true)
    document.removeEventListener('selectionchange', this.schedule)
    window?.removeEventListener('resize', this.schedule)
    window?.visualViewport?.removeEventListener('resize', this.schedule)
    window?.visualViewport?.removeEventListener('scroll', this.schedule)
    this.listening = false
  }
}

function intersect(a: FloatingToolbarRect, b: FloatingToolbarRect): FloatingToolbarRect {
  return {
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
    top: Math.max(a.top, b.top),
    bottom: Math.min(a.bottom, b.bottom),
  }
}

function validRect(rect: FloatingToolbarRect, caret = false): boolean {
  return (
    Object.values(rect).every(Number.isFinite) &&
    (caret ? rect.right >= rect.left : rect.right > rect.left) &&
    rect.bottom > rect.top
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.max(min, max), value))
}

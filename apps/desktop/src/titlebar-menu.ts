/** Visual menu lifetime only. Logical focus and document transitions stay with the shell. */
export class TitlebarMenu {
  private desiredOpen = false
  private generation = 0
  private animations: Animation[] = []
  private timer: number | undefined
  private disposed = false
  private readonly surface: HTMLElement
  private readonly reducedMotion: MediaQueryList
  private readonly resizeObserver: ResizeObserver

  constructor(
    private readonly menu: HTMLElement,
    private readonly titlebar: HTMLElement,
  ) {
    this.surface = menu.querySelector<HTMLElement>('.app-menu-surface')!
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.reducedMotion.addEventListener('change', this.onMotionChange)
    this.resizeObserver = new ResizeObserver(this.placeBelowTitlebar)
    this.resizeObserver.observe(titlebar)
    window.addEventListener('resize', this.placeBelowTitlebar)
    this.placeBelowTitlebar()
    this.menu.dataset.phase = 'closed'
    this.menu.setAttribute('aria-hidden', 'true')
    this.surface.inert = true
  }

  get phase(): string {
    return this.menu.dataset.phase ?? 'closed'
  }

  setOpen(open: boolean): void {
    if (this.disposed || this.desiredOpen === open) return
    this.desiredOpen = open
    const opacity = this.menu.hidden ? '0' : getComputedStyle(this.menu).opacity
    const transform = this.menu.hidden
      ? 'translateY(-8px)'
      : getComputedStyle(this.surface).transform
    const generation = ++this.generation
    this.cancelAnimation()
    this.menu.hidden = false
    this.menu.setAttribute('aria-hidden', String(!open))
    // Keep the closing overlay hit-testable to prevent pointer click-through, but
    // remove its controls immediately. No delayed focus callback can steal focus
    // from a file/save confirmation or a keyboard command opened while closing.
    this.surface.inert = !open
    this.menu.dataset.phase = open ? 'opening' : 'closing'
    this.placeBelowTitlebar()
    if (this.reducedMotion.matches || typeof this.menu.animate !== 'function') {
      this.settle(generation)
      return
    }
    const options: KeyframeAnimationOptions = {
      duration: 180,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      fill: 'both',
    }
    this.animations = [
      this.menu.animate([{ opacity }, { opacity: open ? '1' : '0' }], options),
      this.surface.animate(
        [{ transform }, { transform: open ? 'translateY(0)' : 'translateY(-8px)' }],
        options,
      ),
    ]
    // Completion is generation-checked; a cancelled/late exit cannot hide a
    // reopened menu. The bounded fallback also handles a suspended animation.
    this.timer = window.setTimeout(() => this.settle(generation), 240)
    void Promise.all(this.animations.map((animation) => animation.finished)).then(
      () => this.settle(generation),
      () => this.settle(generation),
    )
  }

  dispose(): void {
    this.disposed = true
    ++this.generation
    this.cancelAnimation()
    this.resizeObserver.disconnect()
    this.reducedMotion.removeEventListener('change', this.onMotionChange)
    window.removeEventListener('resize', this.placeBelowTitlebar)
  }

  private readonly placeBelowTitlebar = (): void => {
    this.menu.style.top = `${Math.max(0, this.titlebar.getBoundingClientRect().bottom)}px`
  }

  private readonly onMotionChange = (): void => {
    if (this.reducedMotion.matches) this.settle(this.generation)
  }

  private settle(generation: number): void {
    if (this.disposed || generation !== this.generation) return
    // Invalidate pending promise completions before cancelling their effects.
    ++this.generation
    this.cancelAnimation()
    this.menu.hidden = !this.desiredOpen
    this.menu.dataset.phase = this.desiredOpen ? 'open' : 'closed'
  }

  private cancelAnimation(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer)
    this.timer = undefined
    for (const animation of this.animations) animation.cancel()
    this.animations = []
  }
}

/** Never initiate a native drag from a control or an inert titlebar. */
export function isTitlebarDragGesture(
  event: Pick<PointerEvent, 'target' | 'button' | 'isPrimary' | 'defaultPrevented'>,
): boolean {
  const target = event.target
  return (
    event.button === 0 &&
    event.isPrimary &&
    !event.defaultPrevented &&
    target instanceof Element &&
    !!target.closest('[data-window-drag-region]') &&
    !target.closest(
      'button, input, textarea, select, summary, a, [role="button"], [contenteditable], [inert], .window-controls, [data-plugin-slot="document-toolbar"]',
    )
  )
}

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TitlebarMenu, isTitlebarDragGesture } from './titlebar-menu'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture(reduced = false, animate = true) {
  vi.useFakeTimers()
  document.body.innerHTML =
    '<header data-window-drag-region><span>Title</span><button><svg></svg></button></header>' +
    '<section hidden><div class="app-menu-surface"><button>Action</button></div></section>'
  const titlebar = document.querySelector('header')!
  const menu = document.querySelector('section')!
  const surface = menu.firstElementChild as HTMLElement
  let bottom = 37
  vi.spyOn(titlebar, 'getBoundingClientRect').mockImplementation(() => ({ bottom }) as DOMRect)
  const motion = new EventTarget() as MediaQueryList & { matches: boolean }
  Object.defineProperty(motion, 'matches', { value: reduced, writable: true })
  vi.stubGlobal('matchMedia', () => motion)
  let resize!: () => void
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect = disconnect
    },
  )
  const animations: {
    finished: Promise<void>
    finish(): void
    cancel: ReturnType<typeof vi.fn>
  }[] = []
  const start = vi.fn(() => {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const animation = { finished, finish, cancel: vi.fn() }
    animations.push(animation)
    return animation as unknown as Animation
  })
  if (animate) {
    menu.animate = start
    surface.animate = start
  }
  const controller = new TitlebarMenu(menu, titlebar)
  return {
    menu,
    surface,
    titlebar,
    controller,
    animations,
    start,
    motion,
    disconnect,
    resize: (value: number) => {
      bottom = value
      resize()
    },
  }
}

describe('titlebar menu visual lifecycle', () => {
  it('measures actual titlebar geometry without covering its controls', () => {
    const f = fixture()
    expect(f.menu.style.top).toBe('37px')
    f.resize(46.25)
    expect(f.menu.style.top).toBe('46.25px')
    f.controller.dispose()
    expect(f.disconnect).toHaveBeenCalledOnce()
  })

  it('keeps the exit shield present but removes closing controls immediately', async () => {
    const f = fixture()
    f.controller.setOpen(true)
    f.animations.forEach((animation) => animation.finish())
    await vi.runAllTimersAsync()
    expect(f.controller.phase).toBe('open')
    expect(f.surface.inert).toBe(false)
    f.controller.setOpen(false)
    expect(f.menu.hidden).toBe(false)
    expect(f.menu.getAttribute('aria-hidden')).toBe('true')
    expect(f.surface.inert).toBe(true)
    expect(f.controller.phase).toBe('closing')
    await vi.advanceTimersByTimeAsync(240)
    expect(f.menu.hidden).toBe(true)
    expect(f.controller.phase).toBe('closed')
    f.controller.dispose()
  })

  it('ignores stale completion after close/open reversal and keeps repeated intent idempotent', async () => {
    const f = fixture()
    f.controller.setOpen(true)
    f.controller.setOpen(false)
    const old = f.animations.slice()
    f.controller.setOpen(true)
    f.controller.setOpen(true)
    expect(f.start).toHaveBeenCalledTimes(6)
    old.forEach((animation) => animation.finish())
    await Promise.resolve()
    await Promise.resolve()
    expect(f.menu.hidden).toBe(false)
    expect(f.controller.phase).toBe('opening')
    await vi.runAllTimersAsync()
    expect(f.controller.phase).toBe('open')
    expect(f.menu.hidden).toBe(false)
    f.controller.dispose()
  })

  it.each([true, false])(
    'settles without animation for reduced motion or missing API: %s',
    (reduced) => {
      const f = fixture(reduced, reduced)
      f.controller.setOpen(true)
      expect(f.controller.phase).toBe('open')
      f.controller.setOpen(false)
      expect(f.menu.hidden).toBe(true)
      expect(f.start).not.toHaveBeenCalled()
      f.controller.dispose()
    },
  )

  it('honors a reduced-motion preference change while closing', async () => {
    const f = fixture()
    f.controller.setOpen(true)
    f.controller.setOpen(false)
    f.motion.matches = true
    f.motion.dispatchEvent(new Event('change'))
    expect(f.menu.hidden).toBe(true)
    f.animations.forEach((animation) => animation.finish())
    await vi.runAllTimersAsync()
    expect(f.controller.phase).toBe('closed')
    f.controller.dispose()
  })

  it('disposal invalidates callbacks and clears scheduled work', async () => {
    const f = fixture()
    f.controller.setOpen(true)
    f.controller.dispose()
    f.animations.forEach((animation) => animation.finish())
    await vi.runAllTimersAsync()
    expect(vi.getTimerCount()).toBe(0)
    expect(f.controller.phase).toBe('opening')
  })
})

describe('native titlebar drag gesture boundary', () => {
  it('accepts only an uncancelled primary left gesture on non-interactive titlebar content', () => {
    const f = fixture()
    const event = (target: Element, overrides = {}) => ({
      target,
      button: 0,
      isPrimary: true,
      defaultPrevented: false,
      ...overrides,
    })
    const title = f.titlebar.querySelector('span')!
    expect(isTitlebarDragGesture(event(title))).toBe(true)
    expect(isTitlebarDragGesture(event(f.titlebar.querySelector('svg')!))).toBe(false)
    expect(isTitlebarDragGesture(event(f.surface))).toBe(false)
    for (const override of [{ button: 2 }, { isPrimary: false }, { defaultPrevented: true }])
      expect(isTitlebarDragGesture(event(title, override))).toBe(false)
    f.titlebar.setAttribute('inert', '')
    expect(isTitlebarDragGesture(event(title))).toBe(false)
    f.controller.dispose()
  })
})

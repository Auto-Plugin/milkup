// @vitest-environment jsdom

import type { PluginContributionIndex } from '@milkup/plugin'
import { describe, expect, it, vi } from 'vitest'

import { DesktopPluginUiController, type DesktopPluginUiRuntime } from './desktop-plugin-ui'

describe('DesktopPluginUiController', () => {
  it('mounts controlled slots and recreates document-scoped views on document changes', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    expect(
      document.querySelector('[data-plugin-ui="example:outline"] .plugin-ui-panel-body')
        ?.textContent,
    ).toBe('mount:doc-a')

    await controller.sync('doc-b')
    expect(phases).toEqual(['mount', 'dispose', 'mount'])
    expect(
      document.querySelector('[data-plugin-ui="example:outline"] .plugin-ui-panel-body')
        ?.textContent,
    ).toBe('mount:doc-b')
  })

  it('opens and closes modal views repeatedly and bridges declared commands', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="modal"></div></main>'
    const phases: string[] = []
    const runCommand = vi.fn()
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'dialog',
          title: 'Dialog',
          slot: 'modal',
          scope: 'app',
        },
      ],
      phases,
      runCommand,
      () => ({
        type: 'element',
        tag: 'button',
        text: 'Run',
        action: { command: 'example.run' },
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc-a')
    expect(document.querySelector('[data-plugin-ui]')).toBeNull()

    await controller.open('example', 'dialog')
    document.querySelector<HTMLElement>('[data-plugin-command]')?.click()
    expect(runCommand).toHaveBeenCalledWith('example.run', {})

    await controller.close('example', 'dialog')
    await controller.open('example', 'dialog')
    await controller.close('example', 'dialog')
    expect(phases).toEqual(['mount', 'focus', 'dispose', 'mount', 'focus', 'dispose'])
    expect(document.querySelector('[data-plugin-ui]')).toBeNull()
  })

  it('rerenders only the requested plugin view when invalidated', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
        {
          pluginId: 'other',
          id: 'notes',
          title: 'Notes',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    phases.length = 0
    await controller.invalidate('example', 'outline')

    expect(phases).toEqual(['update'])
  })

  it('passes fresh viewport state when an editor scroll update rerenders mounted UI', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    let activeLine = 1
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
      vi.fn(),
      (_phase, state) => String((state.viewport as { activeLine: number }).activeLine),
    )
    const controller = new DesktopPluginUiController(document.body, runtime, () => ({
      viewport: { fromLine: activeLine, toLine: activeLine + 20, activeLine },
    }))

    await controller.sync('doc-a')
    activeLine = 900
    await controller.updateViewport()

    expect(
      document.querySelector('[data-plugin-ui="example:outline"] .plugin-ui-panel-body')
        ?.textContent,
    ).toBe('900')
    expect(phases).toEqual(['mount', 'update'])
  })

  it('skips editor viewport updates for views that opt out', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'manual-panel',
          title: 'Manual panel',
          slot: 'sidebar-panel',
          scope: 'document',
          viewportUpdates: false,
        },
      ],
      phases,
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    await controller.updateViewport()

    expect(phases).toEqual(['mount'])
  })

  it('collapses sidebar panels to the bottom and exposes resizers only between expanded panels', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
        {
          pluginId: 'other',
          id: 'notes',
          title: 'Notes',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const slot = document.querySelector<HTMLElement>('[data-plugin-slot="sidebar-panel"]')!
    const outline = document.querySelector<HTMLElement>('[data-plugin-ui="example:outline"]')!
    const notes = document.querySelector<HTMLElement>('[data-plugin-ui="other:notes"]')!
    expect(Array.from(slot.children)).toEqual([outline, notes])
    expect(outline.querySelector<HTMLElement>('.plugin-ui-panel-resize')?.hidden).toBe(false)
    expect(notes.querySelector<HTMLElement>('.plugin-ui-panel-resize')?.hidden).toBe(true)

    outline.querySelector<HTMLButtonElement>('.plugin-ui-panel-toggle')!.click()

    expect(Array.from(slot.children)).toEqual([notes, outline])
    expect(outline.dataset.collapsed).toBe('true')
    expect(outline.querySelector<HTMLElement>('.plugin-ui-panel-body')?.hidden).toBe(true)
    expect(notes.querySelector<HTMLElement>('.plugin-ui-panel-resize')?.hidden).toBe(true)

    outline.querySelector<HTMLButtonElement>('.plugin-ui-panel-toggle')!.click()
    expect(Array.from(slot.children)).toEqual([outline, notes])
  })

  it('resizes adjacent expanded sidebar panels as a bounded pair', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
        {
          pluginId: 'other',
          id: 'notes',
          title: 'Notes',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc-a')
    const outline = document.querySelector<HTMLElement>('[data-plugin-ui="example:outline"]')!
    const notes = document.querySelector<HTMLElement>('[data-plugin-ui="other:notes"]')!
    outline.getBoundingClientRect = () => ({ height: 200 }) as DOMRect
    notes.getBoundingClientRect = () => ({ height: 200 }) as DOMRect

    outline
      .querySelector<HTMLElement>('.plugin-ui-panel-resize')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

    expect(outline.style.flex).toBe('0 0 216px')
    expect(notes.style.flex).toBe('0 0 184px')
  })

  it('keeps identical controlled output mounted and preserves internal scroll on changes', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    let label = 'One'
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
      vi.fn(),
      () => listOutput(label),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc-a')
    const originalList = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    originalList.scrollTop = 120

    await controller.invalidate('example', 'outline')
    expect(document.querySelector('.plugin-virtual-list')).toBe(originalList)

    label = 'Two'
    await controller.invalidate('example', 'outline')
    const nextList = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    expect(nextList).not.toBe(originalList)
    expect(nextList.scrollTop).toBe(120)
  })

  it('decorates a controlled host icon without relying on plugin-specific classes', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
      vi.fn(),
      () => ({
        type: 'element',
        tag: 'span',
        attributes: { 'data-host-icon': 'list-tree' },
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc-a')
    const icon = document.querySelector<HTMLElement>('[data-host-icon="list-tree"]')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.querySelector('svg.icon')).not.toBeNull()
  })

  it('projects a virtual outline slice into the full scroll height and follows its active item', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
      vi.fn(),
      () => virtualListOutput(100, 160, 1000, 124, true),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!

    expect(list.querySelector<HTMLElement>('.plugin-virtual-spacer-before')?.style.height).toBe(
      '2800px',
    )
    expect(list.querySelector<HTMLElement>('.plugin-virtual-spacer-after')?.style.height).toBe(
      '23520px',
    )
    expect(list.scrollTop).toBe(3346)
    clientHeightSpy.mockRestore()
  })

  it('requests a new buffered range when the outline is scrolled outside its rendered slice', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const renderStates: Readonly<Record<string, unknown>>[] = []
    const scrollPositions = new WeakMap<Element, number>()
    const scrollTopGetterSpy = vi
      .spyOn(Element.prototype, 'scrollTop', 'get')
      .mockImplementation(function (this: Element) {
        return scrollPositions.get(this) ?? 0
      })
    const scrollTopSetterSpy = vi
      .spyOn(Element.prototype, 'scrollTop', 'set')
      .mockImplementation(function (this: Element, value: number) {
        const virtualList = this.matches('.plugin-virtual-list')
        const virtualHeightReady = this.querySelector('.plugin-virtual-spacer') !== null
        scrollPositions.set(
          this,
          virtualList && !virtualHeightReady ? Math.min(value, 1400) : value,
        )
      })
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
      vi.fn(),
      (_phase, state) => {
        renderStates.push(state)
        const viewport = state.virtualViewport as { fromIndex: number; toIndex: number } | undefined
        return virtualListOutput(
          viewport?.fromIndex ?? 0,
          viewport?.toIndex ?? 100,
          1000,
          -1,
          false,
        )
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 14_000
    list.dispatchEvent(new Event('pointerdown'))
    list.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(phases).toEqual(['mount'])
    expect(document.querySelector('.plugin-virtual-list')).toBe(list)
    document.dispatchEvent(new Event('pointerup'))

    await vi.waitFor(() => expect(phases).toEqual(['mount', 'update']))
    expect(renderStates[1]?.virtualViewport).toEqual({
      id: 'outline',
      fromIndex: 340,
      toIndex: 670,
      userInitiated: true,
    })
    const updatedList = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    expect(updatedList.dataset.virtualStart).toBe('340')
    expect(updatedList.dataset.virtualEnd).toBe('670')
    expect(updatedList.querySelectorAll('.plugin-list-item')).toHaveLength(330)
    expect(updatedList.scrollTop).toBe(14_000)

    updatedList.scrollTop = 505 * 28
    updatedList.dispatchEvent(new Event('pointerdown'))
    updatedList.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('pointerup'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(phases).toEqual(['mount', 'update'])
    scrollTopSetterSpy.mockRestore()
    scrollTopGetterSpy.mockRestore()
    clientHeightSpy.mockRestore()
  })

  it('does not rerender while outline scrolling remains inside the current overscan buffer', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
      vi.fn(),
      () => virtualListOutput(0, 100, 1000, -1, false),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 30 * 28
    list.dispatchEvent(new Event('pointerdown'))
    list.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('pointerup'))
    await new Promise((resolve) => setTimeout(resolve, 220))

    expect(phases).toEqual(['mount'])
    clientHeightSpy.mockRestore()
  })

  it('keeps the virtual outline viewport stable while background scanning extends the total', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    let total = 1000
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
      vi.fn(),
      () => virtualListOutput(480, 530, total, -1, false),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 14_000
    list.dispatchEvent(new Event('pointerdown'))
    list.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('pointerup'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(phases).toEqual(['mount'])

    total = 1200
    await controller.invalidate('example', 'outline')

    const updatedList = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    expect(updatedList.dataset.virtualStart).toBe('480')
    expect(updatedList.dataset.virtualEnd).toBe('530')
    expect(updatedList.querySelectorAll('.plugin-list-item')).toHaveLength(50)
    expect(updatedList.scrollTop).toBe(14_000)
    expect(
      updatedList.querySelector<HTMLElement>('.plugin-virtual-spacer-after')?.style.height,
    ).toBe('18760px')
    clientHeightSpy.mockRestore()
  })

  it('requests one adjacent buffer only after a real user wheel gesture reaches an edge', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const renderStates: Readonly<Record<string, unknown>>[] = []
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 1450 : 0
      })
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
      vi.fn(),
      (_phase, state) => {
        renderStates.push(state)
        return virtualListOutput(0, 50, 50, -1, false, { hasAfter: true })
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 1160
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }))
    list.scrollTop = 1170
    list.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(phases).toEqual(['mount'])

    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }))
    list.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(phases).toEqual(['mount', 'update']))
    expect(renderStates[1]?.virtualViewport).toEqual({
      id: 'outline',
      fromIndex: 0,
      toIndex: 50,
      userInitiated: true,
      edge: 'after',
      requestId: 1,
    })
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(phases).toEqual(['mount', 'update'])
    scrollHeightSpy.mockRestore()
    clientHeightSpy.mockRestore()
  })

  it('requests the previous buffer only when the list reaches the exact top edge', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const renderStates: Readonly<Record<string, unknown>>[] = []
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
      vi.fn(),
      (_phase, state) => {
        renderStates.push(state)
        return virtualListOutput(0, 50, 50, -1, false, { hasBefore: true })
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 1
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }))
    list.scrollTop = 0
    list.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(phases).toEqual(['mount'])

    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }))
    list.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(phases).toEqual(['mount', 'update']))
    expect(renderStates[1]?.virtualViewport).toMatchObject({
      edge: 'before',
      requestId: 1,
      userInitiated: true,
    })
    clientHeightSpy.mockRestore()
  })

  it('does not request an adjacent buffer for a small scroll far from the cache edge', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
      vi.fn(),
      () => virtualListOutput(0, 100, 200, -1, false, { hasAfter: true }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 280
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }))
    list.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 220))

    expect(phases).toEqual(['mount'])
    clientHeightSpy.mockRestore()
  })

  it('compensates scroll position once when headings are prepended', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    let prepended = false
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
      vi.fn(),
      () =>
        prepended
          ? virtualListOutput(30, 60, 110, -1, false, {
              hasBefore: true,
              scrollAdjust: 280,
              revision: 1,
            })
          : virtualListOutput(20, 50, 100, -1, false, { hasBefore: true }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 1000
    list.dispatchEvent(new Event('pointerdown'))
    list.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('pointerup'))
    await new Promise((resolve) => setTimeout(resolve, 220))

    prepended = true
    await controller.invalidate('example', 'outline')
    expect(document.querySelector<HTMLElement>('.plugin-virtual-list')?.scrollTop).toBe(1280)

    await controller.invalidate('example', 'outline')
    expect(document.querySelector<HTMLElement>('.plugin-virtual-list')?.scrollTop).toBe(1280)
    clientHeightSpy.mockRestore()
  })

  it('coalesces viewport updates without running concurrent plugin renders', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    let releaseUpdate: (() => void) | undefined
    let activeRenders = 0
    let maximumActiveRenders = 0
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
    )
    runtime.renderUi = async (_pluginId, _viewId, phase, state = {}) => {
      phases.push(phase)
      activeRenders += 1
      maximumActiveRenders = Math.max(maximumActiveRenders, activeRenders)
      if (phase === 'update' && !releaseUpdate) {
        await new Promise<void>((resolve) => {
          releaseUpdate = resolve
        })
      }
      activeRenders -= 1
      return `${phase}:${String(state.documentId)}`
    }
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc-a')

    const firstUpdate = controller.updateViewport()
    await vi.waitFor(() => expect(releaseUpdate).toBeTypeOf('function'))
    const secondUpdate = controller.updateViewport()
    releaseUpdate?.()
    await Promise.all([firstUpdate, secondUpdate])

    expect(phases).toEqual(['mount', 'update', 'update'])
    expect(maximumActiveRenders).toBe(1)
  })
})

function listOutput(label: string) {
  return {
    type: 'element' as const,
    tag: 'span' as const,
    attributes: { class: 'plugin-virtual-list' },
    children: [label],
  }
}

function virtualListOutput(
  start: number,
  end: number,
  total: number,
  active: number,
  followActive: boolean,
  options: {
    hasBefore?: boolean
    hasAfter?: boolean
    scrollAdjust?: number
    revision?: number
  } = {},
) {
  return {
    type: 'element' as const,
    tag: 'span' as const,
    attributes: {
      class: 'plugin-virtual-list',
      'data-virtual-list': 'outline',
      'data-virtual-total': String(total),
      'data-virtual-start': String(start),
      'data-virtual-end': String(end),
      'data-virtual-item-height': '28',
      'data-virtual-active': String(active),
      'data-virtual-follow-active': String(followActive),
      'data-virtual-has-before': String(options.hasBefore === true),
      'data-virtual-has-after': String(options.hasAfter === true),
      'data-virtual-scroll-adjust': String(options.scrollAdjust ?? 0),
      'data-virtual-revision': String(options.revision ?? 0),
    },
    children: Array.from({ length: end - start }, (_, offset) => ({
      type: 'element' as const,
      tag: 'button' as const,
      text: `Heading ${start + offset}`,
      attributes: { class: 'plugin-list-item' },
    })),
  }
}

function createRuntime(
  ui: PluginContributionIndex['ui'],
  phases: string[],
  runCommand = vi.fn(),
  output: (phase: string, state: Readonly<Record<string, unknown>>) => unknown = (phase, state) =>
    `${phase}:${String(state.documentId)}`,
): DesktopPluginUiRuntime {
  const index: PluginContributionIndex = {
    commands: [],
    keymaps: [],
    renderers: [],
    markdownSyntax: [],
    ui,
    importers: [],
    documentTypes: [],
  }

  return {
    contributions: () => index,
    renderUi: async (_pluginId, _viewId, phase, state = {}) => {
      phases.push(phase)
      return output(phase, state)
    },
    resolveCommand: (_rendererId, command) => (command === 'example.run' ? command : undefined),
    runCommand,
  }
}

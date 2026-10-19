// @vitest-environment jsdom

import type { PluginContributionIndex } from '@milkup/plugin'
import { describe, expect, it, vi } from 'vitest'

import { DesktopPluginUiController, type DesktopPluginUiRuntime } from './desktop-plugin-ui'

describe('DesktopPluginUiController', () => {
  it('restores a virtual keyboard target named by text without requiring aria-label', async () => {
    document.body.innerHTML = '<div data-plugin-slot="sidebar-panel"></div>'
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      vi.fn(),
      (_phase, state) => {
        const range = state.virtualViewport as { fromIndex: number; toIndex: number } | undefined
        const output = virtualTreeOutput(range?.fromIndex ?? 0, range?.toIndex ?? 2, 18000)
        return {
          ...output,
          children: output.children.map((item) => {
            const { 'aria-label': _label, ...attributes } = item.attributes
            return { ...item, attributes }
          }),
        }
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    document.querySelector<HTMLButtonElement>('[role="treeitem"]')!.focus()
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    )
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Heading 17999'))
    await controller.dispose()
  })

  it('requests bounded virtual tree ranges for End, Home and arrow boundary focus', async () => {
    document.body.innerHTML = '<div data-plugin-slot="sidebar-panel"></div>'
    const requests: { fromIndex: number; toIndex: number }[] = []
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      vi.fn(),
      (_phase, state) => {
        const viewport = state.virtualViewport as { fromIndex: number; toIndex: number } | undefined
        if (viewport) requests.push(viewport)
        return virtualTreeOutput(viewport?.fromIndex ?? 0, viewport?.toIndex ?? 2, 18000)
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    const press = (key: string) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    document.querySelector<HTMLButtonElement>('[role="treeitem"]')!.focus()
    press('End')
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Heading 17999'))
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((request) => request.toIndex - request.fromIndex <= 500)).toBe(true)
    expect(document.querySelectorAll('[role="treeitem"]').length).toBeLessThanOrEqual(500)
    press('Home')
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Heading 0'))
    const items = document.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')
    items[items.length - 1]!.focus()
    const next = Number(items[items.length - 1]!.textContent!.split(' ')[1]) + 1
    press('ArrowDown')
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe(`Heading ${next}`))
    expect(document.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1)
    await controller.dispose()
  })

  it('does not let late virtual keyboard ranges steal focus after Tab or document change', async () => {
    document.body.innerHTML =
      '<button id="outside">Outside</button><div data-plugin-slot="sidebar-panel"></div>'
    let resolve!: (output: unknown) => void
    let pending = false
    let version = 1
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      vi.fn(),
      () => virtualTreeOutput(0, 2, 18000),
    )
    const render = runtime.renderUi
    runtime.renderUi = async (...args) => {
      if (pending && args[2] === 'update')
        return new Promise((done) => {
          resolve = done
        })
      return render(...args)
    }
    const controller = new DesktopPluginUiController(document.body, runtime, () => ({
      documentVersion: version,
    }))
    await controller.sync('doc')
    const request = () => {
      document.querySelector<HTMLButtonElement>('[role="treeitem"]')!.focus()
      pending = true
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
      )
    }
    request()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    document.querySelector<HTMLButtonElement>('#outside')!.focus()
    resolve(virtualTreeOutput(17840, 18000, 18000))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement?.id).toBe('outside')
    pending = false
    await controller.invalidate('example', 'tree')
    request()
    version = 2
    resolve(virtualTreeOutput(17840, 18000, 18000))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement?.textContent).toBe('Heading 0')
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    )
    expect(document.activeElement?.textContent).toBe('Heading 1')
    pending = false
    await controller.dispose()
  })

  it.each(['document', 'version', 'mount'])(
    'discards a rejected keyboard range after the request %s changes',
    async (change) => {
      document.body.innerHTML = '<div data-plugin-slot="sidebar-panel"></div>'
      let version = 1
      let reject!: (error: Error) => void
      const runtime = createRuntime(
        [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
        [],
        vi.fn(),
        () => virtualTreeOutput(0, 2, 18000),
      )
      const render = runtime.renderUi
      runtime.renderUi = async (...args) =>
        args[2] === 'update'
          ? new Promise((_resolve, fail) => {
              reject = fail
            })
          : render(...args)
      const controller = new DesktopPluginUiController(document.body, runtime, () => ({
        documentVersion: version,
      }))
      await controller.sync('doc')
      const first = document.querySelector<HTMLButtonElement>('[role="treeitem"]')!
      const container = first.closest<HTMLElement>('[data-plugin-ui]')!
      first.focus()
      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
      )
      const rejectRequest = reject
      if (change === 'document') await controller.sync('other-doc')
      else if (change === 'version') version = 2
      else await controller.dispose()
      rejectRequest(new Error('obsolete keyboard request'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(document.querySelector('.plugin-ui-error')).toBeNull()
      expect(container.querySelector('.plugin-ui-error')).toBeNull()
      if (change === 'mount') {
        expect(document.querySelector('[data-plugin-ui]')).toBeNull()
        return
      }
      expect(document.activeElement).toBe(first)
      expect(
        document.querySelector('[data-virtual-list]')?.getAttribute('data-virtual-start'),
      ).toBe('0')
      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )
      expect(document.activeElement?.textContent).toBe('Heading 1')
      await controller.dispose()
    },
  )

  it('discards a pending End range when focus moves to another row of the same tree', async () => {
    document.body.innerHTML = '<div data-plugin-slot="sidebar-panel"></div>'
    const pending: ((output: unknown) => void)[] = []
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      vi.fn(),
      () => virtualTreeOutput(0, 2, 18000),
    )
    const render = runtime.renderUi
    runtime.renderUi = async (...args) =>
      args[2] === 'update' ? new Promise((resolve) => pending.push(resolve)) : render(...args)
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    const items = document.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')
    items[0]!.focus()
    items[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    )
    items[1]!.focus()
    pending[0]!(virtualTreeOutput(17840, 18000, 18000))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement).toBe(items[1])
    expect(document.querySelector('[data-virtual-list]')?.getAttribute('data-virtual-start')).toBe(
      '0',
    )
    for (const resolve of pending.slice(1)) resolve(virtualTreeOutput(0, 2, 18000))
    await controller.dispose()
  })

  it('keeps the latest virtual keyboard intent and discards ranges after teardown', async () => {
    document.body.innerHTML =
      '<button id="outside">Outside</button><div data-plugin-slot="sidebar-panel"></div>'
    const pending: ((output: unknown) => void)[] = []
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      vi.fn(),
      () => virtualTreeOutput(0, 2, 18000),
    )
    const render = runtime.renderUi
    runtime.renderUi = async (...args) =>
      args[2] === 'update' ? new Promise((resolve) => pending.push(resolve)) : render(...args)
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    document.querySelector<HTMLButtonElement>('[role="treeitem"]')!.focus()
    const press = (key: string) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    press('End')
    press('Home')
    expect(pending).toHaveLength(2)
    pending[1]!(virtualTreeOutput(0, 160, 18000))
    await vi.waitFor(() => expect(document.querySelectorAll('[role="treeitem"]')).toHaveLength(160))
    pending[0]!(virtualTreeOutput(17840, 18000, 18000))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement?.textContent).toBe('Heading 0')
    expect(document.querySelector('[data-virtual-list]')?.getAttribute('data-virtual-start')).toBe(
      '0',
    )
    press('End')
    expect(pending).toHaveLength(3)
    document.querySelector<HTMLButtonElement>('#outside')!.focus()
    await controller.dispose()
    pending[2]!(virtualTreeOutput(17840, 18000, 18000))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.querySelector('[data-plugin-ui]')).toBeNull()
    expect(document.activeElement?.id).toBe('outside')
  })

  it('uses visible ranks rather than source ordinals after folding a virtual tree', async () => {
    document.body.innerHTML = '<div data-plugin-slot="sidebar-panel"></div>'
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      vi.fn(),
      (_phase, state) => {
        const range = state.virtualViewport as { fromIndex: number; toIndex: number } | undefined
        const output = virtualTreeOutput(range?.fromIndex ?? 0, range?.toIndex ?? 2, 20)
        return {
          ...output,
          children: output.children.map((item, offset) => ({
            ...item,
            text: `Root ${((range?.fromIndex ?? 0) + offset) * 900}`,
          })),
        }
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    document.querySelector<HTMLButtonElement>('[role="treeitem"]')!.focus()
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    )
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Root 17100'))
    expect(document.querySelectorAll('[role="treeitem"]')).toHaveLength(20)
    await controller.dispose()
  })

  it('holds modal focus while a controlled save action is temporarily disabled', async () => {
    document.body.innerHTML = '<div data-plugin-slot="modal"></div>'
    let busy = false
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'form', title: 'Form', slot: 'modal' }],
      [],
      vi.fn(),
      () => ({
        type: 'element',
        tag: 'span',
        children: [
          {
            type: 'field',
            key: 'value',
            kind: 'text',
            label: 'Value',
            value: '',
            disabled: busy,
            onChange: { command: 'example.run' },
          },
          {
            type: 'element',
            tag: 'button',
            text: 'Save',
            attributes: { 'aria-label': 'Save' },
            disabled: busy,
            action: { command: 'example.run' },
          },
        ],
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.open('example', 'form')
    document.querySelector<HTMLButtonElement>('[aria-label="Save"]')!.focus()
    busy = true
    await controller.invalidate('example', 'form')
    expect(document.activeElement).toBe(document.querySelector('.plugin-ui-modal'))
    busy = false
    await controller.invalidate('example', 'form')
    expect(document.activeElement).toBe(document.querySelector('[aria-label="Save"]'))
    await controller.dispose()
  })

  it('combines embedding slot visibility with panel collapse without affecting other slots', async () => {
    document.body.innerHTML =
      '<div data-plugin-slot="sidebar-panel"></div><div data-plugin-slot="menu-page"></div>'
    const calls: { id: string; visible: unknown }[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'tree',
          title: 'Tree',
          slot: 'sidebar-panel',
          viewportUpdates: false,
        },
        { pluginId: 'example', id: 'page', title: 'Page', slot: 'menu-page' },
      ],
      [],
    )
    runtime.renderUi = async (_plugin, id, _phase, state) => {
      calls.push({ id, visible: state?.visible })
      return 'content'
    }
    const controller = new DesktopPluginUiController(document.body, runtime)
    controller.setSlotVisible('sidebar-panel', false)
    await controller.sync('doc')
    expect(calls).toEqual([
      { id: 'tree', visible: false },
      { id: 'page', visible: true },
    ])
    calls.length = 0
    controller.setSlotVisible('sidebar-panel', false)
    expect(calls).toHaveLength(0)
    controller.setSlotVisible('sidebar-panel', true)
    expect(calls).toEqual([{ id: 'tree', visible: true }])
    const toggle = document.querySelector<HTMLButtonElement>('.plugin-ui-panel-toggle')!
    toggle.click()
    expect(calls.at(-1)).toEqual({ id: 'tree', visible: false })
    controller.setSlotVisible('sidebar-panel', false)
    controller.setSlotVisible('sidebar-panel', true)
    expect(calls.at(-1)).toEqual({ id: 'tree', visible: false })
    toggle.click()
    expect(calls.at(-1)).toEqual({ id: 'tree', visible: true })
    await controller.dispose()
  })

  it('traps modal Tab using only the current tree tab stop', async () => {
    document.body.innerHTML = '<div data-plugin-slot="modal"></div>'
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'dialog', title: 'Tree', slot: 'modal' }],
      [],
      vi.fn(),
      () => ({
        type: 'element',
        tag: 'span',
        attributes: { role: 'tree' },
        children: ['a', 'b'].map((label) => ({
          type: 'element',
          tag: 'button',
          text: label,
          attributes: { role: 'treeitem', 'aria-label': label },
        })),
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.open('example', 'dialog')
    const close = document.querySelector<HTMLButtonElement>('.plugin-ui-close')!
    const first = document.querySelector<HTMLButtonElement>('[aria-label="a"]')!
    close.focus()
    close.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Unidentified',
        code: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(document.activeElement).toBe(first)
    first.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(close)
    await controller.dispose()
  })

  it('does not treat scripted clicks or forged action details as trusted user gestures', async () => {
    document.body.innerHTML = '<div data-plugin-slot="sidebar-panel"></div>'
    const run = vi.fn()
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      run,
      () => ({
        type: 'element',
        tag: 'span',
        attributes: { role: 'tree' },
        children: [
          {
            type: 'element',
            tag: 'button',
            text: 'docs',
            attributes: { role: 'treeitem', 'aria-label': 'docs', 'aria-expanded': 'false' },
            action: { command: 'example.run' },
          },
        ],
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    const button = document.querySelector<HTMLButtonElement>('[role="treeitem"]')!
    button.click()
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    const detail = {
      rendererId: 'example:tree',
      command: 'example.run',
      input: {},
      isTrusted: true,
      trusted: true,
    }
    button.dispatchEvent(
      new CustomEvent('milkup-plugin-renderer-action', { detail, bubbles: true }),
    )
    button.dispatchEvent(
      new CustomEvent('milkup-plugin-renderer-action', {
        detail: { ...detail, rendererId: 'another:tree' },
        bubbles: true,
      }),
    )
    expect(run.mock.calls).toEqual(Array.from({ length: 3 }, () => ['example.run', {}]))
    await controller.dispose()
  })

  it('keeps a pressed controlled button until click and coalesces progress renders', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    let progress = 0
    const run = vi.fn()
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'progress',
          title: 'Progress',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      [],
      run,
      () => ({
        type: 'element',
        tag: 'button',
        text: `Cancel ${progress}`,
        action: { command: 'example.run' },
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc-a')
    const button = document.querySelector<HTMLButtonElement>('[data-plugin-command]')!
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    for (progress = 1; progress <= 4; progress++) await controller.invalidate('example', 'progress')
    expect(document.querySelector('[data-plugin-command]')).toBe(button)
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
    button.click()
    expect(run).toHaveBeenCalledOnce()
    await vi.waitFor(() =>
      expect(document.querySelector('[data-plugin-command]')?.textContent).toBe('Cancel 5'),
    )
    const next = document.querySelector('[data-plugin-command]')!
    next.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    progress = 6
    await controller.invalidate('example', 'progress')
    document.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true, button: 0 }))
    await vi.waitFor(() =>
      expect(document.querySelector('[data-plugin-command]')?.textContent).toBe('Cancel 6'),
    )
    await controller.dispose()
  })
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

  it('takes modal focus before pending mount output, so immediate Escape closes and restores the opener', async () => {
    document.body.innerHTML =
      '<button id="opener">Open</button><div data-plugin-slot="modal"></div>'
    const opener = document.querySelector<HTMLButtonElement>('#opener')!
    opener.focus()
    let finish!: (output: unknown) => void
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' }],
      [],
      vi.fn(),
      (phase) => (phase === 'mount' ? pending : ''),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    const opening = controller.open('example', 'dialog')
    const modal = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(modal).not.toBeNull()
    expect(document.activeElement).toBe(modal)
    modal.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    finish('late mount output')
    await opening
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('does not take focus back from a host confirmation when asynchronous opening completes', async () => {
    document.body.innerHTML =
      '<button id="opener">Open</button><button id="host-confirm">Host confirmation</button><div data-plugin-slot="modal"></div>'
    const opener = document.querySelector<HTMLButtonElement>('#opener')!
    const confirmation = document.querySelector<HTMLButtonElement>('#host-confirm')!
    opener.focus()
    let finish!: (output: unknown) => void
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' }],
      [],
      vi.fn(),
      (phase) => (phase === 'mount' ? pending : ''),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    const opening = controller.open('example', 'dialog')
    confirmation.focus()
    finish('mount output')
    await opening
    expect(document.activeElement).toBe(confirmation)
    await controller.close('example', 'dialog')
    expect(document.activeElement).toBe(confirmation)
  })

  it('restores an available card when unloading removes the opener and ignores late output', async () => {
    document.body.innerHTML =
      '<button id="opener">Open</button><div data-plugin-slot="modal"></div>'
    const opener = document.querySelector<HTMLButtonElement>('#opener')!
    opener.focus()
    let finish!: (output: unknown) => void
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' }],
      [],
      vi.fn(),
      (phase) => (phase === 'mount' ? pending : ''),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    const opening = controller.open('example', 'dialog')
    const nextCard = document.createElement('button')
    nextCard.dataset.pluginAction = 'details'
    nextCard.textContent = 'Another plugin'
    opener.replaceWith(nextCard)
    const emptyIndex = { ...runtime.contributions(), ui: [] }
    runtime.contributions = () => emptyIndex
    await controller.sync('doc')
    expect(document.activeElement).toBe(nextCard)
    finish('removed plugin output')
    await opening
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(nextCard)
  })

  it.each(['Action A', 'Action B'])(
    'resumes focus after a pending output removes controls, with final %s',
    async (finalLabel) => {
      document.body.innerHTML = '<div data-plugin-slot="modal"></div>'
      let label: string | undefined = 'Action A'
      const runtime = createRuntime(
        [{ pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' }],
        [],
        vi.fn(),
        () =>
          label
            ? {
                type: 'element',
                tag: 'button',
                text: label,
                attributes: { 'aria-label': label },
                action: { command: 'example.run' },
              }
            : 'Checking…',
      )
      const controller = new DesktopPluginUiController(document.body, runtime)
      await controller.open('example', 'dialog')
      const modal = document.querySelector<HTMLElement>('[role="dialog"]')!
      document.querySelector<HTMLButtonElement>('[data-plugin-command]')!.focus()
      label = undefined
      await controller.invalidate('example', 'dialog')
      expect(document.activeElement).toBe(modal)
      label = finalLabel
      await controller.invalidate('example', 'dialog')
      expect(document.activeElement?.getAttribute('aria-label')).toBe(finalLabel)
      await controller.dispose()
    },
  )

  it.each(['close', 'confirmation'])(
    'does not resume a removed action after the user focuses %s',
    async (destination) => {
      document.body.innerHTML =
        '<button id="confirmation">Confirmation</button><div data-plugin-slot="modal"></div>'
      let waiting = false
      const runtime = createRuntime(
        [{ pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' }],
        [],
        vi.fn(),
        () =>
          waiting
            ? 'Checking…'
            : {
                type: 'element',
                tag: 'button',
                text: 'Action A',
                attributes: { 'aria-label': 'Action A' },
                action: { command: 'example.run' },
              },
      )
      const controller = new DesktopPluginUiController(document.body, runtime)
      await controller.open('example', 'dialog')
      document.querySelector<HTMLButtonElement>('[data-plugin-command]')!.focus()
      waiting = true
      await controller.invalidate('example', 'dialog')
      const next = document.querySelector<HTMLButtonElement>(
        destination === 'close' ? '.plugin-ui-close' : '#confirmation',
      )!
      next.focus()
      waiting = false
      await controller.invalidate('example', 'dialog')
      expect(document.activeElement).toBe(next)
      await controller.dispose()
    },
  )

  it('traps native WebKit Shift+Tab with Unidentified key and Tab code at the close button', async () => {
    document.body.innerHTML =
      '<button id="outside">Outside</button><div data-plugin-slot="modal"></div>'
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' }],
      [],
      vi.fn(),
      () => ({
        type: 'element',
        tag: 'button',
        text: 'Action A',
        attributes: { 'aria-label': 'Action A' },
        action: { command: 'example.run' },
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.open('example', 'dialog')
    const close = document.querySelector<HTMLButtonElement>('.plugin-ui-close')!
    close.focus()
    const event = new KeyboardEvent('keydown', {
      key: 'Unidentified',
      code: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    close.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Action A')
    await controller.dispose()
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

  it('reports actual visibility on collapse and expand, independent of focus lifecycle', async () => {
    document.body.innerHTML =
      '<button id="outside">Outside</button><div data-plugin-slot="sidebar-panel"></div><div data-plugin-slot="modal"></div>'
    const states: { phase: string; visible: unknown }[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'tree',
          title: 'Files',
          slot: 'sidebar-panel',
          viewportUpdates: false,
        },
        { pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' },
      ],
      [],
      vi.fn(),
      (phase, state) => {
        states.push({ phase, visible: state.visible })
        return {
          type: 'element',
          tag: 'button',
          text: 'Open',
          attributes: { 'aria-label': 'Open' },
          action: { command: 'example.run' },
        }
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    expect(states[0]).toEqual({ phase: 'mount', visible: true })
    const toggle = document.querySelector<HTMLButtonElement>('.plugin-ui-panel-toggle')!
    document.querySelector<HTMLButtonElement>('[data-plugin-command]')!.focus()
    document.querySelector<HTMLButtonElement>('#outside')!.focus()
    expect(
      states.filter((state) => state.phase === 'blur').every((state) => state.visible === true),
    ).toBe(true)
    toggle.focus()
    toggle.click()
    expect(states.at(-1)).toEqual({ phase: 'update', visible: false })
    await Promise.resolve()
    expect(document.activeElement).toBe(toggle)
    toggle.click()
    expect(states.at(-1)).toEqual({ phase: 'update', visible: true })
    await controller.open('example', 'dialog')
    expect(states.filter((state) => state.phase === 'mount').at(-1)).toEqual({
      phase: 'mount',
      visible: true,
    })
    await controller.dispose()
    expect(
      states.filter((state) => state.phase === 'dispose').every((state) => state.visible === false),
    ).toBe(true)
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

function virtualTreeOutput(start: number, end: number, total: number) {
  const output = virtualListOutput(start, end, total, -1, false)
  return {
    ...output,
    attributes: { ...output.attributes, role: 'tree', 'aria-label': 'Virtual tree' },
    children: output.children.map((item, index) => ({
      ...item,
      attributes: {
        ...item.attributes,
        role: 'treeitem',
        'aria-level': '1',
        'aria-label': `Heading ${start + index}`,
      },
      action: { command: 'example.run' },
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

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createControlledRendererNodes } from '@milkup/view-dom'
import type { ControlledRendererOutput } from '@milkup/view-dom'
import { normalizePluginContextMenuNodes, reconcilePluginContextMenu } from './context-menu-plugins'

function action(label: string, command = label): ControlledRendererOutput {
  return { type: 'element', tag: 'button', text: label, action: { command } }
}
function mount(slot: HTMLElement, id: string, labels: string[]) {
  const container = document.createElement('section')
  container.dataset.pluginUi = id
  container.dataset.contextMenuState = 'ready'
  container.append(
    ...normalizePluginContextMenuNodes(
      createControlledRendererNodes(document, id, {
        type: 'element',
        tag: 'span',
        children: labels.map((label) => action(label)),
      }),
      id,
      () => true,
    ),
  )
  slot.append(container)
  reconcilePluginContextMenu(slot)
  return container
}
afterEach(() => document.body.replaceChildren())

describe('host-controlled context menu extensions', () => {
  it.each(['pending', 'retired', 'failed', 'unknown', undefined])(
    'does not revive or spend the shared quota on a %s mount when another plugin finishes',
    (state) => {
      const slot = document.createElement('div')
      document.body.append(slot)
      const stale = mount(slot, 'a.slow:menu', ['old A1', 'old A2', 'old A3', 'old A4'])
      const unprojected = document.createElement('button')
      unprojected.textContent = 'obsolete auxiliary button'
      stale.append(unprojected)
      stale.tabIndex = 0
      if (state === undefined) delete stale.dataset.contextMenuState
      else stale.dataset.contextMenuState = state

      const ready = mount(slot, 'z.fast:menu', ['current C1', 'current C2', 'current C3'])
      expect(stale.hidden).toBe(true)
      expect(stale.tabIndex).toBe(-1)
      for (const button of Array.from(stale.querySelectorAll('button'))) {
        expect(button.hidden).toBe(true)
        expect(button.tabIndex).toBe(-1)
      }
      expect(ready.hidden).toBe(false)
      expect(
        Array.from(slot.querySelectorAll('button:not([hidden])')).map(
          (button) => button.textContent,
        ),
      ).toEqual(['current C1', 'current C2', 'current C3'])

      // A completed or removed sibling must never revive old selection A.
      ready.remove()
      reconcilePluginContextMenu(slot)
      reconcilePluginContextMenu(slot)
      expect(stale.hidden).toBe(true)
      expect(slot.hidden).toBe(true)
      expect(slot.querySelectorAll('button:not([hidden])')).toHaveLength(0)
    },
  )

  it('admits a pending mount only after the controller explicitly marks its new result ready', () => {
    const slot = document.createElement('div')
    document.body.append(slot)
    const slow = mount(slot, 'a.slow:menu', ['old A'])
    slow.dataset.contextMenuState = 'pending'
    reconcilePluginContextMenu(slot)
    expect(slot.hidden).toBe(true)
    slow.replaceChildren(
      ...normalizePluginContextMenuNodes(
        createControlledRendererNodes(document, 'a.slow:menu', action('current C')),
        'a.slow:menu',
        () => true,
      ),
    )
    reconcilePluginContextMenu(slot)
    expect(slow.querySelector('button')?.hidden).toBe(true)
    slow.dataset.contextMenuState = 'ready'
    reconcilePluginContextMenu(slot)
    expect(slot.hidden).toBe(false)
    expect(slow.hidden).toBe(false)
    expect(slow.querySelector('button')?.hidden).toBe(false)
    expect(slow.querySelector('button')?.textContent).toBe('current C')
  })

  it('caps the total visible actions at three, not three contributions', () => {
    const slot = document.createElement('div')
    document.body.append(slot)
    mount(slot, 'z.plugin:menu', ['Z1', 'Z2', 'Z3', 'Z4'])
    mount(slot, 'a.plugin:menu', ['A1', 'A2'])
    expect(
      Array.from(slot.querySelectorAll('button:not([hidden])')).map((b) => b.textContent),
    ).toEqual(['A1', 'A2', 'Z1'])
    expect(slot.querySelectorAll('button[hidden]')).toHaveLength(3)
    const first = slot.querySelector('[data-plugin-ui="a.plugin:menu"]')!
    first.remove()
    reconcilePluginContextMenu(slot)
    expect(
      Array.from(slot.querySelectorAll('button:not([hidden])')).map((b) => b.textContent),
    ).toEqual(['Z1', 'Z2', 'Z3'])
  })

  it('keeps command/input binding while rebuilding icons and removing plugin styling/links', () => {
    const nodes = createControlledRendererNodes(document, 'p:menu', {
      type: 'element',
      tag: 'button',
      attributes: { class: 'evil', role: 'dialog' },
      action: { command: 'safe.action', input: { value: '中文🙂' } },
      children: [
        {
          type: 'element',
          tag: 'a',
          attributes: { href: 'https://example.invalid' },
          text: '插入',
        },
      ],
    })
    const original = nodes[0]
    const projected = normalizePluginContextMenuNodes(nodes, 'p:menu', () => true)
    expect(projected[0]).toBe(original)
    document.body.append(...projected)
    const button = projected[0] as HTMLButtonElement
    expect(button.querySelector('a')).toBeNull()
    expect(button.className).toBe('editor-context-menu-item')
    expect(button.querySelectorAll('svg')).toHaveLength(1)
    expect(button.querySelector('script, foreignObject, image, use')).toBeNull()
    const listener = vi.fn()
    document.body.addEventListener('milkup-plugin-renderer-action', listener, { once: true })
    button.click()
    expect(listener.mock.calls[0]?.[0].detail).toEqual({
      rendererId: 'p:menu',
      command: 'safe.action',
      input: { value: '中文🙂' },
    })
  })

  it('does not admit fields, clickable wrappers, nested parent actions or unresolved commands', () => {
    const nodes = createControlledRendererNodes(document, 'p:menu', {
      type: 'element',
      tag: 'span',
      action: { command: 'parent' },
      children: [
        {
          type: 'element',
          tag: 'button',
          action: { command: 'outer' },
          children: [action('leaf')],
        },
        action('unknown'),
        {
          type: 'element',
          tag: 'a',
          attributes: { href: 'https://example.invalid' },
          text: '外链',
        },
      ],
    })
    const projected = normalizePluginContextMenuNodes(
      nodes,
      'p:menu',
      (_, command) => command === 'leaf',
    )
    expect(projected).toHaveLength(1)
    expect((projected[0] as HTMLElement).dataset.pluginCommand).toBe('leaf')
  })

  it('preserves visible focused actions and hides empty/error contributions', () => {
    const slot = document.createElement('div')
    document.body.append(slot)
    const first = mount(slot, 'b:menu', ['B'])
    const button = first.querySelector('button')!
    button.focus()
    mount(slot, 'a:menu', ['A'])
    expect(document.activeElement).toBe(button)
    const failed = document.createElement('section')
    failed.dataset.pluginUi = 'failed:menu'
    failed.textContent = 'plugin error'
    slot.append(failed)
    reconcilePluginContextMenu(slot)
    expect(failed.hidden).toBe(true)
    first.remove()
    slot.querySelector('[data-plugin-ui="a:menu"]')!.remove()
    reconcilePluginContextMenu(slot)
    expect(slot.hidden).toBe(true)
  })
})

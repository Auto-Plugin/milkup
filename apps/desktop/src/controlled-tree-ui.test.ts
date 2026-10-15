// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { decorateControlledTrees, type ControlledTreeFocus } from './controlled-tree-ui'

function setup() {
  document.body.innerHTML = `<div role="tree" aria-label="Files">
    <button role="treeitem" aria-label="docs" aria-level="1" aria-expanded="true">docs</button>
    <button role="treeitem" aria-label="docs/a.md" aria-level="2">a.md</button>
    <button role="treeitem" aria-label="docs/nested" aria-level="2" aria-expanded="false">nested</button>
    <button role="treeitem" aria-label="z.md" aria-level="1">z.md</button>
    <button id="more">More</button>
  </div>`
  const focus = new Map<string, ControlledTreeFocus>()
  const activate = vi.fn()
  decorateControlledTrees(document.body, focus, activate)
  const items = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'))
  const press = (key: string, code = key) => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }),
    )
  }
  return { items, focus, activate, press }
}

describe('controlled tree keyboard', () => {
  it('uses one tab stop and navigates visible rows, parent and first child without running commands', () => {
    const { items, press, activate } = setup()
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1, -1])
    items[0]!.focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(items[1])
    press('ArrowLeft')
    expect(document.activeElement).toBe(items[0])
    press('End')
    expect(document.activeElement).toBe(items[3])
    press('Unidentified', 'ArrowUp')
    expect(document.activeElement).toBe(items[2])
    press('Home')
    expect(document.activeElement).toBe(items[0])
    expect(activate).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLButtonElement>('#more')!.tabIndex).toBe(0)
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1)
  })

  it('activates only expansion or collapse and passes the actual keyboard event', () => {
    const { items, press, activate } = setup()
    items[0]!.focus()
    press('ArrowLeft')
    expect(activate).toHaveBeenLastCalledWith(
      items[0],
      expect.objectContaining({ key: 'ArrowLeft' }),
    )
    items[2]!.focus()
    press('ArrowRight')
    expect(activate).toHaveBeenLastCalledWith(
      items[2],
      expect.objectContaining({ key: 'ArrowRight' }),
    )
    expect(activate).toHaveBeenCalledTimes(2)
    items[3]!.focus()
    press('ArrowRight')
    expect(activate).toHaveBeenCalledTimes(2)
  })

  it('keeps the stable full-path row after refresh and the nearest row after removal', () => {
    const { items, focus, activate } = setup()
    items[2]!.focus()
    const tree = document.querySelector('[role="tree"]')!
    tree.innerHTML = `<button role="treeitem" aria-label="z.md">z.md</button>
      <button role="treeitem" aria-label="docs/nested">nested</button>
      <button role="treeitem" aria-label="other/nested">nested</button>`
    decorateControlledTrees(document.body, focus, activate)
    expect(tree.querySelector('[tabindex="0"]')?.getAttribute('aria-label')).toBe('docs/nested')
    tree.querySelector('[aria-label="docs/nested"]')!.remove()
    // Decorate runs on fresh renderer nodes, so replace the old tree before decorating again.
    tree.replaceWith(tree.cloneNode(true))
    decorateControlledTrees(document.body, focus, activate)
    expect(document.querySelector('[tabindex="0"]')?.getAttribute('aria-label')).toBe(
      'other/nested',
    )
  })

  it('leaves legacy wrapper trees and modified shortcuts unchanged', () => {
    const { items, activate } = setup()
    items[0]!.focus()
    const modified = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    items[0]!.dispatchEvent(modified)
    expect(modified.defaultPrevented).toBe(false)
    expect(activate).not.toHaveBeenCalled()
    document.body.innerHTML =
      '<span role="tree"><span role="treeitem"><button>Open</button><button>Toggle</button></span></span>'
    decorateControlledTrees(document.body, new Map(), activate)
    expect(document.querySelector('[data-controlled-tree-key]')).toBeNull()
    expect(document.querySelector('[tabindex]')).toBeNull()
  })
})

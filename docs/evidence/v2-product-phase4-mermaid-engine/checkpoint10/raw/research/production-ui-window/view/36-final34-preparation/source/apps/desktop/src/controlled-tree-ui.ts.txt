/** Keyboard semantics for public controlled trees; no filesystem or plugin-ID knowledge. */
export interface ControlledTreeFocus {
  readonly label: string
  readonly index: number
}

export function decorateControlledTrees(
  root: HTMLElement,
  focus: Map<string, ControlledTreeFocus>,
  activate: (button: HTMLButtonElement, event: KeyboardEvent) => void,
): void {
  const trees = Array.from(root.querySelectorAll<HTMLElement>('[role="tree"]'))
  for (const [treeIndex, tree] of trees.entries()) {
    const items = Array.from(
      tree.querySelectorAll<HTMLButtonElement>('button[role="treeitem"]'),
    ).filter((item) => item.closest('[role="tree"]') === tree && !item.disabled && !item.hidden)
    // Existing trees with separate wrapper/toggle/navigation controls keep their own semantics.
    if (!items.length) continue
    const key = `${treeIndex}:${tree.getAttribute('aria-label') ?? ''}`
    tree.dataset.controlledTreeKey = key
    const previous = focus.get(key)
    const active = root.ownerDocument.activeElement
    const chosen =
      items.find((item) => item === active) ??
      items.find((item) => item.getAttribute('aria-label') === previous?.label) ??
      (previous ? items[Math.min(previous.index, items.length - 1)] : undefined) ??
      items.find((item) => item.getAttribute('aria-current') === 'location') ??
      items[0]!
    const remember = (item: HTMLButtonElement) => {
      for (const candidate of items) candidate.tabIndex = candidate === item ? 0 : -1
      focus.set(key, { label: item.getAttribute('aria-label') ?? '', index: items.indexOf(item) })
    }
    remember(chosen)
    for (const item of items) {
      item.style.setProperty('--plugin-tree-depth', String(Math.min(6, level(item) - 1)))
    }
    tree.addEventListener('focusin', (event) => {
      if (event.target instanceof HTMLButtonElement && items.includes(event.target))
        remember(event.target)
    })
    tree.addEventListener('keydown', (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return
      const item =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('button[role="treeitem"]')
          : null
      if (!item || !items.includes(item)) return
      const index = items.indexOf(item)
      const key = event.key === 'Unidentified' ? event.code : event.key
      let next: HTMLButtonElement | undefined
      let toggle = false
      if (key === 'ArrowDown') next = items[Math.min(index + 1, items.length - 1)]
      else if (key === 'ArrowUp') next = items[Math.max(0, index - 1)]
      else if (key === 'Home') next = items[0]
      else if (key === 'End') next = items.at(-1)
      else if (key === 'ArrowRight') {
        if (item.getAttribute('aria-expanded') === 'false') toggle = true
        else if (
          item.getAttribute('aria-expanded') === 'true' &&
          items[index + 1] &&
          level(items[index + 1]!) > level(item)
        )
          next = items[index + 1]
      } else if (key === 'ArrowLeft') {
        if (item.getAttribute('aria-expanded') === 'true') toggle = true
        else
          next = items
            .slice(0, index)
            .reverse()
            .find((candidate) => level(candidate) < level(item))
      } else return
      event.preventDefault()
      event.stopPropagation()
      if (toggle) activate(item, event)
      else if (next) {
        remember(next)
        next.focus({ preventScroll: true })
        next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      }
    })
  }
}

function level(item: HTMLElement): number {
  const value = Number(item.getAttribute('aria-level'))
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}

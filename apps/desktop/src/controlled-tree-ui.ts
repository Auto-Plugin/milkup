/** Keyboard semantics for public controlled trees; no filesystem or plugin-ID knowledge. */
export interface ControlledTreeFocus {
  readonly label: string
  readonly index: number
}

export function decorateControlledTrees(
  root: HTMLElement,
  focus: Map<string, ControlledTreeFocus>,
  activate: (button: HTMLButtonElement, event: KeyboardEvent) => void,
  navigateVirtual?: (tree: HTMLElement, item: HTMLButtonElement, key: string) => boolean,
): void {
  const trees = Array.from(root.querySelectorAll<HTMLElement>('[role="tree"]'))
  for (const [treeIndex, tree] of trees.entries()) {
    const toggles = decorateSeparateTreeControls(tree)
    const items = Array.from(
      tree.querySelectorAll<HTMLButtonElement>('button[role="treeitem"]'),
    ).filter((item) => item.closest('[role="tree"]') === tree && !item.disabled && !item.hidden)
    // Unrecognized wrapper trees retain their own semantics.
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
      if (!(event.target instanceof HTMLButtonElement)) return
      const item = items.includes(event.target)
        ? event.target
        : items.find((candidate) => toggles.get(candidate) === event.target)
      if (item) remember(item)
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
      const target =
        event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null
      const item =
        target &&
        (items.includes(target)
          ? target
          : items.find((candidate) => toggles.get(candidate) === target))
      if (!item || !items.includes(item)) return
      const index = items.indexOf(item)
      const key = event.key === 'Unidentified' ? event.code : event.key
      if (navigateVirtual?.(tree, item, key)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
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
      if (toggle) activate(toggles.get(item) ?? item, event)
      else if (next) {
        remember(next)
        next.focus({ preventScroll: true })
        next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      }
    })
  }
}

/**
 * A public tree may separate navigation from folding. Recognize only an
 * unambiguous row: one current-location button and, for a branch, one matching
 * expansion button. Put the tree semantics on the focusable navigation control;
 * keep the fold button available to pointer users and the arrow-key dispatcher.
 * No plugin ID, command name or private renderer attribute is involved.
 */
function decorateSeparateTreeControls(
  tree: HTMLElement,
): Map<HTMLButtonElement, HTMLButtonElement> {
  const toggles = new Map<HTMLButtonElement, HTMLButtonElement>()
  for (const row of Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))) {
    if (row instanceof HTMLButtonElement || row.closest('[role="tree"]') !== tree) continue
    const buttons = Array.from(row.children).filter(
      (child): child is HTMLButtonElement => child instanceof HTMLButtonElement,
    )
    const navigation = buttons.filter((button) =>
      ['location', 'false'].includes(button.getAttribute('aria-current') ?? ''),
    )
    if (navigation.length !== 1 || buttons.some((button) => button.disabled || button.hidden))
      continue
    const item = navigation[0]!
    const expanded = row.getAttribute('aria-expanded')
    const other = buttons.filter((button) => button !== item)
    if (
      expanded === null
        ? other.length !== 0
        : !['true', 'false'].includes(expanded) ||
          other.length !== 1 ||
          other[0]!.getAttribute('aria-expanded') !== expanded
    )
      continue
    item.setAttribute('role', 'treeitem')
    item.setAttribute('aria-level', row.getAttribute('aria-level') ?? '1')
    row.setAttribute('role', 'none')
    row.removeAttribute('aria-level')
    row.removeAttribute('aria-expanded')
    if (expanded !== null) {
      item.setAttribute('aria-expanded', expanded)
      other[0]!.tabIndex = -1
      toggles.set(item, other[0]!)
    }
  }
  return toggles
}

function level(item: HTMLElement): number {
  const value = Number(item.getAttribute('aria-level'))
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}

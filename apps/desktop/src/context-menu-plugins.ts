import { Puzzle } from 'lucide'
import { iconSvg } from './icons'

const maxVisiblePluginActions = 3

/** Project already-controlled output into flat host-styled actions. Keep the
 * original button so its validated command/input binding and gesture survive. */
export function normalizePluginContextMenuNodes(
  nodes: readonly Node[],
  rendererId: string,
  resolves: (rendererId: string, command: string) => boolean,
): readonly Node[] {
  const result: HTMLButtonElement[] = []
  for (const node of nodes) {
    if (node.nodeType !== 1) continue
    const element = node as HTMLElement
    const candidates = [
      ...(element.matches('button[data-plugin-command]') ? [element] : []),
      ...Array.from(element.querySelectorAll<HTMLElement>('button[data-plugin-command]')),
    ]
    for (const candidate of candidates) {
      if (candidate.querySelector('button')) continue
      const button = candidate as HTMLButtonElement
      const command = button.dataset.pluginCommand
      if (!command || !resolves(rendererId, command)) continue
      const text = (button.getAttribute('aria-label') ?? button.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!text) continue
      const label = Array.from(text).slice(0, 160).join('')
      const disabled = button.disabled
      // No plugin classes, ARIA roles, links or SVG are part of the host menu.
      for (const attribute of Array.from(button.attributes)) button.removeAttribute(attribute.name)
      button.type = 'button'
      button.disabled = disabled
      button.dataset.pluginCommand = command
      button.dataset.contextPluginAction = ''
      button.className = 'editor-context-menu-item'
      button.setAttribute('role', 'menuitem')
      button.setAttribute('aria-label', label)
      const icon = button.ownerDocument.createElement('span')
      icon.className = 'editor-context-menu-icon'
      icon.innerHTML = iconSvg(Puzzle)
      const name = button.ownerDocument.createElement('span')
      name.className = 'editor-context-menu-label'
      name.textContent = label
      button.replaceChildren(icon, name)
      result.push(button)
    }
  }
  return result
}

/** One shared budget across ready plugin/views, including disabled entries.
 * Only the controller can mark a result ready for the current menu opening.
 * Hidden ready overflow can fill vacancies, but pending/retired output must
 * never reappear when a faster sibling completes or is removed. */
export function reconcilePluginContextMenu(slot: HTMLElement): void {
  const active = slot.ownerDocument.activeElement
  const mounts = Array.from(slot.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  )
  mounts.sort((a, b) => {
    const first = a.dataset.pluginUi ?? ''
    const second = b.dataset.pluginUi ?? ''
    return first < second ? -1 : first > second ? 1 : 0
  })
  let remaining = maxVisiblePluginActions
  let visible = 0
  let cursor: Element | null = slot.firstElementChild
  for (const mount of mounts) {
    if (mount !== cursor) slot.insertBefore(mount, cursor)
    cursor = mount.nextElementSibling
    if (mount.dataset.contextMenuState !== 'ready') {
      mount.hidden = true
      mount.tabIndex = -1
      for (const button of Array.from(mount.querySelectorAll('button'))) {
        button.hidden = true
        button.tabIndex = -1
      }
      continue
    }
    let count = 0
    for (const button of Array.from(
      mount.querySelectorAll<HTMLButtonElement>('button[data-context-plugin-action]'),
    )) {
      const allowed = remaining > 0
      button.hidden = !allowed
      button.tabIndex = allowed && !button.disabled ? 0 : -1
      if (allowed) {
        remaining--
        count++
      }
    }
    mount.hidden = count === 0
    visible += count
  }
  slot.hidden = visible === 0
  // Moving an existing mount can blur its focused child; preserve it only while
  // the exact action is still an eligible visible item.
  if (
    active instanceof HTMLElement &&
    slot.contains(active) &&
    !active.closest('[hidden]') &&
    !active.hasAttribute('disabled') &&
    slot.ownerDocument.activeElement !== active
  )
    active.focus({ preventScroll: true })
}

import type { PluginRegistryRecord } from '@milkup/plugin'
import {
  renderDesktopPluginManager,
  type DesktopPluginManagerState,
} from './desktop-plugin-manager'

export type PluginIconLoader = (record: PluginRegistryRecord) => Promise<string | undefined>
const views = new WeakMap<HTMLElement, DesktopPluginManagerView>()

/** Retain navigation and focus across asynchronous manager state changes. */
export function renderDesktopPluginManagerElement(
  target: HTMLElement,
  state: DesktopPluginManagerState,
  loadIcon?: PluginIconLoader,
): void {
  let view = views.get(target)
  if (!view) {
    view = new DesktopPluginManagerView(target, loadIcon)
    views.set(target, view)
  }
  view.render(state)
}

export function revealDesktopPluginDetails(
  target: HTMLElement,
  pluginId: string,
  kind: 'details' | 'settings',
): boolean {
  const view = views.get(target)
  if (!view) return false
  view.openDetail(pluginId)
  if (kind === 'settings') {
    const section = target.querySelector<HTMLElement>('[data-plugin-settings-schema]')
    if (!section) return false
    section.scrollIntoView({ block: 'nearest' })
  }
  return true
}
class DesktopPluginManagerView {
  private state?: DesktopPluginManagerState
  private selectedPluginId: string | undefined
  private selectedFailurePath: string | undefined
  private returnPluginId: string | undefined
  private readonly icons = new Map<string, string>()
  private readonly iconRequests = new Map<string, string>()

  constructor(
    private readonly target: HTMLElement,
    private readonly loadIcon?: PluginIconLoader,
  ) {
    target.addEventListener('click', (event) => {
      const button =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('[data-plugin-action]')
          : null
      if (button?.dataset.pluginAction === 'failure-details' && button.dataset.pluginSource) {
        this.selectedPluginId = undefined
        this.selectedFailurePath = button.dataset.pluginSource
        this.paint()
        this.focusHeading()
      } else if (button?.dataset.pluginAction === 'details' && button.dataset.pluginId) {
        this.selectedFailurePath = undefined
        this.selectedPluginId = button.dataset.pluginId
        this.returnPluginId = button.dataset.pluginId
        this.paint()
        this.focusHeading()
      } else if (button?.dataset.pluginAction === 'back') {
        this.back()
      }
    })
    // Registered before shell Escape handling so one press returns to the list.
    target.ownerDocument.defaultView?.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && !event.isComposing && target.contains(event.target as Node)) {
          const menu = (event.target as Element).closest<HTMLDetailsElement>(
            '[data-plugin-card-more][open]',
          )
          if (menu) {
            event.preventDefault()
            event.stopImmediatePropagation()
            menu.open = false
            menu.querySelector<HTMLElement>('summary')?.focus()
            return
          }
        }
        if (
          event.key !== 'Escape' ||
          event.isComposing ||
          (!this.selectedPluginId && !this.selectedFailurePath) ||
          !target.contains(event.target as Node) ||
          target.getClientRects().length === 0
        )
          return
        event.preventDefault()
        event.stopImmediatePropagation()
        this.back()
      },
      true,
    )
    target.addEventListener(
      'error',
      (event) => {
        if (
          event.target instanceof HTMLImageElement &&
          event.target.hasAttribute('data-plugin-icon')
        ) {
          event.target.remove()
        }
      },
      true,
    )
  }

  render(state: DesktopPluginManagerState): void {
    const previous = this.state
    // Keep the first visible order across catalog active/pending projection changes.
    // New installations append; removing a plugin really removes its card.
    const records = new Map(state.records.map((record) => [record.manifest.id, record]))
    const ordered =
      previous?.records.flatMap((record) => {
        const next = records.get(record.manifest.id)
        records.delete(record.manifest.id)
        return next ? [next] : []
      }) ?? []
    state = { ...state, records: [...ordered, ...records.values()] }
    const active = this.target.ownerDocument.activeElement
    const focused =
      active instanceof HTMLElement && this.target.contains(active) ? active : undefined
    const previousIndex =
      previous?.records.findIndex((record) => record.manifest.id === this.selectedPluginId) ?? -1
    const removed =
      this.selectedPluginId &&
      !state.records.some((record) => record.manifest.id === this.selectedPluginId)
    const added =
      previous &&
      focused?.dataset.pluginAction === 'install' &&
      this.target.getClientRects().length > 0 &&
      state.records.find(
        (record) => !previous.records.some((old) => old.manifest.id === record.manifest.id),
      )
    const candidateChanged = state.catalogEntries?.find(
      (entry) =>
        entry.pending &&
        entry.pending.transactionId !==
          previous?.catalogEntries?.find((old) => old.id === entry.id)?.pending?.transactionId,
    )
    // Only a foreground installation may navigate to its candidate; background
    // staging must not replace the list or a different plugin's current detail.
    const navigateToCandidate =
      focused?.dataset.pluginAction === 'install' ? candidateChanged : undefined
    const newFailure = state.installFailures.find(
      (f) =>
        !previous?.installFailures.some(
          (old) => old.sourcePath === f.sourcePath && old.at === f.at,
        ),
    )
    this.state = state
    const navigateToFailure = focused?.dataset.pluginAction === 'install' ? newFailure : undefined
    if (navigateToFailure && previous && this.target.getClientRects().length > 0) {
      this.selectedPluginId = undefined
      this.selectedFailurePath = navigateToFailure.sourcePath
    } else if (navigateToCandidate && previous && this.target.getClientRects().length > 0) {
      this.selectedFailurePath = undefined
      this.selectedPluginId = navigateToCandidate.id
      this.returnPluginId = navigateToCandidate.id
    } else if (removed) {
      this.selectedPluginId = undefined
      this.returnPluginId =
        state.records[Math.min(previousIndex, state.records.length - 1)]?.manifest.id
    } else if (added) {
      // New installs open their permissions and controls immediately.
      this.selectedPluginId = added.manifest.id
      this.returnPluginId = added.manifest.id
    }
    this.refreshIcons(state)
    this.paint()
    if ((added || navigateToFailure || navigateToCandidate) && focused) this.focusHeading()
    else if (removed && focused) this.focusCard()
    else if (focused && this.target.ownerDocument.activeElement !== focused) {
      const replacement = Array.from(
        this.target.querySelectorAll<HTMLElement>(
          '[data-plugin-action], [data-plugin-card-more-trigger]',
        ),
      ).find(
        (element) =>
          element.dataset.pluginCardMoreTrigger === focused.dataset.pluginCardMoreTrigger &&
          element.dataset.pluginAction === focused.dataset.pluginAction &&
          element.dataset.pluginId === focused.dataset.pluginId &&
          element.dataset.pluginCommand === focused.dataset.pluginCommand &&
          element.dataset.pluginUiId === focused.dataset.pluginUiId,
      )
      if (replacement) replacement.focus({ preventScroll: true })
      else if (this.selectedPluginId) this.focusHeading(true)
      else this.focusCard(true)
    }
  }

  openDetail(pluginId: string): void {
    if (!this.state?.records.some((record) => record.manifest.id === pluginId))
      throw new Error('Unknown plugin detail')
    this.selectedFailurePath = undefined
    this.selectedPluginId = pluginId
    this.returnPluginId = pluginId
    this.paint()
    this.focusHeading()
  }
  private paint(): void {
    if (!this.state) return
    const template = this.target.ownerDocument.createElement('template')
    template.innerHTML = renderDesktopPluginManager(this.state, {
      ...(this.selectedPluginId ? { selectedPluginId: this.selectedPluginId } : {}),
      icons: this.icons,
      ...(this.selectedFailurePath ? { selectedFailurePath: this.selectedFailurePath } : {}),
    })
    reconcileChildren(this.target, template.content)
  }

  private back(): void {
    this.selectedPluginId = undefined
    this.selectedFailurePath = undefined
    this.paint()
    this.focusCard()
  }

  private focusHeading(preventScroll = false): void {
    this.target.querySelector<HTMLElement>('#plugin-detail-title')?.focus({ preventScroll })
  }

  private focusCard(preventScroll = false): void {
    const cards = Array.from(
      this.target.querySelectorAll<HTMLButtonElement>(
        '[data-plugin-action="details"], [data-plugin-action="failure-details"]',
      ),
    )
    const card = cards.find((element) => element.dataset.pluginId === this.returnPluginId)
    ;(
      card ??
      cards[0] ??
      this.target.querySelector<HTMLButtonElement>('[data-plugin-action="install"]')
    )?.focus({ preventScroll })
  }

  private refreshIcons(state: DesktopPluginManagerState): void {
    if (!this.loadIcon) return
    for (const record of state.records) {
      const id = record.manifest.id
      const key = JSON.stringify([
        record.manifestPath,
        record.manifest.version,
        record.manifest.icon,
      ])
      if (this.iconRequests.get(id) === key) continue
      this.iconRequests.set(id, key)
      this.icons.delete(id)
      void this.loadIcon(record)
        .then((icon) => {
          if (
            this.iconRequests.get(id) !== key ||
            !icon ||
            !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(icon)
          )
            return
          this.icons.set(id, icon)
          // Update images in place; asynchronous image arrival must not steal focus.
          for (const card of Array.from(
            this.target.querySelectorAll<HTMLElement>('.plugin-summary-card, .plugin-detail'),
          )) {
            if (
              card.dataset.pluginId !== id &&
              !(card.classList.contains('plugin-detail') && this.selectedPluginId === id)
            )
              continue
            const logo = card.querySelector('.plugin-logo')
            if (!logo || logo.querySelector('img')) continue
            const image = this.target.ownerDocument.createElement('img')
            image.alt = ''
            image.dataset.pluginIcon = ''
            image.src = icon
            logo.append(image)
          }
        })
        .catch(() => undefined)
    }
    for (const id of this.iconRequests.keys()) {
      if (!state.records.some((record) => record.manifest.id === id)) {
        this.iconRequests.delete(id)
        this.icons.delete(id)
      }
    }
  }
}

/** Reconcile only trusted manager markup; preserve live controls and disclosure state. */
function reconcileChildren(current: Node, next: Node): void {
  const available = new Map<string, Node[]>()
  for (const child of Array.from(current.childNodes)) {
    const key = nodeIdentity(child)
    const matches = available.get(key) ?? []
    matches.push(child)
    available.set(key, matches)
  }
  const children = Array.from(next.childNodes).map((desired) => ({
    desired,
    retained: available.get(nodeIdentity(desired))?.shift(),
  }))
  // Remove obsolete controls first, so inserting/removing a reload or panel button
  // never detaches the retained, possibly focused export/details/switch control.
  for (const obsolete of available.values()) for (const node of obsolete) current.removeChild(node)
  let cursor = current.firstChild
  for (const { desired, retained } of children) {
    const node = retained ?? desired
    if (node !== cursor) current.insertBefore(node, cursor)
    if (retained) reconcileNode(retained, desired)
    cursor = node.nextSibling
  }
}

function nodeIdentity(node: Node): string {
  if (!(node instanceof Element)) return String(node.nodeType)
  // Action identity prevents an inserted command from becoming a different button.
  return JSON.stringify([
    node.namespaceURI,
    node.tagName,
    node.id,
    node.getAttribute('class'),
    ...[
      'data-plugin-id',
      'data-plugin-action',
      'data-plugin-command',
      'data-plugin-ui-id',
      'data-plugin-source',
      'data-plugin-card-more',
      'data-plugin-card-more-trigger',
    ].map((name) => node.getAttribute(name)),
  ])
}

function reconcileNode(current: Node, next: Node): void {
  if (current.isEqualNode(next)) return
  if (current instanceof Element && next instanceof Element) {
    for (const attribute of Array.from(current.attributes)) {
      if (current instanceof HTMLDetailsElement && attribute.name === 'open') continue
      if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name)
    }
    for (const attribute of Array.from(next.attributes)) {
      if (current.getAttribute(attribute.name) !== attribute.value)
        current.setAttribute(attribute.name, attribute.value)
    }
    reconcileChildren(current, next)
  } else if (current.nodeValue !== next.nodeValue) {
    current.nodeValue = next.nodeValue
  }
}

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
    // A bundled upgrade staged by the card switch must keep that same control in place.
    const navigateToCandidate =
      focused?.dataset.pluginAction !== 'toggle' ? candidateChanged : undefined
    const newFailure = state.installFailures.find(
      (f) =>
        !previous?.installFailures.some(
          (old) => old.sourcePath === f.sourcePath && old.at === f.at,
        ),
    )
    this.state = state
    if (newFailure && previous && this.target.getClientRects().length > 0) {
      this.selectedPluginId = undefined
      this.selectedFailurePath = newFailure.sourcePath
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
    if ((added || newFailure || navigateToCandidate) && focused) this.focusHeading()
    else if (removed && focused) this.focusCard()
    else if (focused) {
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
      if (replacement) replacement.focus()
      else if (this.selectedPluginId) this.focusHeading()
      else this.focusCard()
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
    const opened = new Set(
      Array.from(
        this.target.querySelectorAll<HTMLDetailsElement>('[data-plugin-card-more][open]'),
      ).map((menu) => menu.dataset.pluginCardMore),
    )
    this.target.innerHTML = renderDesktopPluginManager(this.state, {
      ...(this.selectedPluginId ? { selectedPluginId: this.selectedPluginId } : {}),
      icons: this.icons,
      ...(this.selectedFailurePath ? { selectedFailurePath: this.selectedFailurePath } : {}),
    })
    for (const menu of Array.from(
      this.target.querySelectorAll<HTMLDetailsElement>('[data-plugin-card-more]'),
    ))
      menu.open = opened.has(menu.dataset.pluginCardMore)
  }

  private back(): void {
    this.selectedPluginId = undefined
    this.selectedFailurePath = undefined
    this.paint()
    this.focusCard()
  }

  private focusHeading(): void {
    this.target.querySelector<HTMLElement>('#plugin-detail-title')?.focus()
  }

  private focusCard(): void {
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
    )?.focus()
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

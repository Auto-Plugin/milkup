import { ChevronRight, Circle, type IconNode } from 'lucide'
import { iconSvg } from './icons'

/** These models are created by the host, never deserialized from plugin output. */
export interface HostContextMenuItem {
  readonly id: string
  readonly label: string
  readonly icon?: IconNode
  readonly shortcut?: string
  readonly disabled?: boolean
  readonly separatorBefore?: boolean
  readonly children?: readonly HostContextMenuItem[]
}

export interface HostContextMenuSnapshot {
  readonly identity: unknown
  readonly version: number
  readonly selection: unknown
}

export interface HostContextMenuAdapter<Snapshot extends HostContextMenuSnapshot> {
  capture(): Snapshot | undefined
  items(snapshot: Snapshot): readonly HostContextMenuItem[]
  isCurrent(snapshot: Snapshot): boolean
  execute(
    id: string,
    snapshot: Snapshot,
    originalEvent?: Event,
    signal?: AbortSignal,
  ): void | Promise<void>
}

export interface EditorContextMenuOptions<Snapshot extends HostContextMenuSnapshot> {
  readonly host?: HostContextMenuAdapter<Snapshot>
  /** A separate slot owned by the controlled plugin renderer, limited there to three actions. */
  readonly pluginContainer?: HTMLElement
  /** Editor lifecycle availability, independent of whether plugins contribute anything. */
  available?(): boolean
  identity?(): unknown
  refresh?(): Promise<void>
  visible?(value: boolean): void
  onError?(error: unknown): void
}

let nextMenuId = 0

/** Synchronously shows host actions; asynchronous plugin work can only fill its own slot. */
export class EditorContextMenu<Snapshot extends HostContextMenuSnapshot = HostContextMenuSnapshot> {
  private generation = 0
  private returnFocus: HTMLElement | undefined
  private documentIdentity: unknown
  private snapshot: Snapshot | undefined
  private disposed = false
  private execution: AbortController | undefined
  private pendingAction = false
  private focusedPluginItem: HTMLElement | undefined
  private readonly hostContainer: HTMLElement | undefined
  private readonly submenus = new Map<HTMLButtonElement, HTMLElement>()
  private readonly parents = new Map<HTMLElement, HTMLButtonElement>()
  private readonly actions = new Map<HTMLButtonElement, HostContextMenuItem>()
  private readonly instanceId = ++nextMenuId
  private anchor = { x: 0, y: 0 }

  constructor(
    private readonly editor: HTMLElement,
    private readonly menu: HTMLElement,
    private readonly options: EditorContextMenuOptions<Snapshot>,
  ) {
    menu.hidden = true
    menu.classList.add('editor-context-menu')
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', '编辑操作')
    menu.tabIndex = -1
    if (options.host) {
      this.hostContainer = menu.ownerDocument.createElement('div')
      this.hostContainer.dataset.hostContextMenu = ''
      this.hostContainer.setAttribute('role', 'group')
      menu.prepend(this.hostContainer)
    }
    if (options.pluginContainer) {
      options.pluginContainer.classList.add('editor-context-menu-plugins')
      options.pluginContainer.setAttribute('role', 'group')
      options.pluginContainer.setAttribute('aria-label', '扩展操作')
    }
    editor.addEventListener('contextmenu', this.onContextMenu)
    editor.addEventListener('keydown', this.onEditorKey)
    menu.addEventListener('keydown', this.onMenuKey)
    menu.addEventListener('pointerdown', this.onMenuPointerDown)
    menu.addEventListener('pointerover', this.onMenuPointerOver)
    menu.addEventListener('click', this.guardAction, true)
    menu.addEventListener('click', this.onMenuClick)
    menu.addEventListener('milkup-plugin-renderer-action', this.guardAction, true)
    menu.addEventListener('milkup-plugin-renderer-action', this.onPluginAction)
    menu.ownerDocument.addEventListener('pointerdown', this.onOutsidePointer, true)
    menu.ownerDocument.addEventListener('focusin', this.onDocumentFocus)
    menu.ownerDocument.addEventListener('scroll', this.onScroll, true)
    menu.ownerDocument.defaultView?.addEventListener('blur', this.onWindowBlur)
    menu.ownerDocument.defaultView?.addEventListener('resize', this.onWindowResize)
  }

  private available(): boolean {
    return !this.disposed && (this.options.available?.() ?? true)
  }

  private current(): boolean {
    return (
      this.available() &&
      (this.options.host
        ? this.snapshot !== undefined && this.options.host.isCurrent(this.snapshot)
        : this.documentIdentity === this.options.identity?.())
    )
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (!this.available()) return
    event.preventDefault()
    void this.open(event.clientX, event.clientY)
  }

  private readonly onEditorKey = (event: KeyboardEvent): void => {
    if (event.isComposing || event.defaultPrevented || !this.available()) return
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
    event.preventDefault()
    const active = this.editor.ownerDocument.activeElement
    const bounds = (active instanceof HTMLElement ? active : this.editor).getBoundingClientRect()
    void this.open(bounds.left, bounds.bottom)
  }

  private readonly onMenuKey = (event: KeyboardEvent): void => {
    if (this.menu.hidden || event.isComposing || event.defaultPrevented) return
    if (!this.current()) {
      event.preventDefault()
      event.stopPropagation()
      this.close(false)
      return
    }
    const active = this.menu.ownerDocument.activeElement as HTMLElement | null
    const scope = active?.closest<HTMLElement>('[role="menu"]') ?? this.menu
    const parent = this.parents.get(scope)
    if (event.key === 'Escape' || (event.key === 'ArrowLeft' && parent)) {
      event.preventDefault()
      event.stopPropagation()
      if (parent && !this.pendingAction) {
        this.hideSubmenu(parent)
        this.focus(parent)
      } else this.close(true)
      return
    }
    if (event.key === 'Tab') {
      // Restore the originating editor and let the browser continue normal tab order.
      this.close(true)
      return
    }
    if (this.pendingAction) {
      event.preventDefault()
      return
    }
    if (event.key === 'ArrowRight' && active instanceof HTMLButtonElement) {
      if (this.submenus.has(active)) {
        event.preventDefault()
        event.stopPropagation()
        this.showSubmenu(active, true)
      }
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (active instanceof HTMLButtonElement && this.actions.has(active)) {
        event.preventDefault()
        event.stopPropagation()
        this.runHostAction(active, event)
      }
      // Controlled plugin buttons need the browser's trusted keyboard click.
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = this.items(scope)
    if (!items.length) return
    event.preventDefault()
    event.stopPropagation()
    const current = items.indexOf(active as HTMLElement)
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : current < 0
            ? event.key === 'ArrowDown'
              ? 0
              : items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    const next = items[index]
    if (next) {
      this.closeSiblingSubmenus(scope, next)
      this.focus(next)
    }
  }

  private readonly onMenuPointerDown = (event: PointerEvent): void => {
    // A menu gesture must not alter the editor's DOM selection before execution.
    if (event.target instanceof Element && event.target.closest('[role="menuitem"]'))
      event.preventDefault()
  }

  private readonly onMenuPointerOver = (event: PointerEvent): void => {
    const button = this.button(event)
    if (!button || button.disabled || this.pendingAction || !this.current()) return
    const scope = button.closest<HTMLElement>('[role="menu"]') ?? this.menu
    this.closeSiblingSubmenus(scope, button)
    this.focus(button)
    if (this.submenus.has(button)) this.showSubmenu(button, false)
  }

  private readonly guardAction = (event: Event): void => {
    // Runs before controlled plugin handlers, which stop propagation of the click.
    const valid = !this.menu.hidden && this.current()
    const button = this.button(event)
    const actionable =
      !button ||
      (!button.disabled &&
        button.getAttribute('aria-disabled') !== 'true' &&
        !button.closest('[hidden]'))
    if (valid && actionable && !this.pendingAction) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!valid) this.close(false)
  }

  private readonly onMenuClick = (event: MouseEvent): void => {
    const button = this.button(event)
    if (!button || button.disabled) return
    if (this.actions.has(button)) this.runHostAction(button, event)
    else if (button.hasAttribute('data-plugin-command')) this.close(false)
  }

  private runHostAction(button: HTMLButtonElement, event: Event): void {
    if (button.disabled || this.pendingAction || !this.current()) return
    const action = this.actions.get(button)
    if (action && this.snapshot && this.options.host) {
      if (this.submenus.has(button)) {
        this.showSubmenu(button, true)
        return
      }
      const execution = this.execution!
      const generation = this.generation
      try {
        // No await before dispatch: clipboard permissions belong to this user gesture.
        const result = this.options.host.execute(action.id, this.snapshot, event, execution.signal)
        if (result && typeof result.then === 'function') {
          if (generation === this.generation) {
            this.pendingAction = true
            this.menu.setAttribute('aria-busy', 'true')
          }
          void result
            .then(() => {
              if (generation === this.generation) this.closeAfterAction()
            })
            .catch((error: unknown) => {
              if (generation === this.generation) {
                this.pendingAction = false
                this.menu.removeAttribute('aria-busy')
              }
              if (!execution.signal.aborted) this.options.onError?.(error)
            })
        } else if (generation === this.generation) this.closeAfterAction()
      } catch (error) {
        this.options.onError?.(error)
      }
    }
  }

  private readonly onPluginAction = (): void => {
    // The controlled command has run; preserve any modal/chooser focus it established.
    this.close(false)
  }

  private button(event: Event): HTMLButtonElement | null {
    const button =
      event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null
    return button && this.menu.contains(button) ? button : null
  }

  private readonly onOutsidePointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.menu.contains(event.target)) this.close(false)
  }

  private readonly onDocumentFocus = (event: FocusEvent): void => {
    this.focusedPluginItem =
      event.target instanceof HTMLElement && this.options.pluginContainer?.contains(event.target)
        ? event.target
        : undefined
  }

  private readonly onScroll = (event: Event): void => {
    if (this.menu.hidden) return
    if (event.target instanceof Node && this.menu.contains(event.target)) this.reconcileLayout()
    else this.close(false)
  }

  private readonly onWindowBlur = (): void => this.close(false)
  private readonly onWindowResize = (): void => this.close(false)

  private items(scope = this.menu): HTMLElement[] {
    return Array.from(
      scope.querySelectorAll<HTMLElement>('button, a[href], [role="menuitem"]'),
    ).filter(
      (element) =>
        !element.hasAttribute('disabled') &&
        element.getAttribute('aria-disabled') !== 'true' &&
        !element.closest('[hidden]') &&
        element.closest('[role="menu"]') === scope,
    )
  }

  private focus(item: HTMLElement): void {
    for (const candidate of Array.from(
      this.menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ))
      candidate.tabIndex = candidate === item ? 0 : -1
    item.focus({ preventScroll: true })
    item.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  private renderHost(snapshot: Snapshot): void {
    if (!this.hostContainer || !this.options.host) return
    this.submenus.clear()
    this.parents.clear()
    this.actions.clear()
    this.hostContainer.replaceChildren()
    this.renderItems(this.hostContainer, this.options.host.items(snapshot))
  }

  private renderItems(container: HTMLElement, items: readonly HostContextMenuItem[]): void {
    const document = this.menu.ownerDocument
    for (const item of items) {
      if (item.separatorBefore && container.childElementCount) {
        const separator = document.createElement('div')
        separator.className = 'editor-context-menu-separator'
        separator.setAttribute('role', 'separator')
        container.append(separator)
      }
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'editor-context-menu-item'
      button.dataset.hostContextCommand = item.id
      button.setAttribute('role', 'menuitem')
      button.tabIndex = -1
      button.disabled = item.disabled === true
      const icon = document.createElement('span')
      icon.className = 'editor-context-menu-icon'
      // iconSvg is a host Lucide serializer, not an external SVG sanitizer.
      icon.innerHTML = iconSvg(item.icon ?? Circle)
      const label = document.createElement('span')
      label.className = 'editor-context-menu-label'
      label.textContent = item.label
      button.append(icon, label)
      if (item.shortcut) {
        const shortcut = document.createElement('span')
        shortcut.className = 'editor-context-menu-shortcut'
        shortcut.textContent = item.shortcut
        button.append(shortcut)
      }
      container.append(button)
      this.actions.set(button, item)
      if (item.children?.length) {
        const chevron = document.createElement('span')
        chevron.className = 'editor-context-menu-chevron'
        chevron.innerHTML = iconSvg(ChevronRight)
        button.append(chevron)
        const submenu = document.createElement('div')
        submenu.className = 'editor-context-submenu'
        submenu.id = `editor-context-submenu-${this.instanceId}-${this.submenus.size}`
        submenu.hidden = true
        submenu.setAttribute('role', 'menu')
        submenu.setAttribute('aria-label', item.label)
        button.setAttribute('aria-haspopup', 'menu')
        button.setAttribute('aria-expanded', 'false')
        button.setAttribute('aria-controls', submenu.id)
        this.submenus.set(button, submenu)
        this.parents.set(submenu, button)
        container.append(submenu)
        this.renderItems(submenu, item.children)
      }
    }
  }

  private showSubmenu(button: HTMLButtonElement, focusFirst: boolean): void {
    const submenu = this.submenus.get(button)
    if (!submenu || button.disabled) return
    this.closeSiblingSubmenus(button.closest<HTMLElement>('[role="menu"]') ?? this.menu, button)
    submenu.hidden = false
    button.setAttribute('aria-expanded', 'true')
    this.positionSubmenu(button, submenu)
    if (focusFirst) {
      const first = this.items(submenu)[0]
      if (first) this.focus(first)
    }
  }

  private positionSubmenu(button: HTMLButtonElement, submenu: HTMLElement): void {
    const bounds = button.getBoundingClientRect()
    const width = submenu.getBoundingClientRect().width
    const viewport = this.menu.ownerDocument.defaultView!
    const x = bounds.right + width + 8 <= viewport.innerWidth ? bounds.right : bounds.left - width
    this.position(submenu, x, bounds.top)
  }

  private hideSubmenu(button: HTMLButtonElement): void {
    const submenu = this.submenus.get(button)
    if (!submenu) return
    for (const [child] of this.submenus) if (submenu.contains(child)) this.hideSubmenu(child)
    submenu.hidden = true
    button.setAttribute('aria-expanded', 'false')
  }

  private closeSiblingSubmenus(scope: HTMLElement, except?: HTMLElement): void {
    for (const [button] of this.submenus)
      if (button !== except && button.closest('[role="menu"]') === scope) this.hideSubmenu(button)
  }

  private position(element: HTMLElement, x: number, y: number): void {
    const window = this.menu.ownerDocument.defaultView!
    const marginX = Math.min(8, Math.max(0, window.innerWidth / 2))
    const marginY = Math.min(8, Math.max(0, window.innerHeight / 2))
    element.style.maxWidth = `${Math.max(0, window.innerWidth - 2 * marginX)}px`
    element.style.maxHeight = `${Math.max(0, window.innerHeight - 2 * marginY)}px`
    const bounds = element.getBoundingClientRect()
    element.style.left = `${Math.max(marginX, Math.min(x, window.innerWidth - bounds.width - marginX))}px`
    element.style.top = `${Math.max(marginY, Math.min(y, window.innerHeight - bounds.height - marginY))}px`
  }

  private preparePluginItems(): void {
    const container = this.options.pluginContainer ?? this.menu
    for (const item of Array.from(container.querySelectorAll<HTMLElement>('button, a[href]'))) {
      item.setAttribute('role', 'menuitem')
      if (item !== this.menu.ownerDocument.activeElement) item.tabIndex = -1
    }
  }

  private hasVisiblePluginItems(container: HTMLElement): boolean {
    return Array.from(container.querySelectorAll<HTMLElement>('button, a[href]')).some((item) => {
      let node: HTMLElement | null = item
      while (node && node !== container) {
        if (node.hidden) return false
        node = node.parentElement
      }
      return true
    })
  }

  async open(x: number, y: number): Promise<void> {
    if (!this.available()) return
    const snapshot = this.options.host?.capture()
    if (this.options.host && !snapshot) {
      this.close(false)
      return
    }
    this.execution?.abort()
    this.execution = new AbortController()
    this.pendingAction = false
    this.menu.removeAttribute('aria-busy')
    const generation = ++this.generation
    const active = this.editor.ownerDocument.activeElement
    if (active instanceof HTMLElement && this.editor.contains(active)) this.returnFocus = active
    else if (!this.menu.contains(active)) this.returnFocus = undefined
    this.documentIdentity = this.options.identity?.()
    this.snapshot = snapshot
    if (snapshot) this.renderHost(snapshot)
    this.anchor = { x, y }
    if (this.options.pluginContainer) this.options.pluginContainer.hidden = true
    this.menu.hidden = false
    this.preparePluginItems()
    this.position(this.menu, x, y)
    const first = this.items()[0]
    if (first) this.focus(first)
    else this.menu.focus({ preventScroll: true })
    this.options.visible?.(true)
    try {
      await this.options.refresh?.()
    } catch {
      // Extension failures must leave the already usable host menu alone.
      if (generation === this.generation && !this.current()) this.close(false)
      return
    }
    if (this.disposed || generation !== this.generation) return
    if (!this.current()) {
      this.close(false)
      return
    }
    if (this.options.pluginContainer)
      this.options.pluginContainer.hidden = !this.hasVisiblePluginItems(
        this.options.pluginContainer,
      )
    this.reconcileLayout()
    // Never refocus here: an asynchronous extension may arrive after navigation.
  }

  reconcile(): void {
    if (!this.menu.hidden && !this.current()) this.close(false)
  }

  /** Plugin updates may change height, but cannot rebuild host rows or move focus. */
  reconcileLayout(): void {
    if (this.menu.hidden) return
    if (!this.current()) {
      this.close(false)
      return
    }
    const active = this.menu.ownerDocument.activeElement
    const detachedPluginFocus =
      this.focusedPluginItem &&
      !this.focusedPluginItem.isConnected &&
      active === this.menu.ownerDocument.body
    const hiddenPluginFocus =
      active instanceof HTMLElement &&
      this.options.pluginContainer?.contains(active) &&
      (active.closest('[hidden]') ||
        active.hasAttribute('disabled') ||
        active.getAttribute('aria-disabled') === 'true')
    this.preparePluginItems()
    this.position(this.menu, this.anchor.x, this.anchor.y)
    for (const [button, submenu] of this.submenus)
      if (!submenu.hidden) this.positionSubmenu(button, submenu)
    if (hiddenPluginFocus || detachedPluginFocus) {
      const next = this.items()[0]
      if (next) this.focus(next)
      else this.menu.focus({ preventScroll: true })
    }
  }

  private closeAfterAction(): void {
    this.close(this.menu.contains(this.menu.ownerDocument.activeElement))
  }

  close(restoreFocus = false): void {
    this.generation++
    this.execution?.abort()
    this.execution = undefined
    this.pendingAction = false
    this.focusedPluginItem = undefined
    this.menu.removeAttribute('aria-busy')
    const wasVisible = !this.menu.hidden
    this.menu.hidden = true
    this.snapshot = undefined
    this.closeSiblingSubmenus(this.menu)
    if (wasVisible) this.options.visible?.(false)
    if (restoreFocus && wasVisible && this.returnFocus?.isConnected)
      this.returnFocus.focus({ preventScroll: true })
    this.returnFocus = undefined
  }

  dispose(): void {
    this.close(false)
    this.disposed = true
    this.editor.removeEventListener('contextmenu', this.onContextMenu)
    this.editor.removeEventListener('keydown', this.onEditorKey)
    this.menu.removeEventListener('keydown', this.onMenuKey)
    this.menu.removeEventListener('pointerdown', this.onMenuPointerDown)
    this.menu.removeEventListener('pointerover', this.onMenuPointerOver)
    this.menu.removeEventListener('click', this.guardAction, true)
    this.menu.removeEventListener('click', this.onMenuClick)
    this.menu.removeEventListener('milkup-plugin-renderer-action', this.guardAction, true)
    this.menu.removeEventListener('milkup-plugin-renderer-action', this.onPluginAction)
    this.menu.ownerDocument.removeEventListener('pointerdown', this.onOutsidePointer, true)
    this.menu.ownerDocument.removeEventListener('focusin', this.onDocumentFocus)
    this.menu.ownerDocument.removeEventListener('scroll', this.onScroll, true)
    this.menu.ownerDocument.defaultView?.removeEventListener('blur', this.onWindowBlur)
    this.menu.ownerDocument.defaultView?.removeEventListener('resize', this.onWindowResize)
  }
}

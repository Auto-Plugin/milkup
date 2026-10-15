/** A host-owned menu shell. Its contents come from ordinary plugin contributions. */
export class EditorContextMenu {
  private generation = 0
  private returnFocus: HTMLElement | undefined
  private documentIdentity: unknown
  private disposed = false

  constructor(
    private readonly editor: HTMLElement,
    private readonly menu: HTMLElement,
    private readonly options: {
      available(): boolean
      identity(): unknown
      refresh(): Promise<void>
      visible(value: boolean): void
    },
  ) {
    menu.hidden = true
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', '编辑操作')
    editor.addEventListener('contextmenu', this.onContextMenu)
    editor.addEventListener('keydown', this.onEditorKey)
    menu.addEventListener('keydown', this.onMenuKey)
    menu.addEventListener('click', this.onMenuClick)
    menu.ownerDocument.addEventListener('pointerdown', this.onOutsidePointer, true)
    menu.ownerDocument.defaultView?.addEventListener('blur', this.onWindowBlur)
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (!this.options.available()) return
    event.preventDefault()
    void this.open(event.clientX, event.clientY)
  }

  private readonly onEditorKey = (event: KeyboardEvent): void => {
    if (event.isComposing || event.defaultPrevented || !this.options.available()) return
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
    event.preventDefault()
    const active = this.editor.ownerDocument.activeElement
    const bounds = (active instanceof HTMLElement ? active : this.editor).getBoundingClientRect()
    void this.open(bounds.left, bounds.bottom)
  }

  private readonly onMenuKey = (event: KeyboardEvent): void => {
    if (event.isComposing || event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close(true)
      return
    }
    if (event.key === 'Tab') {
      this.close(true)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = this.items()
    if (!items.length) return
    event.preventDefault()
    const current = items.indexOf(this.menu.ownerDocument.activeElement as HTMLElement)
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[index]?.focus()
  }

  private readonly onMenuClick = (event: MouseEvent): void => {
    const button =
      event.target instanceof Element ? event.target.closest('button[data-plugin-command]') : null
    // Controlled action dispatch runs before this bubbling listener. Do not move
    // focus away from a modal or chooser that the command has just opened.
    if (button && this.menu.contains(button) && !button.hasAttribute('disabled')) this.close(false)
  }

  private readonly onOutsidePointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.menu.contains(event.target)) this.close(false)
  }

  private readonly onWindowBlur = (): void => this.close(false)

  private items(): HTMLElement[] {
    return Array.from(
      this.menu.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]'),
    ).filter((element) => !element.hasAttribute('disabled') && !element.hidden)
  }

  async open(x: number, y: number): Promise<void> {
    if (this.disposed || !this.options.available()) return
    const generation = ++this.generation
    const identity = this.options.identity()
    const active = this.editor.ownerDocument.activeElement
    this.returnFocus =
      active instanceof HTMLElement && this.editor.contains(active) ? active : undefined
    this.documentIdentity = identity
    this.options.visible(true)
    try {
      await this.options.refresh()
    } catch {
      if (generation === this.generation) this.close(false)
      return
    }
    if (this.disposed || generation !== this.generation) return
    if (identity !== this.options.identity() || !this.options.available()) {
      this.close(false)
      return
    }
    this.menu.hidden = false
    const window = this.menu.ownerDocument.defaultView!
    const bounds = this.menu.getBoundingClientRect()
    this.menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`
    this.menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`
    for (const item of this.items()) item.setAttribute('role', 'menuitem')
    this.items()[0]?.focus()
  }

  reconcile(): void {
    if (this.documentIdentity !== this.options.identity() || !this.options.available())
      this.close(false)
  }

  close(restoreFocus = false): void {
    this.generation++
    const wasVisible = !this.menu.hidden
    this.menu.hidden = true
    this.options.visible(false)
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
    this.menu.removeEventListener('click', this.onMenuClick)
    this.menu.ownerDocument.removeEventListener('pointerdown', this.onOutsidePointer, true)
    this.menu.ownerDocument.defaultView?.removeEventListener('blur', this.onWindowBlur)
  }
}

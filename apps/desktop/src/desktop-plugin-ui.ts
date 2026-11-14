import type { PluginContributionIndex, PluginUiBinding } from '@milkup/plugin'
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  GripHorizontal,
  ListTree,
  LoaderCircle,
} from 'lucide'
import {
  createControlledRendererNodes,
  type ControlledRendererActionDetail,
  type ControlledRendererOutput,
} from '@milkup/view-dom'

import { ControlledFormState, revealModalFocus } from './controlled-form-ui'

import type { DesktopPluginUiPhase } from './desktop-plugin-manager'
import { iconSvg } from './icons'
import { decorateControlledTrees, type ControlledTreeFocus } from './controlled-tree-ui'
import {
  FloatingDocumentToolbar,
  type FloatingDocumentToolbarHost,
} from './floating-document-toolbar'

export interface DesktopPluginUiOptions {
  readonly documentToolbar?: FloatingDocumentToolbarHost
  readonly contextMenu?: {
    normalize(nodes: readonly Node[], rendererId: string): readonly Node[]
    updated?(): void
  }
}

export interface DesktopPluginUiRuntime {
  contributions(): PluginContributionIndex
  /** Host-owned execution identity, independent of stable plugin/view IDs. */
  generation?(pluginId: string): number
  renderUi(
    pluginId: string,
    viewId: string,
    phase: DesktopPluginUiPhase,
    state?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>
  resolveCommand(rendererId: string, command: string): string | undefined
  runCommand(command: string, input: unknown, originalEvent?: Event): void
}

interface MountedPluginUi {
  readonly contribution: PluginUiBinding
  readonly container: HTMLElement
  readonly body: HTMLElement
  readonly toggle?: HTMLButtonElement
  readonly resizeHandle?: HTMLElement
  readonly documentId: string
  readonly executionGeneration: number | undefined
  renderSequence: number
  renderSignature: string | undefined
  pendingFocusLabel: string | undefined
  readonly forms: ControlledFormState
  readonly treeFocus: Map<string, ControlledTreeFocus>
  virtualViewport?: PluginVirtualViewportState
  virtualScrollTimer?: ReturnType<typeof setTimeout>
  virtualScrollRequest?: VirtualScrollRequest
  virtualScrollTop?: number
  virtualUserIntentUntil?: number
  virtualPointerActive?: boolean
  virtualPointerCleanup?: () => void
  virtualPendingEdgeHint?: 'before' | 'after'
  virtualRequestSequence?: number
  virtualAdjustmentRevision?: number
  virtualTreeFocus?: {
    id: string
    target: number
    total: number
    anchor: Element
    documentId: string
    documentVersion: unknown
  }
  modalFocusFrame?: number | undefined
  pointerActive?: boolean
  pointerRenderPending?: boolean
  pointerCleanup?: () => void
  toolbarContext?: string
  contextMenuEpoch?: number
  contextMenuContext?: string
  contextMenuStarted?: boolean
  contextMenuHide?: Promise<void>
}

interface PluginVirtualViewportState {
  readonly id: string
  readonly fromIndex: number
  readonly toIndex: number
  readonly userInitiated?: boolean
  readonly edge?: 'before' | 'after'
  readonly requestId?: number
}

interface VirtualScrollRequest {
  readonly documentId: string
  readonly documentVersion: unknown
  readonly selectionRevision: unknown
  readonly id: string
  pending: boolean
  inFlight?: object
  requested?: { readonly viewport: PluginVirtualViewportState; readonly total: number }
}

const sidebarPanelMinimumHeight = 96
const virtualListScrollDelay = 16
const virtualListMinimumBufferItems = 160
const virtualListMinimumRefreshMarginItems = 12

export class DesktopPluginUiController {
  private readonly mounts = new Map<string, MountedPluginUi>()
  private commandGesture:
    | {
        readonly button: HTMLButtonElement
        readonly command: string
        readonly originalEvent: Event
      }
    | undefined
  private fieldEvent:
    | {
        readonly control: HTMLInputElement | HTMLSelectElement
        readonly command: string
        readonly originalEvent: Event
      }
    | undefined
  private readonly openModals = new Set<string>()
  private readonly modalReturnFocus = new Map<string, HTMLElement>()
  private syncSequence = 0
  private readonly disposals = new Map<MountedPluginUi, Promise<unknown>>()
  private documentId = ''
  private lastSyncSignature = ''
  private readonly collapsedSidebarPanels = new Set<string>()
  private readonly hiddenSlots = new Set<PluginUiBinding['slot']>()
  private sidebarResizeCleanup: (() => void) | undefined
  private viewportUpdatePending = false
  private viewportUpdatePromise: Promise<void> | undefined
  private readonly documentToolbar: FloatingDocumentToolbar | undefined
  private contextMenuEpoch = 0

  constructor(
    private readonly root: HTMLElement,
    private readonly runtime: DesktopPluginUiRuntime,
    private readonly renderState: () => Readonly<Record<string, unknown>> = () => ({}),
    private readonly options: DesktopPluginUiOptions = {},
  ) {
    const slot = root.querySelector<HTMLElement>('[data-plugin-slot="document-toolbar"]')
    this.documentToolbar =
      slot && options.documentToolbar
        ? new FloatingDocumentToolbar(slot, options.documentToolbar, () => this.documentId)
        : undefined
  }

  async sync(documentId: string): Promise<void> {
    const documentChanged = this.documentId !== documentId
    this.documentId = documentId
    if (documentChanged) {
      this.retireContextMenu()
      for (const mount of this.mounts.values()) {
        if (mount.contribution.slot !== 'document-toolbar') continue
        this.retireToolbarOutput(mount)
        delete mount.toolbarContext
      }
      this.documentToolbar?.refresh()
    }
    this.reconcileDocumentToolbar()
    const desired = new Map(
      this.runtime
        .contributions()
        .ui.filter((view) => view.slot !== 'modal' || this.openModals.has(uiKey(view)))
        .map((contribution) => [
          uiKey(contribution),
          {
            contribution,
            executionGeneration: this.runtime.generation?.(contribution.pluginId),
          },
        ]),
    )
    const signature = JSON.stringify(
      [...desired].map(([key, { contribution: view, executionGeneration }]) => [
        key,
        view.slot,
        view.title,
        view.scope ?? 'app',
        view.viewportUpdates !== false,
        executionGeneration,
      ]),
    )

    if (signature === this.lastSyncSignature && !documentChanged) return

    this.lastSyncSignature = signature
    const sequence = ++this.syncSequence
    // Retire every obsolete shell before yielding to plugin cleanup. Otherwise a
    // slow first view leaves later views interactive against the wrong document.
    for (const [key, mount] of [...this.mounts]) {
      if (sequence !== this.syncSequence) return
      const next = desired.get(key)
      const documentChanged =
        mount.contribution.scope === 'document' && mount.documentId !== documentId
      const contributionChanged =
        next !== undefined &&
        (mount.executionGeneration !== next.executionGeneration ||
          mount.contribution.slot !== next.contribution.slot ||
          mount.contribution.title !== next.contribution.title ||
          mount.contribution.scope !== next.contribution.scope ||
          mount.contribution.viewportUpdates !== next.contribution.viewportUpdates)

      if (!next || documentChanged || contributionChanged) void this.disposeMount(key, mount)
    }
    // A newer sync can arrive after the previous one detached its views. Keep
    // same-instance disposal ahead of replacement mounts even in that case.
    const disposing = [...this.disposals]
      .filter(([mount]) => this.isCurrentGeneration(mount))
      .map(([, pending]) => pending)
    if (disposing.length) await Promise.all(disposing)

    for (const [key, { contribution, executionGeneration }] of desired) {
      if (sequence !== this.syncSequence) return
      if (executionGeneration !== this.runtime.generation?.(contribution.pluginId)) return
      // A modal may be closed while an earlier view is still rendering.
      if (contribution.slot === 'modal' && !this.openModals.has(key)) continue
      const mount = this.mounts.get(key)

      if (mount) await this.updateMount(mount)
      else await this.mount(contribution)
    }
  }

  async open(pluginId: string, viewId: string): Promise<void> {
    const key = `${pluginId}:${viewId}`
    const existing = this.mounts.get(key)
    const previous = this.root.ownerDocument.activeElement
    if (!existing && previous instanceof HTMLElement) this.modalReturnFocus.set(key, previous)
    this.openModals.add(key)
    // Explicitly reopening an existing view may focus it now, never after an await.
    existing?.container.focus()
    await this.sync(this.documentId)
  }

  async close(pluginId: string, viewId: string): Promise<void> {
    const key = `${pluginId}:${viewId}`
    this.openModals.delete(key)
    this.lastSyncSignature = ''
    const mount = this.mounts.get(key)

    if (mount) {
      await this.disposeMount(key, mount)
    }
  }

  async invalidate(pluginId: string, viewId?: string): Promise<void> {
    const targets = [...this.mounts.values()].filter(
      (mount) =>
        mount.contribution.pluginId === pluginId &&
        (viewId === undefined || mount.contribution.id === viewId),
    )

    await Promise.all(targets.map((mount) => this.updateMount(mount)))
  }

  /** The embedding shell owns slot visibility; plugins receive an actual lifecycle snapshot. */
  setSlotVisible(slot: PluginUiBinding['slot'], visible: boolean): void {
    if (this.hiddenSlots.has(slot) === !visible) return
    if (slot === 'sidebar-panel' && !visible) this.sidebarResizeCleanup?.()
    if (visible) this.hiddenSlots.delete(slot)
    else this.hiddenSlots.add(slot)
    if (slot === 'document-toolbar') this.documentToolbar?.setEnabled(visible)
    if (slot === 'context-menu') {
      this.retireContextMenu()
      if (!visible)
        for (const mount of this.mounts.values())
          if (mount.contribution.slot === slot) this.notifyContextMenuHidden(mount)
      // The shell calls refreshSlot after opening. Rendering here as well
      // would enqueue each Worker twice and discard the first result.
      return
    }
    for (const mount of this.mounts.values()) {
      if (slot === 'document-toolbar' && mount.contribution.slot === slot && !visible)
        this.retireToolbarOutput(mount)
      if (mount.contribution.slot === slot) void this.updateMount(mount)
    }
  }

  private isVisible(contribution: PluginUiBinding): boolean {
    return (
      !this.hiddenSlots.has(contribution.slot) &&
      !this.collapsedSidebarPanels.has(uiKey(contribution))
    )
  }

  async refreshSlot(slot: PluginUiBinding['slot']): Promise<void> {
    // Retire the entire previous opening before any fast renderer can cause a
    // quota update that might otherwise reveal another renderer's old buttons.
    if (slot === 'context-menu') this.retireContextMenu()
    await Promise.all(
      [...this.mounts.values()]
        .filter((mount) => mount.contribution.slot === slot)
        .map((mount) => this.updateMount(mount)),
    )
  }

  async updateViewport(): Promise<void> {
    this.reconcileDocumentToolbar()
    this.viewportUpdatePending = true
    if (this.viewportUpdatePromise) return this.viewportUpdatePromise

    this.viewportUpdatePromise = (async () => {
      while (this.viewportUpdatePending) {
        this.viewportUpdatePending = false
        await Promise.all(
          [...this.mounts.values()]
            .filter((mount) => mount.contribution.viewportUpdates !== false)
            .map((mount) => this.updateMount(mount)),
        )
      }
    })().finally(() => {
      this.viewportUpdatePromise = undefined
    })
    return this.viewportUpdatePromise
  }

  /** Retire stale commands immediately while the host debounces Worker renders. */
  reconcileDocumentToolbar(): void {
    const toolbars = [...this.mounts.values()].filter(
      (mount) => mount.contribution.slot === 'document-toolbar',
    )
    if (toolbars.length) {
      const context = this.toolbarContext()
      for (const mount of toolbars) {
        if (mount.toolbarContext === context) continue
        this.retireToolbarOutput(mount)
      }
    }
    this.documentToolbar?.refresh()
  }

  async dispose(): Promise<void> {
    this.syncSequence++
    this.lastSyncSignature = ''
    this.viewportUpdatePending = false
    this.documentToolbar?.dispose()
    const disposing = [...this.mounts].map(([key, mount]) => this.disposeMount(key, mount))
    this.openModals.clear()
    this.modalReturnFocus.clear()
    await Promise.all([...disposing, ...this.disposals.values()])
  }

  private isCurrentGeneration(mount: MountedPluginUi): boolean {
    return mount.executionGeneration === this.runtime.generation?.(mount.contribution.pluginId)
  }

  private isCurrentMount(mount: MountedPluginUi): boolean {
    return (
      this.mounts.get(uiKey(mount.contribution)) === mount &&
      this.isCurrentGeneration(mount) &&
      (mount.contribution.scope !== 'document' || mount.documentId === this.documentId)
    )
  }

  private async mount(contribution: PluginUiBinding): Promise<void> {
    const target = this.root.querySelector<HTMLElement>(`[data-plugin-slot="${contribution.slot}"]`)

    if (!target) {
      return
    }

    const container = this.root.ownerDocument.createElement(
      contribution.slot === 'document-toolbar' || contribution.slot === 'statusbar'
        ? 'span'
        : 'section',
    )
    container.className = `plugin-ui plugin-ui-${contribution.slot}`
    container.dataset.pluginUi = uiKey(contribution)
    container.tabIndex = -1
    if (contribution.slot === 'document-toolbar') container.hidden = true
    container.setAttribute('aria-label', contribution.title)
    let body = container
    let toggle: HTMLButtonElement | undefined
    let resizeHandle: HTMLElement | undefined

    if (contribution.slot === 'sidebar-panel') {
      toggle = this.root.ownerDocument.createElement('button')
      toggle.type = 'button'
      toggle.className = 'plugin-ui-panel-toggle'
      toggle.setAttribute('aria-expanded', 'true')
      toggle.innerHTML = `${iconSvg(ChevronDown)}<span>${escapeText(contribution.title)}</span>`
      toggle.addEventListener('click', () => this.toggleSidebarPanel(uiKey(contribution)))

      body = this.root.ownerDocument.createElement('div')
      body.className = 'plugin-ui-panel-body'

      resizeHandle = this.root.ownerDocument.createElement('div')
      resizeHandle.className = 'plugin-ui-panel-resize'
      resizeHandle.setAttribute('role', 'separator')
      resizeHandle.setAttribute('aria-orientation', 'horizontal')
      resizeHandle.setAttribute('aria-label', `调整 ${contribution.title} 高度`)
      resizeHandle.tabIndex = 0
      resizeHandle.innerHTML = iconSvg(GripHorizontal)
      resizeHandle.addEventListener('pointerdown', (event) => {
        this.startSidebarPanelResize(uiKey(contribution), event)
      })
      resizeHandle.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        this.resizeSidebarPanelPair(uiKey(contribution), event.key === 'ArrowUp' ? -16 : 16)
      })
      container.append(toggle, body, resizeHandle)
    }

    if (contribution.slot === 'modal') {
      container.setAttribute('role', 'dialog')
      container.setAttribute('aria-modal', 'true')
      container.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || event.isComposing) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          void this.close(contribution.pluginId, contribution.id)
        } else if (event.key === 'Tab' || event.code === 'Tab') {
          const buttons = Array.from(
            container.querySelectorAll<HTMLElement>(
              'button, input, select, a[href], [tabindex="0"]',
            ),
          ).filter(
            (element) =>
              !element.hasAttribute('disabled') && !element.hidden && element.tabIndex >= 0,
          )
          const active = this.root.ownerDocument.activeElement
          const first = buttons[0],
            last = buttons.at(-1)
          if (!first) {
            event.preventDefault()
            container.focus()
          } else if (event.shiftKey && (active === first || active === container)) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && (active === last || active === container)) {
            event.preventDefault()
            first.focus()
          }
        }
      })
      const close = this.root.ownerDocument.createElement('button')
      close.type = 'button'
      close.className = 'icon-button plugin-ui-close'
      close.textContent = '×'
      close.setAttribute('aria-label', '关闭')
      close.addEventListener('click', () => {
        void this.close(contribution.pluginId, contribution.id)
      })
      container.append(close)
    }

    container.addEventListener('focusin', () => {
      void this.sendLifecycle(mount, 'focus')
    })
    container.addEventListener('focusout', () => {
      void this.sendLifecycle(mount, 'blur')
    })
    container.addEventListener(
      'click',
      (event) => {
        const button =
          event.target instanceof Element
            ? event.target.closest<HTMLButtonElement>('button[data-plugin-command]')
            : null
        if (!button || !container.contains(button)) return
        const command = button.dataset.pluginCommand!
        const keyboard = this.commandGesture
        const originalEvent = event.isTrusted
          ? event
          : keyboard?.button === button &&
              keyboard.command === command &&
              keyboard.originalEvent.type === 'keydown' &&
              keyboard.originalEvent.isTrusted &&
              keyboard.originalEvent.eventPhase !== Event.NONE
            ? keyboard.originalEvent
            : undefined
        const gesture = originalEvent ? { button, command, originalEvent } : undefined
        this.commandGesture = gesture
        // Only the synchronous controlled action dispatched by this click can use it.
        // Native dispatch can checkpoint microtasks between capture and target listeners.
        // Keep the binding through this event task; eventPhase still rejects later replay.
        setTimeout(() => {
          if (this.commandGesture === gesture) this.commandGesture = undefined
        }, 0)
      },
      true,
    )
    for (const type of ['input', 'change'])
      container.addEventListener(
        type,
        (event) => {
          const control = event.target
          if (
            !(control instanceof HTMLInputElement || control instanceof HTMLSelectElement) ||
            !control.dataset.pluginFieldControl ||
            !control.dataset.pluginCommand ||
            control.disabled
          )
            return
          const binding = event.isTrusted
            ? { control, command: control.dataset.pluginCommand, originalEvent: event }
            : undefined
          this.fieldEvent = binding
          setTimeout(() => {
            if (this.fieldEvent === binding) this.fieldEvent = undefined
          }, 0)
        },
        true,
      )
    container.addEventListener('milkup-plugin-renderer-action', (event) => {
      if (!this.isCurrentMount(mount)) return
      if (contribution.slot === 'context-menu' && !this.isCurrentContextMenuOutput(mount)) return
      if (
        contribution.slot === 'document-toolbar' &&
        (mount.container.hidden || mount.toolbarContext !== this.toolbarContext())
      )
        return
      const detail = (event as CustomEvent<ControlledRendererActionDetail>).detail
      if (
        !detail ||
        detail.rendererId !== uiKey(contribution) ||
        typeof detail.command !== 'string'
      )
        return
      const command = this.runtime.resolveCommand(detail.rendererId, detail.command)
      if (!command) return
      const gesture = this.commandGesture
      const field = this.fieldEvent
      const originalEvent =
        field &&
        event.target === field.control &&
        field.command === detail.command &&
        field.control.dataset.pluginCommand === detail.command &&
        field.originalEvent.isTrusted &&
        field.originalEvent.eventPhase !== Event.NONE
          ? field.originalEvent
          : gesture &&
              event.target === gesture.button &&
              gesture.command === detail.command &&
              gesture.button.dataset.pluginCommand === detail.command &&
              gesture.originalEvent.isTrusted &&
              gesture.originalEvent.eventPhase !== Event.NONE
            ? gesture.originalEvent
            : undefined
      if (originalEvent) {
        this.commandGesture = undefined
        this.fieldEvent = undefined
      }
      // Keyboard activation leaves focus on the toolbar; restore the host's
      // selection before dispatch so a command can deliberately open a modal.
      if (contribution.slot === 'document-toolbar' && event.target instanceof HTMLButtonElement)
        this.options.documentToolbar?.restoreEditorFocus?.()
      if (originalEvent) this.runtime.runCommand(command, detail.input ?? {}, originalEvent)
      else this.runtime.runCommand(command, detail.input ?? {})
    })
    target.append(container)
    const mount: MountedPluginUi = {
      contribution,
      container,
      body,
      ...(toggle ? { toggle } : {}),
      ...(resizeHandle ? { resizeHandle } : {}),
      documentId: this.documentId,
      executionGeneration: this.runtime.generation?.(contribution.pluginId),
      renderSequence: 0,
      renderSignature: undefined,
      pendingFocusLabel: undefined as string | undefined,
      forms: new ControlledFormState(body),
      treeFocus: new Map<string, ControlledTreeFocus>(),
    }
    // A deferred action may resume only while focus stays on our fallback shell.
    // Explicit focus on another control or outside the modal cancels that intent.
    container.addEventListener('focusin', (event) => {
      if (event.target !== container) mount.pendingFocusLabel = undefined
      if (mount.virtualTreeFocus && event.target !== mount.virtualTreeFocus.anchor)
        this.cancelVirtualTreeFocus(mount)
      if (contribution.slot === 'modal') {
        const window = container.ownerDocument.defaultView
        if (mount.modalFocusFrame !== undefined) window?.cancelAnimationFrame(mount.modalFocusFrame)
        const target = event.target
        mount.modalFocusFrame = window?.requestAnimationFrame(() => {
          mount.modalFocusFrame = undefined
          if (
            this.isCurrentMount(mount) &&
            this.isVisible(contribution) &&
            container.ownerDocument.activeElement === target
          )
            revealModalFocus(container)
        })
      }
    })
    container.addEventListener('focusout', (event) => {
      if (!(event.relatedTarget instanceof Node) || !container.contains(event.relatedTarget)) {
        mount.pendingFocusLabel = undefined
        this.cancelVirtualTreeFocus(mount)
      }
    })
    this.mounts.set(uiKey(contribution), mount)
    body.addEventListener('pointerdown', (event) => this.holdPointerRender(mount, event))
    if (contribution.slot === 'document-toolbar') {
      body.addEventListener('focusin', (event) => {
        if (event.target instanceof HTMLElement) {
          this.documentToolbar?.reveal(event.target)
        }
      })
      // Mouse commands operate on the editor's current selection. Keep that
      // focus while leaving keyboard navigation and form fields untouched.
      body.addEventListener('mousedown', (event) => {
        const button =
          event.target instanceof Element
            ? event.target.closest<HTMLButtonElement>('button[data-plugin-command]')
            : null
        if (event.button === 0 && button && !button.disabled && body.contains(button)) {
          event.preventDefault()
        }
      })
    }
    this.reorderSidebarPanels()
    const previous = this.root.ownerDocument.activeElement
    const rendering = this.renderMount(mount, 'mount')
    // The shell is already visible. Claim focus before yielding to plugin output,
    // so Escape is handled by this modal instead of the underlying details page.
    // A synchronous host confirmation may have taken focus during renderUi.
    if (
      this.openModals.has(uiKey(contribution)) &&
      this.root.ownerDocument.activeElement === previous
    ) {
      container.focus()
    }
    await rendering
  }

  private async updateMount(mount: MountedPluginUi): Promise<void> {
    await this.renderMount(mount, 'update')
  }

  private async renderMount(mount: MountedPluginUi, phase: 'mount' | 'update'): Promise<void> {
    if (!this.isCurrentMount(mount)) return
    if (mount.contribution.slot === 'context-menu') {
      if (!this.isVisible(mount.contribution)) {
        this.retireContextMenuOutput(mount)
        this.didRender(mount)
        return
      }
      // An ordinary invalidation can wait through a current, valid click.
      // Reopening or changing its context retires the gesture synchronously.
      if (mount.pointerActive && this.isCurrentContextMenuOutput(mount)) {
        mount.pointerRenderPending = true
        return
      }
    }
    const formRevision = mount.forms.snapshot()
    const renderState: Readonly<Record<string, unknown>> = {
      documentId: this.documentId,
      ...this.renderState(),
    }
    const contextMenuEpoch = this.contextMenuEpoch
    const contextMenuContext = this.contextMenuContext(renderState)
    if (mount.contribution.slot === 'context-menu') {
      mount.contextMenuEpoch = contextMenuEpoch
      mount.contextMenuContext = contextMenuContext
      this.retireContextMenuOutput(
        mount,
        this.isVisible(mount.contribution) ? 'pending' : 'retired',
      )
      this.didRender(mount)
    }
    if (mount.contribution.slot === 'document-toolbar') {
      const context = this.toolbarContext(renderState)
      if (mount.toolbarContext !== context) {
        mount.toolbarContext = context
        // Old commands must not survive a changed selection while a Worker is
        // still rendering. Also cancel a held gesture against that old context.
        this.retireToolbarOutput(mount)
        this.documentToolbar?.refresh()
      }
    }
    const keyboardFocus = mount.virtualTreeFocus
    if (
      keyboardFocus &&
      (keyboardFocus.documentId !== this.documentId ||
        keyboardFocus.documentVersion !== renderState.documentVersion)
    ) {
      // App-scoped shells survive a document switch, but their deferred keyboard
      // destination must not survive even when the new output is unchanged.
      delete mount.virtualTreeFocus
      this.resetVirtualScrollRequest(mount)
    }
    const scrollRequest = mount.virtualScrollRequest
    if (
      scrollRequest &&
      (scrollRequest.documentId !== this.documentId ||
        scrollRequest.documentVersion !== renderState.documentVersion ||
        scrollRequest.selectionRevision !== renderState.selectionRevision)
    )
      this.resetVirtualScrollRequest(mount)
    const requestedScroll = mount.virtualScrollRequest
    const renderSequence = ++mount.renderSequence
    const requestedKeyboardFocus = mount.virtualTreeFocus
    const isCurrentRequest = (): boolean => {
      if (!this.isCurrentMount(mount) || renderSequence !== mount.renderSequence) return false
      if (
        mount.contribution.slot === 'context-menu' &&
        (contextMenuEpoch !== this.contextMenuEpoch ||
          contextMenuContext !== this.contextMenuContext() ||
          !this.isVisible(mount.contribution))
      ) {
        this.retireContextMenuOutput(mount)
        this.didRender(mount)
        return false
      }
      if (
        mount.contribution.slot === 'document-toolbar' &&
        (renderState.selectionRevision !== this.renderState().selectionRevision ||
          renderState.viewMode !== this.renderState().viewMode)
      ) {
        mount.container.hidden = true
        this.documentToolbar?.refresh()
        return false
      }
      if (
        requestedScroll &&
        requestedScroll.selectionRevision !== this.renderState().selectionRevision
      ) {
        if (mount.virtualScrollRequest === requestedScroll) this.resetVirtualScrollRequest(mount)
        return false
      }
      if (
        renderState.documentId !== this.documentId ||
        renderState.documentVersion !== this.renderState().documentVersion
      ) {
        if (mount.contribution.slot === 'document-toolbar') {
          mount.container.hidden = true
          this.documentToolbar?.refresh()
        }
        // Discard only this request's keyboard intent; never clear a newer one.
        if (requestedKeyboardFocus && mount.virtualTreeFocus === requestedKeyboardFocus)
          this.cancelVirtualTreeFocus(mount)
        return false
      }
      return true
    }
    try {
      if (mount.contribution.slot === 'context-menu' && mount.contextMenuHide) {
        await mount.contextMenuHide
        if (!isCurrentRequest()) return
      }
      // Hidden context menus defer their first lifecycle request until opened.
      // Keep its mount phase so the manager tracks the active renderer.
      const requestedPhase =
        mount.contribution.slot === 'context-menu' && !mount.contextMenuStarted ? 'mount' : phase
      if (mount.contribution.slot === 'context-menu') mount.contextMenuStarted = true
      const output = (await this.runtime.renderUi(
        mount.contribution.pluginId,
        mount.contribution.id,
        requestedPhase,
        {
          ...renderState,
          visible: this.isVisible(mount.contribution),
          ...(mount.virtualViewport ? { virtualViewport: mount.virtualViewport } : {}),
        },
      )) as ControlledRendererOutput

      if (!isCurrentRequest()) return

      const signature = controlledOutputSignature(output)
      let toolbarNodes: readonly Node[] | undefined
      if (mount.contribution.slot === 'document-toolbar') {
        toolbarNodes = createControlledRendererNodes(
          this.root.ownerDocument,
          uiKey(mount.contribution),
          output,
        )
        if (!toolbarNodes.some(hasToolbarContent)) {
          this.retireToolbarOutput(mount)
          mount.body.replaceChildren()
          mount.renderSignature = signature
          mount.container.dataset.uiState = 'ready'
          this.documentToolbar?.refresh()
          return
        }
      }

      // Replacing a pressed button between pointerdown and click loses the action.
      // Drop intermediate output and request one fresh render after the gesture.
      if (mount.pointerActive) {
        mount.pointerRenderPending = true
        return
      }

      if (mount.contribution.slot === 'document-toolbar')
        mount.container.hidden = !this.isVisible(mount.contribution)

      if (signature === mount.renderSignature && !mount.body.querySelector('[data-plugin-field]')) {
        mount.container.dataset.uiState = 'ready'
        this.didRender(mount)
        return
      }

      const focused = this.root.ownerDocument.activeElement
      const keyboardFocus = mount.virtualTreeFocus
      delete mount.virtualTreeFocus
      const keepKeyboardFocus =
        keyboardFocus &&
        keyboardFocus.anchor === focused &&
        keyboardFocus.documentId === this.documentId &&
        keyboardFocus.documentVersion === this.renderState().documentVersion
      const focusedLabel =
        focused === mount.container
          ? mount.pendingFocusLabel
          : focused instanceof HTMLElement && mount.body.contains(focused)
            ? focused.getAttribute('aria-label')
            : undefined
      const focusedTreeKey =
        focused instanceof Element
          ? focused.closest<HTMLElement>('[data-controlled-tree-key]')?.dataset.controlledTreeKey
          : undefined
      const scrollOffsets = captureScrollOffsets(mount.body)
      const existingClose = mount.body.querySelector('.plugin-ui-close')
      let nodes =
        toolbarNodes ??
        createControlledRendererNodes(this.root.ownerDocument, uiKey(mount.contribution), output)
      if (mount.contribution.slot === 'context-menu' && this.options.contextMenu)
        nodes = this.options.contextMenu.normalize(nodes, uiKey(mount.contribution))
      mount.forms.reconcile(
        mount.body,
        [...(existingClose ? [existingClose] : []), ...nodes],
        formRevision,
      )
      decorateControlledTrees(
        mount.body,
        mount.treeFocus,
        (button, event) => {
          this.commandGesture =
            event.isTrusted && button.dataset.pluginCommand
              ? { button, command: button.dataset.pluginCommand, originalEvent: event }
              : undefined
          try {
            button.click()
          } finally {
            if (this.commandGesture?.originalEvent === event) this.commandGesture = undefined
          }
        },
        (tree, item, key) => this.navigateVirtualTree(mount, tree, item, key),
      )
      const keyboardList = mount.body.querySelector<HTMLElement>('[role="tree"][data-virtual-list]')
      const keyboardMetadata = keyboardList && readVirtualListMetadata(keyboardList)
      const validKeyboardFocus =
        keepKeyboardFocus &&
        keyboardMetadata &&
        keyboardMetadata.id === keyboardFocus.id &&
        keyboardMetadata.total === keyboardFocus.total
      const keyboardTarget =
        validKeyboardFocus &&
        keyboardFocus.target >= keyboardMetadata.start &&
        keyboardFocus.target < keyboardMetadata.end
          ? keyboardList.querySelectorAll<HTMLButtonElement>('button[role="treeitem"]')[
              keyboardFocus.target - keyboardMetadata.start
            ]
          : undefined
      if ((focusedLabel || validKeyboardFocus) && this.isVisible(mount.contribution)) {
        const treeFallback =
          focusedTreeKey === undefined
            ? undefined
            : Array.from(mount.body.querySelectorAll<HTMLElement>('[data-controlled-tree-key]'))
                .find((tree) => tree.dataset.controlledTreeKey === focusedTreeKey)
                ?.querySelector<HTMLElement>('button[role="treeitem"][tabindex="0"]')
        const next =
          keyboardTarget ??
          Array.from(
            mount.body.querySelectorAll<HTMLElement>('button[aria-label]:not([disabled])'),
          ).find((button) => button.getAttribute('aria-label') === focusedLabel) ??
          treeFallback ??
          mount.body.querySelector<HTMLElement>('[data-plugin-command]:not([disabled])') ??
          mount.container
        mount.pendingFocusLabel = next === mount.container ? (focusedLabel ?? undefined) : undefined
        if (validKeyboardFocus && !keyboardTarget)
          mount.virtualTreeFocus = { ...keyboardFocus, anchor: next }
        next.focus({ preventScroll: true })
      }
      decorateControlledUiIcons(mount.body)
      if (!this.configureVirtualList(mount, scrollOffsets)) {
        restoreScrollOffsets(mount.body, scrollOffsets)
      }
      keyboardTarget?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      if (mount.contribution.slot === 'modal' && this.isVisible(mount.contribution)) {
        revealModalFocus(mount.container)
      }
      mount.renderSignature = signature
      mount.container.dataset.uiState = 'ready'
      if (mount.contribution.slot === 'context-menu') {
        mount.container.dataset.contextMenuState = 'ready'
        mount.container.hidden = false
      }
      this.didRender(mount)
    } catch (error) {
      if (!isCurrentRequest()) return
      if (mount.contribution.slot === 'document-toolbar') mount.container.hidden = false
      mount.container.dataset.uiState = 'failed'
      if (mount.contribution.slot === 'context-menu')
        mount.container.dataset.contextMenuState = 'failed'
      const message = this.root.ownerDocument.createElement('span')
      message.className = 'plugin-ui-error'
      message.textContent = error instanceof Error ? error.message : String(error)
      mount.body.replaceChildren(message)
      mount.renderSignature = undefined
      this.didRender(mount)
    }
  }

  private didRender(mount: MountedPluginUi): void {
    if (mount.contribution.slot === 'document-toolbar') this.documentToolbar?.refresh()
    if (mount.contribution.slot === 'context-menu') this.options.contextMenu?.updated?.()
  }

  private toolbarContext(state = this.renderState()): string {
    return JSON.stringify([
      this.documentId,
      state.documentVersion,
      state.selectionRevision,
      state.viewMode,
    ])
  }

  private contextMenuContext(state = this.renderState()): string {
    return JSON.stringify([
      this.documentId,
      state.documentVersion,
      state.selectionRevision,
      state.saveLocationGeneration,
    ])
  }

  private isCurrentContextMenuOutput(mount: MountedPluginUi): boolean {
    return (
      mount.container.dataset.contextMenuState === 'ready' &&
      mount.contextMenuEpoch === this.contextMenuEpoch &&
      mount.contextMenuContext === this.contextMenuContext() &&
      this.isVisible(mount.contribution) &&
      !mount.container.hidden
    )
  }

  private retireContextMenu(): void {
    this.contextMenuEpoch++
    let changed = false
    for (const mount of this.mounts.values()) {
      if (mount.contribution.slot !== 'context-menu') continue
      this.retireContextMenuOutput(mount)
      changed = true
    }
    if (changed) this.options.contextMenu?.updated?.()
  }

  private retireContextMenuOutput(
    mount: MountedPluginUi,
    state: 'pending' | 'retired' = 'retired',
  ): void {
    mount.container.hidden = true
    mount.container.dataset.contextMenuState = state
    mount.body.replaceChildren()
    mount.renderSignature = undefined
    mount.pendingFocusLabel = undefined
    mount.pointerCleanup?.()
    mount.pointerRenderPending = false
  }

  private notifyContextMenuHidden(mount: MountedPluginUi): void {
    if (!mount.contextMenuStarted) return
    const state = { documentId: this.documentId, ...this.renderState(), visible: false }
    const previous = mount.contextMenuHide
    const pending = (async () => {
      if (previous) await previous
      if (!this.isCurrentMount(mount)) return
      // This notification resets renderer visibility state. Its output is never
      // admitted, and a reopened menu waits for it before sending visible:true.
      await this.runtime
        .renderUi(mount.contribution.pluginId, mount.contribution.id, 'blur', state)
        .catch(() => undefined)
    })()
    mount.contextMenuHide = pending
    void pending.then(() => {
      if (mount.contextMenuHide === pending) delete mount.contextMenuHide
    })
  }

  private retireToolbarOutput(mount: MountedPluginUi): void {
    const hadFocus = mount.container.contains(this.root.ownerDocument.activeElement)
    mount.container.hidden = true
    if (mount.pointerActive) {
      mount.body.replaceChildren()
      mount.renderSignature = undefined
    }
    mount.pointerCleanup?.()
    mount.pointerRenderPending = false
    if (hadFocus) this.options.documentToolbar?.restoreEditorFocus?.()
  }

  private async sendLifecycle(mount: MountedPluginUi, phase: 'focus' | 'blur'): Promise<void> {
    if (!this.isCurrentMount(mount)) return
    const contribution = mount.contribution
    // Closing has one explicit, ordered notification even when DOM removal
    // produces no focusout. Do not duplicate it with an incidental blur.
    if (contribution.slot === 'context-menu' && !this.isVisible(contribution)) return
    await this.runtime
      .renderUi(contribution.pluginId, contribution.id, phase, {
        documentId: this.documentId,
        ...this.renderState(),
        visible: this.isVisible(contribution),
      })
      .catch(() => undefined)
  }

  private async disposeMount(key: string, mount: MountedPluginUi): Promise<void> {
    if (this.mounts.get(key) !== mount) return
    this.mounts.delete(key)
    this.collapsedSidebarPanels.delete(key)
    if (mount.virtualScrollTimer !== undefined) clearTimeout(mount.virtualScrollTimer)
    delete mount.virtualScrollRequest
    mount.virtualPointerCleanup?.()
    mount.pointerCleanup?.()
    if (mount.modalFocusFrame !== undefined)
      mount.container.ownerDocument.defaultView?.cancelAnimationFrame(mount.modalFocusFrame)
    const hadFocus = mount.container.contains(this.root.ownerDocument.activeElement)
    mount.container.remove()
    this.didRender(mount)
    if (mount.contribution.slot === 'document-toolbar' && hadFocus)
      this.options.documentToolbar?.restoreEditorFocus?.()
    if (mount.contribution.slot === 'modal') {
      this.openModals.delete(key)
      const previous = this.modalReturnFocus.get(key)
      this.modalReturnFocus.delete(key)
      if (hadFocus) {
        const opener = previous?.isConnected
          ? previous
          : Array.from(
              this.root.querySelectorAll<HTMLElement>('[data-plugin-action="open-ui"]'),
            ).find(
              (element) =>
                element.dataset.pluginId === mount.contribution.pluginId &&
                element.dataset.pluginUiId === mount.contribution.id,
            )
        // Disable/uninstall may have rebuilt the manager and removed the opener.
        const target =
          opener ??
          this.root.querySelector<HTMLElement>(
            '#plugin-detail-title, [data-plugin-action="details"], [data-plugin-action="install"]',
          )
        target?.focus()
      }
    }
    this.reorderSidebarPanels()
    // Revocation already disposes the isolated owner. Never route an old view's
    // cleanup by plugin/view ID into a newly enabled instance with the same IDs.
    if (!this.isCurrentGeneration(mount)) return
    const disposal = this.runtime
      .renderUi(mount.contribution.pluginId, mount.contribution.id, 'dispose', {
        documentId: mount.documentId,
        visible: false,
      })
      .catch(() => undefined)
    this.disposals.set(mount, disposal)
    try {
      await disposal
    } finally {
      this.disposals.delete(mount)
    }
  }

  private holdPointerRender(mount: MountedPluginUi, event: PointerEvent): void {
    if (event.button !== 0 || mount.pointerActive) return
    mount.pointerActive = true
    const document = this.root.ownerDocument
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      document.removeEventListener('pointerup', release)
      document.removeEventListener('pointercancel', release)
      if (timer !== undefined) clearTimeout(timer)
      mount.pointerActive = false
      delete mount.pointerCleanup
    }
    const release = (): void => {
      // Click dispatch follows pointerup in the same task.
      timer = setTimeout(() => {
        cleanup()
        if (this.mounts.get(uiKey(mount.contribution)) !== mount) return
        if (mount.pointerRenderPending) {
          mount.pointerRenderPending = false
          void this.updateMount(mount)
        }
      }, 0)
    }
    mount.pointerCleanup = cleanup
    document.addEventListener('pointerup', release, { once: true })
    document.addEventListener('pointercancel', release, { once: true })
  }

  private configureVirtualList(
    mount: MountedPluginUi,
    scrollOffsets: readonly ScrollOffsetSnapshot[],
  ): boolean {
    const list = mount.body.querySelector<HTMLElement>('[data-virtual-list]')
    if (!list) return false

    const metadata = readVirtualListMetadata(list)
    if (!metadata) return false

    const before = this.root.ownerDocument.createElement('span')
    before.className = 'plugin-virtual-spacer plugin-virtual-spacer-before'
    before.setAttribute('aria-hidden', 'true')
    before.style.height = `${metadata.start * metadata.itemHeight}px`
    const after = this.root.ownerDocument.createElement('span')
    after.className = 'plugin-virtual-spacer plugin-virtual-spacer-after'
    after.setAttribute('aria-hidden', 'true')
    after.style.height = `${(metadata.total - metadata.end) * metadata.itemHeight}px`
    list.prepend(before)
    list.append(after)
    restoreScrollOffsets(mount.body, scrollOffsets)
    if (metadata.followActive) this.resetVirtualScrollRequest(mount)
    const scrollRequest = mount.virtualScrollRequest
    const requested = scrollRequest?.requested
    if (
      requested &&
      (scrollRequest.documentId !== this.documentId ||
        scrollRequest.documentVersion !== this.renderState().documentVersion ||
        scrollRequest.selectionRevision !== this.renderState().selectionRevision ||
        scrollRequest.id !== metadata.id ||
        requested.total !== metadata.total ||
        (metadata.start <= requested.viewport.fromIndex &&
          metadata.end >= requested.viewport.toIndex))
    )
      delete scrollRequest.requested
    if (!mount.virtualTreeFocus)
      mount.virtualViewport = Object.freeze({
        id: metadata.id,
        fromIndex: metadata.start,
        toIndex: metadata.end,
        userInitiated:
          !metadata.followActive &&
          mount.virtualViewport?.id === metadata.id &&
          mount.virtualViewport.userInitiated === true,
      })
    // A renderer may echo its old slice before publishing asynchronously prepared rows.
    // Preserve the requested buffer independently of that echo, without polling it.
    if (!mount.virtualTreeFocus && scrollRequest?.requested)
      mount.virtualViewport = scrollRequest.requested.viewport

    if (metadata.followActive && metadata.active >= 0 && list.clientHeight > 0) {
      const maximumScrollTop = Math.max(0, metadata.total * metadata.itemHeight - list.clientHeight)
      list.scrollTop = Math.min(
        maximumScrollTop,
        Math.max(0, (metadata.active + 0.5) * metadata.itemHeight - list.clientHeight / 2),
      )
    } else if (mount.virtualScrollTop !== undefined) {
      list.scrollTop = mount.virtualScrollTop
    }
    if (
      !metadata.followActive &&
      metadata.scrollAdjust !== 0 &&
      metadata.revision !== mount.virtualAdjustmentRevision
    ) {
      list.scrollTop += metadata.scrollAdjust
      mount.virtualAdjustmentRevision = metadata.revision
    }
    mount.virtualScrollTop = list.scrollTop

    list.addEventListener(
      'pointerdown',
      () => {
        this.cancelVirtualTreeFocus(mount)
        mount.virtualPointerCleanup?.()
        mount.virtualPointerActive = true
        const startScrollTop = list.scrollTop
        this.markVirtualUserIntent(mount, 5000)
        const ownerDocument = list.ownerDocument
        const finishPointerInteraction = (): void => {
          ownerDocument.removeEventListener('pointerup', finishPointerInteraction)
          ownerDocument.removeEventListener('pointercancel', finishPointerInteraction)
          delete mount.virtualPointerCleanup
          mount.virtualPointerActive = false
          this.markVirtualUserIntent(mount, 750)
          const direction =
            list.scrollTop < startScrollTop
              ? 'before'
              : list.scrollTop > startScrollTop
                ? 'after'
                : undefined
          this.scheduleVirtualViewportUpdate(
            mount,
            list,
            direction && isVirtualListAtEdge(list, direction) ? direction : undefined,
            true,
          )
        }
        mount.virtualPointerCleanup = () => {
          ownerDocument.removeEventListener('pointerup', finishPointerInteraction)
          ownerDocument.removeEventListener('pointercancel', finishPointerInteraction)
          delete mount.virtualPointerCleanup
          mount.virtualPointerActive = false
        }
        ownerDocument.addEventListener('pointerup', finishPointerInteraction)
        ownerDocument.addEventListener('pointercancel', finishPointerInteraction)
      },
      { passive: true },
    )
    list.addEventListener(
      'wheel',
      (event) => {
        this.cancelVirtualTreeFocus(mount)
        this.markVirtualUserIntent(mount, 750)
        const direction = event.deltaY < 0 ? 'before' : event.deltaY > 0 ? 'after' : undefined
        this.scheduleVirtualViewportUpdate(
          mount,
          list,
          direction && isVirtualListAtEdge(list, direction) ? direction : undefined,
          true,
        )
      },
      { passive: true },
    )
    list.addEventListener(
      'keydown',
      () => {
        if (!mount.virtualTreeFocus) this.markVirtualUserIntent(mount, 750)
      },
      {
        passive: true,
      },
    )
    list.addEventListener('scroll', () => this.scheduleVirtualViewportUpdate(mount, list), {
      passive: true,
    })
    return true
  }

  private navigateVirtualTree(
    mount: MountedPluginUi,
    tree: HTMLElement,
    item: HTMLButtonElement,
    key: string,
  ): boolean {
    if (!['Home', 'End', 'ArrowUp', 'ArrowDown'].includes(key)) {
      this.cancelVirtualTreeFocus(mount)
      return false
    }
    const metadata = readVirtualListMetadata(tree)
    if (!metadata || !metadata.total) return false
    const items = Array.from(
      tree.querySelectorAll<HTMLButtonElement>('button[role="treeitem"]'),
    ).filter((button) => button.closest('[role="tree"]') === tree)
    if (items.length !== metadata.end - metadata.start) return false
    const ordinal = items.indexOf(item)
    if (ordinal < 0) return false
    const prior = mount.virtualTreeFocus
    const current = prior?.target ?? metadata.start + ordinal
    const target =
      key === 'Home'
        ? 0
        : key === 'End'
          ? metadata.total - 1
          : Math.max(0, Math.min(metadata.total - 1, current + (key === 'ArrowUp' ? -1 : 1)))
    const inside = target >= metadata.start && target < metadata.end
    if (mount.virtualScrollTimer !== undefined) clearTimeout(mount.virtualScrollTimer)
    delete mount.virtualScrollTimer
    if (mount.virtualScrollRequest?.inFlight) mount.renderSequence++
    delete mount.virtualScrollRequest
    delete mount.virtualPendingEdgeHint
    mount.virtualUserIntentUntil = 0
    if (inside && !prior) {
      mount.virtualViewport = Object.freeze({
        id: metadata.id,
        fromIndex: metadata.start,
        toIndex: metadata.end,
        userInitiated: true,
      })
      return false
    }
    const count = Math.min(metadata.total, 500, Math.max(160, metadata.end - metadata.start))
    const fromIndex = Math.max(0, Math.min(metadata.total - count, target - Math.floor(count / 2)))
    mount.virtualViewport = Object.freeze({
      id: metadata.id,
      fromIndex,
      toIndex: fromIndex + count,
      userInitiated: true,
    })
    mount.virtualScrollTop = Math.max(0, target * metadata.itemHeight - tree.clientHeight / 2)
    if (inside) {
      delete mount.virtualTreeFocus
      items[target - metadata.start]!.focus({ preventScroll: true })
      items[target - metadata.start]!.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    } else {
      mount.virtualTreeFocus = {
        id: metadata.id,
        target,
        total: metadata.total,
        anchor: tree.ownerDocument.activeElement ?? item,
        documentId: this.documentId,
        documentVersion: this.renderState().documentVersion,
      }
    }
    void this.updateMount(mount)
    return true
  }

  private cancelVirtualTreeFocus(mount: MountedPluginUi): void {
    if (!mount.virtualTreeFocus) return
    delete mount.virtualTreeFocus
    // Invalidating just the pending focus is insufficient: an obsolete range
    // could still replace the user's newly focused row and invoke fallback.
    mount.renderSequence++
    const list = mount.body.querySelector<HTMLElement>('[role="tree"][data-virtual-list]')
    const metadata = list && readVirtualListMetadata(list)
    if (!metadata) return
    mount.virtualViewport = Object.freeze({
      id: metadata.id,
      fromIndex: metadata.start,
      toIndex: metadata.end,
      userInitiated: true,
    })
    mount.virtualScrollTop = list.scrollTop
    if (this.mounts.get(uiKey(mount.contribution)) === mount) void this.updateMount(mount)
  }

  private markVirtualUserIntent(mount: MountedPluginUi, duration: number): void {
    mount.virtualUserIntentUntil = Date.now() + duration
  }

  private resetVirtualScrollRequest(mount: MountedPluginUi): void {
    if (mount.virtualScrollTimer !== undefined) clearTimeout(mount.virtualScrollTimer)
    delete mount.virtualScrollTimer
    delete mount.virtualScrollRequest
    delete mount.virtualPendingEdgeHint
    mount.virtualUserIntentUntil = 0
    if (mount.virtualTreeFocus) return
    const list = mount.body.querySelector<HTMLElement>('[data-virtual-list]')
    const metadata = list && readVirtualListMetadata(list)
    if (metadata)
      mount.virtualViewport = Object.freeze({
        id: metadata.id,
        fromIndex: metadata.start,
        toIndex: metadata.end,
      })
    else delete mount.virtualViewport
  }

  private scheduleVirtualViewportUpdate(
    mount: MountedPluginUi,
    list: HTMLElement,
    edgeHint?: 'before' | 'after',
    replaceEdgeHint = false,
  ): void {
    mount.virtualScrollTop = list.scrollTop
    if (mount.virtualPointerActive) return
    if ((mount.virtualUserIntentUntil ?? 0) < Date.now()) return
    const metadata = readVirtualListMetadata(list)
    if (!metadata) return
    let request = mount.virtualScrollRequest
    const { documentVersion, selectionRevision } = this.renderState()
    if (
      !request ||
      request.documentId !== this.documentId ||
      request.documentVersion !== documentVersion ||
      request.selectionRevision !== selectionRevision ||
      request.id !== metadata.id
    ) {
      const userIntentUntil = mount.virtualUserIntentUntil ?? 0
      this.resetVirtualScrollRequest(mount)
      mount.virtualUserIntentUntil = userIntentUntil
      request = {
        documentId: this.documentId,
        documentVersion,
        selectionRevision,
        id: metadata.id,
        pending: false,
      }
      mount.virtualScrollRequest = request
    }
    if (replaceEdgeHint) {
      if (edgeHint) mount.virtualPendingEdgeHint = edgeHint
      else delete mount.virtualPendingEdgeHint
    }
    request.pending = true
    this.queueVirtualViewportUpdate(mount, request)
  }

  private queueVirtualViewportUpdate(mount: MountedPluginUi, request: VirtualScrollRequest): void {
    if (mount.virtualScrollTimer !== undefined || request.inFlight) return
    mount.virtualScrollTimer = setTimeout(() => {
      delete mount.virtualScrollTimer
      if (
        this.mounts.get(uiKey(mount.contribution)) !== mount ||
        mount.virtualScrollRequest !== request ||
        request.documentId !== this.documentId ||
        request.documentVersion !== this.renderState().documentVersion ||
        request.selectionRevision !== this.renderState().selectionRevision ||
        mount.virtualTreeFocus
      ) {
        return
      }
      if (mount.virtualPointerActive) return
      request.pending = false
      const list = mount.body.querySelector<HTMLElement>('[data-virtual-list]')
      const metadata = list && readVirtualListMetadata(list)
      if (!list || metadata?.id !== request.id) return
      if (!metadata || list.clientHeight <= 0) return
      const requestedEdge = mount.virtualPendingEdgeHint
      delete mount.virtualPendingEdgeHint

      const visibleStart = Math.max(0, Math.floor(list.scrollTop / metadata.itemHeight))
      const visibleEnd = Math.min(
        metadata.total,
        Math.ceil((list.scrollTop + list.clientHeight) / metadata.itemHeight),
      )
      const visibleCount = Math.max(1, visibleEnd - visibleStart)
      const bufferItems = Math.max(virtualListMinimumBufferItems, visibleCount * 8)
      const refreshMarginItems = Math.max(
        virtualListMinimumRefreshMarginItems,
        Math.ceil(visibleCount * 1.5),
      )
      const fromIndex = Math.max(0, visibleStart - bufferItems)
      const toIndex = Math.min(metadata.total, visibleEnd + bufferItems)
      const edge =
        requestedEdge === 'before' &&
        metadata.hasBefore &&
        isVirtualListAtEdge(list, 'before', metadata)
          ? 'before'
          : requestedEdge === 'after' &&
              metadata.hasAfter &&
              isVirtualListAtEdge(list, 'after', metadata)
            ? 'after'
            : undefined

      const needsRangeBefore =
        metadata.start > 0 && visibleStart - metadata.start < refreshMarginItems
      const needsRangeAfter =
        metadata.end < metadata.total && metadata.end - visibleEnd < refreshMarginItems
      if (!edge && !needsRangeBefore && !needsRangeAfter) return
      const requested = request.requested
      if (
        !edge &&
        requested?.total === metadata.total &&
        visibleStart >= requested.viewport.fromIndex &&
        visibleEnd <= requested.viewport.toIndex
      )
        return
      mount.virtualUserIntentUntil = 0
      const requestId = (mount.virtualRequestSequence ?? 0) + 1
      mount.virtualRequestSequence = requestId
      mount.virtualViewport = Object.freeze({
        id: metadata.id,
        fromIndex,
        toIndex,
        userInitiated: true,
        ...(edge ? { edge, requestId } : {}),
      })
      request.requested = { viewport: mount.virtualViewport, total: metadata.total }
      const token = {}
      request.inFlight = token
      void this.updateMount(mount).finally(() => {
        if (mount.virtualScrollRequest !== request || request.inFlight !== token) return
        delete request.inFlight
        if (request.pending) this.queueVirtualViewportUpdate(mount, request)
      })
    }, virtualListScrollDelay)
  }

  private toggleSidebarPanel(key: string): void {
    const mount = this.mounts.get(key)
    if (!mount?.toggle || mount.contribution.slot !== 'sidebar-panel') return

    const collapsed = !this.collapsedSidebarPanels.has(key)
    const hadFocus = mount.container.contains(this.root.ownerDocument.activeElement)
    if (collapsed) this.collapsedSidebarPanels.add(key)
    else this.collapsedSidebarPanels.delete(key)

    mount.container.dataset.collapsed = String(collapsed)
    mount.container.style.removeProperty('flex')
    mount.body.hidden = collapsed
    mount.toggle.setAttribute('aria-expanded', String(!collapsed))
    mount.toggle.innerHTML = `${iconSvg(collapsed ? ChevronRight : ChevronDown)}<span>${escapeText(mount.contribution.title)}</span>`
    this.reorderSidebarPanels()
    if (hadFocus) mount.toggle.focus({ preventScroll: true })
    void this.updateMount(mount)
  }

  private reorderSidebarPanels(): void {
    this.sidebarResizeCleanup?.()
    const target = this.root.querySelector<HTMLElement>('[data-plugin-slot="sidebar-panel"]')
    if (!target) return

    const contributionOrder = new Map(
      this.runtime
        .contributions()
        .ui.filter((view) => view.slot === 'sidebar-panel')
        .map((view, index) => [uiKey(view), index]),
    )
    const panels = [...this.mounts.entries()]
      .filter(([, mount]) => mount.contribution.slot === 'sidebar-panel')
      .sort(([leftKey], [rightKey]) => {
        const collapsedDifference =
          Number(this.collapsedSidebarPanels.has(leftKey)) -
          Number(this.collapsedSidebarPanels.has(rightKey))
        return (
          collapsedDifference ||
          (contributionOrder.get(leftKey) ?? Number.MAX_SAFE_INTEGER) -
            (contributionOrder.get(rightKey) ?? Number.MAX_SAFE_INTEGER)
        )
      })

    target.append(...panels.map(([, mount]) => mount.container))
    const expanded = panels.filter(([key]) => !this.collapsedSidebarPanels.has(key))
    if (expanded.some(([, mount]) => mount.container.style.flex)) {
      const weights = expanded.map(([, mount]) => Number(mount.container.style.flexGrow || 1))
      const total = weights.reduce((sum, weight) => sum + weight, 0)
      expanded.forEach(([, mount], index) => {
        const weight = total > 0 ? (weights[index]! * expanded.length) / total : 1
        mount.container.style.flex = `${weight} 1 ${sidebarPanelMinimumHeight}px`
      })
    }
    let foundCollapsedPanel = false

    for (const [key, mount] of panels) {
      const collapsed = this.collapsedSidebarPanels.has(key)
      if (collapsed && !foundCollapsedPanel) {
        mount.container.dataset.collapseStackStart = 'true'
        foundCollapsedPanel = true
      } else {
        delete mount.container.dataset.collapseStackStart
      }
      if (!mount.resizeHandle) continue
      const expandedIndex = expanded.findIndex(([candidate]) => candidate === key)
      mount.resizeHandle.hidden = expandedIndex < 0 || expandedIndex >= expanded.length - 1
    }
  }

  private startSidebarPanelResize(key: string, event: PointerEvent): void {
    if (event.button !== 0) return
    const pair = this.getSidebarPanelPair(key)
    const handle = pair?.[0].resizeHandle
    if (!pair || !handle) return
    this.sidebarResizeCleanup?.()
    event.preventDefault()
    handle.focus({ preventScroll: true })

    const startY = event.clientY
    const firstHeight = pair[0].container.getBoundingClientRect().height
    const secondHeight = pair[1].container.getBoundingClientRect().height
    const ownerDocument = this.root.ownerDocument
    const window = ownerDocument.defaultView
    const handleMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== event.pointerId) return
      this.applySidebarPanelPairSize(pair, firstHeight, secondHeight, moveEvent.clientY - startY)
    }
    const cleanup = (): void => {
      this.sidebarResizeCleanup = undefined
      ownerDocument.removeEventListener('pointermove', handleMove)
      ownerDocument.removeEventListener('pointerup', handleEnd)
      ownerDocument.removeEventListener('pointercancel', handleEnd)
      handle.removeEventListener('lostpointercapture', handleEnd)
      window?.removeEventListener('blur', cleanup)
      window?.removeEventListener('resize', cleanup)
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId)
      ownerDocument.documentElement.dataset.pluginPanelResizing = 'false'
    }
    const handleEnd = (endEvent: PointerEvent): void => {
      if (endEvent.pointerId === event.pointerId) cleanup()
    }

    this.sidebarResizeCleanup = cleanup
    ownerDocument.documentElement.dataset.pluginPanelResizing = 'true'
    ownerDocument.addEventListener('pointermove', handleMove)
    ownerDocument.addEventListener('pointerup', handleEnd)
    ownerDocument.addEventListener('pointercancel', handleEnd)
    handle.addEventListener('lostpointercapture', handleEnd)
    window?.addEventListener('blur', cleanup)
    window?.addEventListener('resize', cleanup)
    handle.setPointerCapture?.(event.pointerId)
  }

  private resizeSidebarPanelPair(key: string, delta: number): void {
    const pair = this.getSidebarPanelPair(key)
    if (!pair) return
    this.applySidebarPanelPairSize(
      pair,
      pair[0].container.getBoundingClientRect().height,
      pair[1].container.getBoundingClientRect().height,
      delta,
    )
  }

  private getSidebarPanelPair(
    key: string,
  ): readonly [MountedPluginUi, MountedPluginUi] | undefined {
    const expanded = this.getExpandedSidebarPanels()
    const index = expanded.findIndex((mount) => uiKey(mount.contribution) === key)
    return index >= 0 && index < expanded.length - 1
      ? [expanded[index]!, expanded[index + 1]!]
      : undefined
  }

  private getExpandedSidebarPanels(): MountedPluginUi[] {
    const target = this.root.querySelector<HTMLElement>('[data-plugin-slot="sidebar-panel"]')
    if (!target) return []
    // Document-scoped remounts change Map insertion order. The separator belongs
    // to the next visible DOM panel, including after collapse/reordering.
    return Array.from(target.children).flatMap((element) => {
      const key = (element as HTMLElement).dataset.pluginUi
      const mount = key ? this.mounts.get(key) : undefined
      return mount && !this.collapsedSidebarPanels.has(key!) ? [mount] : []
    })
  }

  private applySidebarPanelPairSize(
    pair: readonly [MountedPluginUi, MountedPluginUi],
    firstHeight: number,
    secondHeight: number,
    delta: number,
  ): void {
    const boundedDelta = Math.min(
      secondHeight - sidebarPanelMinimumHeight,
      Math.max(sidebarPanelMinimumHeight - firstHeight, delta),
    )
    const panels = this.getExpandedSidebarPanels()
    const excessHeights = panels.map((mount) => {
      const height =
        mount === pair[0]
          ? firstHeight + boundedDelta
          : mount === pair[1]
            ? secondHeight - boundedDelta
            : mount.container.getBoundingClientRect().height
      return Math.max(0, height - sidebarPanelMinimumHeight)
    })
    const total = excessHeights.reduce((sum, height) => sum + height, 0)
    // Share only the space above each panel's minimum. Pixel bases would leave
    // siblings clipped after a window resize; resize all weights to keep the
    // untouched panels stationary during this gesture.
    panels.forEach((mount, index) => {
      const weight = total > 0 ? (excessHeights[index]! * panels.length) / total : 1
      mount.container.style.flex = `${weight} 1 ${sidebarPanelMinimumHeight}px`
    })
  }
}

function hasToolbarContent(node: Node): boolean {
  if (node.textContent?.trim()) return true
  return (
    node instanceof Element &&
    (node.matches('button, input, select, [data-host-icon]') ||
      node.querySelector('button, input, select, [data-host-icon]') !== null)
  )
}

function decorateControlledUiIcons(container: HTMLElement): void {
  const icons = {
    'list-tree': ListTree,
    'circle-alert': CircleAlert,
    'loader-circle': LoaderCircle,
  } as const

  for (const target of Array.from(container.querySelectorAll<HTMLElement>('[data-host-icon]'))) {
    const iconName = target.dataset.hostIcon as keyof typeof icons | undefined
    const icon = iconName ? icons[iconName] : undefined
    if (!icon) continue
    target.innerHTML = iconSvg(icon)
    target.setAttribute('aria-hidden', 'true')
    if (iconName === 'loader-circle') {
      const startedAt = Number(target.dataset.animationStartedAt)
      const now = Date.now()
      if (Number.isFinite(startedAt) && startedAt > 0) {
        target.style.animationDelay = `-${now - startedAt}ms`
      } else {
        target.dataset.animationStartedAt = String(now)
      }
    }
  }
}

function uiKey(contribution: Pick<PluginUiBinding, 'pluginId' | 'id'>): string {
  return `${contribution.pluginId}:${contribution.id}`
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface ScrollOffsetSnapshot {
  readonly path: readonly number[]
  readonly top: number
  readonly left: number
}

function controlledOutputSignature(output: ControlledRendererOutput): string {
  return JSON.stringify(output) ?? String(output)
}

interface VirtualListMetadata {
  readonly id: string
  readonly total: number
  readonly start: number
  readonly end: number
  readonly itemHeight: number
  readonly active: number
  readonly followActive: boolean
  readonly hasBefore: boolean
  readonly hasAfter: boolean
  readonly scrollAdjust: number
  readonly revision: number
}

function readVirtualListMetadata(list: HTMLElement): VirtualListMetadata | undefined {
  const id = list.dataset.virtualList
  const total = readNonNegativeInteger(list.dataset.virtualTotal)
  const start = readNonNegativeInteger(list.dataset.virtualStart)
  const end = readNonNegativeInteger(list.dataset.virtualEnd)
  const itemHeight = Number(list.dataset.virtualItemHeight)
  const active = Number(list.dataset.virtualActive)
  const scrollAdjust = Number(list.dataset.virtualScrollAdjust ?? '0')
  const revision = readNonNegativeInteger(list.dataset.virtualRevision ?? '0')
  if (
    !id ||
    total === undefined ||
    start === undefined ||
    end === undefined ||
    start > end ||
    end > total ||
    !Number.isFinite(itemHeight) ||
    itemHeight <= 0 ||
    !Number.isInteger(active) ||
    active < -1 ||
    active >= total ||
    !Number.isFinite(scrollAdjust) ||
    revision === undefined
  ) {
    return undefined
  }

  return {
    id,
    total,
    start,
    end,
    itemHeight,
    active,
    followActive: list.dataset.virtualFollowActive === 'true',
    hasBefore: list.dataset.virtualHasBefore === 'true',
    hasAfter: list.dataset.virtualHasAfter === 'true',
    scrollAdjust,
    revision,
  }
}

function isVirtualListAtEdge(
  list: HTMLElement,
  direction: 'before' | 'after',
  metadata = readVirtualListMetadata(list),
): boolean {
  if (!metadata || list.clientHeight <= 0) return false
  if (direction === 'before') return list.scrollTop <= 0.5

  const estimatedMaximumScrollTop = Math.max(
    0,
    metadata.total * metadata.itemHeight - list.clientHeight,
  )
  const measuredMaximumScrollTop = Math.max(0, list.scrollHeight - list.clientHeight)
  const maximumScrollTop =
    measuredMaximumScrollTop > 0 ? measuredMaximumScrollTop : estimatedMaximumScrollTop
  return list.scrollTop >= maximumScrollTop - 0.5
}

function readNonNegativeInteger(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function captureScrollOffsets(root: HTMLElement): readonly ScrollOffsetSnapshot[] {
  const snapshots: ScrollOffsetSnapshot[] = []

  function visit(element: HTMLElement, path: readonly number[]): void {
    if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
      snapshots.push({ path, top: element.scrollTop, left: element.scrollLeft })
    }
    Array.from(element.children).forEach((child, index) => {
      if (child instanceof HTMLElement) visit(child, [...path, index])
    })
  }

  visit(root, [])
  return snapshots
}

function restoreScrollOffsets(root: HTMLElement, snapshots: readonly ScrollOffsetSnapshot[]): void {
  for (const snapshot of snapshots) {
    let element: HTMLElement | undefined = root
    for (const index of snapshot.path) {
      const child: Element | undefined = element?.children[index]
      element = child instanceof HTMLElement ? child : undefined
      if (!element) break
    }
    if (!element) continue
    element.scrollTop = snapshot.top
    element.scrollLeft = snapshot.left
  }
}

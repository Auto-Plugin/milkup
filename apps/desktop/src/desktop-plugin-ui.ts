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

import type { DesktopPluginUiPhase } from './desktop-plugin-manager'
import { iconSvg } from './icons'

export interface DesktopPluginUiRuntime {
  contributions(): PluginContributionIndex
  renderUi(
    pluginId: string,
    viewId: string,
    phase: DesktopPluginUiPhase,
    state?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>
  resolveCommand(rendererId: string, command: string): string | undefined
  runCommand(command: string, input: unknown): void
}

interface MountedPluginUi {
  readonly contribution: PluginUiBinding
  readonly container: HTMLElement
  readonly body: HTMLElement
  readonly toggle?: HTMLButtonElement
  readonly resizeHandle?: HTMLElement
  readonly documentId: string
  readonly generation: number
  renderSequence: number
  renderSignature: string | undefined
  virtualViewport?: PluginVirtualViewportState
  virtualScrollTimer?: ReturnType<typeof setTimeout>
  virtualScrollTop?: number
  virtualUserIntentUntil?: number
  virtualPointerActive?: boolean
  virtualPointerCleanup?: () => void
  virtualRequestSequence?: number
  virtualAdjustmentRevision?: number
}

interface PluginVirtualViewportState {
  readonly id: string
  readonly fromIndex: number
  readonly toIndex: number
  readonly userInitiated?: boolean
  readonly edge?: 'before' | 'after'
  readonly requestId?: number
}

const sidebarPanelMinimumHeight = 96
const virtualListScrollDelay = 40
const virtualListMinimumBufferItems = 80
const virtualListMinimumRefreshMarginItems = 12

export class DesktopPluginUiController {
  private readonly mounts = new Map<string, MountedPluginUi>()
  private readonly openModals = new Set<string>()
  private generation = 0
  private documentId = ''
  private lastSyncSignature = ''
  private readonly collapsedSidebarPanels = new Set<string>()
  private viewportUpdatePending = false
  private viewportUpdatePromise: Promise<void> | undefined

  constructor(
    private readonly root: HTMLElement,
    private readonly runtime: DesktopPluginUiRuntime,
    private readonly renderState: () => Readonly<Record<string, unknown>> = () => ({}),
  ) {}

  async sync(documentId: string): Promise<void> {
    this.documentId = documentId
    const contributions = this.runtime.contributions().ui
    const signature = contributions
      .filter((view) => view.slot !== 'modal' || this.openModals.has(uiKey(view)))
      .map(
        (view) =>
          `${uiKey(view)}:${view.slot}:${view.title}:${view.scope ?? 'app'}:${view.viewportUpdates !== false}:${view.scope === 'document' ? documentId : ''}`,
      )
      .join('|')

    if (signature === this.lastSyncSignature) {
      return
    }

    this.lastSyncSignature = signature
    const desired = new Map(
      contributions
        .filter((view) => view.slot !== 'modal' || this.openModals.has(uiKey(view)))
        .map((view) => [uiKey(view), view]),
    )

    for (const [key, mount] of this.mounts) {
      const next = desired.get(key)
      const documentChanged =
        mount.contribution.scope === 'document' && mount.documentId !== documentId
      const contributionChanged =
        next !== undefined &&
        (mount.contribution.slot !== next.slot ||
          mount.contribution.title !== next.title ||
          mount.contribution.scope !== next.scope ||
          mount.contribution.viewportUpdates !== next.viewportUpdates)

      if (!next || documentChanged || contributionChanged) {
        await this.disposeMount(key, mount)
      }
    }

    for (const [key, contribution] of desired) {
      const mount = this.mounts.get(key)

      if (mount) {
        await this.updateMount(mount)
      } else {
        await this.mount(contribution)
      }
    }
  }

  async open(pluginId: string, viewId: string): Promise<void> {
    this.openModals.add(`${pluginId}:${viewId}`)
    await this.sync(this.documentId)
    this.mounts.get(`${pluginId}:${viewId}`)?.container.focus()
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

  async updateViewport(): Promise<void> {
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

  async dispose(): Promise<void> {
    this.lastSyncSignature = ''
    for (const [key, mount] of [...this.mounts]) {
      await this.disposeMount(key, mount)
    }
  }

  private async mount(contribution: PluginUiBinding): Promise<void> {
    const target = this.root.querySelector<HTMLElement>(`[data-plugin-slot="${contribution.slot}"]`)

    if (!target) {
      return
    }

    const generation = ++this.generation
    const container = this.root.ownerDocument.createElement(
      contribution.slot === 'document-toolbar' || contribution.slot === 'statusbar'
        ? 'span'
        : 'section',
    )
    container.className = `plugin-ui plugin-ui-${contribution.slot}`
    container.dataset.pluginUi = uiKey(contribution)
    container.tabIndex = -1
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
      void this.sendLifecycle(contribution, 'focus')
    })
    container.addEventListener('focusout', () => {
      void this.sendLifecycle(contribution, 'blur')
    })
    container.addEventListener('milkup-plugin-renderer-action', (event) => {
      const detail = (event as CustomEvent<ControlledRendererActionDetail>).detail
      const command = this.runtime.resolveCommand(detail.rendererId, detail.command)

      if (command) {
        this.runtime.runCommand(command, detail.input ?? {})
      }
    })
    target.append(container)
    const mount = {
      contribution,
      container,
      body,
      ...(toggle ? { toggle } : {}),
      ...(resizeHandle ? { resizeHandle } : {}),
      documentId: this.documentId,
      generation,
      renderSequence: 0,
      renderSignature: undefined,
    }
    this.mounts.set(uiKey(contribution), mount)
    this.reorderSidebarPanels()
    await this.renderMount(mount, 'mount')
  }

  private async updateMount(mount: MountedPluginUi): Promise<void> {
    await this.renderMount(mount, 'update')
  }

  private async renderMount(mount: MountedPluginUi, phase: 'mount' | 'update'): Promise<void> {
    const renderSequence = ++mount.renderSequence
    try {
      const output = (await this.runtime.renderUi(
        mount.contribution.pluginId,
        mount.contribution.id,
        phase,
        {
          documentId: this.documentId,
          ...this.renderState(),
          ...(mount.virtualViewport ? { virtualViewport: mount.virtualViewport } : {}),
        },
      )) as ControlledRendererOutput

      if (
        this.mounts.get(uiKey(mount.contribution))?.generation !== mount.generation ||
        renderSequence !== mount.renderSequence
      ) {
        return
      }

      const signature = controlledOutputSignature(output)
      if (signature === mount.renderSignature) {
        mount.container.dataset.uiState = 'ready'
        return
      }

      const scrollOffsets = captureScrollOffsets(mount.body)
      const existingClose = mount.body.querySelector('.plugin-ui-close')
      mount.body.replaceChildren(
        ...(existingClose ? [existingClose] : []),
        ...createControlledRendererNodes(
          this.root.ownerDocument,
          uiKey(mount.contribution),
          output,
        ),
      )
      decorateControlledUiIcons(mount.body)
      if (!this.configureVirtualList(mount, scrollOffsets)) {
        restoreScrollOffsets(mount.body, scrollOffsets)
      }
      mount.renderSignature = signature
      mount.container.dataset.uiState = 'ready'
    } catch (error) {
      if (renderSequence !== mount.renderSequence) return
      mount.container.dataset.uiState = 'failed'
      const message = this.root.ownerDocument.createElement('span')
      message.className = 'plugin-ui-error'
      message.textContent = error instanceof Error ? error.message : String(error)
      mount.body.replaceChildren(message)
      mount.renderSignature = undefined
    }
  }

  private async sendLifecycle(
    contribution: PluginUiBinding,
    phase: 'focus' | 'blur',
  ): Promise<void> {
    await this.runtime
      .renderUi(contribution.pluginId, contribution.id, phase, {
        documentId: this.documentId,
        ...this.renderState(),
      })
      .catch(() => undefined)
  }

  private async disposeMount(key: string, mount: MountedPluginUi): Promise<void> {
    this.mounts.delete(key)
    this.collapsedSidebarPanels.delete(key)
    if (mount.virtualScrollTimer !== undefined) clearTimeout(mount.virtualScrollTimer)
    mount.virtualPointerCleanup?.()
    mount.container.remove()
    this.reorderSidebarPanels()
    await this.runtime
      .renderUi(mount.contribution.pluginId, mount.contribution.id, 'dispose', {
        documentId: mount.documentId,
      })
      .catch(() => undefined)
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
    mount.virtualViewport = Object.freeze({
      id: metadata.id,
      fromIndex: metadata.start,
      toIndex: metadata.end,
      userInitiated:
        !metadata.followActive &&
        mount.virtualViewport?.id === metadata.id &&
        mount.virtualViewport.userInitiated === true,
    })

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
        mount.virtualPointerCleanup?.()
        mount.virtualPointerActive = true
        this.markVirtualUserIntent(mount, 5000)
        const ownerDocument = list.ownerDocument
        const finishPointerInteraction = (): void => {
          ownerDocument.removeEventListener('pointerup', finishPointerInteraction)
          ownerDocument.removeEventListener('pointercancel', finishPointerInteraction)
          delete mount.virtualPointerCleanup
          mount.virtualPointerActive = false
          this.markVirtualUserIntent(mount, 750)
          this.scheduleVirtualViewportUpdate(mount, list)
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
        this.markVirtualUserIntent(mount, 750)
        this.scheduleVirtualViewportUpdate(
          mount,
          list,
          event.deltaY < 0 ? 'before' : event.deltaY > 0 ? 'after' : undefined,
        )
      },
      { passive: true },
    )
    list.addEventListener('keydown', () => this.markVirtualUserIntent(mount, 750), {
      passive: true,
    })
    list.addEventListener('scroll', () => this.scheduleVirtualViewportUpdate(mount, list), {
      passive: true,
    })
    return true
  }

  private markVirtualUserIntent(mount: MountedPluginUi, duration: number): void {
    mount.virtualUserIntentUntil = Date.now() + duration
  }

  private scheduleVirtualViewportUpdate(
    mount: MountedPluginUi,
    list: HTMLElement,
    edgeHint?: 'before' | 'after',
  ): void {
    mount.virtualScrollTop = list.scrollTop
    if (mount.virtualPointerActive) return
    if ((mount.virtualUserIntentUntil ?? 0) < Date.now()) return
    if (mount.virtualScrollTimer !== undefined) clearTimeout(mount.virtualScrollTimer)
    mount.virtualScrollTimer = setTimeout(() => {
      delete mount.virtualScrollTimer
      if (this.mounts.get(uiKey(mount.contribution)) !== mount || !mount.body.contains(list)) {
        return
      }

      const metadata = readVirtualListMetadata(list)
      if (!metadata || list.clientHeight <= 0) return

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
      const estimatedMaximumScrollTop = Math.max(
        0,
        metadata.total * metadata.itemHeight - list.clientHeight,
      )
      const measuredMaximumScrollTop = Math.max(0, list.scrollHeight - list.clientHeight)
      const maximumScrollTop =
        measuredMaximumScrollTop > 0 ? measuredMaximumScrollTop : estimatedMaximumScrollTop
      const atBeforeEdge = list.scrollTop <= 0
      const atAfterEdge = list.scrollTop >= maximumScrollTop
      const edge =
        edgeHint === 'before' && metadata.hasBefore && atBeforeEdge
          ? 'before'
          : edgeHint === 'after' && metadata.hasAfter && atAfterEdge
            ? 'after'
            : metadata.hasBefore && atBeforeEdge
              ? 'before'
              : metadata.hasAfter && atAfterEdge
                ? 'after'
                : undefined

      const needsRangeBefore =
        metadata.start > 0 && visibleStart - metadata.start < refreshMarginItems
      const needsRangeAfter =
        metadata.end < metadata.total && metadata.end - visibleEnd < refreshMarginItems
      if (!edge && !needsRangeBefore && !needsRangeAfter) return
      if (
        !edge &&
        mount.virtualViewport?.id === metadata.id &&
        mount.virtualViewport.fromIndex === fromIndex &&
        mount.virtualViewport.toIndex === toIndex
      ) {
        return
      }

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
      void this.updateMount(mount)
    }, virtualListScrollDelay)
  }

  private toggleSidebarPanel(key: string): void {
    const mount = this.mounts.get(key)
    if (!mount?.toggle || mount.contribution.slot !== 'sidebar-panel') return

    const collapsed = !this.collapsedSidebarPanels.has(key)
    if (collapsed) this.collapsedSidebarPanels.add(key)
    else this.collapsedSidebarPanels.delete(key)

    mount.container.dataset.collapsed = String(collapsed)
    mount.container.style.removeProperty('flex')
    mount.body.hidden = collapsed
    mount.toggle.setAttribute('aria-expanded', String(!collapsed))
    mount.toggle.innerHTML = `${iconSvg(collapsed ? ChevronRight : ChevronDown)}<span>${escapeText(mount.contribution.title)}</span>`
    this.reorderSidebarPanels()
  }

  private reorderSidebarPanels(): void {
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
    if (!pair) return
    event.preventDefault()

    const startY = event.clientY
    const firstHeight = pair[0].container.getBoundingClientRect().height
    const secondHeight = pair[1].container.getBoundingClientRect().height
    const ownerDocument = this.root.ownerDocument
    const handleMove = (moveEvent: PointerEvent): void => {
      this.applySidebarPanelPairSize(pair, firstHeight, secondHeight, moveEvent.clientY - startY)
    }
    const handleUp = (): void => {
      ownerDocument.removeEventListener('pointermove', handleMove)
      ownerDocument.removeEventListener('pointerup', handleUp)
      ownerDocument.documentElement.dataset.pluginPanelResizing = 'false'
    }

    ownerDocument.documentElement.dataset.pluginPanelResizing = 'true'
    ownerDocument.addEventListener('pointermove', handleMove)
    ownerDocument.addEventListener('pointerup', handleUp)
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
    const expanded = [...this.mounts.entries()].filter(
      ([candidate, mount]) =>
        mount.contribution.slot === 'sidebar-panel' && !this.collapsedSidebarPanels.has(candidate),
    )
    const index = expanded.findIndex(([candidate]) => candidate === key)
    return index >= 0 && index < expanded.length - 1
      ? [expanded[index]![1], expanded[index + 1]![1]]
      : undefined
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
    pair[0].container.style.flex = `0 0 ${Math.round(firstHeight + boundedDelta)}px`
    pair[1].container.style.flex = `0 0 ${Math.round(secondHeight - boundedDelta)}px`
  }
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

import type { PluginContributionIndex, PluginUiBinding } from '@milkup/plugin'
import { CircleAlert, ListTree, LoaderCircle } from 'lucide'
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
  readonly documentId: string
  readonly generation: number
}

export class DesktopPluginUiController {
  private readonly mounts = new Map<string, MountedPluginUi>()
  private readonly openModals = new Set<string>()
  private generation = 0
  private documentId = ''
  private lastSyncSignature = ''

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
          `${uiKey(view)}:${view.slot}:${view.scope ?? 'app'}:${view.scope === 'document' ? documentId : ''}`,
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

      if (!next || documentChanged) {
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
    await Promise.all([...this.mounts.values()].map((mount) => this.updateMount(mount)))
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
    const mount = { contribution, container, documentId: this.documentId, generation }
    this.mounts.set(uiKey(contribution), mount)
    await this.renderMount(mount, 'mount')
  }

  private async updateMount(mount: MountedPluginUi): Promise<void> {
    await this.renderMount(mount, 'update')
  }

  private async renderMount(mount: MountedPluginUi, phase: 'mount' | 'update'): Promise<void> {
    try {
      const output = (await this.runtime.renderUi(
        mount.contribution.pluginId,
        mount.contribution.id,
        phase,
        { documentId: this.documentId, ...this.renderState() },
      )) as ControlledRendererOutput

      if (this.mounts.get(uiKey(mount.contribution))?.generation !== mount.generation) {
        return
      }

      const existingClose = mount.container.querySelector('.plugin-ui-close')
      mount.container.replaceChildren(
        ...(existingClose ? [existingClose] : []),
        ...createControlledRendererNodes(
          this.root.ownerDocument,
          uiKey(mount.contribution),
          output,
        ),
      )
      decorateControlledUiIcons(mount.container)
      mount.container.dataset.uiState = 'ready'
    } catch (error) {
      mount.container.dataset.uiState = 'failed'
      const message = this.root.ownerDocument.createElement('span')
      message.className = 'plugin-ui-error'
      message.textContent = error instanceof Error ? error.message : String(error)
      mount.container.append(message)
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
    mount.container.remove()
    await this.runtime
      .renderUi(mount.contribution.pluginId, mount.contribution.id, 'dispose', {
        documentId: mount.documentId,
      })
      .catch(() => undefined)
  }
}

function decorateControlledUiIcons(container: HTMLElement): void {
  const icons = [
    ['.outline-empty-icon', ListTree],
    ['.outline-error-icon', CircleAlert],
    ['.outline-loading-icon', LoaderCircle],
  ] as const

  for (const [selector, icon] of icons) {
    const target = container.querySelector<HTMLElement>(selector)
    if (!target) continue
    target.innerHTML = iconSvg(icon)
    target.setAttribute('aria-hidden', 'true')
  }
}

function uiKey(contribution: Pick<PluginUiBinding, 'pluginId' | 'id'>): string {
  return `${contribution.pluginId}:${contribution.id}`
}

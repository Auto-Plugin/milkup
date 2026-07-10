// @vitest-environment jsdom

import type { PluginContributionIndex } from '@milkup/plugin'
import { describe, expect, it, vi } from 'vitest'

import { DesktopPluginUiController, type DesktopPluginUiRuntime } from './desktop-plugin-ui'

describe('DesktopPluginUiController', () => {
  it('mounts controlled slots and recreates document-scoped views on document changes', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    expect(document.querySelector('[data-plugin-ui="example:outline"]')?.textContent).toBe(
      'mount:doc-a',
    )

    await controller.sync('doc-b')
    expect(phases).toEqual(['mount', 'dispose', 'mount'])
    expect(document.querySelector('[data-plugin-ui="example:outline"]')?.textContent).toBe(
      'mount:doc-b',
    )
  })

  it('opens and closes modal views repeatedly and bridges declared commands', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="modal"></div></main>'
    const phases: string[] = []
    const runCommand = vi.fn()
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'dialog',
          title: 'Dialog',
          slot: 'modal',
          scope: 'app',
        },
      ],
      phases,
      runCommand,
      () => ({
        type: 'element',
        tag: 'button',
        text: 'Run',
        action: { command: 'example.run' },
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc-a')
    expect(document.querySelector('[data-plugin-ui]')).toBeNull()

    await controller.open('example', 'dialog')
    document.querySelector<HTMLElement>('[data-plugin-command]')?.click()
    expect(runCommand).toHaveBeenCalledWith('example.run', {})

    await controller.close('example', 'dialog')
    await controller.open('example', 'dialog')
    await controller.close('example', 'dialog')
    expect(phases).toEqual(['mount', 'focus', 'dispose', 'mount', 'focus', 'dispose'])
    expect(document.querySelector('[data-plugin-ui]')).toBeNull()
  })

  it('rerenders only the requested plugin view when invalidated', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
        {
          pluginId: 'other',
          id: 'notes',
          title: 'Notes',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    phases.length = 0
    await controller.invalidate('example', 'outline')

    expect(phases).toEqual(['update'])
  })

  it('passes fresh viewport state when an editor scroll update rerenders mounted UI', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    let activeLine = 1
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'outline',
          title: 'Outline',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      phases,
      vi.fn(),
      (_phase, state) => String((state.viewport as { activeLine: number }).activeLine),
    )
    const controller = new DesktopPluginUiController(document.body, runtime, () => ({
      viewport: { fromLine: activeLine, toLine: activeLine + 20, activeLine },
    }))

    await controller.sync('doc-a')
    activeLine = 900
    await controller.updateViewport()

    expect(document.querySelector('[data-plugin-ui="example:outline"]')?.textContent).toBe('900')
    expect(phases).toEqual(['mount', 'update'])
  })
})

function createRuntime(
  ui: PluginContributionIndex['ui'],
  phases: string[],
  runCommand = vi.fn(),
  output: (phase: string, state: Readonly<Record<string, unknown>>) => unknown = (phase, state) =>
    `${phase}:${String(state.documentId)}`,
): DesktopPluginUiRuntime {
  const index: PluginContributionIndex = {
    commands: [],
    keymaps: [],
    renderers: [],
    markdownSyntax: [],
    ui,
    importers: [],
    documentTypes: [],
  }

  return {
    contributions: () => index,
    renderUi: async (_pluginId, _viewId, phase, state = {}) => {
      phases.push(phase)
      return output(phase, state)
    },
    resolveCommand: (_rendererId, command) => (command === 'example.run' ? command : undefined),
    runCommand,
  }
}

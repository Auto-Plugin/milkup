// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PluginContributionIndex } from '@milkup/plugin'
import { describe, expect, it, vi } from 'vitest'

import { DesktopPluginUiController, type DesktopPluginUiRuntime } from './desktop-plugin-ui'
import { EditorContextMenu } from './editor-context-menu'
import { normalizePluginContextMenuNodes, reconcilePluginContextMenu } from './context-menu-plugins'

describe('context menu output ownership', () => {
  function fixture() {
    document.body.innerHTML = '<div data-plugin-slot="context-menu"></div>'
    const slot = document.querySelector<HTMLElement>('[data-plugin-slot="context-menu"]')!
    const state = { documentVersion: 1, selectionRevision: 1, saveLocationGeneration: 1 }
    const run = vi.fn()
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'menu',
          title: 'Menu',
          slot: 'context-menu',
          scope: 'app',
          viewportUpdates: false,
        },
      ],
      [],
      run,
    )
    const output = (label: string) => ({
      type: 'element',
      tag: 'button',
      text: label,
      action: { command: 'example.run', input: { label } },
    })
    const render = vi.fn<DesktopPluginUiRuntime['renderUi']>(
      async (_plugin, _id, phase, snapshot) =>
        snapshot?.visible && (phase === 'mount' || phase === 'update')
          ? output(`${snapshot.documentId}:${snapshot.selectionRevision}`)
          : '',
    )
    runtime.renderUi = render
    const controller = new DesktopPluginUiController(document.body, runtime, () => state, {
      contextMenu: {
        normalize: (nodes, id) => normalizePluginContextMenuNodes(nodes, id, () => true),
        updated: () => reconcilePluginContextMenu(slot),
      },
    })
    return { slot, state, run, render, controller, output }
  }

  it.each(['documentVersion', 'selectionRevision', 'saveLocationGeneration'] as const)(
    'rejects pending output and existing actions after %s changes without another refresh',
    async (field) => {
      const f = fixture()
      await f.controller.sync('doc-a')
      const oldButton = f.slot.querySelector<HTMLButtonElement>('button')!
      f.state[field]++
      oldButton.click()
      expect(f.run).not.toHaveBeenCalled()
      let finish!: (output: unknown) => void
      f.render.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const pending = f.controller.refreshSlot('context-menu')
      expect(f.slot.querySelector('button')).toBeNull()
      expect(f.slot.querySelector<HTMLElement>('[data-plugin-ui]')?.dataset.contextMenuState).toBe(
        'pending',
      )
      f.state[field]++
      finish(f.output('obsolete'))
      await pending
      expect(f.slot.querySelector('button')).toBeNull()
      expect(f.slot.querySelector<HTMLElement>('[data-plugin-ui]')?.dataset.contextMenuState).toBe(
        'retired',
      )
      await f.controller.dispose()
    },
  )

  it('keeps a newer same-selection opening when a previous opening resolves late', async () => {
    const f = fixture()
    await f.controller.sync('doc-a')
    let finish!: (output: unknown) => void
    f.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = f.controller.refreshSlot('context-menu')
    f.controller.setSlotVisible('context-menu', false)
    expect(f.slot.querySelector('button')).toBeNull()
    f.controller.setSlotVisible('context-menu', true)
    await f.controller.refreshSlot('context-menu')
    await vi.waitFor(() => expect(f.slot.querySelector('button')?.textContent).toBe('doc-a:1'))
    const newest = f.slot.querySelector('button')
    finish(f.output('previous opening'))
    await pending
    expect(f.slot.querySelector('button')).toBe(newest)
    expect(f.slot.querySelector('button')?.textContent).toBe('doc-a:1')
    await f.controller.dispose()
  })

  it('renders each menu view once per opening and only notifies visibility when it closes', async () => {
    const f = fixture()
    f.controller.setSlotVisible('context-menu', false)
    await f.controller.sync('doc-a')
    await f.controller.updateViewport()
    await f.controller.refreshSlot('context-menu')
    expect(f.render).not.toHaveBeenCalled()
    f.controller.setSlotVisible('context-menu', true)
    expect(f.render).not.toHaveBeenCalled()
    await f.controller.refreshSlot('context-menu')
    expect(f.render).toHaveBeenCalledTimes(1)
    expect(f.render.mock.calls[0]?.[2]).toBe('mount')
    f.controller.setSlotVisible('context-menu', false)
    expect(f.render).toHaveBeenCalledTimes(2)
    expect(f.render.mock.calls[1]?.[2]).toBe('blur')
    expect(f.render.mock.calls[1]?.[3]?.visible).toBe(false)
    f.controller.setSlotVisible('context-menu', true)
    await f.controller.refreshSlot('context-menu')
    expect(f.render).toHaveBeenCalledTimes(3)
    expect(f.render.mock.calls[2]?.[2]).toBe('update')
    await f.controller.dispose()
  })

  it('finishes one captured hide lifecycle before rendering an immediately reopened selection', async () => {
    const f = fixture()
    await f.controller.sync('doc-a')
    let finish!: (output: unknown) => void
    f.render.mockClear()
    f.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    f.controller.setSlotVisible('context-menu', false)
    f.controller.setSlotVisible('context-menu', false)
    expect(f.render).toHaveBeenCalledTimes(1)
    expect(f.render.mock.calls[0]?.[2]).toBe('blur')
    expect(f.render.mock.calls[0]?.[3]).toMatchObject({ visible: false, selectionRevision: 1 })
    f.state.selectionRevision = 3
    f.controller.setSlotVisible('context-menu', true)
    const reopened = f.controller.refreshSlot('context-menu')
    await Promise.resolve()
    expect(f.render).toHaveBeenCalledTimes(1)
    expect(f.slot.querySelector('button')).toBeNull()
    finish(f.output('obsolete hidden output'))
    await reopened
    expect(f.render).toHaveBeenCalledTimes(2)
    expect(f.render.mock.calls[1]?.[3]).toMatchObject({ visible: true, selectionRevision: 3 })
    expect(f.slot.querySelector('button')?.textContent).toBe('doc-a:3')
    await f.controller.dispose()
  })

  it('defers a same-context refresh until a held menu button dispatches its click', async () => {
    const f = fixture()
    await f.controller.sync('doc-a')
    const button = f.slot.querySelector<HTMLButtonElement>('button')!
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    f.render.mockClear()
    await f.controller.invalidate('example', 'menu')
    expect(f.slot.querySelector('button')).toBe(button)
    expect(f.render).not.toHaveBeenCalled()
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
    button.click()
    expect(f.run).toHaveBeenCalledWith('example.run', { label: 'doc-a:1' })
    await vi.waitFor(() => expect(f.render).toHaveBeenCalledTimes(1))
    await f.controller.dispose()
  })

  it('retires app-scoped output synchronously on document change and rejects its late render', async () => {
    const f = fixture()
    await f.controller.sync('doc-a')
    const oldButton = f.slot.querySelector<HTMLButtonElement>('button')!
    let finish!: (output: unknown) => void
    f.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = f.controller.refreshSlot('context-menu')
    const switched = f.controller.sync('doc-b')
    oldButton.click()
    expect(f.run).not.toHaveBeenCalled()
    expect(f.slot.querySelector('button')).toBeNull()
    await switched
    finish(f.output('doc-a:obsolete'))
    await pending
    expect(f.slot.querySelector('button')?.textContent).toBe('doc-b:1')
    await f.controller.dispose()
  })

  it('never exposes a slow plugin previous selection when a fast plugin completes a reopened menu', async () => {
    document.body.innerHTML =
      '<div id="editor"><textarea></textarea></div><div id="menu"><div data-plugin-slot="context-menu"></div></div>'
    const slot = document.querySelector<HTMLElement>('[data-plugin-slot="context-menu"]')!
    let selectionRevision = 1
    let holdSlow = false
    const slow: { finish(): void; revision: number }[] = []
    const run = vi.fn()
    const views: PluginContributionIndex['ui'] = ['a.fast', 'b.slow'].map((pluginId) => ({
      pluginId,
      id: 'menu',
      title: pluginId,
      slot: 'context-menu',
      scope: 'document',
      viewportUpdates: false,
    }))
    const runtime = createRuntime(views, [], run)
    runtime.renderUi = async (pluginId, _id, phase, state = {}) => {
      if (!state.visible || (phase !== 'mount' && phase !== 'update')) return ''
      const revision = state.selectionRevision as number
      if (holdSlow && pluginId === 'b.slow')
        await new Promise<void>((finish) => slow.push({ finish, revision }))
      return {
        type: 'element',
        tag: 'button',
        text: `${pluginId}:${revision}`,
        action: { command: 'example.run', input: { revision } },
      }
    }
    const controller = new DesktopPluginUiController(
      document.body,
      runtime,
      () => ({ documentVersion: 1, selectionRevision }),
      {
        contextMenu: {
          normalize: (nodes, id) => normalizePluginContextMenuNodes(nodes, id, () => true),
          updated: () => reconcilePluginContextMenu(slot),
        },
      },
    )
    controller.setSlotVisible('context-menu', false)
    await controller.sync('doc-a')
    const identity = {}
    const menu = new EditorContextMenu(
      document.querySelector<HTMLElement>('#editor')!,
      document.querySelector<HTMLElement>('#menu')!,
      {
        host: {
          capture: () => ({ identity, version: 1, selection: selectionRevision }),
          items: () => [{ id: 'copy', label: 'Copy' }],
          isCurrent: (snapshot) => snapshot.selection === selectionRevision,
          execute: () => {},
        },
        pluginContainer: slot,
        visible: (value) => controller.setSlotVisible('context-menu', value),
        refresh: () => controller.refreshSlot('context-menu'),
      },
    )
    await menu.open(20, 20)
    const oldSlow = slot.querySelector<HTMLButtonElement>('[data-plugin-ui="b.slow:menu"] button')!
    expect(oldSlow.textContent).toBe('b.slow:1')
    menu.close()
    selectionRevision = 3
    holdSlow = true
    const reopened = menu.open(20, 20)
    try {
      await vi.waitFor(() =>
        expect(slot.querySelector('[data-plugin-ui="a.fast:menu"] button')?.textContent).toBe(
          'a.fast:3',
        ),
      )
      // This uses the retained real controlled button and shell capture guard.
      // A quota recomputation must not make its old input usable in the new menu.
      oldSlow.click()
      expect(run).not.toHaveBeenCalled()
      expect(slot.querySelector('[data-plugin-ui="b.slow:menu"] button')).toBeNull()
      expect(slot.querySelectorAll('button:not([hidden])')).toHaveLength(1)
    } finally {
      slow.forEach((pending) => pending.finish())
      await reopened
      menu.dispose()
      await controller.dispose()
    }
  })
})

describe('plugin UI lifecycle races', () => {
  function fixture(scope: 'app' | 'document' = 'document') {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    let views: PluginContributionIndex['ui'] = ['first', 'second'].map((id) => ({
      pluginId: 'example',
      id,
      title: id,
      slot: 'sidebar-panel',
      scope,
    }))
    const runtime = createRuntime(views, [])
    const index = runtime.contributions()
    runtime.contributions = () => ({ ...index, ui: views })
    const render = vi.fn<DesktopPluginUiRuntime['renderUi']>(
      async (_plugin, id, phase, state) => `${id}:${phase}:${String(state?.documentId)}`,
    )
    runtime.renderUi = render
    const controller = new DesktopPluginUiController(document.body, runtime)
    return {
      controller,
      runtime,
      render,
      removeViews: () => {
        views = []
      },
      panels: () => Array.from(document.querySelectorAll<HTMLElement>('[data-plugin-ui]')),
      text: () =>
        Array.from(document.querySelectorAll('.plugin-ui-panel-body')).map(
          (body) => body.textContent,
        ),
    }
  }

  function deferred() {
    let resolve!: (output: unknown) => void
    let reject!: (error: Error) => void
    const promise = new Promise<unknown>((finish, fail) => {
      resolve = finish
      reject = fail
    })
    return { promise, resolve, reject }
  }

  it.each(['disable', 'dispose'] as const)(
    'does not resume mounting views after %s interrupts sync',
    async (stop) => {
      const f = fixture()
      const pending = deferred()
      f.render.mockImplementationOnce(() => pending.promise)
      const syncing = f.controller.sync('doc-a')
      if (stop === 'disable') {
        f.removeViews()
        await f.controller.sync('doc-a')
      } else await f.controller.dispose()
      pending.resolve('retired first view')
      await syncing
      expect(f.panels()).toHaveLength(0)
      expect(
        f.render.mock.calls.filter(([, id, phase]) => id === 'second' && phase === 'mount'),
      ).toHaveLength(0)
      await f.controller.dispose()
    },
  )

  it.each(['disable', 'dispose', 'document'] as const)(
    'removes every retired view synchronously while %s cleanup is pending',
    async (stop) => {
      const f = fixture()
      await f.controller.sync('doc-a')
      const retiredPanels = f.panels()
      const pending = deferred()
      f.render.mockImplementationOnce(() => pending.promise)
      if (stop === 'disable') f.removeViews()
      const stopping =
        stop === 'dispose'
          ? f.controller.dispose()
          : f.controller.sync(stop === 'document' ? 'doc-b' : 'doc-a')
      const connected = retiredPanels.map((panel) => panel.isConnected)
      pending.resolve('retired cleanup')
      await stopping
      expect(connected).toEqual([false, false])
      await f.controller.dispose()
    },
  )

  it('keeps only the newest document when a prior sync resumes after pending cleanup', async () => {
    const f = fixture()
    await f.controller.sync('doc-a')
    const pending = deferred()
    f.render.mockImplementationOnce(() => pending.promise)
    const oldSync = f.controller.sync('doc-b')
    const latestSync = f.controller.sync('doc-c')
    pending.resolve('retired cleanup')
    await Promise.all([oldSync, latestSync])
    expect(f.text()).toEqual(['first:mount:doc-c', 'second:mount:doc-c'])
    expect(
      f.render.mock.calls.filter(
        ([, , phase, state]) => phase === 'mount' && state?.documentId === 'doc-c',
      ),
    ).toHaveLength(2)
    expect(
      f.render.mock.calls.filter(
        ([, , phase, state]) => phase === 'update' && state?.documentId === 'doc-c',
      ),
    ).toHaveLength(0)
    await f.controller.dispose()
  })

  it.each(['same', 'new'] as const)(
    'waits for retiring view cleanup only when replacing within the %s execution generation',
    async (replacement) => {
      const f = fixture()
      let generation = 1
      Object.assign(f.runtime, { generation: () => generation })
      await f.controller.sync('doc-a')
      const pending = deferred()
      f.render.mockImplementationOnce(() => pending.promise)
      const oldSync = f.controller.sync('doc-b')
      if (replacement === 'new') generation++
      const latestSync = f.controller.sync('doc-c')
      await new Promise((resolve) => setTimeout(resolve, 0))
      const mountedBeforeCleanup = f.render.mock.calls.filter(
        ([, , phase, state]) => phase === 'mount' && state?.documentId === 'doc-c',
      ).length
      pending.resolve('retired cleanup')
      await Promise.all([oldSync, latestSync])
      expect(mountedBeforeCleanup).toBe(replacement === 'same' ? 0 : 2)
      expect(f.text()).toEqual(['first:mount:doc-c', 'second:mount:doc-c'])
      await f.controller.dispose()
    },
  )

  it('does not mount remaining views from a revoked sync snapshot before the next sync', async () => {
    const f = fixture()
    let generation = 1
    Object.assign(f.runtime, { generation: () => generation })
    const pending = deferred()
    f.render.mockImplementationOnce(() => pending.promise)
    const oldSync = f.controller.sync('doc-a')
    generation++
    pending.resolve('retired first mount')
    await oldSync
    expect(
      f.render.mock.calls.filter(([, id, phase]) => id === 'second' && phase === 'mount'),
    ).toHaveLength(0)
    await f.controller.sync('doc-a')
    expect(f.text()).toEqual(['first:mount:doc-a', 'second:mount:doc-a'])
    await f.controller.dispose()
  })

  it('refreshes app-scoped views for a new document while an old mount is pending', async () => {
    const f = fixture('app')
    const pending = deferred()
    f.render.mockImplementationOnce(() => pending.promise)
    const oldSync = f.controller.sync('doc-a')
    await f.controller.sync('doc-b')
    pending.resolve('retired document output')
    await oldSync
    expect(f.text()).toEqual(['first:update:doc-b', 'second:mount:doc-b'])
    await f.controller.dispose()
  })

  it('does not cancel an in-flight sync when its document and contributions are unchanged', async () => {
    const f = fixture()
    const pending = deferred()
    f.render.mockImplementationOnce(() => pending.promise)
    const syncing = f.controller.sync('doc-a')
    await f.controller.sync('doc-a')
    pending.resolve('first:mount:doc-a')
    await syncing
    expect(f.text()).toEqual(['first:mount:doc-a', 'second:mount:doc-a'])
    await f.controller.dispose()
  })

  it('remounts unchanged contributions for a new execution generation without disposing the new instance', async () => {
    const f = fixture()
    let generation = 1
    Object.assign(f.runtime, { generation: () => generation })
    await f.controller.sync('doc-a')
    const retiredPanels = f.panels()
    generation++
    await f.controller.sync('doc-a')
    expect(retiredPanels.every((panel) => !panel.isConnected)).toBe(true)
    expect(f.render.mock.calls.filter(([, , phase]) => phase === 'mount')).toHaveLength(4)
    expect(f.render.mock.calls.filter(([, , phase]) => phase === 'dispose')).toHaveLength(0)
    await f.controller.dispose()
  })

  it('does not dispatch focus or controlled commands from a retired execution generation', async () => {
    const f = fixture()
    let generation = 1
    Object.assign(f.runtime, { generation: () => generation })
    await f.controller.sync('doc-a')
    const retired = f.panels()[0]!
    generation++
    const count = f.render.mock.calls.length
    retired.focus()
    retired.dispatchEvent(
      new CustomEvent('milkup-plugin-renderer-action', {
        bubbles: true,
        detail: { rendererId: 'example:first', command: 'example.run' },
      }),
    )
    expect(f.render).toHaveBeenCalledTimes(count)
    expect(f.runtime.runCommand).not.toHaveBeenCalled()
    await f.controller.dispose()
  })

  it.each(['output', 'error'] as const)(
    'drops late render %s and invalidation once its execution generation is revoked',
    async (result) => {
      const f = fixture()
      let generation = 1
      Object.assign(f.runtime, { generation: () => generation })
      await f.controller.sync('doc-a')
      const pending = deferred()
      f.render.mockImplementationOnce(() => pending.promise)
      const updating = f.controller.invalidate('example', 'first')
      generation++
      if (result === 'output') pending.resolve('revoked output')
      else pending.reject(new Error('revoked render error'))
      await updating
      const count = f.render.mock.calls.length
      await f.controller.invalidate('example')
      expect(f.text()).toEqual(['first:mount:doc-a', 'second:mount:doc-a'])
      expect(f.render).toHaveBeenCalledTimes(count)
      await f.controller.dispose()
      expect(f.render.mock.calls.filter(([, , phase]) => phase === 'dispose')).toHaveLength(0)
    },
  )
})

describe('generic contextual document toolbar', () => {
  it('collapses empty contributions and the entire empty slot, restoring either when content returns', async () => {
    document.body.innerHTML =
      '<main><div class="plugin-toolbar-slot" data-plugin-slot="document-toolbar"></div></main>'
    const stylesheet = document.createElement('style')
    stylesheet.textContent = readFileSync(resolve(__dirname, 'style.css'), 'utf8').match(
      /\.plugin-toolbar-slot[\s\S]*?(?=\n\.plugin-ui \{)/,
    )![0]
    document.head.append(stylesheet)
    const ui = ['first', 'second'].map((id) => ({
      pluginId: 'example',
      id,
      title: id,
      slot: 'document-toolbar' as const,
      scope: 'document' as const,
    }))
    const runtime = createRuntime(ui, [])
    const outputs = new Map<string, string>([
      ['first', ''],
      ['second', ''],
    ])
    runtime.renderUi = async (_plugin, id) => outputs.get(id) ?? ''
    const controller = new DesktopPluginUiController(document.body, runtime)
    try {
      await controller.sync('doc-a')
      const slot = document.querySelector<HTMLElement>('.plugin-toolbar-slot')!
      const first = slot.querySelector<HTMLElement>('[data-plugin-ui="example:first"]')!
      const second = slot.querySelector<HTMLElement>('[data-plugin-ui="example:second"]')!
      expect(first.hidden).toBe(true)
      expect(second.hidden).toBe(true)
      expect(getComputedStyle(slot).display).toBe('none')
      outputs.set('first', 'Table tools')
      await controller.invalidate('example', 'first')
      expect(first.hidden).toBe(false)
      expect(getComputedStyle(slot).display).not.toBe('none')
      outputs.set('second', 'Other tools')
      await controller.invalidate('example', 'second')
      outputs.set('first', '')
      await controller.invalidate('example', 'first')
      expect(first.hidden).toBe(true)
      expect(getComputedStyle(first).display).toBe('none')
      expect(getComputedStyle(slot).display).not.toBe('none')
      outputs.set('second', '')
      await controller.invalidate('example', 'second')
      expect(getComputedStyle(slot).display).toBe('none')
    } finally {
      await controller.dispose()
      stylesheet.remove()
    }
  })
})

describe('contextual toolbar invalidation', () => {
  function fixture() {
    document.body.innerHTML = '<div data-plugin-slot="document-toolbar"></div>'
    let output: unknown = 'Tools'
    let selectionRevision = 1
    let viewMode = 'source'
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'tools',
          title: 'Tools',
          slot: 'document-toolbar',
          scope: 'document',
        },
      ],
      [],
    )
    runtime.renderUi = async () => output
    const controller = new DesktopPluginUiController(document.body, runtime, () => ({
      selectionRevision,
      viewMode,
    }))
    return {
      controller,
      runtime,
      setOutput: (next: unknown) => {
        output = next
      },
      select: () => {
        selectionRevision++
      },
      setMode: (mode: string) => {
        viewMode = mode
      },
      shell: () => document.querySelector<HTMLElement>('[data-plugin-ui]')!,
    }
  }

  it('removes empty controlled trees and whitespace without leaving a blank toolbar', async () => {
    const f = fixture()
    await f.controller.sync('doc-a')
    for (const empty of ['   ', { type: 'element', tag: 'span', children: [] }]) {
      f.setOutput(empty)
      await f.controller.invalidate('example')
      expect(f.shell().hidden).toBe(true)
    }
    await f.controller.dispose()
  })

  it('retires empty output immediately even while a pointer is held', async () => {
    const f = fixture()
    await f.controller.sync('doc-a')
    f.shell().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    f.setOutput('')
    await f.controller.invalidate('example')
    expect(f.shell().hidden).toBe(true)
    expect(f.shell().textContent).toBe('')
    await f.controller.dispose()
  })

  it('hides old context synchronously and rejects output for an earlier selection', async () => {
    const f = fixture()
    await f.controller.sync('doc-a')
    let resolve!: (value: unknown) => void
    f.runtime.renderUi = () =>
      new Promise((finish) => {
        resolve = finish
      })
    f.select()
    const updating = f.controller.invalidate('example')
    const hiddenBeforeRender = f.shell().hidden
    f.select()
    resolve('Obsolete tools')
    await updating
    expect(hiddenBeforeRender).toBe(true)
    expect(f.shell().hidden).toBe(true)
    expect(f.shell().textContent).not.toContain('Obsolete')
    f.runtime.renderUi = async () => ''
    await f.controller.dispose()
  })

  it('retires commands before the host debounce without starting another Worker render', async () => {
    const f = fixture()
    f.setOutput({
      type: 'element',
      tag: 'button',
      text: 'Run',
      action: { command: 'example.run' },
    })
    const render = vi.spyOn(f.runtime, 'renderUi')
    await f.controller.sync('doc-a')
    const button = f.shell().querySelector('button')!
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    f.select()
    f.controller.reconcileDocumentToolbar()
    expect(f.shell().hidden).toBe(true)
    expect(button.isConnected).toBe(false)
    expect(render).toHaveBeenCalledTimes(1)
    button.click()
    expect(f.runtime.runCommand).not.toHaveBeenCalled()
    await f.controller.dispose()
  })

  it('retires the previous view mode synchronously during same-document sync', async () => {
    const f = fixture()
    f.setOutput({
      type: 'element',
      tag: 'button',
      text: 'Source tools',
      action: { command: 'example.run' },
    })
    const render = vi.spyOn(f.runtime, 'renderUi')
    await f.controller.sync('doc-a')
    const sourceButton = f.shell().querySelector('button')!
    f.setMode('live')
    const syncing = f.controller.sync('doc-a')
    const hiddenBeforeYield = f.shell().hidden
    sourceButton.click()
    await syncing
    expect(hiddenBeforeYield).toBe(true)
    expect(f.runtime.runCommand).not.toHaveBeenCalled()
    expect(render).toHaveBeenCalledTimes(1)
    f.setOutput('Live tools')
    await f.controller.updateViewport()
    expect(f.shell().hidden).toBe(false)
    expect(f.shell().textContent).toBe('Live tools')
    await f.controller.dispose()
  })

  it('rejects a delayed source-mode render before the live-mode refresh starts', async () => {
    const f = fixture()
    await f.controller.sync('doc-a')
    let resolve!: (value: unknown) => void
    f.runtime.renderUi = () =>
      new Promise((finish) => {
        resolve = finish
      })
    const updating = f.controller.invalidate('example')
    f.setMode('live')
    await f.controller.sync('doc-a')
    resolve('Obsolete source tools')
    await updating
    expect(f.shell().hidden).toBe(true)
    expect(f.shell().textContent).not.toContain('Obsolete')
    f.runtime.renderUi = async () => 'Current live tools'
    await f.controller.updateViewport()
    expect(f.shell().hidden).toBe(false)
    expect(f.shell().textContent).toBe('Current live tools')
    await f.controller.dispose()
  })

  it.each(['disable', 'dispose'] as const)(
    'cannot resurrect a floating toolbar after %s',
    async (stop) => {
      document.body.innerHTML = '<div data-plugin-slot="document-toolbar"></div>'
      const runtime = createRuntime(
        [
          {
            pluginId: 'example',
            id: 'tools',
            title: 'Tools',
            slot: 'document-toolbar',
            scope: 'document',
          },
        ],
        [],
      )
      const controller = new DesktopPluginUiController(document.body, runtime, () => ({}), {
        documentToolbar: {
          geometry: () => ({
            documentId: 'doc-a',
            anchor: { left: 50, right: 51, top: 90, bottom: 110 },
            boundary: { left: 0, right: 600, top: 0, bottom: 400 },
          }),
        },
      })
      await controller.sync('doc-a')
      const slot = document.querySelector<HTMLElement>('[data-plugin-slot]')!
      expect(slot.hidden).toBe(false)
      let resolve!: (value: unknown) => void
      runtime.renderUi = async (_plugin, _view, phase) =>
        phase === 'dispose'
          ? ''
          : new Promise((finish) => {
              resolve = finish
            })
      const pending = controller.invalidate('example')
      if (stop === 'disable') {
        const index = runtime.contributions()
        runtime.contributions = () => ({ ...index, ui: [] })
        await controller.sync('doc-a')
      } else await controller.dispose()
      expect(slot.hidden).toBe(true)
      resolve('Late tools')
      await pending
      expect(slot.hidden).toBe(true)
      expect(slot.children).toHaveLength(0)
      await controller.dispose()
    },
  )

  it('keeps toolbar fields focused and restores editor focus before commands or empty output', async () => {
    document.body.innerHTML =
      '<textarea id="editor"></textarea><div data-plugin-slot="document-toolbar"></div>'
    const editor = document.querySelector<HTMLTextAreaElement>('#editor')!
    const restore = vi.fn(() => editor.focus())
    let empty = false
    const focusedAtCommand: (Element | null)[] = []
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tools', title: 'Tools', slot: 'document-toolbar' }],
      [],
      vi.fn(() => {
        focusedAtCommand.push(document.activeElement)
      }),
      () =>
        empty
          ? ''
          : {
              type: 'element',
              tag: 'span',
              children: [
                {
                  type: 'field',
                  key: 'value',
                  kind: 'text',
                  label: 'Value',
                  value: '',
                  onChange: { command: 'example.run' },
                },
                { type: 'element', tag: 'button', text: 'Run', action: { command: 'example.run' } },
              ],
            },
    )
    const controller = new DesktopPluginUiController(document.body, runtime, () => ({}), {
      documentToolbar: {
        geometry: () => ({
          documentId: 'doc-a',
          anchor: { left: 50, right: 51, top: 90, bottom: 110 },
          boundary: { left: 0, right: 600, top: 0, bottom: 400 },
        }),
        restoreEditorFocus: restore,
      },
    })
    await controller.sync('doc-a')
    const field = document.querySelector<HTMLInputElement>('[data-plugin-field-control]')!
    field.focus()
    field.value = 'Draft'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    expect(document.activeElement).toBe(field)
    expect(restore).not.toHaveBeenCalled()
    const button = document.querySelector('button')!
    button.focus()
    button.click()
    expect(focusedAtCommand.at(-1)).toBe(editor)
    button.focus()
    empty = true
    await controller.invalidate('example')
    expect(document.activeElement).toBe(editor)
    expect(restore).toHaveBeenCalledTimes(2)
    await controller.dispose()
  })
})

describe('generic virtual scroll scheduling', () => {
  it('publishes a near-edge range within one frame window during sustained scrolling', async () => {
    const fixture = await createScrollSchedulerFixture()
    try {
      for (let index = 0; index < 4; index++) {
        fixture.wheel(140 + index)
        await vi.advanceTimersByTimeAsync(8)
      }
      expect(fixture.requests).toHaveLength(1)
      expect(fixture.requests[0]!.at).toBeLessThanOrEqual(32)
      for (let index = 4; index < 50; index++) {
        fixture.wheel(140 + index)
        await vi.advanceTimersByTimeAsync(8)
      }
      await vi.advanceTimersByTimeAsync(200)
      expect(fixture.requests).toHaveLength(1)
      const list = fixture.list()
      expect(Number(list.dataset.virtualStart)).toBeLessThanOrEqual(189)
      expect(Number(list.dataset.virtualEnd)).toBeGreaterThanOrEqual(199)
      expect(list.querySelectorAll('[role="treeitem"]')).toHaveLength(
        Number(list.dataset.virtualEnd) - Number(list.dataset.virtualStart),
      )
    } finally {
      await fixture.dispose()
    }
  })

  it('keeps a requested buffer across old-slice echoes without suppressing a newer distant range', async () => {
    const fixture = await createScrollSchedulerFixture()
    fixture.echoOldSlice = true
    try {
      fixture.wheel(140)
      await vi.advanceTimersByTimeAsync(200)
      expect(fixture.requests).toHaveLength(1)
      expect(fixture.list().dataset.virtualEnd).toBe('160')
      for (const position of [145, 150, 155, 160]) {
        fixture.wheel(position)
        await vi.advanceTimersByTimeAsync(200)
      }
      expect(fixture.requests).toHaveLength(1)
      fixture.wheel(600)
      await vi.advanceTimersByTimeAsync(32)
      expect(fixture.requests).toHaveLength(2)
      expect(fixture.requests[1]!.range.fromIndex).toBe(440)
      expect(fixture.requests[1]!.range.toIndex).toBe(770)
      fixture.echoOldSlice = false
      await fixture.controller.invalidate('public-example', 'items')
      expect(fixture.list().dataset.virtualStart).toBe('440')
      expect(fixture.list().dataset.virtualEnd).toBe('770')
      expect(fixture.list().querySelectorAll('[role="treeitem"]')).toHaveLength(330)
      const count = fixture.requests.length
      await vi.advanceTimersByTimeAsync(1000)
      expect(fixture.requests).toHaveLength(count)
    } finally {
      await fixture.dispose()
    }
  })

  it('allows only one scroll render in flight and retains only the latest pending range', async () => {
    const fixture = await createScrollSchedulerFixture()
    fixture.defer = true
    try {
      fixture.wheel(140)
      await vi.advanceTimersByTimeAsync(200)
      expect(fixture.requests).toHaveLength(1)
      for (const position of [150, 600, 900]) {
        fixture.wheel(position)
        await vi.advanceTimersByTimeAsync(200)
      }
      expect(fixture.requests).toHaveLength(1)
      fixture.resolveNextOldSlice()
      await vi.advanceTimersByTimeAsync(32)
      expect(fixture.requests).toHaveLength(2)
      expect(fixture.requests[1]!.range.fromIndex).toBe(740)
      expect(fixture.requests[1]!.range.toIndex).toBe(1070)
      await vi.advanceTimersByTimeAsync(500)
      expect(fixture.requests).toHaveLength(2)
    } finally {
      await fixture.dispose()
    }
  })

  it.each(['document', 'version', 'dispose'] as const)(
    'drops a scheduled scroll demand after its %s changes',
    async (change) => {
      const fixture = await createScrollSchedulerFixture()
      try {
        fixture.wheel(140)
        if (change === 'document') await fixture.controller.sync('next-document')
        else if (change === 'version') fixture.version++
        else await fixture.controller.dispose()
        const count = fixture.requests.length
        await vi.advanceTimersByTimeAsync(500)
        expect(fixture.requests).toHaveLength(count)
        expect(fixture.listOptional()?.dataset.virtualStart ?? '0').toBe('0')
      } finally {
        await fixture.dispose()
      }
    },
  )

  it('lets a new version schedule its own range without inheriting an old timer', async () => {
    const fixture = await createScrollSchedulerFixture()
    try {
      fixture.wheel(140)
      fixture.version++
      fixture.wheel(600)
      await vi.advanceTimersByTimeAsync(32)
      expect(fixture.requests).toHaveLength(1)
      expect(fixture.requests[0]!.range.fromIndex).toBe(440)
      expect(fixture.list().dataset.virtualStart).toBe('440')
    } finally {
      await fixture.dispose()
    }
  })

  it.each(['selection', 'follow-active'] as const)(
    'lets same-document %s navigation supersede an old echoed scroll buffer',
    async (navigation) => {
      const fixture = await createScrollSchedulerFixture()
      fixture.echoOldSlice = true
      try {
        fixture.wheel(140)
        await vi.advanceTimersByTimeAsync(32)
        expect(fixture.requests).toHaveLength(1)
        if (navigation === 'selection') fixture.selectionRevision++
        await fixture.publishActive(5900, 6060, 6000)
        const count = fixture.requests.length
        fixture.list().dispatchEvent(new Event('scroll'))
        await vi.advanceTimersByTimeAsync(200)
        expect(fixture.requests).toHaveLength(count)
        fixture.echoOldSlice = false
        await fixture.controller.invalidate('public-example', 'items')
        expect(fixture.requests.at(-1)!.range.fromIndex).toBe(5900)
        expect(fixture.requests.at(-1)!.range.toIndex).toBe(6060)
        expect(fixture.list().dataset.virtualStart).toBe('5900')
        fixture.wheel(7000)
        await vi.advanceTimersByTimeAsync(32)
        expect(fixture.requests.at(-1)!.range.fromIndex).toBe(6840)
        expect(fixture.list().dataset.virtualStart).toBe('6840')
      } finally {
        await fixture.dispose()
      }
    },
  )

  it.each(['echo', 'in-flight'] as const)(
    'requests the same position again after a version change with an old %s',
    async (response) => {
      const fixture = await createScrollSchedulerFixture()
      fixture.echoOldSlice = true
      fixture.defer = response === 'in-flight'
      try {
        fixture.wheel(600)
        await vi.advanceTimersByTimeAsync(32)
        expect(fixture.requests).toHaveLength(1)
        fixture.version++
        fixture.wheel(600)
        await vi.advanceTimersByTimeAsync(32)
        expect(fixture.requests).toHaveLength(2)
        expect(fixture.requests[1]!.range).toEqual(fixture.requests[0]!.range)
      } finally {
        await fixture.dispose()
      }
    },
  )

  it('lets local keyboard Home cancel even an already in-flight scroll range', async () => {
    const fixture = await createScrollSchedulerFixture()
    fixture.defer = true
    try {
      fixture.list().querySelector<HTMLButtonElement>('[role="treeitem"]')!.focus()
      fixture.wheel(600)
      await vi.advanceTimersByTimeAsync(32)
      expect(fixture.requests).toHaveLength(1)
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
      )
      fixture.resolveNextRange()
      await vi.advanceTimersByTimeAsync(500)
      expect(fixture.requests).toHaveLength(1)
      expect(document.activeElement?.textContent).toBe('Heading 0')
      expect(fixture.list().dataset.virtualStart).toBe('0')
    } finally {
      await fixture.dispose()
    }
  })

  it('does not reclaim departed focus or replay pending scroll over keyboard Home', async () => {
    const fixture = await createScrollSchedulerFixture()
    try {
      fixture.wheel(600)
      const outside = document.querySelector<HTMLButtonElement>('#scroll-outside')!
      outside.focus()
      await vi.advanceTimersByTimeAsync(200)
      expect(document.activeElement).toBe(outside)
      const row = fixture.list().querySelector<HTMLButtonElement>('[role="treeitem"]')!
      row.focus()
      fixture.wheel(900)
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
      await vi.advanceTimersByTimeAsync(500)
      expect(document.activeElement?.textContent).toBe('Heading 0')
      expect(fixture.list().dataset.virtualStart).toBe('0')
      expect(fixture.list().querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1)
    } finally {
      await fixture.dispose()
    }
  })
})

async function createScrollSchedulerFixture() {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  document.body.innerHTML =
    '<button id="scroll-outside">Outside</button><div data-plugin-slot="sidebar-panel"></div>'
  const height = vi
    .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return this.matches('[data-virtual-list]') ? 280 : 0
    })
  type Range = { id: string; fromIndex: number; toIndex: number; userInitiated?: boolean }
  const requests: { at: number; range: Range }[] = []
  const deferred: ((output: unknown) => void)[] = []
  const output = (start = 0, end = 160, revision = 0) => {
    const tree = virtualTreeOutput(start, end, 20000)
    return {
      ...tree,
      attributes: {
        ...tree.attributes,
        'data-virtual-list': 'public-items',
        'data-virtual-revision': String(revision),
      },
    }
  }
  const runtime = createRuntime(
    [
      {
        pluginId: 'public-example',
        id: 'items',
        title: 'Items',
        slot: 'sidebar-panel',
        scope: 'document',
      },
    ],
    [],
    vi.fn(),
    (phase, state) => {
      if (phase !== 'update') return output()
      const range = state.virtualViewport as Range | undefined
      if (!range) return output()
      requests.push({ at: Date.now(), range: { ...range } })
      if (fixture.published) return fixture.published
      if (fixture.defer) return new Promise((resolve) => deferred.push(resolve))
      return fixture.echoOldSlice
        ? output(0, 160, requests.length)
        : output(range.fromIndex, range.toIndex, requests.length)
    },
  )
  const controller: DesktopPluginUiController = new DesktopPluginUiController(
    document.body,
    runtime,
    (): Readonly<Record<string, unknown>> => ({
      documentVersion: fixture.version,
      selectionRevision: fixture.selectionRevision,
    }),
  )
  const fixture = {
    controller,
    requests,
    version: 1,
    selectionRevision: 1,
    published: undefined as ReturnType<typeof output> | undefined,
    echoOldSlice: false,
    defer: false,
    listOptional: () => document.querySelector<HTMLElement>('[data-virtual-list="public-items"]'),
    list: () => document.querySelector<HTMLElement>('[data-virtual-list="public-items"]')!,
    wheel(position: number) {
      const list = this.list()
      list.scrollTop = position * 28
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: 28 }))
      list.dispatchEvent(new Event('scroll'))
    },
    resolveNextOldSlice() {
      const resolve = deferred.shift()
      if (!resolve) throw new Error('Expected an actual in-flight renderer request')
      resolve(output(0, 160, requests.length))
    },
    resolveNextRange() {
      const resolve = deferred.shift()
      const range = requests[0]?.range
      if (!resolve || !range) throw new Error('Expected an actual in-flight renderer request')
      resolve(output(range.fromIndex, range.toIndex, requests.length))
    },
    async publishActive(start: number, end: number, active: number) {
      const tree = output(start, end, requests.length + 1)
      this.published = {
        ...tree,
        attributes: {
          ...tree.attributes,
          'data-virtual-active': String(active),
          'data-virtual-follow-active': 'true',
        },
      }
      await controller.invalidate('public-example', 'items')
      this.published = undefined
    },
    async dispose() {
      await controller.dispose()
      for (const resolve of deferred.splice(0)) resolve(output())
      await vi.advanceTimersByTimeAsync(0)
      height.mockRestore()
      vi.useRealTimers()
    },
  }
  await controller.sync('document')
  return fixture
}

describe('DesktopPluginUiController', () => {
  it('restores a virtual keyboard target named by text without requiring aria-label', async () => {
    document.body.innerHTML = '<div data-plugin-slot="sidebar-panel"></div>'
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      vi.fn(),
      (_phase, state) => {
        const range = state.virtualViewport as { fromIndex: number; toIndex: number } | undefined
        const output = virtualTreeOutput(range?.fromIndex ?? 0, range?.toIndex ?? 2, 18000)
        return {
          ...output,
          children: output.children.map((item) => {
            const { 'aria-label': _label, ...attributes } = item.attributes
            return { ...item, attributes }
          }),
        }
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    document.querySelector<HTMLButtonElement>('[role="treeitem"]')!.focus()
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    )
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Heading 17999'))
    await controller.dispose()
  })

  it('requests bounded virtual tree ranges for End, Home and arrow boundary focus', async () => {
    document.body.innerHTML = '<div data-plugin-slot="sidebar-panel"></div>'
    const requests: { fromIndex: number; toIndex: number }[] = []
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      vi.fn(),
      (_phase, state) => {
        const viewport = state.virtualViewport as { fromIndex: number; toIndex: number } | undefined
        if (viewport) requests.push(viewport)
        return virtualTreeOutput(viewport?.fromIndex ?? 0, viewport?.toIndex ?? 2, 18000)
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    const press = (key: string) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    document.querySelector<HTMLButtonElement>('[role="treeitem"]')!.focus()
    press('End')
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Heading 17999'))
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((request) => request.toIndex - request.fromIndex <= 500)).toBe(true)
    expect(document.querySelectorAll('[role="treeitem"]').length).toBeLessThanOrEqual(500)
    press('Home')
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Heading 0'))
    const items = document.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')
    items[items.length - 1]!.focus()
    const next = Number(items[items.length - 1]!.textContent!.split(' ')[1]) + 1
    press('ArrowDown')
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe(`Heading ${next}`))
    expect(document.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1)
    await controller.dispose()
  })

  it('does not let late virtual keyboard ranges steal focus after Tab or document change', async () => {
    document.body.innerHTML =
      '<button id="outside">Outside</button><div data-plugin-slot="sidebar-panel"></div>'
    let resolve!: (output: unknown) => void
    let pending = false
    let version = 1
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      vi.fn(),
      () => virtualTreeOutput(0, 2, 18000),
    )
    const render = runtime.renderUi
    runtime.renderUi = async (...args) => {
      if (pending && args[2] === 'update')
        return new Promise((done) => {
          resolve = done
        })
      return render(...args)
    }
    const controller = new DesktopPluginUiController(document.body, runtime, () => ({
      documentVersion: version,
    }))
    await controller.sync('doc')
    const request = () => {
      document.querySelector<HTMLButtonElement>('[role="treeitem"]')!.focus()
      pending = true
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
      )
    }
    request()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    document.querySelector<HTMLButtonElement>('#outside')!.focus()
    resolve(virtualTreeOutput(17840, 18000, 18000))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement?.id).toBe('outside')
    pending = false
    await controller.invalidate('example', 'tree')
    request()
    version = 2
    resolve(virtualTreeOutput(17840, 18000, 18000))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement?.textContent).toBe('Heading 0')
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    )
    expect(document.activeElement?.textContent).toBe('Heading 1')
    pending = false
    await controller.dispose()
  })

  it.each(['document', 'version', 'mount'])(
    'discards a rejected keyboard range after the request %s changes',
    async (change) => {
      document.body.innerHTML = '<div data-plugin-slot="sidebar-panel"></div>'
      let version = 1
      let reject!: (error: Error) => void
      const runtime = createRuntime(
        [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
        [],
        vi.fn(),
        () => virtualTreeOutput(0, 2, 18000),
      )
      const render = runtime.renderUi
      runtime.renderUi = async (...args) =>
        args[2] === 'update' && args[3]?.documentId === 'doc'
          ? new Promise((_resolve, fail) => {
              reject = fail
            })
          : render(...args)
      const controller = new DesktopPluginUiController(document.body, runtime, () => ({
        documentVersion: version,
      }))
      await controller.sync('doc')
      const first = document.querySelector<HTMLButtonElement>('[role="treeitem"]')!
      const container = first.closest<HTMLElement>('[data-plugin-ui]')!
      first.focus()
      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
      )
      const rejectRequest = reject
      if (change === 'document') await controller.sync('other-doc')
      else if (change === 'version') version = 2
      else await controller.dispose()
      rejectRequest(new Error('obsolete keyboard request'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(document.querySelector('.plugin-ui-error')).toBeNull()
      expect(container.querySelector('.plugin-ui-error')).toBeNull()
      if (change === 'mount') {
        expect(document.querySelector('[data-plugin-ui]')).toBeNull()
        return
      }
      expect(document.activeElement).toBe(first)
      expect(
        document.querySelector('[data-virtual-list]')?.getAttribute('data-virtual-start'),
      ).toBe('0')
      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )
      expect(document.activeElement?.textContent).toBe('Heading 1')
      await controller.dispose()
    },
  )

  it('discards a pending End range when focus moves to another row of the same tree', async () => {
    document.body.innerHTML = '<div data-plugin-slot="sidebar-panel"></div>'
    const pending: ((output: unknown) => void)[] = []
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      vi.fn(),
      () => virtualTreeOutput(0, 2, 18000),
    )
    const render = runtime.renderUi
    runtime.renderUi = async (...args) =>
      args[2] === 'update' ? new Promise((resolve) => pending.push(resolve)) : render(...args)
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    const items = document.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')
    items[0]!.focus()
    items[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    )
    items[1]!.focus()
    pending[0]!(virtualTreeOutput(17840, 18000, 18000))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement).toBe(items[1])
    expect(document.querySelector('[data-virtual-list]')?.getAttribute('data-virtual-start')).toBe(
      '0',
    )
    for (const resolve of pending.slice(1)) resolve(virtualTreeOutput(0, 2, 18000))
    await controller.dispose()
  })

  it('keeps the latest virtual keyboard intent and discards ranges after teardown', async () => {
    document.body.innerHTML =
      '<button id="outside">Outside</button><div data-plugin-slot="sidebar-panel"></div>'
    const pending: ((output: unknown) => void)[] = []
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      vi.fn(),
      () => virtualTreeOutput(0, 2, 18000),
    )
    const render = runtime.renderUi
    runtime.renderUi = async (...args) =>
      args[2] === 'update' ? new Promise((resolve) => pending.push(resolve)) : render(...args)
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    document.querySelector<HTMLButtonElement>('[role="treeitem"]')!.focus()
    const press = (key: string) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    press('End')
    press('Home')
    expect(pending).toHaveLength(2)
    pending[1]!(virtualTreeOutput(0, 160, 18000))
    await vi.waitFor(() => expect(document.querySelectorAll('[role="treeitem"]')).toHaveLength(160))
    pending[0]!(virtualTreeOutput(17840, 18000, 18000))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement?.textContent).toBe('Heading 0')
    expect(document.querySelector('[data-virtual-list]')?.getAttribute('data-virtual-start')).toBe(
      '0',
    )
    press('End')
    expect(pending).toHaveLength(3)
    document.querySelector<HTMLButtonElement>('#outside')!.focus()
    await controller.dispose()
    pending[2]!(virtualTreeOutput(17840, 18000, 18000))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.querySelector('[data-plugin-ui]')).toBeNull()
    expect(document.activeElement?.id).toBe('outside')
  })

  it('uses visible ranks rather than source ordinals after folding a virtual tree', async () => {
    document.body.innerHTML = '<div data-plugin-slot="sidebar-panel"></div>'
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      vi.fn(),
      (_phase, state) => {
        const range = state.virtualViewport as { fromIndex: number; toIndex: number } | undefined
        const output = virtualTreeOutput(range?.fromIndex ?? 0, range?.toIndex ?? 2, 20)
        return {
          ...output,
          children: output.children.map((item, offset) => ({
            ...item,
            text: `Root ${((range?.fromIndex ?? 0) + offset) * 900}`,
          })),
        }
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    document.querySelector<HTMLButtonElement>('[role="treeitem"]')!.focus()
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    )
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Root 17100'))
    expect(document.querySelectorAll('[role="treeitem"]')).toHaveLength(20)
    await controller.dispose()
  })

  it('holds modal focus while a controlled save action is temporarily disabled', async () => {
    document.body.innerHTML = '<div data-plugin-slot="modal"></div>'
    let busy = false
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'form', title: 'Form', slot: 'modal' }],
      [],
      vi.fn(),
      () => ({
        type: 'element',
        tag: 'span',
        children: [
          {
            type: 'field',
            key: 'value',
            kind: 'text',
            label: 'Value',
            value: '',
            disabled: busy,
            onChange: { command: 'example.run' },
          },
          {
            type: 'element',
            tag: 'button',
            text: 'Save',
            attributes: { 'aria-label': 'Save' },
            disabled: busy,
            action: { command: 'example.run' },
          },
        ],
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.open('example', 'form')
    document.querySelector<HTMLButtonElement>('[aria-label="Save"]')!.focus()
    busy = true
    await controller.invalidate('example', 'form')
    expect(document.activeElement).toBe(document.querySelector('.plugin-ui-modal'))
    busy = false
    await controller.invalidate('example', 'form')
    expect(document.activeElement).toBe(document.querySelector('[aria-label="Save"]'))
    await controller.dispose()
  })

  it('combines embedding slot visibility with panel collapse without affecting other slots', async () => {
    document.body.innerHTML =
      '<div data-plugin-slot="sidebar-panel"></div><div data-plugin-slot="menu-page"></div>'
    const calls: { id: string; visible: unknown }[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'tree',
          title: 'Tree',
          slot: 'sidebar-panel',
          viewportUpdates: false,
        },
        { pluginId: 'example', id: 'page', title: 'Page', slot: 'menu-page' },
      ],
      [],
    )
    runtime.renderUi = async (_plugin, id, _phase, state) => {
      calls.push({ id, visible: state?.visible })
      return 'content'
    }
    const controller = new DesktopPluginUiController(document.body, runtime)
    controller.setSlotVisible('sidebar-panel', false)
    await controller.sync('doc')
    expect(calls).toEqual([
      { id: 'tree', visible: false },
      { id: 'page', visible: true },
    ])
    calls.length = 0
    controller.setSlotVisible('sidebar-panel', false)
    expect(calls).toHaveLength(0)
    controller.setSlotVisible('sidebar-panel', true)
    expect(calls).toEqual([{ id: 'tree', visible: true }])
    const toggle = document.querySelector<HTMLButtonElement>('.plugin-ui-panel-toggle')!
    toggle.click()
    expect(calls.at(-1)).toEqual({ id: 'tree', visible: false })
    controller.setSlotVisible('sidebar-panel', false)
    controller.setSlotVisible('sidebar-panel', true)
    expect(calls.at(-1)).toEqual({ id: 'tree', visible: false })
    toggle.click()
    expect(calls.at(-1)).toEqual({ id: 'tree', visible: true })
    await controller.dispose()
  })

  it('traps modal Tab using only the current tree tab stop', async () => {
    document.body.innerHTML = '<div data-plugin-slot="modal"></div>'
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'dialog', title: 'Tree', slot: 'modal' }],
      [],
      vi.fn(),
      () => ({
        type: 'element',
        tag: 'span',
        attributes: { role: 'tree' },
        children: ['a', 'b'].map((label) => ({
          type: 'element',
          tag: 'button',
          text: label,
          attributes: { role: 'treeitem', 'aria-label': label },
        })),
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.open('example', 'dialog')
    const close = document.querySelector<HTMLButtonElement>('.plugin-ui-close')!
    const first = document.querySelector<HTMLButtonElement>('[aria-label="a"]')!
    close.focus()
    close.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Unidentified',
        code: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(document.activeElement).toBe(first)
    first.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(close)
    await controller.dispose()
  })

  it('does not treat scripted clicks or forged action details as trusted user gestures', async () => {
    document.body.innerHTML = '<div data-plugin-slot="sidebar-panel"></div>'
    const run = vi.fn()
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'tree', title: 'Tree', slot: 'sidebar-panel' }],
      [],
      run,
      () => ({
        type: 'element',
        tag: 'span',
        attributes: { role: 'tree' },
        children: [
          {
            type: 'element',
            tag: 'button',
            text: 'docs',
            attributes: { role: 'treeitem', 'aria-label': 'docs', 'aria-expanded': 'false' },
            action: { command: 'example.run' },
          },
        ],
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    const button = document.querySelector<HTMLButtonElement>('[role="treeitem"]')!
    button.click()
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    const detail = {
      rendererId: 'example:tree',
      command: 'example.run',
      input: {},
      isTrusted: true,
      trusted: true,
    }
    button.dispatchEvent(
      new CustomEvent('milkup-plugin-renderer-action', { detail, bubbles: true }),
    )
    button.dispatchEvent(
      new CustomEvent('milkup-plugin-renderer-action', {
        detail: { ...detail, rendererId: 'another:tree' },
        bubbles: true,
      }),
    )
    expect(run.mock.calls).toEqual(Array.from({ length: 3 }, () => ['example.run', {}]))
    await controller.dispose()
  })

  it('keeps a pressed controlled button until click and coalesces progress renders', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    let progress = 0
    const run = vi.fn()
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'progress',
          title: 'Progress',
          slot: 'sidebar-panel',
          scope: 'document',
        },
      ],
      [],
      run,
      () => ({
        type: 'element',
        tag: 'button',
        text: `Cancel ${progress}`,
        action: { command: 'example.run' },
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc-a')
    const button = document.querySelector<HTMLButtonElement>('[data-plugin-command]')!
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    for (progress = 1; progress <= 4; progress++) await controller.invalidate('example', 'progress')
    expect(document.querySelector('[data-plugin-command]')).toBe(button)
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
    button.click()
    expect(run).toHaveBeenCalledOnce()
    await vi.waitFor(() =>
      expect(document.querySelector('[data-plugin-command]')?.textContent).toBe('Cancel 5'),
    )
    const next = document.querySelector('[data-plugin-command]')!
    next.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    progress = 6
    await controller.invalidate('example', 'progress')
    document.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true, button: 0 }))
    await vi.waitFor(() =>
      expect(document.querySelector('[data-plugin-command]')?.textContent).toBe('Cancel 6'),
    )
    await controller.dispose()
  })
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
    expect(
      document.querySelector('[data-plugin-ui="example:outline"] .plugin-ui-panel-body')
        ?.textContent,
    ).toBe('mount:doc-a')

    await controller.sync('doc-b')
    expect(phases).toEqual(['mount', 'dispose', 'mount'])
    expect(
      document.querySelector('[data-plugin-ui="example:outline"] .plugin-ui-panel-body')
        ?.textContent,
    ).toBe('mount:doc-b')
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

  it('takes modal focus before pending mount output, so immediate Escape closes and restores the opener', async () => {
    document.body.innerHTML =
      '<button id="opener">Open</button><div data-plugin-slot="modal"></div>'
    const opener = document.querySelector<HTMLButtonElement>('#opener')!
    opener.focus()
    let finish!: (output: unknown) => void
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' }],
      [],
      vi.fn(),
      (phase) => (phase === 'mount' ? pending : ''),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    const opening = controller.open('example', 'dialog')
    const modal = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(modal).not.toBeNull()
    expect(document.activeElement).toBe(modal)
    modal.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    finish('late mount output')
    await opening
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('does not take focus back from a host confirmation when asynchronous opening completes', async () => {
    document.body.innerHTML =
      '<button id="opener">Open</button><button id="host-confirm">Host confirmation</button><div data-plugin-slot="modal"></div>'
    const opener = document.querySelector<HTMLButtonElement>('#opener')!
    const confirmation = document.querySelector<HTMLButtonElement>('#host-confirm')!
    opener.focus()
    let finish!: (output: unknown) => void
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' }],
      [],
      vi.fn(),
      (phase) => (phase === 'mount' ? pending : ''),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    const opening = controller.open('example', 'dialog')
    confirmation.focus()
    finish('mount output')
    await opening
    expect(document.activeElement).toBe(confirmation)
    await controller.close('example', 'dialog')
    expect(document.activeElement).toBe(confirmation)
  })

  it('restores an available card when unloading removes the opener and ignores late output', async () => {
    document.body.innerHTML =
      '<button id="opener">Open</button><div data-plugin-slot="modal"></div>'
    const opener = document.querySelector<HTMLButtonElement>('#opener')!
    opener.focus()
    let finish!: (output: unknown) => void
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' }],
      [],
      vi.fn(),
      (phase) => (phase === 'mount' ? pending : ''),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    const opening = controller.open('example', 'dialog')
    const nextCard = document.createElement('button')
    nextCard.dataset.pluginAction = 'details'
    nextCard.textContent = 'Another plugin'
    opener.replaceWith(nextCard)
    const emptyIndex = { ...runtime.contributions(), ui: [] }
    runtime.contributions = () => emptyIndex
    await controller.sync('doc')
    expect(document.activeElement).toBe(nextCard)
    finish('removed plugin output')
    await opening
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(nextCard)
  })

  it.each(['Action A', 'Action B'])(
    'resumes focus after a pending output removes controls, with final %s',
    async (finalLabel) => {
      document.body.innerHTML = '<div data-plugin-slot="modal"></div>'
      let label: string | undefined = 'Action A'
      const runtime = createRuntime(
        [{ pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' }],
        [],
        vi.fn(),
        () =>
          label
            ? {
                type: 'element',
                tag: 'button',
                text: label,
                attributes: { 'aria-label': label },
                action: { command: 'example.run' },
              }
            : 'Checking…',
      )
      const controller = new DesktopPluginUiController(document.body, runtime)
      await controller.open('example', 'dialog')
      const modal = document.querySelector<HTMLElement>('[role="dialog"]')!
      document.querySelector<HTMLButtonElement>('[data-plugin-command]')!.focus()
      label = undefined
      await controller.invalidate('example', 'dialog')
      expect(document.activeElement).toBe(modal)
      label = finalLabel
      await controller.invalidate('example', 'dialog')
      expect(document.activeElement?.getAttribute('aria-label')).toBe(finalLabel)
      await controller.dispose()
    },
  )

  it.each(['close', 'confirmation'])(
    'does not resume a removed action after the user focuses %s',
    async (destination) => {
      document.body.innerHTML =
        '<button id="confirmation">Confirmation</button><div data-plugin-slot="modal"></div>'
      let waiting = false
      const runtime = createRuntime(
        [{ pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' }],
        [],
        vi.fn(),
        () =>
          waiting
            ? 'Checking…'
            : {
                type: 'element',
                tag: 'button',
                text: 'Action A',
                attributes: { 'aria-label': 'Action A' },
                action: { command: 'example.run' },
              },
      )
      const controller = new DesktopPluginUiController(document.body, runtime)
      await controller.open('example', 'dialog')
      document.querySelector<HTMLButtonElement>('[data-plugin-command]')!.focus()
      waiting = true
      await controller.invalidate('example', 'dialog')
      const next = document.querySelector<HTMLButtonElement>(
        destination === 'close' ? '.plugin-ui-close' : '#confirmation',
      )!
      next.focus()
      waiting = false
      await controller.invalidate('example', 'dialog')
      expect(document.activeElement).toBe(next)
      await controller.dispose()
    },
  )

  it('traps native WebKit Shift+Tab with Unidentified key and Tab code at the close button', async () => {
    document.body.innerHTML =
      '<button id="outside">Outside</button><div data-plugin-slot="modal"></div>'
    const runtime = createRuntime(
      [{ pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' }],
      [],
      vi.fn(),
      () => ({
        type: 'element',
        tag: 'button',
        text: 'Action A',
        attributes: { 'aria-label': 'Action A' },
        action: { command: 'example.run' },
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.open('example', 'dialog')
    const close = document.querySelector<HTMLButtonElement>('.plugin-ui-close')!
    close.focus()
    const event = new KeyboardEvent('keydown', {
      key: 'Unidentified',
      code: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    close.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Action A')
    await controller.dispose()
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

    expect(
      document.querySelector('[data-plugin-ui="example:outline"] .plugin-ui-panel-body')
        ?.textContent,
    ).toBe('900')
    expect(phases).toEqual(['mount', 'update'])
  })

  it('skips editor viewport updates for views that opt out', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'manual-panel',
          title: 'Manual panel',
          slot: 'sidebar-panel',
          scope: 'document',
          viewportUpdates: false,
        },
      ],
      phases,
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    await controller.updateViewport()

    expect(phases).toEqual(['mount'])
  })

  it('collapses sidebar panels to the bottom and exposes resizers only between expanded panels', async () => {
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
    const slot = document.querySelector<HTMLElement>('[data-plugin-slot="sidebar-panel"]')!
    const outline = document.querySelector<HTMLElement>('[data-plugin-ui="example:outline"]')!
    const notes = document.querySelector<HTMLElement>('[data-plugin-ui="other:notes"]')!
    expect(Array.from(slot.children)).toEqual([outline, notes])
    expect(outline.querySelector<HTMLElement>('.plugin-ui-panel-resize')?.hidden).toBe(false)
    expect(notes.querySelector<HTMLElement>('.plugin-ui-panel-resize')?.hidden).toBe(true)

    outline.querySelector<HTMLButtonElement>('.plugin-ui-panel-toggle')!.click()

    expect(Array.from(slot.children)).toEqual([notes, outline])
    expect(outline.dataset.collapsed).toBe('true')
    expect(outline.querySelector<HTMLElement>('.plugin-ui-panel-body')?.hidden).toBe(true)
    expect(notes.querySelector<HTMLElement>('.plugin-ui-panel-resize')?.hidden).toBe(true)

    outline.querySelector<HTMLButtonElement>('.plugin-ui-panel-toggle')!.click()
    expect(Array.from(slot.children)).toEqual([outline, notes])
  })

  it('reports actual visibility on collapse and expand, independent of focus lifecycle', async () => {
    document.body.innerHTML =
      '<button id="outside">Outside</button><div data-plugin-slot="sidebar-panel"></div><div data-plugin-slot="modal"></div>'
    const states: { phase: string; visible: unknown }[] = []
    const runtime = createRuntime(
      [
        {
          pluginId: 'example',
          id: 'tree',
          title: 'Files',
          slot: 'sidebar-panel',
          viewportUpdates: false,
        },
        { pluginId: 'example', id: 'dialog', title: 'Dialog', slot: 'modal' },
      ],
      [],
      vi.fn(),
      (phase, state) => {
        states.push({ phase, visible: state.visible })
        return {
          type: 'element',
          tag: 'button',
          text: 'Open',
          attributes: { 'aria-label': 'Open' },
          action: { command: 'example.run' },
        }
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc')
    expect(states[0]).toEqual({ phase: 'mount', visible: true })
    const toggle = document.querySelector<HTMLButtonElement>('.plugin-ui-panel-toggle')!
    document.querySelector<HTMLButtonElement>('[data-plugin-command]')!.focus()
    document.querySelector<HTMLButtonElement>('#outside')!.focus()
    expect(
      states.filter((state) => state.phase === 'blur').every((state) => state.visible === true),
    ).toBe(true)
    toggle.focus()
    toggle.click()
    expect(states.at(-1)).toEqual({ phase: 'update', visible: false })
    await Promise.resolve()
    expect(document.activeElement).toBe(toggle)
    toggle.click()
    expect(states.at(-1)).toEqual({ phase: 'update', visible: true })
    await controller.open('example', 'dialog')
    expect(states.filter((state) => state.phase === 'mount').at(-1)).toEqual({
      phase: 'mount',
      visible: true,
    })
    await controller.dispose()
    expect(
      states.filter((state) => state.phase === 'dispose').every((state) => state.visible === false),
    ).toBe(true)
  })

  it('resizes adjacent expanded sidebar panels as a bounded pair', async () => {
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
    const outline = document.querySelector<HTMLElement>('[data-plugin-ui="example:outline"]')!
    const notes = document.querySelector<HTMLElement>('[data-plugin-ui="other:notes"]')!
    outline.getBoundingClientRect = () => ({ height: 200 }) as DOMRect
    notes.getBoundingClientRect = () => ({ height: 200 }) as DOMRect

    outline
      .querySelector<HTMLElement>('.plugin-ui-panel-resize')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

    expect(Number(outline.style.flexGrow)).toBeCloseTo(120 / 104)
    expect(Number(notes.style.flexGrow)).toBeCloseTo(88 / 104)
    expect(outline.style.flexBasis).toBe('96px')
    expect(notes.style.flexBasis).toBe('96px')
  })

  it.each(['pointercancel', 'lostpointercapture', 'dispose', 'collapse', 'hide', 'resize', 'blur'])(
    'ends a sidebar pointer drag on %s without responding to later moves',
    async (end) => {
      document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
      const runtime = createRuntime(
        ['a', 'b', 'c'].map((id) => ({
          pluginId: 'example',
          id,
          title: id,
          slot: 'sidebar-panel',
        })),
        [],
      )
      const controller = new DesktopPluginUiController(document.body, runtime)
      await controller.sync('doc-a')
      const panels = Array.from(document.querySelectorAll<HTMLElement>('.plugin-ui-sidebar-panel'))
      for (const panel of panels) panel.getBoundingClientRect = () => ({ height: 200 }) as DOMRect
      const handle = panels[0]!.querySelector<HTMLElement>('.plugin-ui-panel-resize')!
      const pointer = (type: string, pointerId = 1, clientY = 0): Event => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientY })
        Object.defineProperty(event, 'pointerId', { value: pointerId })
        return event
      }
      handle.dispatchEvent(pointer('pointerdown'))
      expect(document.documentElement.dataset.pluginPanelResizing).toBe('true')
      document.dispatchEvent(pointer('pointermove', 2, 50))
      expect(panels[0]!.style.flex).toBe('')
      document.dispatchEvent(pointer('pointerup', 2))
      expect(document.documentElement.dataset.pluginPanelResizing).toBe('true')
      document.dispatchEvent(pointer('pointermove', 1, 50))
      expect(Number(panels[0]!.style.flexGrow)).toBeGreaterThan(1)
      if (end === 'dispose') await controller.dispose()
      else if (end === 'collapse') panels[1]!.querySelector<HTMLButtonElement>('button')!.click()
      else if (end === 'hide') controller.setSlotVisible('sidebar-panel', false)
      else if (end === 'resize' || end === 'blur') window.dispatchEvent(new Event(end))
      else if (end === 'lostpointercapture') handle.dispatchEvent(pointer(end))
      else document.dispatchEvent(pointer(end))
      expect(document.documentElement.dataset.pluginPanelResizing).toBe('false')
      const styles = panels.map((panel) => panel.style.flex)
      document.dispatchEvent(pointer('pointermove', 1, -50))
      expect(panels.map((panel) => panel.style.flex)).toEqual(styles)
      await controller.dispose()
    },
  )

  it('keeps identical controlled output mounted and preserves internal scroll on changes', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    let label = 'One'
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
      () => listOutput(label),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc-a')
    const originalList = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    originalList.scrollTop = 120

    await controller.invalidate('example', 'outline')
    expect(document.querySelector('.plugin-virtual-list')).toBe(originalList)

    label = 'Two'
    await controller.invalidate('example', 'outline')
    const nextList = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    expect(nextList).not.toBe(originalList)
    expect(nextList.scrollTop).toBe(120)
  })

  it('decorates a controlled host icon without relying on plugin-specific classes', async () => {
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
      vi.fn(),
      () => ({
        type: 'element',
        tag: 'span',
        attributes: { 'data-host-icon': 'list-tree' },
      }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc-a')
    const icon = document.querySelector<HTMLElement>('[data-host-icon="list-tree"]')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.querySelector('svg.icon')).not.toBeNull()
  })

  it('projects a virtual outline slice into the full scroll height and follows its active item', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
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
      () => virtualListOutput(100, 160, 1000, 124, true),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!

    expect(list.querySelector<HTMLElement>('.plugin-virtual-spacer-before')?.style.height).toBe(
      '2800px',
    )
    expect(list.querySelector<HTMLElement>('.plugin-virtual-spacer-after')?.style.height).toBe(
      '23520px',
    )
    expect(list.scrollTop).toBe(3346)
    clientHeightSpy.mockRestore()
  })

  it('requests a new buffered range when the outline is scrolled outside its rendered slice', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const renderStates: Readonly<Record<string, unknown>>[] = []
    const scrollPositions = new WeakMap<Element, number>()
    const scrollTopGetterSpy = vi
      .spyOn(Element.prototype, 'scrollTop', 'get')
      .mockImplementation(function (this: Element) {
        return scrollPositions.get(this) ?? 0
      })
    const scrollTopSetterSpy = vi
      .spyOn(Element.prototype, 'scrollTop', 'set')
      .mockImplementation(function (this: Element, value: number) {
        const virtualList = this.matches('.plugin-virtual-list')
        const virtualHeightReady = this.querySelector('.plugin-virtual-spacer') !== null
        scrollPositions.set(
          this,
          virtualList && !virtualHeightReady ? Math.min(value, 1400) : value,
        )
      })
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
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
      (_phase, state) => {
        renderStates.push(state)
        const viewport = state.virtualViewport as { fromIndex: number; toIndex: number } | undefined
        return virtualListOutput(
          viewport?.fromIndex ?? 0,
          viewport?.toIndex ?? 100,
          1000,
          -1,
          false,
        )
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 14_000
    list.dispatchEvent(new Event('pointerdown'))
    list.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(phases).toEqual(['mount'])
    expect(document.querySelector('.plugin-virtual-list')).toBe(list)
    document.dispatchEvent(new Event('pointerup'))

    await vi.waitFor(() => expect(phases).toEqual(['mount', 'update']))
    expect(renderStates[1]?.virtualViewport).toEqual({
      id: 'outline',
      fromIndex: 340,
      toIndex: 670,
      userInitiated: true,
    })
    const updatedList = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    expect(updatedList.dataset.virtualStart).toBe('340')
    expect(updatedList.dataset.virtualEnd).toBe('670')
    expect(updatedList.querySelectorAll('.plugin-list-item')).toHaveLength(330)
    expect(updatedList.scrollTop).toBe(14_000)

    updatedList.scrollTop = 505 * 28
    updatedList.dispatchEvent(new Event('pointerdown'))
    updatedList.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('pointerup'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(phases).toEqual(['mount', 'update'])
    scrollTopSetterSpy.mockRestore()
    scrollTopGetterSpy.mockRestore()
    clientHeightSpy.mockRestore()
  })

  it('does not rerender while outline scrolling remains inside the current overscan buffer', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
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
      () => virtualListOutput(0, 100, 1000, -1, false),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 30 * 28
    list.dispatchEvent(new Event('pointerdown'))
    list.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('pointerup'))
    await new Promise((resolve) => setTimeout(resolve, 220))

    expect(phases).toEqual(['mount'])
    clientHeightSpy.mockRestore()
  })

  it('keeps the virtual outline viewport stable while background scanning extends the total', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    let total = 1000
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
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
      () => virtualListOutput(480, 530, total, -1, false),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 14_000
    list.dispatchEvent(new Event('pointerdown'))
    list.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('pointerup'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(phases).toEqual(['mount'])

    total = 1200
    await controller.invalidate('example', 'outline')

    const updatedList = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    expect(updatedList.dataset.virtualStart).toBe('480')
    expect(updatedList.dataset.virtualEnd).toBe('530')
    expect(updatedList.querySelectorAll('.plugin-list-item')).toHaveLength(50)
    expect(updatedList.scrollTop).toBe(14_000)
    expect(
      updatedList.querySelector<HTMLElement>('.plugin-virtual-spacer-after')?.style.height,
    ).toBe('18760px')
    clientHeightSpy.mockRestore()
  })

  it('requests one adjacent buffer only after a real user wheel gesture reaches an edge', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const renderStates: Readonly<Record<string, unknown>>[] = []
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 1450 : 0
      })
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
      (_phase, state) => {
        renderStates.push(state)
        return virtualListOutput(0, 50, 50, -1, false, { hasAfter: true })
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 1160
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }))
    list.scrollTop = 1170
    list.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(phases).toEqual(['mount'])

    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }))
    list.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(phases).toEqual(['mount', 'update']))
    expect(renderStates[1]?.virtualViewport).toEqual({
      id: 'outline',
      fromIndex: 0,
      toIndex: 50,
      userInitiated: true,
      edge: 'after',
      requestId: 1,
    })
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(phases).toEqual(['mount', 'update'])
    scrollHeightSpy.mockRestore()
    clientHeightSpy.mockRestore()
  })

  it('requests the previous buffer only when the list reaches the exact top edge', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const renderStates: Readonly<Record<string, unknown>>[] = []
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
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
      (_phase, state) => {
        renderStates.push(state)
        return virtualListOutput(0, 50, 50, -1, false, { hasBefore: true })
      },
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 1
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }))
    list.scrollTop = 0
    list.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(phases).toEqual(['mount'])

    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }))
    list.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(phases).toEqual(['mount', 'update']))
    expect(renderStates[1]?.virtualViewport).toMatchObject({
      edge: 'before',
      requestId: 1,
      userInitiated: true,
    })
    clientHeightSpy.mockRestore()
  })

  it('does not request an adjacent buffer for a small scroll far from the cache edge', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
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
      () => virtualListOutput(0, 100, 200, -1, false, { hasAfter: true }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 280
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }))
    list.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 220))

    expect(phases).toEqual(['mount'])
    clientHeightSpy.mockRestore()
  })

  it('compensates scroll position once when headings are prepended', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    let prepended = false
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('plugin-virtual-list') ? 280 : 0
      })
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
      () =>
        prepended
          ? virtualListOutput(30, 60, 110, -1, false, {
              hasBefore: true,
              scrollAdjust: 280,
              revision: 1,
            })
          : virtualListOutput(20, 50, 100, -1, false, { hasBefore: true }),
    )
    const controller = new DesktopPluginUiController(document.body, runtime)

    await controller.sync('doc-a')
    const list = document.querySelector<HTMLElement>('.plugin-virtual-list')!
    list.scrollTop = 1000
    list.dispatchEvent(new Event('pointerdown'))
    list.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('pointerup'))
    await new Promise((resolve) => setTimeout(resolve, 220))

    prepended = true
    await controller.invalidate('example', 'outline')
    expect(document.querySelector<HTMLElement>('.plugin-virtual-list')?.scrollTop).toBe(1280)

    await controller.invalidate('example', 'outline')
    expect(document.querySelector<HTMLElement>('.plugin-virtual-list')?.scrollTop).toBe(1280)
    clientHeightSpy.mockRestore()
  })

  it('coalesces viewport updates without running concurrent plugin renders', async () => {
    document.body.innerHTML = '<main><div data-plugin-slot="sidebar-panel"></div></main>'
    const phases: string[] = []
    let releaseUpdate: (() => void) | undefined
    let activeRenders = 0
    let maximumActiveRenders = 0
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
    runtime.renderUi = async (_pluginId, _viewId, phase, state = {}) => {
      phases.push(phase)
      activeRenders += 1
      maximumActiveRenders = Math.max(maximumActiveRenders, activeRenders)
      if (phase === 'update' && !releaseUpdate) {
        await new Promise<void>((resolve) => {
          releaseUpdate = resolve
        })
      }
      activeRenders -= 1
      return `${phase}:${String(state.documentId)}`
    }
    const controller = new DesktopPluginUiController(document.body, runtime)
    await controller.sync('doc-a')

    const firstUpdate = controller.updateViewport()
    await vi.waitFor(() => expect(releaseUpdate).toBeTypeOf('function'))
    const secondUpdate = controller.updateViewport()
    releaseUpdate?.()
    await Promise.all([firstUpdate, secondUpdate])

    expect(phases).toEqual(['mount', 'update', 'update'])
    expect(maximumActiveRenders).toBe(1)
  })
})

function listOutput(label: string) {
  return {
    type: 'element' as const,
    tag: 'span' as const,
    attributes: { class: 'plugin-virtual-list' },
    children: [label],
  }
}

function virtualListOutput(
  start: number,
  end: number,
  total: number,
  active: number,
  followActive: boolean,
  options: {
    hasBefore?: boolean
    hasAfter?: boolean
    scrollAdjust?: number
    revision?: number
  } = {},
) {
  return {
    type: 'element' as const,
    tag: 'span' as const,
    attributes: {
      class: 'plugin-virtual-list',
      'data-virtual-list': 'outline',
      'data-virtual-total': String(total),
      'data-virtual-start': String(start),
      'data-virtual-end': String(end),
      'data-virtual-item-height': '28',
      'data-virtual-active': String(active),
      'data-virtual-follow-active': String(followActive),
      'data-virtual-has-before': String(options.hasBefore === true),
      'data-virtual-has-after': String(options.hasAfter === true),
      'data-virtual-scroll-adjust': String(options.scrollAdjust ?? 0),
      'data-virtual-revision': String(options.revision ?? 0),
    },
    children: Array.from({ length: end - start }, (_, offset) => ({
      type: 'element' as const,
      tag: 'button' as const,
      text: `Heading ${start + offset}`,
      attributes: { class: 'plugin-list-item' },
    })),
  }
}

function virtualTreeOutput(start: number, end: number, total: number) {
  const output = virtualListOutput(start, end, total, -1, false)
  return {
    ...output,
    attributes: { ...output.attributes, role: 'tree', 'aria-label': 'Virtual tree' },
    children: output.children.map((item, index) => ({
      ...item,
      attributes: {
        ...item.attributes,
        role: 'treeitem',
        'aria-level': '1',
        'aria-label': `Heading ${start + index}`,
      },
      action: { command: 'example.run' },
    })),
  }
}

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

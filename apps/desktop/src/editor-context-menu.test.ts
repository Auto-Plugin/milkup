// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Copy, FilePlus } from 'lucide'
import { EditorContextMenu, type HostContextMenuItem } from './editor-context-menu'

function fixture(refresh: () => Promise<void> = async () => {}) {
  document.body.innerHTML =
    '<div id="editor"><textarea></textarea></div><div id="menu"><button data-plugin-command="one">One</button><button disabled>Unavailable</button><button data-plugin-command="two">Two</button></div><button id="other">Other</button>'
  const editor = document.querySelector<HTMLElement>('#editor')!
  const menu = document.querySelector<HTMLElement>('#menu')!
  const input = document.querySelector<HTMLTextAreaElement>('textarea')!
  let identity = {}
  let available = true
  const visible = vi.fn()
  const controller = new EditorContextMenu(editor, menu, {
    identity: () => identity,
    available: () => available,
    refresh,
    visible,
  })
  input.focus()
  return {
    controller,
    menu,
    input,
    visible,
    changeDocument: () => {
      identity = {}
    },
    disable: () => {
      available = false
    },
  }
}

describe('editor context menu shell', () => {
  it('clamps the menu to the viewport, skips disabled actions and restores keyboard focus', async () => {
    const f = fixture()
    f.menu.getBoundingClientRect = () => ({ width: 300, height: 200 }) as DOMRect
    await f.controller.open(10000, 10000)
    expect(f.menu.style.left).toBe(`${window.innerWidth - 308}px`)
    expect(f.menu.style.top).toBe(`${window.innerHeight - 208}px`)
    expect(document.activeElement?.textContent).toBe('One')
    f.menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement?.textContent).toBe('Two')
    f.menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(f.menu.hidden).toBe(true)
    expect(document.activeElement).toBe(f.input)
    f.controller.dispose()
  })

  it('does not reopen after cancellation or a document change while contributions render', async () => {
    let resolve!: () => void
    const f = fixture(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    const opening = f.controller.open(20, 20)
    f.controller.close(false)
    resolve()
    await opening
    expect(f.menu.hidden).toBe(true)
    const next = f.controller.open(20, 20)
    f.changeDocument()
    resolve()
    await next
    expect(f.menu.hidden).toBe(true)
    f.controller.dispose()
  })

  it('closes without stealing the focus of an action or an outside control', async () => {
    const f = fixture()
    await f.controller.open(20, 20)
    const other = document.querySelector<HTMLButtonElement>('#other')!
    other.focus()
    f.menu.querySelector('button')!.click()
    expect(f.menu.hidden).toBe(true)
    expect(document.activeElement).toBe(other)
    f.controller.dispose()
  })

  it('removes disabled contributions and does not leave a stale menu open', async () => {
    const f = fixture()
    await f.controller.open(20, 20)
    f.disable()
    f.controller.reconcile()
    expect(f.menu.hidden).toBe(true)
    f.controller.dispose()
  })
})

function hostFixture(refresh: () => Promise<void> = async () => {}) {
  document.body.innerHTML =
    '<div id="editor"><textarea></textarea></div><div id="menu"><div id="plugins"></div></div><button id="other">Other</button>'
  const editor = document.querySelector<HTMLElement>('#editor')!
  const menu = document.querySelector<HTMLElement>('#menu')!
  const plugins = document.querySelector<HTMLElement>('#plugins')!
  const input = document.querySelector<HTMLTextAreaElement>('textarea')!
  let identity = {}
  let version = 1
  const selection = { anchor: 2, focus: 8 }
  const execute = vi.fn()
  const onError = vi.fn()
  const items: readonly HostContextMenuItem[] = [
    { id: 'copy', label: '复制', icon: Copy, shortcut: 'Ctrl+C' },
    { id: 'cut', label: '剪切', disabled: true },
    {
      id: 'insert',
      label: '插入',
      icon: FilePlus,
      separatorBefore: true,
      children: [
        { id: 'table', label: '表格', disabled: true },
        { id: 'code', label: '代码块' },
        { id: 'quote', label: '引用' },
      ],
    },
  ]
  input.focus()
  const controller = new EditorContextMenu(editor, menu, {
    pluginContainer: plugins,
    refresh,
    onError,
    host: {
      capture: () => ({ identity, version, selection }),
      items: () => items,
      isCurrent: (snapshot) => snapshot.identity === identity && snapshot.version === version,
      execute,
    },
  })
  return {
    controller,
    editor,
    menu,
    plugins,
    input,
    selection,
    execute,
    onError,
    changeDocument: () => {
      identity = {}
    },
    changeVersion: () => version++,
    item: (id: string) =>
      menu.querySelector<HTMLButtonElement>(`[data-host-context-command="${id}"]`)!,
  }
}

describe('host editor context menu', () => {
  it('shows host items synchronously while plugins are pending and never refocuses on completion', async () => {
    let finish!: () => void
    const f = hostFixture(() => new Promise<void>((resolve) => (finish = resolve)))
    const opening = f.controller.open(20, 20)
    expect(f.menu.hidden).toBe(false)
    expect(f.item('copy').querySelector('svg')).not.toBeNull()
    expect(f.item('copy').textContent).toContain('Ctrl+C')
    const copy = f.item('copy')
    f.item('insert').focus()
    f.plugins.innerHTML = '<button data-plugin-command="plugin">Plugin</button>'
    finish()
    await opening
    expect(f.item('copy')).toBe(copy)
    expect(f.item('cut').disabled).toBe(true)
    expect(document.activeElement).toBe(f.item('insert'))
    expect(f.plugins.querySelector('button')?.getAttribute('role')).toBe('menuitem')
    f.controller.dispose()
  })

  it('keeps host items usable after plugin failure and executes the opening selection', async () => {
    const f = hostFixture(async () => {
      throw new Error('plugin unavailable')
    })
    await f.controller.open(20, 20)
    expect(f.menu.hidden).toBe(false)
    f.item('copy').click()
    expect(f.execute).toHaveBeenCalledWith(
      'copy',
      expect.objectContaining({ version: 1, selection: f.selection }),
      expect.any(MouseEvent),
      expect.any(AbortSignal),
    )
    expect(f.menu.hidden).toBe(true)
    expect(document.activeElement).toBe(f.input)
    f.controller.dispose()
  })

  it.each(['document', 'version'] as const)(
    'blocks stale host and plugin commands after a %s change',
    async (change) => {
      const f = hostFixture()
      const plugin = document.createElement('button')
      plugin.dataset.pluginCommand = 'plugin'
      const runPlugin = vi.fn()
      plugin.addEventListener('click', runPlugin)
      f.plugins.append(plugin)
      await f.controller.open(20, 20)
      if (change === 'document') f.changeDocument()
      else f.changeVersion()
      plugin.click()
      f.item('copy').click()
      expect(runPlugin).not.toHaveBeenCalled()
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.menu.hidden).toBe(true)
      f.controller.dispose()
    },
  )

  it('navigates nested menus and restores the editor only when keyboard dismissal requests it', async () => {
    const f = hostFixture()
    await f.controller.open(20, 20)
    const key = (value: string) =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
      )
    key('ArrowDown')
    expect(document.activeElement).toBe(f.item('insert'))
    key('ArrowRight')
    expect(document.activeElement).toBe(f.item('code'))
    expect(f.item('insert').getAttribute('aria-expanded')).toBe('true')
    key('End')
    expect(document.activeElement).toBe(f.item('quote'))
    key('ArrowDown')
    expect(document.activeElement).toBe(f.item('code'))
    key('ArrowLeft')
    expect(document.activeElement).toBe(f.item('insert'))
    key('Home')
    expect(document.activeElement).toBe(f.item('copy'))
    key('End')
    key('ArrowRight')
    key('Escape')
    expect(f.menu.hidden).toBe(false)
    expect(document.activeElement).toBe(f.item('insert'))
    key('Escape')
    expect(f.menu.hidden).toBe(true)
    expect(document.activeElement).toBe(f.input)
    f.controller.dispose()
  })

  it('opens with right click and Shift+F10, closes for editor scroll and leaves Tab untrapped', async () => {
    const f = hostFixture()
    const context = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 20,
    })
    f.input.dispatchEvent(context)
    expect(context.defaultPrevented).toBe(true)
    expect(f.menu.hidden).toBe(false)
    f.menu.dispatchEvent(new Event('scroll'))
    expect(f.menu.hidden).toBe(false)
    f.editor.dispatchEvent(new Event('scroll'))
    expect(f.menu.hidden).toBe(true)
    f.input.focus()
    const keyboard = new KeyboardEvent('keydown', {
      key: 'F10',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    f.input.dispatchEvent(keyboard)
    expect(keyboard.defaultPrevented).toBe(true)
    expect(f.menu.hidden).toBe(false)
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    f.item('copy').dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
    expect(f.menu.hidden).toBe(true)
    expect(document.activeElement).toBe(f.input)
    f.controller.dispose()
  })

  it('discards pending plugin results after dispose and removes all open handlers', async () => {
    let finish!: () => void
    const f = hostFixture(() => new Promise<void>((resolve) => (finish = resolve)))
    const opening = f.controller.open(20, 20)
    f.controller.dispose()
    finish()
    await opening
    expect(f.menu.hidden).toBe(true)
    const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    f.input.dispatchEvent(context)
    expect(context.defaultPrevented).toBe(false)
    expect(f.menu.hidden).toBe(true)
  })

  it('cancels pending host commands on Escape and prevents late completion from closing a new menu', async () => {
    const f = hostFixture()
    let finish!: () => void
    f.execute.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    await f.controller.open(20, 20)
    f.item('copy').click()
    const signal = f.execute.mock.calls[0]![3] as AbortSignal
    expect(signal.aborted).toBe(false)
    expect(f.menu.getAttribute('aria-busy')).toBe('true')
    f.item('copy').click()
    expect(f.execute).toHaveBeenCalledTimes(1)
    f.menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(signal.aborted).toBe(true)
    expect(f.menu.hidden).toBe(true)
    await f.controller.open(30, 30)
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(f.menu.hidden).toBe(false)
    expect(f.menu.hasAttribute('aria-busy')).toBe(false)
    f.controller.dispose()
  })

  it('reports an async command failure and keeps the menu available to retry or dismiss', async () => {
    const f = hostFixture()
    const failure = new Error('Clipboard denied')
    f.execute.mockRejectedValue(failure)
    await f.controller.open(20, 20)
    f.item('copy').click()
    await Promise.resolve()
    await Promise.resolve()
    expect(f.onError).toHaveBeenCalledWith(failure)
    expect(f.menu.hidden).toBe(false)
    expect(f.menu.hasAttribute('aria-busy')).toBe(false)
    f.execute.mockImplementation(() => undefined)
    f.item('copy').click()
    expect(f.menu.hidden).toBe(true)
    f.controller.dispose()
  })

  it('preserves the original keyboard gesture when dispatching host commands', async () => {
    const f = hostFixture()
    await f.controller.open(20, 20)
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    f.item('copy').dispatchEvent(event)
    expect(f.execute.mock.calls[0]![2]).toBe(event)
    expect(event.defaultPrevented).toBe(true)
    f.controller.dispose()
  })

  it('closes after controlled plugin actions even when their click does not bubble', async () => {
    const f = hostFixture()
    const button = document.createElement('button')
    button.dataset.pluginCommand = 'plugin'
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      button.dispatchEvent(new CustomEvent('milkup-plugin-renderer-action', { bubbles: true }))
    })
    const other = document.querySelector<HTMLButtonElement>('#other')!
    const runPlugin = vi.fn(() => other.focus())
    f.plugins.addEventListener('milkup-plugin-renderer-action', runPlugin)
    f.plugins.append(button)
    await f.controller.open(20, 20)
    button.focus()
    const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    button.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(false)
    expect(runPlugin).not.toHaveBeenCalled()
    button.click()
    expect(runPlugin).toHaveBeenCalledTimes(1)
    expect(f.menu.hidden).toBe(true)
    expect(document.activeElement).toBe(other)
    await f.controller.open(20, 20)
    f.changeDocument()
    button.dispatchEvent(new CustomEvent('milkup-plugin-renderer-action', { bubbles: true }))
    expect(runPlugin).toHaveBeenCalledTimes(1)
    f.controller.dispose()
  })

  it('preserves the focus of a control opened by a successful host action', async () => {
    const f = hostFixture()
    const other = document.querySelector<HTMLButtonElement>('#other')!
    f.execute.mockImplementation(() => other.focus())
    await f.controller.open(20, 20)
    f.item('copy').click()
    expect(f.menu.hidden).toBe(true)
    expect(document.activeElement).toBe(other)
    f.controller.dispose()
  })

  it('does not mark a reopened menu busy when a command synchronously changes the document', async () => {
    const f = hostFixture()
    let finish!: () => void
    f.execute.mockImplementation(() => {
      f.changeVersion()
      f.controller.reconcile()
      void f.controller.open(30, 30)
      return new Promise<void>((resolve) => (finish = resolve))
    })
    await f.controller.open(20, 20)
    f.item('copy').click()
    expect(f.menu.hasAttribute('aria-busy')).toBe(false)
    expect(f.menu.hidden).toBe(false)
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(f.menu.hidden).toBe(false)
    f.controller.dispose()
  })

  it('keeps root and child menus bounded in narrow windows and flips submenus at the right edge', async () => {
    const f = hostFixture()
    vi.stubGlobal('innerWidth', 240)
    vi.stubGlobal('innerHeight', 160)
    try {
      f.menu.getBoundingClientRect = () => ({ width: 224, height: 144 }) as DOMRect
      await f.controller.open(500, 500)
      expect(f.menu.style.left).toBe('8px')
      expect(f.menu.style.top).toBe('8px')
      expect(f.menu.style.maxWidth).toBe('224px')
      const insert = f.item('insert')
      insert.getBoundingClientRect = () => ({ left: 200, right: 230, top: 140 }) as DOMRect
      const submenu = f.menu.querySelector<HTMLElement>('.editor-context-submenu')!
      submenu.getBoundingClientRect = () => ({ width: 150, height: 100 }) as DOMRect
      insert.click()
      expect(submenu.style.left).toBe('50px')
      expect(submenu.style.top).toBe('52px')
      expect(submenu.style.maxHeight).toBe('144px')
    } finally {
      f.controller.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('reconciles appended plugin geometry without changing host nodes or the opening selection', async () => {
    const f = hostFixture()
    await f.controller.open(20, 20)
    const copy = f.item('copy')
    f.item('insert').click()
    const focus = document.activeElement
    f.plugins.innerHTML = '<button data-plugin-command="plugin">Plugin</button>'
    f.controller.reconcileLayout()
    expect(f.item('copy')).toBe(copy)
    expect(document.activeElement).toBe(focus)
    expect(f.plugins.querySelector('button')?.getAttribute('role')).toBe('menuitem')
    f.item('code').click()
    expect(f.execute.mock.calls[0]![1].selection).toBe(f.selection)
    f.controller.dispose()
  })

  it('does not expose an empty plugin group or hidden overflow after refreshing', async () => {
    const f = hostFixture()
    f.plugins.innerHTML = '<div hidden><button data-plugin-command="removed">Old</button></div>'
    await f.controller.open(20, 20)
    expect(f.plugins.hidden).toBe(true)
    expect(f.menu.hidden).toBe(false)
    f.controller.dispose()
  })

  it('rejects disabled or overflow plugin actions before controlled dispatch', async () => {
    const f = hostFixture()
    f.plugins.innerHTML =
      '<button data-plugin-command="one">One</button><div hidden><button data-plugin-command="overflow">Overflow</button></div><button data-plugin-command="disabled" disabled>Disabled</button>'
    const run = vi.fn()
    f.plugins.addEventListener('milkup-plugin-renderer-action', run)
    f.plugins.addEventListener('click', run)
    await f.controller.open(20, 20)
    const overflow = f.plugins.querySelector<HTMLButtonElement>('[data-plugin-command="overflow"]')!
    overflow.click()
    overflow.dispatchEvent(new CustomEvent('milkup-plugin-renderer-action', { bubbles: true }))
    const disabled = f.plugins.querySelector<HTMLButtonElement>('[data-plugin-command="disabled"]')!
    disabled.dispatchEvent(new CustomEvent('milkup-plugin-renderer-action', { bubbles: true }))
    expect(run).not.toHaveBeenCalled()
    expect(f.menu.hidden).toBe(false)
    f.controller.dispose()
  })

  it('moves an overflowed plugin focus to a host row without taking outside focus', async () => {
    const f = hostFixture()
    f.plugins.innerHTML = '<button data-plugin-command="one">One</button>'
    await f.controller.open(20, 20)
    const plugin = f.plugins.querySelector<HTMLButtonElement>('button')!
    plugin.focus()
    plugin.hidden = true
    f.controller.reconcileLayout()
    expect(document.activeElement).toBe(f.item('copy'))
    const other = document.querySelector<HTMLButtonElement>('#other')!
    other.focus()
    f.controller.reconcileLayout()
    expect(document.activeElement).toBe(other)
    f.controller.dispose()
  })

  it('keeps keyboard dismissal reachable after the focused plugin is unmounted', async () => {
    const f = hostFixture()
    f.plugins.innerHTML = '<button data-plugin-command="one">One</button>'
    await f.controller.open(20, 20)
    f.plugins.querySelector<HTMLButtonElement>('button')!.focus()
    f.plugins.replaceChildren()
    expect(document.activeElement).toBe(document.body)
    f.controller.reconcileLayout()
    expect(document.activeElement).toBe(f.item('copy'))
    f.item('copy').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(f.menu.hidden).toBe(true)
    f.controller.dispose()
  })

  it('keeps Escape available when all host commands are disabled', async () => {
    const f = fixture()
    f.controller.dispose()
    f.menu.replaceChildren()
    const snapshot = { identity: {}, version: 1, selection: undefined }
    const controller = new EditorContextMenu(f.input.parentElement!, f.menu, {
      host: {
        capture: () => snapshot,
        items: () => [{ id: 'copy', label: 'Copy', disabled: true }],
        isCurrent: () => true,
        execute: () => {},
      },
    })
    f.input.focus()
    await controller.open(20, 20)
    expect(document.activeElement).toBe(f.menu)
    f.menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(f.menu.hidden).toBe(true)
    expect(document.activeElement).toBe(f.input)
    controller.dispose()
  })
})

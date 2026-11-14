// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { EditorContextMenu } from './editor-context-menu'

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

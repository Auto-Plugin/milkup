// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { moveDesktopFocus, restoreDesktopFocus } from './desktop-focus'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function setup() {
  document.body.innerHTML = `<button id="first">Menu</button><textarea id="editor"></textarea>
    <button disabled>Disabled</button><div inert><button>Inert</button></div>
    <div hidden><button>Hidden</button></div><button style="visibility:hidden">Invisible</button>
    <button tabindex="-1">Programmatic only</button><button id="last">Last</button>`
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  return Object.fromEntries(
    ['first', 'editor', 'last'].map((id) => [id, document.getElementById(id)!]),
  )
}

describe('desktop focus after editor or modal operations', () => {
  it('follows visible forward and reverse tab order without changing textarea selection', () => {
    const { first, editor, last } = setup()
    const input = editor as HTMLTextAreaElement
    input.value = '中文 abc'
    input.setSelectionRange(1, 4)
    input.focus()
    moveDesktopFocus(input, false)
    expect(document.activeElement).toBe(last)
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 4])
    input.focus()
    moveDesktopFocus(input, true)
    expect(document.activeElement).toBe(first)
  })
  it('respects positive tabindex and wraps within the desktop document', () => {
    const { first, editor, last } = setup()
    last!.tabIndex = 1
    moveDesktopFocus(last!, false)
    expect(document.activeElement).toBe(first)
    moveDesktopFocus(editor!, false)
    expect(document.activeElement).toBe(last)
    moveDesktopFocus(last!, true)
    expect(document.activeElement).toBe(editor)
  })
  it('returns to a connected invoker and uses fallback when it becomes unavailable', () => {
    const { first, editor } = setup()
    const fallback = vi.fn(() => editor!.focus())
    restoreDesktopFocus(first!, fallback)
    expect(document.activeElement).toBe(first)
    expect(fallback).not.toHaveBeenCalled()
    first!.setAttribute('inert', '')
    restoreDesktopFocus(first!, fallback)
    expect(document.activeElement).toBe(editor)
    first!.remove()
    restoreDesktopFocus(first!, fallback)
    expect(fallback).toHaveBeenCalledTimes(2)
  })

  it('uses fallback when a visible prior element cannot actually receive focus', () => {
    const { editor, first } = setup()
    const target = document.createElement('div')
    document.body.append(target)
    first!.focus()
    const fallback = vi.fn(() => editor!.focus())
    restoreDesktopFocus(target, fallback)
    expect(document.activeElement).toBe(editor)
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('uses the DOM position of a programmatically focused non-tab-stop container', () => {
    const { first, editor } = setup()
    const container = document.createElement('div')
    container.tabIndex = -1
    editor!.before(container)
    container.focus()
    moveDesktopFocus(container, true)
    expect(document.activeElement).toBe(first)
    container.focus()
    moveDesktopFocus(container, false)
    expect(document.activeElement).toBe(editor)
  })
})

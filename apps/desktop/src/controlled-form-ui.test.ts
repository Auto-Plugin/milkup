// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createControlledRendererNodes, type ControlledRendererField } from '@milkup/view-dom'
import { ControlledFormState, revealModalFocus } from './controlled-form-ui'

const field: ControlledRendererField = {
  type: 'field',
  key: 'font',
  kind: 'text',
  label: 'Font',
  value: 'abcdef',
  onChange: { command: 'edit' },
}
function setup() {
  document.body.innerHTML = '<div id="forms"></div><button id="outside">Other</button>'
  const body = document.getElementById('forms')!
  const state = new ControlledFormState(body)
  const render = (value: ControlledRendererField, snapshot = state.snapshot()) =>
    state.reconcile(
      body,
      createControlledRendererNodes(document, 'form', {
        type: 'element',
        tag: 'span',
        children: [
          { type: 'element', tag: 'button', text: 'Save', action: { command: 'save' } },
          value,
        ],
      }),
      snapshot,
    )
  render(field)
  return { body, state, render, input: body.querySelector('input')! }
}

describe('controlled form reconciliation', () => {
  it('keeps the exact connected input and selection while validation changes', () => {
    const { body, render, input } = setup()
    input.focus()
    input.setSelectionRange(1, 4, 'backward')
    const blur: Event[] = []
    input.addEventListener('blur', (e) => blur.push(e))
    render({ ...field, invalid: true, help: 'Check font' })
    expect(body.querySelector('input')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([
      1,
      4,
      'backward',
    ])
    expect(blur).toHaveLength(0)
  })

  it('does not overwrite an edit made after an asynchronous render started', () => {
    const { state, render, input } = setup()
    const pending = state.snapshot()
    input.value = 'new draft'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    render({ ...field, help: 'Old response' }, pending)
    expect(input.value).toBe('new draft')
    render({ ...field, value: 'New accepted value' })
    expect(input.value).toBe('New accepted value')
  })

  it('preserves IME composition and never takes focus from another control', () => {
    const { render, input } = setup()
    input.focus()
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input.value = '拼音'
    render({ ...field, value: 'Old value', help: 'Status update' })
    expect(input.value).toBe('拼音')
    expect(document.activeElement).toBe(input)
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    document.getElementById('outside')!.focus()
    render({ ...field, value: 'Accepted' })
    expect(document.activeElement?.id).toBe('outside')
  })
})

describe('modal focus visibility', () => {
  it('scrolls only the modal by CSS units to reveal the entire zoomed control and focus ring', () => {
    document.body.innerHTML = '<section><input></section><button>Outside</button>'
    const modal = document.querySelector('section')!
    const input = document.querySelector('input')!
    Object.defineProperties(modal, {
      offsetWidth: { value: 100 },
      offsetHeight: { value: 100 },
      clientWidth: { value: 98 },
      clientHeight: { value: 98 },
      clientTop: { value: 1 },
      clientLeft: { value: 1 },
    })
    modal.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 200, height: 200, right: 210, bottom: 220 }) as DOMRect
    input.getBoundingClientRect = () =>
      ({ left: 180, top: 200, width: 40, height: 30, right: 220, bottom: 230 }) as DOMRect
    modal.scrollTop = 100
    modal.scrollLeft = 100
    input.focus()
    revealModalFocus(modal)
    expect(modal.scrollTop).toBe(110)
    expect(modal.scrollLeft).toBe(110)
    expect(document.activeElement).toBe(input)
    document.querySelector('button')!.focus()
    revealModalFocus(modal)
    expect(modal.scrollTop).toBe(110)
    expect(document.activeElement).toBe(document.querySelector('button'))
    modal.remove()
    revealModalFocus(modal)
    expect(modal.scrollTop).toBe(110)
  })
})

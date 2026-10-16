import { describe, expect, it, vi } from 'vitest'
import { createControlledRendererNodes, type ControlledRendererField } from '../index'

const field: ControlledRendererField = {
  type: 'field',
  key: 'font',
  kind: 'text',
  label: 'Font',
  value: '',
  onChange: { command: 'change' },
}

describe('controlled fields', () => {
  it('associates literal labels and validation help with a native control and emits only field/value', () => {
    const [node] = createControlledRendererNodes(document, 'view', {
      ...field,
      value: '<script>',
      invalid: true,
      help: '<b>Use a font</b>',
    })
    document.body.replaceChildren(node!)
    const input = document.querySelector('input')!
    expect(document.querySelector('label')!.control).toBe(input)
    expect(input.value).toBe('<script>')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe(
      '<b>Use a font</b>',
    )
    expect(document.querySelector('script,b')).toBeNull()
    const listener = vi.fn()
    node!.addEventListener('milkup-plugin-renderer-action', listener)
    input.value = 'New font'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(listener.mock.calls[0]![0].detail).toEqual({
      rendererId: 'view',
      command: 'change',
      input: { field: 'font', value: 'New font' },
    })
  })

  it('keeps empty numeric drafts and native constraints, and suppresses disabled actions', () => {
    const [node] = createControlledRendererNodes(document, 'view', {
      ...field,
      kind: 'number',
      disabled: true,
      min: 8,
      max: 40,
      step: 1,
    })
    const control = (node as HTMLElement).querySelector('input')!
    const listener = vi.fn()
    node!.addEventListener('milkup-plugin-renderer-action', listener)
    expect(control.value).toBe('')
    expect(control.min).toBe('8')
    control.dispatchEvent(new Event('input', { bubbles: true }))
    expect(listener).not.toHaveBeenCalled()
    const [button] = createControlledRendererNodes(document, 'view', {
      type: 'element',
      tag: 'button',
      disabled: true,
      action: { command: 'save' },
    })
    button!.addEventListener('milkup-plugin-renderer-action', listener)
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(listener).not.toHaveBeenCalled()
  })

  it('renders safe select options and rejects duplicate keys, malformed or oversized field values', () => {
    const [node] = createControlledRendererNodes(document, 'view', {
      ...field,
      kind: 'select',
      value: 'dark',
      options: [
        { value: 'light', label: '<Light>' },
        { value: 'dark', label: 'Dark' },
      ],
    })
    expect((node as HTMLElement).querySelector('select')!.value).toBe('dark')
    expect((node as HTMLElement).querySelector('option')!.textContent).toBe('<Light>')
    expect(() =>
      createControlledRendererNodes(document, 'view', {
        type: 'element',
        tag: 'span',
        children: [field, field],
      }),
    ).toThrow('unique')
    for (const patch of [
      { key: '' },
      { value: 42 },
      { kind: 'html' },
      { step: -1 },
      { value: 'x'.repeat(16385) },
    ]) {
      expect(() =>
        createControlledRendererNodes(document, 'view', { ...field, ...patch } as never),
      ).toThrow()
    }
    expect(() =>
      createControlledRendererNodes(document, 'view', { type: 'element', tag: 'input' } as never),
    ).toThrow('not allowed')
  })
})

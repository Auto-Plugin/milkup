import type {
  ControlledRendererActionDetail,
  ControlledRendererElement,
  ControlledRendererField,
  ControlledRendererOutput,
} from './types'

const controlledRendererTags = new Set(['span', 'strong', 'em', 'code', 'a', 'button'])
const controlledRendererAttributes = new Set([
  'class',
  'title',
  'href',
  'aria-label',
  'aria-current',
  'aria-expanded',
  'aria-level',
  'role',
  'data-host-icon',
  'data-virtual-list',
  'data-virtual-total',
  'data-virtual-start',
  'data-virtual-end',
  'data-virtual-item-height',
  'data-virtual-active',
  'data-virtual-follow-active',
  'data-virtual-has-before',
  'data-virtual-has-after',
  'data-virtual-scroll-adjust',
  'data-virtual-revision',
])

export function createControlledRendererNodes(
  document: Document,
  rendererId: string,
  value: ControlledRendererOutput,
): readonly Node[] {
  return createNodes(document, rendererId, value, new Set())
}

function createNodes(
  document: Document,
  rendererId: string,
  value: ControlledRendererOutput,
  keys: Set<string>,
): readonly Node[] {
  if (typeof value === 'object' && value !== null && value.type === 'field') {
    if (keys.has(value.key)) throw new Error('Renderer field keys must be unique')
    keys.add(value.key)
    return Object.freeze([createField(document, rendererId, value)])
  }
  if (typeof value === 'object' && value !== null && value.type === 'element') {
    return Object.freeze([createControlledRendererElement(document, rendererId, value, keys)])
  }

  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new Error('Renderer output must be text or a controlled element')
  }

  const span = document.createElement('span')
  span.textContent = String(value)
  return Object.freeze([span])
}

function createControlledRendererElement(
  document: Document,
  rendererId: string,
  output: ControlledRendererElement,
  keys: Set<string>,
): HTMLElement {
  if (!controlledRendererTags.has(output.tag)) {
    throw new Error(`Renderer element is not allowed: ${output.tag}`)
  }

  const element = document.createElement(output.tag)
  if (output.disabled !== undefined) {
    if (output.tag !== 'button') throw new Error('Only renderer buttons support disabled')
    ;(element as HTMLButtonElement).disabled = output.disabled === true
  }

  for (const [name, value] of Object.entries(output.attributes ?? {})) {
    if (!controlledRendererAttributes.has(name)) {
      throw new Error(`Renderer attribute is not allowed: ${name}`)
    }

    if (name === 'href' && !/^(?:https?:|mailto:|#)/i.test(value)) {
      throw new Error(`Renderer link is not allowed: ${value}`)
    }

    element.setAttribute(name, value)
  }

  if (output.text !== undefined) {
    element.textContent = output.text
  } else if (output.children) {
    element.replaceChildren(
      ...output.children.flatMap((child) => createNodes(document, rendererId, child, keys)),
    )
  }

  if (output.action) {
    element.dataset.pluginCommand = output.action.command
    element.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (element.hasAttribute('disabled')) return
      element.dispatchEvent(
        new document.defaultView!.CustomEvent<ControlledRendererActionDetail>(
          'milkup-plugin-renderer-action',
          {
            bubbles: true,
            composed: true,
            detail: Object.freeze({
              rendererId,
              command: output.action!.command,
              ...(output.action!.input === undefined ? {} : { input: output.action!.input }),
            }),
          },
        ),
      )
    })
  }

  return element
}

function fieldText(value: unknown, name: string, limit = 16384): asserts value is string {
  if (typeof value !== 'string' || value.length > limit)
    throw new Error(`Invalid renderer field ${name}`)
}

function createField(
  document: Document,
  rendererId: string,
  field: ControlledRendererField,
): HTMLElement {
  fieldText(field.key, 'key', 128)
  if (!field.key) throw new Error('Renderer field key must not be empty')
  fieldText(field.label, 'label', 1024)
  fieldText(field.value, 'value')
  fieldText(field.onChange?.command, 'command', 256)
  if (!field.onChange.command) throw new Error('Renderer field command must not be empty')
  if (!['text', 'number', 'select'].includes(field.kind))
    throw new Error('Invalid renderer field kind')
  for (const name of ['help', 'placeholder'] as const) {
    if (field[name] !== undefined) fieldText(field[name], name)
  }
  for (const name of ['min', 'max', 'step'] as const) {
    if (
      field[name] !== undefined &&
      (!Number.isFinite(field[name]) || (name === 'step' && field[name]! <= 0))
    ) {
      throw new Error(`Invalid renderer field ${name}`)
    }
  }
  if (
    field.options !== undefined &&
    (!Array.isArray(field.options) || field.options.length > 256)
  ) {
    throw new Error('Invalid renderer field options')
  }
  const wrapper = document.createElement('span')
  wrapper.className = 'plugin-form-field'
  wrapper.dataset.pluginField = field.key
  const id =
    'plugin-field-' +
    Array.from(`${rendererId}:${field.key}`, (char) => char.codePointAt(0)!.toString(16)).join('-')
  const label = document.createElement('label')
  label.className = 'plugin-form-label'
  label.htmlFor = id
  label.textContent = field.label
  const control = document.createElement(field.kind === 'select' ? 'select' : 'input')
  if (control.tagName === 'INPUT') {
    const input = control as HTMLInputElement
    input.type = field.kind
    input.maxLength = 16384
    if (field.placeholder !== undefined) input.placeholder = field.placeholder
    for (const name of ['min', 'max', 'step'] as const) {
      if (field[name] !== undefined) input.setAttribute(name, String(field[name]))
    }
  } else {
    const values = new Set<string>()
    for (const option of field.options ?? []) {
      fieldText(option.value, 'option value')
      fieldText(option.label, 'option label', 1024)
      if (values.has(option.value))
        throw new Error('Renderer field options must have unique values')
      values.add(option.value)
      const node = document.createElement('option')
      node.value = option.value
      node.textContent = option.label
      node.disabled = option.disabled === true
      control.append(node)
    }
  }
  control.id = id
  control.className = 'plugin-form-control'
  control.dataset.pluginFieldControl = field.key
  control.dataset.pluginCommand = field.onChange.command
  control.value = field.value
  control.disabled = field.disabled === true
  control.setAttribute('aria-invalid', String(field.invalid === true))
  const help = document.createElement('span')
  help.className = 'plugin-form-help'
  help.id = `${id}-help`
  help.textContent = field.help ?? ''
  help.hidden = !field.help
  if (field.help) control.setAttribute('aria-describedby', help.id)
  wrapper.append(label, control, help)
  control.addEventListener(field.kind === 'select' ? 'change' : 'input', () => {
    if (control.disabled || control.value.length > 16384) return
    // Read current host-owned metadata: the DOM node survives later controlled renders.
    control.dispatchEvent(
      new document.defaultView!.CustomEvent<ControlledRendererActionDetail>(
        'milkup-plugin-renderer-action',
        {
          bubbles: true,
          composed: true,
          detail: Object.freeze({
            rendererId,
            command: control.dataset.pluginCommand!,
            input: Object.freeze({
              field: control.dataset.pluginFieldControl!,
              value: control.value,
            }),
          }),
        },
      ),
    )
  })
  return wrapper
}

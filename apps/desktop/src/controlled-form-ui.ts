/** Host-owned form state. Plugin output never supplies event authority or DOM identity. */
export class ControlledFormState {
  private readonly revisions = new Map<string, number>()
  private readonly composing = new Set<Element>()

  constructor(body: HTMLElement) {
    for (const type of ['input', 'change'])
      body.addEventListener(
        type,
        (event) => {
          const control = event.target
          if (!(control instanceof HTMLElement) || !control.dataset.pluginFieldControl) return
          const key = control.dataset.pluginFieldControl
          this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1)
        },
        true,
      )
    body.addEventListener(
      'compositionstart',
      (event) => {
        if (event.target instanceof Element) this.composing.add(event.target)
      },
      true,
    )
    body.addEventListener(
      'compositionend',
      (event) => {
        if (event.target instanceof Element) this.composing.delete(event.target)
      },
      true,
    )
  }

  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.revisions)
  }

  reconcile(body: HTMLElement, nodes: readonly Node[], started: ReadonlyMap<string, number>): void {
    if (
      !nodes.some(
        (node) =>
          node instanceof HTMLElement &&
          (node.matches('[data-plugin-field]') || node.querySelector('[data-plugin-field]')),
      )
    ) {
      body.replaceChildren(...nodes)
      return
    }
    const focused = body.ownerDocument.activeElement
    const field =
      focused instanceof HTMLElement && body.contains(focused) && focused.dataset.pluginFieldControl
        ? focused
        : undefined
    const selection =
      field instanceof HTMLInputElement && field.type === 'text'
        ? {
            start: field.selectionStart,
            end: field.selectionEnd,
            direction: field.selectionDirection,
          }
        : undefined
    const existing = new Map(
      Array.from(body.querySelectorAll<HTMLElement>('[data-plugin-field]')).map((node) => [
        node.dataset.pluginField!,
        node,
      ]),
    )
    const patchChildren = (parent: Node, incoming: readonly Node[]): void => {
      let cursor = parent.firstChild
      for (const fresh of incoming) {
        let node: Node = fresh
        if (fresh instanceof HTMLElement && fresh.dataset.pluginField) {
          const previous = existing.get(fresh.dataset.pluginField)
          const oldControl = previous?.querySelector<HTMLInputElement | HTMLSelectElement>(
            '[data-plugin-field-control]',
          )
          const newControl = fresh.querySelector<HTMLInputElement | HTMLSelectElement>(
            '[data-plugin-field-control]',
          )!
          if (
            previous &&
            oldControl &&
            oldControl.tagName === newControl.tagName &&
            oldControl.getAttribute('type') === newControl.getAttribute('type')
          ) {
            const key = fresh.dataset.pluginField
            const preserveDraft =
              this.composing.has(oldControl) ||
              (started.get(key) ?? 0) !== (this.revisions.get(key) ?? 0)
            const value = preserveDraft ? oldControl.value : newControl.value
            copyAttributes(oldControl, newControl)
            if (
              oldControl instanceof HTMLSelectElement &&
              oldControl.innerHTML !== newControl.innerHTML
            )
              oldControl.replaceChildren(...Array.from(newControl.childNodes))
            if (oldControl.value !== value) oldControl.value = value
            // Keep the input, its listener, IME state and selection connected in place.
            for (const selector of ['label', '.plugin-form-help']) {
              const before = previous.querySelector<HTMLElement>(selector)!
              const after = fresh.querySelector<HTMLElement>(selector)!
              copyAttributes(before, after)
              before.textContent = after.textContent
            }
            node = previous
          }
        } else if (
          cursor instanceof HTMLElement &&
          fresh instanceof HTMLElement &&
          cursor.tagName === fresh.tagName &&
          !cursor.dataset.pluginField &&
          !cursor.dataset.pluginCommand &&
          !fresh.dataset.pluginCommand
        ) {
          copyAttributes(cursor, fresh)
          patchChildren(cursor, Array.from(fresh.childNodes))
          node = cursor
        } else if (cursor?.nodeType === Node.TEXT_NODE && fresh.nodeType === Node.TEXT_NODE) {
          cursor.textContent = fresh.textContent
          node = cursor
        }
        if (node !== cursor) {
          // Replace obsolete unkeyed siblings immediately. Leaving an old action
          // in front of a field would unnecessarily move (and blur) that field.
          if (
            node === fresh &&
            cursor &&
            !(cursor instanceof HTMLElement && cursor.dataset.pluginField)
          ) {
            parent.replaceChild(node, cursor)
          } else parent.insertBefore(node, cursor)
        }
        cursor = node.nextSibling
      }
      while (cursor) {
        const next = cursor.nextSibling
        parent.removeChild(cursor)
        cursor = next
      }
    }
    patchChildren(body, nodes)
    if (field?.isConnected && !field.hasAttribute('disabled')) {
      // Moving a keyed field can cause native blur. Restore only a focus lost to DOM removal.
      if (body.ownerDocument.activeElement === body.ownerDocument.body)
        field.focus({ preventScroll: true })
      if (
        body.ownerDocument.activeElement === field &&
        selection?.start !== null &&
        selection?.end !== null &&
        selection
      ) {
        ;(field as HTMLInputElement).setSelectionRange(
          selection.start,
          selection.end,
          selection.direction ?? undefined,
        )
      }
    }
  }
}

function copyAttributes(target: Element, source: Element): void {
  for (const attribute of Array.from(target.attributes))
    if (!source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name)
  for (const attribute of Array.from(source.attributes))
    if (target.getAttribute(attribute.name) !== attribute.value)
      target.setAttribute(attribute.name, attribute.value)
}

/** Reveal the actual focused control inside this modal, including its focus ring.
 * Native focus scrolling can reveal only the caret; never scroll the document or
 * refocus a captured control that the user has already left. */
export function revealModalFocus(modal: HTMLElement): void {
  const active = modal.ownerDocument.activeElement
  if (
    !modal.isConnected ||
    !(active instanceof HTMLElement) ||
    active === modal ||
    !modal.contains(active) ||
    active.hasAttribute('disabled') ||
    modal.offsetHeight === 0 ||
    modal.offsetWidth === 0
  )
    return
  const bounds = modal.getBoundingClientRect()
  const control = active.getBoundingClientRect()
  if (control.width === 0 || control.height === 0) return
  // CSS zoom scales DOMRects but scroll offsets/client sizes stay in CSS units.
  const scaleX = bounds.width / modal.offsetWidth
  const scaleY = bounds.height / modal.offsetHeight
  const top = bounds.top + (modal.clientTop + 4) * scaleY
  const bottom = bounds.top + (modal.clientTop + modal.clientHeight - 4) * scaleY
  const left = bounds.left + (modal.clientLeft + 4) * scaleX
  const right = bounds.left + (modal.clientLeft + modal.clientWidth - 4) * scaleX
  const dy =
    control.top < top ? control.top - top : control.bottom > bottom ? control.bottom - bottom : 0
  const dx =
    control.left < left ? control.left - left : control.right > right ? control.right - right : 0
  if (dy) modal.scrollTop += dy > 0 ? Math.ceil(dy / scaleY) : Math.floor(dy / scaleY)
  if (dx) modal.scrollLeft += dx > 0 ? Math.ceil(dx / scaleX) : Math.floor(dx / scaleX)
}

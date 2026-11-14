/** Mirror native preedit without editing the document or replacing its input. */
export function renderCompositionOverlay(
  layer: HTMLElement,
  content: HTMLElement,
  text: string,
): void {
  layer.querySelector('.milkup-composition')?.remove()
  if (!text) return
  const cursor = layer.querySelector<HTMLElement>('.milkup-cursor')
  if (!cursor) return

  const document = layer.ownerDocument
  const composition = document.createElement('span')
  composition.className = 'milkup-composition'
  composition.setAttribute('aria-hidden', 'true')
  composition.textContent = text
  composition.style.left = cursor.style.left
  composition.style.top = cursor.style.top
  composition.style.minHeight = cursor.style.height
  composition.style.visibility = cursor.style.visibility

  const line = content.querySelector<HTMLElement>(
    `.milkup-line[data-line="${cursor.dataset.line}"]`,
  )
  const window = document.defaultView
  if (window) {
    const style = window.getComputedStyle(line ?? content)
    for (const property of [
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'letter-spacing',
      'line-height',
    ])
      composition.style.setProperty(property, style.getPropertyValue(property))
    // Overlay text must not collide with the unchanged source beneath it. Use
    // the actual line/ancestor fill, including dark and custom solid themes.
    // Translucent fills/gradients retain the nearest opaque ancestor fallback;
    // this temporary cover does not recreate arbitrary background artwork.
    for (let node: HTMLElement | null = line ?? content; node; node = node.parentElement) {
      const background = window.getComputedStyle(node).backgroundColor
      if (isOpaque(background)) {
        composition.style.backgroundColor = background
        break
      }
    }
  }
  layer.append(composition)
}

function isOpaque(color: string): boolean {
  if (!color || color === 'transparent') return false
  const alpha = color.startsWith('rgba(')
    ? /,\s*([\d.]+)\s*\)$/u.exec(color)
    : /\/\s*([\d.]+)(%)?\s*\)$/u.exec(color)
  return !alpha || Number(alpha[1]) >= (alpha[2] ? 100 : 1)
}

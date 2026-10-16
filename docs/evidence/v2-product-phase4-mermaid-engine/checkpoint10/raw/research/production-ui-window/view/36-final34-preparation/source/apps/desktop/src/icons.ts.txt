import type { IconNode } from 'lucide'

const svgAttributeNameMap = new Map([
  ['strokeWidth', 'stroke-width'],
  ['strokeLinecap', 'stroke-linecap'],
  ['strokeLinejoin', 'stroke-linejoin'],
])

export function iconSvg(icon: IconNode, className = 'icon'): string {
  const children = icon.map(([tag, attrs]) => {
    const attributes = Object.entries(attrs)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${normalizeSvgAttributeName(name)}="${escapeHtml(String(value))}"`)
      .join(' ')

    return `<${tag}${attributes ? ` ${attributes}` : ''}></${tag}>`
  })

  return [
    `<svg class="${className}" aria-hidden="true" focusable="false"`,
    'xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"',
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
    children.join(''),
    '</svg>',
  ].join('')
}

function normalizeSvgAttributeName(name: string): string {
  return svgAttributeNameMap.get(name) ?? name
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

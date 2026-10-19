import type { SdkDocumentSvgDefinition, SdkDocumentSvgLength } from '@milkup/plugin-sdk'
import { finite } from './svg-primitives.js'

type IdentityFilter = Extract<SdkDocumentSvgDefinition, { kind: 'dropShadowFilter' }>
type StyleReader = (node: Element, property: string) => string
const SVG = 'http://www.w3.org/2000/svg'
const none = (value: string) => value === '' || value === 'none'

/** A bounded identity surface; does not redistribute opacity or mutate the live DOM. */
export function boundedOpacityFilter(
  root: SVGSVGElement,
  group: SVGGraphicsElement,
  id: string,
  read: StyleReader,
): IdentityFilter | undefined {
  const opacity = Number(read(group, 'opacity'))
  if (!(opacity > 0 && opacity < 1) || group.localName !== 'g') return undefined
  if (group.ownerSVGElement !== root || group.children.length !== 2) return undefined
  const children = Array.from(group.children)
  const line = children.find((node) => node.localName === 'line')
  const text = children.find((node) => node.localName === 'text')
  if (
    !line ||
    !text ||
    line.children.length ||
    text.childNodes.length !== 1 ||
    text.firstChild?.nodeType !== 3
  )
    return undefined
  if (
    read(root, 'overflow-x') !== 'hidden' ||
    read(root, 'overflow-y') !== 'hidden' ||
    !none(read(root, 'transform'))
  )
    return undefined
  for (const side of ['top', 'right', 'bottom', 'left']) {
    for (const property of [`border-${side}-width`, `padding-${side}`]) {
      const value = read(root, property)
      if (value && value !== '0px') return undefined
    }
  }
  function effectFree(node: Element, allowOpacity: boolean): boolean {
    if (
      node.namespaceURI !== SVG ||
      read(node, 'display') === 'none' ||
      read(node, 'visibility') !== 'visible'
    )
      return false
    if (!allowOpacity && Number(read(node, 'opacity')) !== 1) return false
    for (const property of [
      'filter',
      'clip-path',
      'mask-image',
      '-webkit-mask-image',
      'text-shadow',
    ]) {
      if (!none(read(node, property))) return false
    }
    if (
      !['', 'normal'].includes(read(node, 'mix-blend-mode')) ||
      !['', 'auto'].includes(read(node, 'isolation'))
    )
      return false
    return none(read(node, 'animation-name'))
  }
  if (!effectFree(root, true) || !effectFree(group, true)) return undefined
  let parent: Element | null = group.parentElement
  while (parent && parent !== root) {
    if (parent.localName !== 'g' || !effectFree(parent, true)) return undefined
    parent = parent.parentElement
  }
  if (parent !== root) return undefined
  for (const child of children) {
    if (!effectFree(child, false)) return undefined
    for (const property of ['marker-start', 'marker-mid', 'marker-end']) {
      if (!none(read(child, property))) return undefined
    }
  }
  const rect = root.getBoundingClientRect()
  if (!(rect.width > 0 && rect.height > 0)) return undefined
  const matrix = group.getScreenCTM()
  if (
    !matrix ||
    ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)
  )
    return undefined
  let inverse: DOMMatrix
  try {
    inverse = matrix.inverse()
  } catch {
    return undefined
  }
  if (![inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(Number.isFinite))
    return undefined
  const corners: [number, number][] = []
  for (const x of [rect.x, rect.x + rect.width]) {
    for (const y of [rect.y, rect.y + rect.height]) {
      corners.push([
        inverse.a * x + inverse.c * y + inverse.e,
        inverse.b * x + inverse.d * y + inverse.f,
      ])
    }
  }
  const left = Math.floor(Math.min(...corners.map((point) => point[0])))
  const top = Math.floor(Math.min(...corners.map((point) => point[1])))
  const right = Math.ceil(Math.max(...corners.map((point) => point[0])))
  const bottom = Math.ceil(Math.max(...corners.map((point) => point[1])))
  const user = (value: number): SdkDocumentSvgLength => ({
    unit: 'user',
    value: finite(value, 'bounded opacity region'),
  })
  return {
    kind: 'dropShadowFilter',
    id,
    units: 'userSpaceOnUse',
    primitiveUnits: 'userSpaceOnUse',
    region: [user(left), user(top), user(right - left), user(bottom - top)],
    colorInterpolation: 'sRGB',
    dx: 0,
    dy: 0,
    stdDeviation: [0, 0],
    color: [0, 0, 0, 0],
  }
}

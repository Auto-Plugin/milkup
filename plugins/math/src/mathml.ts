import type { SdkDocumentMathNode, SdkDocumentMathTag } from '@milkup/plugin-sdk'

interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}
const maxBytes = 256 * 1024
const mathNamespace = 'http://www.w3.org/1998/Math/MathML'
const tokenTags = new Set(['mi', 'mn', 'mo', 'mtext'])
const tags = new Set([
  'math',
  'mrow',
  'mi',
  'mn',
  'mo',
  'mtext',
  'mspace',
  'msup',
  'msub',
  'msubsup',
  'mfrac',
  'msqrt',
  'mroot',
  'mover',
  'munder',
  'munderover',
  'mtable',
  'mtr',
  'mtd',
  'mstyle',
])
const variants = new Set([
  'normal',
  'bold',
  'italic',
  'bold-italic',
  'double-struck',
  'script',
  'fraktur',
  'monospace',
])
function fail(): never {
  throw new Error('不支持的公式输出；已保留源码。')
}
function validText(value: string): string {
  for (const c of value) {
    const n = c.codePointAt(0)!
    if (
      (n < 32 && n !== 9 && n !== 10 && n !== 13) ||
      (n >= 0xd800 && n <= 0xdfff) ||
      n === 0xfffe ||
      n === 0xffff
    )
      fail()
  }
  return value
}
function decode(value: string): string {
  // XML's five predefined entities and bounded scalar references only. No DTD expansion.
  return validText(
    value.replace(/&([^;]*);|&/g, (match, entity: string | undefined) => {
      const predefined: Record<string, string> = {
        lt: '<',
        gt: '>',
        amp: '&',
        quot: '"',
        apos: "'",
      }
      if (entity && Object.hasOwn(predefined, entity)) return predefined[entity]!
      if (!entity || !/^#(?:[0-9]{1,7}|x[0-9a-fA-F]{1,6})$/.test(entity)) fail()
      const scalar = entity.startsWith('#x')
        ? Number.parseInt(entity.slice(2), 16)
        : Number(entity.slice(1))
      if (scalar > 0x10ffff) fail()
      return validText(String.fromCodePoint(scalar))
    }),
  )
}
function parseXml(markup: string): XmlNode {
  if (markup.length > maxBytes || new TextEncoder().encode(markup).length > maxBytes) fail()
  const stack: XmlNode[] = []
  let root: XmlNode | undefined,
    position = 0,
    count = 0
  while (position < markup.length) {
    if (markup[position] !== '<') {
      const end = markup.indexOf('<', position)
      const next = end < 0 ? markup.length : end
      if (!stack.length) fail()
      stack[stack.length - 1]!.text += decode(markup.slice(position, next))
      position = next
      continue
    }
    const closing = /^<\/([a-z][a-z0-9]*)>/.exec(markup.slice(position))
    if (closing) {
      if (stack.pop()?.tag !== closing[1]) fail()
      position += closing[0].length
      continue
    }
    const start = /^<([a-z][a-z0-9]*)/.exec(markup.slice(position))
    if (!start) fail()
    position += start[0].length
    const node: XmlNode = { tag: start[1]!, attrs: Object.create(null), children: [], text: '' }
    while (markup[position] !== '>' && markup.slice(position, position + 2) !== '/>') {
      const attr = /^\s+([a-z][a-z0-9-]*)="([^"<]*)"/.exec(markup.slice(position))
      if (!attr || Object.hasOwn(node.attrs, attr[1]!)) fail()
      node.attrs[attr[1]!] = decode(attr[2]!)
      position += attr[0].length
    }
    const selfClosing = markup[position] === '/'
    position += selfClosing ? 2 : 1
    if (++count > 4096 || stack.length >= 64) fail()
    if (stack.length) stack[stack.length - 1]!.children.push(node)
    else if (root) fail()
    else root = node
    if (!selfClosing) stack.push(node)
  }
  if (stack.length || !root) fail()
  return root
}
function exactAttrs(node: XmlNode, attrs: Record<string, string>): void {
  if (
    Object.keys(node.attrs).length !== Object.keys(attrs).length ||
    Object.entries(attrs).some(([key, value]) => node.attrs[key] !== value)
  )
    fail()
}
function em(value: string, minimum = 0): number {
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)em$/.test(value)) fail()
  const number = Number(value.slice(0, -2))
  if (!Number.isFinite(number) || number < minimum || number > 20) fail()
  return number
}
function bool(value: string): boolean {
  if (value !== 'true' && value !== 'false') fail()
  return value === 'true'
}
function list(value: string): string[] {
  const values = value.split(' ')
  if (!values.length || values.length > 32 || values.some((x) => !x)) fail()
  return values
}
function convert(node: XmlNode): SdkDocumentMathNode {
  if (!tags.has(node.tag) || node.tag === 'math') fail()
  if (tokenTags.has(node.tag)) {
    if (node.children.length) fail()
  } else if (node.text) fail()
  const children = node.children.map(convert)
  const arity: Record<string, number> = {
    mfrac: 2,
    mroot: 2,
    msub: 2,
    msup: 2,
    msubsup: 3,
    mover: 2,
    munder: 2,
    munderover: 3,
    mspace: 0,
  }
  if (Object.hasOwn(arity, node.tag) && children.length !== arity[node.tag]) fail()
  if (node.tag === 'mtable' && children.some((x) => x.tag !== 'mtr')) fail()
  if (node.tag === 'mtr' && children.some((x) => x.tag !== 'mtd')) fail()
  type Attributes = {
    -readonly [K in keyof NonNullable<SdkDocumentMathNode['attributes']>]: NonNullable<
      SdkDocumentMathNode['attributes']
    >[K]
  }
  const attributes: Attributes & Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node.attrs)) {
    if (
      key === 'mathvariant' &&
      ['mi', 'mn', 'mtext', 'mstyle'].includes(node.tag) &&
      variants.has(value)
    )
      attributes.mathvariant = value as NonNullable<
        NonNullable<SdkDocumentMathNode['attributes']>['mathvariant']
      >
    else if (['stretchy', 'fence', 'separator'].includes(key) && node.tag === 'mo')
      attributes[key] = bool(value)
    else if (key === 'accent' && ['mover', 'munder'].includes(node.tag))
      attributes.accent = bool(value)
    else if (key === 'scriptlevel' && node.tag === 'mstyle' && /^[0-4]$/.test(value))
      attributes.scriptLevel = Number(value)
    else if (key === 'displaystyle' && node.tag === 'mstyle') attributes.displayStyle = bool(value)
    else if (key === 'rowspacing' && node.tag === 'mtable')
      attributes.rowSpacingEm = list(value).map((x) => em(x))
    else if (key === 'columnspacing' && node.tag === 'mtable')
      attributes.columnSpacingEm = list(value).map((x) => em(x))
    else if (key === 'columnalign' && node.tag === 'mtable') {
      const align = list(value)
      if (align.some((x) => !['left', 'center', 'right'].includes(x))) fail()
      attributes.columnAlign = align as ('left' | 'center' | 'right')[]
    } else if (key === 'width' && node.tag === 'mspace') attributes.widthEm = em(value)
    else if ((key === 'lspace' || key === 'rspace') && node.tag === 'mo')
      attributes[key === 'lspace' ? 'lspaceEm' : 'rspaceEm'] = em(value, -20)
    else fail()
  }
  return {
    tag: node.tag as SdkDocumentMathTag,
    ...(tokenTags.has(node.tag) ? { text: node.text } : { children }),
    ...(Object.keys(attributes).length ? { attributes } : {}),
  }
}
/** Parse only KaTeX's inert MathML envelope. Unknown syntax rejects the whole formula. */
export function parseMathMarkup(markup: string, source: string): SdkDocumentMathNode {
  const wrapper = parseXml(markup)
  if (wrapper.tag !== 'span' || wrapper.text || wrapper.children.length !== 1) fail()
  exactAttrs(wrapper, { class: 'katex' })
  const math = wrapper.children[0]!
  if (math.tag !== 'math' || math.text || math.children.length !== 1) fail()
  const display = math.attrs.display
  if (display !== undefined && display !== 'block') fail()
  exactAttrs(math, { xmlns: mathNamespace, ...(display ? { display } : {}) })
  const semantics = math.children[0]!
  if (semantics.tag !== 'semantics' || semantics.text || semantics.children.length !== 2) fail()
  exactAttrs(semantics, {})
  const annotation = semantics.children[1]!
  if (annotation.tag !== 'annotation' || annotation.children.length || annotation.text !== source)
    fail()
  exactAttrs(annotation, { encoding: 'application/x-tex' })
  return {
    tag: 'math',
    attributes: { display: display === 'block' ? 'block' : 'inline' },
    children: [convert(semantics.children[0]!)],
  }
}

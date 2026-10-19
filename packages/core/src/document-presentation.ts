import type { DocumentSvgImage } from './document-svg-image'
import {
  copyDocumentSvgImage,
  createDocumentOutputBudget,
  serializeDocumentSvgImage,
  type DocumentOutputBudget,
} from './document-svg-image-codec'

/** Shared, inert document presentation data. All source offsets are absolute UTF-16. */
export interface DocumentPresentationRange {
  readonly from: number
  readonly to: number
}
export interface DocumentPresentationBlock extends DocumentPresentationRange {
  readonly kind: 'text' | 'fence' | 'code' | 'unknown'
  readonly complete: boolean
  readonly info?: string
  readonly contentRanges: readonly DocumentPresentationRange[]
}
export interface DocumentPresentationRequest extends DocumentPresentationRange {
  readonly documentId: string
  readonly version: number
  readonly source: string
  readonly fromLine: number
  readonly toLine: number
  readonly completeStart: boolean
  readonly completeEnd: boolean
  readonly contextKnown: boolean
  readonly protectedRanges: readonly DocumentPresentationRange[]
  readonly blocks: readonly DocumentPresentationBlock[]
  readonly selection: { readonly anchor: number; readonly head: number }
  readonly theme: 'light' | 'dark'
  readonly target: 'screen' | 'export'
  readonly width: number
}
export type DocumentPresentationTone = 'foreground' | 'muted' | 'accent' | 'background' | 'border'
export type DocumentMathTag =
  | 'math'
  | 'mrow'
  | 'mi'
  | 'mn'
  | 'mo'
  | 'mtext'
  | 'mspace'
  | 'msup'
  | 'msub'
  | 'msubsup'
  | 'mfrac'
  | 'msqrt'
  | 'mroot'
  | 'mover'
  | 'munder'
  | 'munderover'
  | 'mtable'
  | 'mtr'
  | 'mtd'
  | 'mstyle'
export interface DocumentMathNode {
  readonly tag: DocumentMathTag
  readonly text?: string
  readonly children?: readonly DocumentMathNode[]
  readonly attributes?: {
    readonly scriptLevel?: number
    readonly displayStyle?: boolean
    readonly rowSpacingEm?: readonly number[]
    readonly columnSpacingEm?: readonly number[]
    readonly columnAlign?: readonly ('left' | 'center' | 'right')[]
    readonly widthEm?: number
    readonly lspaceEm?: number
    readonly rspaceEm?: number
    readonly display?: 'inline' | 'block'
    readonly mathvariant?:
      | 'normal'
      | 'bold'
      | 'italic'
      | 'bold-italic'
      | 'double-struck'
      | 'script'
      | 'fraktur'
      | 'monospace'
    readonly stretchy?: boolean
    readonly fence?: boolean
    readonly separator?: boolean
    readonly accent?: boolean
  }
}
export interface DocumentVectorStyle {
  readonly stroke?: DocumentPresentationTone
  readonly fill?: DocumentPresentationTone | 'none'
  readonly strokeWidth?: number
}
export type DocumentVectorPrimitive =
  | (DocumentVectorStyle & {
      readonly type: 'rect'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly radius?: number
    })
  | (DocumentVectorStyle & {
      readonly type: 'ellipse'
      readonly cx: number
      readonly cy: number
      readonly rx: number
      readonly ry: number
    })
  | (DocumentVectorStyle & {
      readonly type: 'line'
      readonly x1: number
      readonly y1: number
      readonly x2: number
      readonly y2: number
    })
  | (DocumentVectorStyle & {
      readonly type: 'polyline' | 'polygon'
      readonly points: readonly { readonly x: number; readonly y: number }[]
    })
  | {
      readonly type: 'text'
      readonly x: number
      readonly y: number
      readonly text: string
      readonly tone?: DocumentPresentationTone
      readonly fontSize?: number
      readonly anchor?: 'start' | 'middle' | 'end'
    }
export type DocumentPresentationNode =
  | DocumentSvgImage
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'group' | 'emphasis' | 'code' | 'sup' | 'sub'
      readonly children: readonly DocumentPresentationNode[]
    }
  | {
      readonly type: 'reference'
      readonly label: string
      readonly target: {
        readonly documentId: string
        readonly version: number
        readonly from: number
        readonly to: number
      }
    }
  | { readonly type: 'math'; readonly tree: DocumentMathNode }
  | {
      readonly type: 'vector'
      readonly width: number
      readonly height: number
      readonly children: readonly DocumentVectorPrimitive[]
    }
export interface DocumentPresentationFragment extends DocumentPresentationRange {
  readonly layout: 'inline' | 'block'
  readonly content: DocumentPresentationNode
  readonly accessibleText: string
  readonly status?: 'ready' | 'error'
  readonly message?: string
}
export interface DocumentPresentationResult {
  readonly fragments: readonly DocumentPresentationFragment[]
  readonly complete: boolean
}
export interface DocumentRendererDeclaration {
  readonly id: string
  readonly contexts: readonly ('text' | 'fence')[]
  readonly fenceLanguages?: readonly string[]
}
export type DocumentRenderer = (
  request: DocumentPresentationRequest,
  options: { readonly signal: AbortSignal },
) => DocumentPresentationResult | Promise<DocumentPresentationResult>

export const DOCUMENT_PRESENTATION_LIMITS = Object.freeze({
  inputUtf16: 65_536,
  inputLines: 256,
  outputBytes: 262_144,
  nodes: 4096,
  depth: 64,
  fragments: 128,
  timeoutMs: 2000,
  queue: 2,
})
export class DocumentPresentationError extends Error {
  constructor(
    readonly code:
      | 'invalid-input'
      | 'invalid-output'
      | 'revoked'
      | 'aborted'
      | 'busy'
      | 'timeout'
      | 'unavailable',
  ) {
    super(`Document presentation: ${code}`)
    this.name = 'DocumentPresentationError'
  }
}
type RecordValue = Record<string, unknown>
function record(value: unknown, keys: readonly string[], fail: () => never): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return fail()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (
    Object.keys(descriptors).some((key) => !keys.includes(key) || !('value' in descriptors[key]!))
  )
    return fail()
  return value as RecordValue
}
function integer(value: unknown, min: number, max: number, fail: () => never): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    return fail()
  return value
}
function number(value: unknown, min: number, max: number, fail: () => never): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    return fail()
  return value
}
function string(value: unknown, max: number, fail: () => never): string {
  if (typeof value !== 'string' || value.length > max) return fail()
  return value
}
function boolean(value: unknown, fail: () => never): boolean {
  if (typeof value !== 'boolean') return fail()
  return value
}
function choice<T extends string>(value: unknown, values: readonly T[], fail: () => never): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return fail()
  return value as T
}
function array<T>(
  value: unknown,
  max: number,
  copy: (value: unknown) => T,
  fail: () => never,
): readonly T[] {
  if (!Array.isArray(value) || value.length > max) return fail()
  return Object.freeze(value.map(copy))
}
function range(
  value: unknown,
  min: number,
  max: number,
  fail: () => never,
): DocumentPresentationRange {
  const v = record(value, ['from', 'to'], fail)
  const from = integer(v.from, min, max, fail)
  return Object.freeze({ from, to: integer(v.to, from, max, fail) })
}
export function copyDocumentPresentationRequest(value: unknown): DocumentPresentationRequest {
  const fail = (): never => {
    throw new DocumentPresentationError('invalid-input')
  }
  const v = record(
    value,
    [
      'documentId',
      'version',
      'from',
      'to',
      'source',
      'fromLine',
      'toLine',
      'completeStart',
      'completeEnd',
      'contextKnown',
      'protectedRanges',
      'blocks',
      'selection',
      'theme',
      'target',
      'width',
    ],
    fail,
  )
  const documentId = string(v.documentId, 512, fail)
  if (!documentId) fail()
  const from = integer(v.from, 0, Number.MAX_SAFE_INTEGER, fail)
  const to = integer(v.to, from, Number.MAX_SAFE_INTEGER, fail)
  const source = string(v.source, DOCUMENT_PRESENTATION_LIMITS.inputUtf16, fail)
  if (
    source.length !== to - from ||
    source.split('\n').length > DOCUMENT_PRESENTATION_LIMITS.inputLines
  )
    fail()
  const fromLine = integer(v.fromLine, 1, Number.MAX_SAFE_INTEGER, fail)
  const toLine = integer(
    v.toLine,
    fromLine,
    fromLine + DOCUMENT_PRESENTATION_LIMITS.inputLines - 1,
    fail,
  )
  const selection = record(v.selection, ['anchor', 'head'], fail)
  return Object.freeze({
    documentId,
    version: integer(v.version, 0, Number.MAX_SAFE_INTEGER, fail),
    from,
    to,
    source,
    fromLine,
    toLine,
    completeStart: boolean(v.completeStart, fail),
    completeEnd: boolean(v.completeEnd, fail),
    contextKnown: boolean(v.contextKnown, fail),
    protectedRanges: array(v.protectedRanges, 4096, (item) => range(item, from, to, fail), fail),
    blocks: array(
      v.blocks,
      256,
      (item) => {
        const b = record(item, ['from', 'to', 'kind', 'complete', 'info', 'contentRanges'], fail)
        const r = range({ from: b.from, to: b.to }, from, to, fail)
        return Object.freeze({
          ...r,
          kind: choice(b.kind, ['text', 'fence', 'code', 'unknown'], fail),
          complete: boolean(b.complete, fail),
          ...(b.info === undefined ? {} : { info: string(b.info, 256, fail) }),
          contentRanges: array(b.contentRanges, 256, (r2) => range(r2, r.from, r.to, fail), fail),
        })
      },
      fail,
    ),
    selection: Object.freeze({
      anchor: integer(selection.anchor, 0, Number.MAX_SAFE_INTEGER, fail),
      head: integer(selection.head, 0, Number.MAX_SAFE_INTEGER, fail),
    }),
    theme: choice(v.theme, ['light', 'dark'], fail),
    target: choice(v.target, ['screen', 'export'], fail),
    width: number(v.width, 1, 8192, fail),
  })
}
const tones = ['foreground', 'muted', 'accent', 'background', 'border'] as const
const mathTags = [
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
] as const
type Budget = DocumentOutputBudget
function count(budget: Budget, depth: number, fail: () => never): void {
  if (
    ++budget.nodes > DOCUMENT_PRESENTATION_LIMITS.nodes ||
    depth > DOCUMENT_PRESENTATION_LIMITS.depth
  )
    fail()
}
function boundedText(value: unknown, budget: Budget, fail: () => never, max = 65_536): string {
  const text = string(value, max, fail)
  budget.text += text.length
  if (budget.text > DOCUMENT_PRESENTATION_LIMITS.outputBytes) fail()
  return text
}
function mathNode(
  value: unknown,
  budget: Budget,
  depth: number,
  fail: () => never,
): DocumentMathNode {
  count(budget, depth, fail)
  const v = record(value, ['tag', 'text', 'children', 'attributes'], fail)
  const tag = choice(v.tag, mathTags, fail)
  const attrs: Record<string, unknown> = {}
  if (v.attributes !== undefined) {
    const allowed =
      tag === 'math'
        ? ['display']
        : tag === 'mstyle'
          ? ['scriptLevel', 'displayStyle', 'mathvariant']
          : tag === 'mtable'
            ? ['rowSpacingEm', 'columnSpacingEm', 'columnAlign']
            : tag === 'mspace'
              ? ['widthEm']
              : tag === 'mo'
                ? ['stretchy', 'fence', 'separator', 'lspaceEm', 'rspaceEm']
                : tag === 'mover' || tag === 'munder'
                  ? ['accent']
                  : tag === 'mi' || tag === 'mn' || tag === 'mtext'
                    ? ['mathvariant']
                    : []
    const a = record(v.attributes, allowed, fail)
    for (const [key, val] of Object.entries(a)) {
      if (['stretchy', 'fence', 'separator', 'accent', 'displayStyle'].includes(key))
        attrs[key] = boolean(val, fail)
      else if (key === 'display') attrs[key] = choice(val, ['inline', 'block'], fail)
      else if (key === 'mathvariant')
        attrs[key] = choice(
          val,
          [
            'normal',
            'bold',
            'italic',
            'bold-italic',
            'double-struck',
            'script',
            'fraktur',
            'monospace',
          ],
          fail,
        )
      else if (key === 'scriptLevel') attrs[key] = integer(val, 0, 4, fail)
      else if (key === 'columnAlign')
        attrs[key] = array(val, 32, (x) => choice(x, ['left', 'center', 'right'], fail), fail)
      else if (key === 'rowSpacingEm' || key === 'columnSpacingEm')
        attrs[key] = array(val, 32, (x) => number(x, 0, 20, fail), fail)
      else attrs[key] = number(val, key === 'widthEm' ? 0 : -20, 20, fail)
    }
  }
  const text = v.text === undefined ? undefined : boundedText(v.text, budget, fail)
  const children =
    v.children === undefined
      ? undefined
      : array(v.children, 4096, (x) => mathNode(x, budget, depth + 1, fail), fail)
  if (text !== undefined && !['mi', 'mn', 'mo', 'mtext'].includes(tag)) fail()
  if (text !== undefined && children?.length) fail()
  const arity: Record<string, number> = {
    mfrac: 2,
    mroot: 2,
    msup: 2,
    msub: 2,
    msubsup: 3,
    mover: 2,
    munder: 2,
    munderover: 3,
  }
  if (arity[tag] !== undefined && children?.length !== arity[tag]) fail()
  if (tag === 'mtable' && children?.some((c) => c.tag !== 'mtr')) fail()
  if (tag === 'mtr' && children?.some((c) => c.tag !== 'mtd')) fail()
  return Object.freeze({
    tag,
    ...(text === undefined ? {} : { text }),
    ...(children ? { children } : {}),
    ...(v.attributes === undefined ? {} : { attributes: Object.freeze(attrs) }),
  }) as DocumentMathNode
}
function primitive(
  value: unknown,
  budget: Budget,
  depth: number,
  fail: () => never,
): DocumentVectorPrimitive {
  count(budget, depth, fail)
  const raw = record(
    value,
    [
      'type',
      'x',
      'y',
      'width',
      'height',
      'radius',
      'cx',
      'cy',
      'rx',
      'ry',
      'x1',
      'y1',
      'x2',
      'y2',
      'points',
      'stroke',
      'fill',
      'strokeWidth',
      'text',
      'tone',
      'fontSize',
      'anchor',
    ],
    fail,
  )
  const type = choice(raw.type, ['rect', 'ellipse', 'line', 'polyline', 'polygon', 'text'], fail)
  const keys: Record<string, string[]> = {
    rect: ['x', 'y', 'width', 'height', 'radius'],
    ellipse: ['cx', 'cy', 'rx', 'ry'],
    line: ['x1', 'y1', 'x2', 'y2'],
    polyline: ['points'],
    polygon: ['points'],
    text: ['x', 'y', 'text', 'tone', 'fontSize', 'anchor'],
  }
  const v = record(
    value,
    ['type', ...keys[type]!, ...(type === 'text' ? [] : ['stroke', 'fill', 'strokeWidth'])],
    fail,
  )
  const out: Record<string, unknown> = { type }
  for (const key of keys[type]!) {
    if (v[key] === undefined && ['radius', 'tone', 'fontSize', 'anchor'].includes(key)) continue
    if (key === 'points')
      out[key] = array(
        v[key],
        1024,
        (p) => {
          count(budget, depth + 1, fail)
          const r = record(p, ['x', 'y'], fail)
          return Object.freeze({
            x: number(r.x, -8192, 8192, fail),
            y: number(r.y, -8192, 8192, fail),
          })
        },
        fail,
      )
    else if (key === 'text') out[key] = boundedText(v[key], budget, fail, 4096)
    else if (key === 'tone') out[key] = choice(v[key], tones, fail)
    else if (key === 'anchor') out[key] = choice(v[key], ['start', 'middle', 'end'], fail)
    else
      out[key] = number(
        v[key],
        key === 'fontSize'
          ? 8
          : ['width', 'height', 'radius', 'rx', 'ry'].includes(key)
            ? 0
            : -8192,
        key === 'fontSize' ? 72 : 8192,
        fail,
      )
  }
  if (v.stroke !== undefined) out.stroke = choice(v.stroke, tones, fail)
  if (v.fill !== undefined) out.fill = choice(v.fill, [...tones, 'none'], fail)
  if (v.strokeWidth !== undefined) out.strokeWidth = number(v.strokeWidth, 0, 32, fail)
  return Object.freeze(out) as unknown as DocumentVectorPrimitive
}
function node(
  value: unknown,
  budget: Budget,
  depth: number,
  fail: () => never,
  request?: DocumentPresentationRequest,
): DocumentPresentationNode {
  // Inspect the discriminator without invoking producer getters. The SVG codec
  // independently checks the complete closed object and shares this result budget.
  if (
    value &&
    typeof value === 'object' &&
    Object.getOwnPropertyDescriptor(value, 'type')?.value === 'svg-image'
  ) {
    try {
      return copyDocumentSvgImage(value, budget, depth)
    } catch {
      return fail()
    }
  }
  count(budget, depth, fail)
  const v = record(
    value,
    ['type', 'text', 'children', 'label', 'target', 'tree', 'width', 'height'],
    fail,
  )
  const type = choice(
    v.type,
    ['text', 'group', 'emphasis', 'code', 'sup', 'sub', 'reference', 'math', 'vector'],
    fail,
  )
  if (type === 'text') {
    record(v, ['type', 'text'], fail)
    return Object.freeze({ type, text: boundedText(v.text, budget, fail) })
  }
  if (type === 'reference') {
    record(v, ['type', 'label', 'target'], fail)
    const t = record(v.target, ['documentId', 'version', 'from', 'to'], fail)
    const from = integer(t.from, 0, Number.MAX_SAFE_INTEGER, fail)
    const target = Object.freeze({
      documentId: string(t.documentId, 512, fail),
      version: integer(t.version, 0, Number.MAX_SAFE_INTEGER, fail),
      from,
      to: integer(t.to, from, Number.MAX_SAFE_INTEGER, fail),
    })
    if (request && (target.documentId !== request.documentId || target.version !== request.version))
      fail()
    return Object.freeze({ type, label: boundedText(v.label, budget, fail, 4096), target })
  }
  if (type === 'math') {
    record(v, ['type', 'tree'], fail)
    const tree = mathNode(v.tree, budget, depth + 1, fail)
    if (tree.tag !== 'math') fail()
    return Object.freeze({ type, tree })
  }
  if (type === 'vector') {
    record(v, ['type', 'width', 'height', 'children'], fail)
    return Object.freeze({
      type,
      width: number(v.width, 1, 8192, fail),
      height: number(v.height, 1, 8192, fail),
      children: array(v.children, 4096, (p) => primitive(p, budget, depth + 1, fail), fail),
    })
  }
  record(v, ['type', 'children'], fail)
  return Object.freeze({
    type,
    children: array(v.children, 4096, (c) => node(c, budget, depth + 1, fail, request), fail),
  })
}
function outputSize(value: unknown, fail: () => never): void {
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    DOCUMENT_PRESENTATION_LIMITS.outputBytes
  )
    fail()
}
export function copyDocumentPresentationNode(
  value: unknown,
  request?: DocumentPresentationRequest,
): DocumentPresentationNode {
  const fail = (): never => {
    throw new DocumentPresentationError('invalid-output')
  }
  const result = node(value, createDocumentOutputBudget(), 1, fail, request)
  outputSize(result, fail)
  canonicalSize([result], fail)
  return result
}
export function copyDocumentPresentationResult(
  value: unknown,
  request: DocumentPresentationRequest,
  declaration?: DocumentRendererDeclaration | readonly DocumentRendererDeclaration[],
): DocumentPresentationResult {
  const fail = (): never => {
    throw new DocumentPresentationError('invalid-output')
  }
  const declarations =
    declaration === undefined ? undefined : 'contexts' in declaration ? [declaration] : declaration
  const v = record(value, ['fragments', 'complete'], fail),
    budget = createDocumentOutputBudget()
  let end = request.from
  const fragments = array(
    v.fragments,
    128,
    (item) => {
      const f = record(
        item,
        ['from', 'to', 'layout', 'content', 'accessibleText', 'status', 'message'],
        fail,
      )
      const r = range({ from: f.from, to: f.to }, request.from, request.to, fail)
      if (!request.contextKnown || r.from === r.to || r.from < end) fail()
      end = r.to
      const overlaps = (a: DocumentPresentationRange) => r.from < a.to && r.to > a.from
      const fence = request.blocks.find(
        (b) =>
          b.kind === 'fence' &&
          b.complete &&
          r.from === b.from &&
          r.to === b.to &&
          declarations?.some(
            (d) =>
              d.contexts.includes('fence') &&
              d.fenceLanguages?.includes((b.info ?? '').trim().split(/\s+/)[0] ?? ''),
          ),
      )
      if (!fence) {
        if (declarations && !declarations.some((d) => d.contexts.includes('text'))) fail()
        if (
          request.protectedRanges.some(overlaps) ||
          request.blocks.some((b) => b.kind !== 'text' && overlaps(b))
        )
          fail()
      }
      const layout = choice(f.layout, ['inline', 'block'], fail)
      if (fence && layout !== 'block') fail()
      return Object.freeze({
        ...r,
        layout,
        content: node(f.content, budget, 1, fail, request),
        accessibleText: boundedText(f.accessibleText, budget, fail, 8192),
        ...(f.status === undefined ? {} : { status: choice(f.status, ['ready', 'error'], fail) }),
        ...(f.message === undefined ? {} : { message: boundedText(f.message, budget, fail, 1000) }),
      })
    },
    fail,
  )
  const result = Object.freeze({ fragments, complete: boolean(v.complete, fail) })
  outputSize(result, fail)
  canonicalSize(
    fragments.map((fragment) => fragment.content),
    fail,
  )
  return result
}

function canonicalSize(nodes: readonly DocumentPresentationNode[], fail: () => never): void {
  let bytes = 0
  const context = { image: 0 }
  for (const node of nodes) {
    bytes += new TextEncoder().encode(serializeValidatedNode(node, context)).byteLength
    if (bytes > DOCUMENT_PRESENTATION_LIMITS.outputBytes) fail()
  }
}

/** P5-safe pure serializer: no plugin HTML, CSS, URLs, script or event handlers. */
export function serializeDocumentPresentationNode(
  value: unknown,
  request?: DocumentPresentationRequest,
  options: { readonly idPrefix?: string } = {},
): string {
  const prefix = options.idPrefix ?? 'document-svg'
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(prefix))
    throw new DocumentPresentationError('invalid-input')
  const serialized = serializeValidatedNode(copyDocumentPresentationNode(value, request), {
    image: 0,
    prefix,
  })
  if (new TextEncoder().encode(serialized).byteLength > DOCUMENT_PRESENTATION_LIMITS.outputBytes)
    throw new DocumentPresentationError('invalid-output')
  return serialized
}
function serializeValidatedNode(
  validated: DocumentPresentationNode,
  context: { image: number; prefix?: string },
): string {
  const escape = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    )
  const math = (n: DocumentMathNode): string => {
    const attrs = Object.entries(n.attributes ?? {})
      .map(([k, v]) => {
        const names: Record<string, string> = {
          scriptLevel: 'scriptlevel',
          displayStyle: 'displaystyle',
          rowSpacingEm: 'rowspacing',
          columnSpacingEm: 'columnspacing',
          columnAlign: 'columnalign',
          widthEm: 'width',
          lspaceEm: 'lspace',
          rspaceEm: 'rspace',
        }
        const formatted = Array.isArray(v)
          ? v.map((x) => (typeof x === 'number' ? `${x}em` : x)).join(' ')
          : k.endsWith('Em')
            ? `${v}em`
            : String(v)
        return ` ${names[k] ?? k}="${escape(formatted)}"`
      })
      .join('')
    return `<${n.tag}${n.tag === 'math' ? ' xmlns="http://www.w3.org/1998/Math/MathML"' : ''}${attrs}>${escape(n.text ?? '')}${(n.children ?? []).map(math).join('')}</${n.tag}>`
  }
  const vector = (p: DocumentVectorPrimitive): string => {
    const attrs: string[] = []
    let text = ''
    for (const [key, value] of Object.entries(p)) {
      if (key === 'type') continue
      if (key === 'text') {
        text = escape(String(value))
        continue
      }
      if (key === 'tone') {
        attrs.push(`fill="currentColor"`)
        continue
      }
      if (key === 'fill' || key === 'stroke') {
        attrs.push(`${key}="${value === 'none' ? 'none' : 'currentColor'}"`)
        continue
      }
      if (key === 'radius') {
        attrs.push(`rx="${value}"`)
        continue
      }
      if (key === 'points') {
        attrs.push(
          `points="${(value as readonly { x: number; y: number }[]).map((p) => `${p.x},${p.y}`).join(' ')}"`,
        )
        continue
      }
      const name =
        (
          { strokeWidth: 'stroke-width', fontSize: 'font-size', anchor: 'text-anchor' } as Record<
            string,
            string
          >
        )[key] ?? key
      attrs.push(`${name}="${escape(String(value))}"`)
    }
    return `<${p.type} ${attrs.join(' ')}>${text}</${p.type}>`
  }
  const render = (n: DocumentPresentationNode): string => {
    if (n.type === 'svg-image')
      return serializeDocumentSvgImage(n, {
        idPrefix: `${context.prefix ?? 'document-svg'}-${context.image++}`,
      })
    if (n.type === 'text') return escape(n.text)
    if (n.type === 'math') return math(n.tree)
    if (n.type === 'vector')
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n.width} ${n.height}" width="${n.width}" height="${n.height}">${n.children.map(vector).join('')}</svg>`
    if (n.type === 'reference')
      return `<span data-source-from="${n.target.from}" data-source-to="${n.target.to}">${escape(n.label)}</span>`
    const tag = n.type === 'group' ? 'span' : n.type === 'emphasis' ? 'em' : n.type
    return `<${tag}>${n.children.map(render).join('')}</${tag}>`
  }
  return render(validated)
}

/** Host-only aggregate validation. Declarations must come from active registry records. */
export function copyDocumentPresentationAggregate(
  value: unknown,
  request: DocumentPresentationRequest,
  declarations: readonly DocumentRendererDeclaration[],
): DocumentPresentationResult {
  return copyDocumentPresentationResult(value, request, declarations)
}

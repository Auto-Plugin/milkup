import { validateGeometryCost, documentSvgMarkerInstances } from './document-svg-image-geometry'
import type {
  DocumentSvgImage as SvgImage,
  DocumentSvgNode as SvgNode,
  DocumentSvgDefinition as SvgDefinition,
  DocumentSvgStyle as SvgStyle,
  DocumentSvgLength as Length,
  DocumentSvgRgba as Rgba,
  DocumentSvgTransform as Transform,
  DocumentSvgPaint as Paint,
  DocumentSvgFilterValue as FilterValue,
  DocumentSvgPathCommand as PathCommand,
  DocumentSvgTextChild as TextChild,
  DocumentSvgText as SvgText,
  DocumentSvgTspan as SvgTspan,
  DocumentSvgTextBox as SvgTextBox,
} from './document-svg-image'
export interface DocumentOutputBudget {
  nodes: number
  text: number
  expanded: number
  work: number
  canonicalBytes: number
}
type Budget = DocumentOutputBudget
type Parser<T> = (value: unknown, budget: Budget, depth: number) => T
type ParseMap = Record<string, Parser<unknown>>
type Parsed<M extends ParseMap> = { [K in keyof M]: ReturnType<M[K]> }
type Tree = SvgNode | SvgDefinition | TextChild
export type SvgRecord = {
  [K in Tree extends infer U ? (U extends Tree ? keyof U : never) : never]?: Tree extends infer U
    ? U extends Tree
      ? K extends keyof U
        ? U[K]
        : never
      : never
    : never
}

export const LIMITS = Object.freeze({
  bytes: 262144,
  nodes: 4096,
  depth: 64,
  images: 128,
  coordinate: 8192,
  surfacePixels: 16777216,
  filterWork: 268435456,
  blur: 32,
})
class SvgProfileError extends Error {
  constructor(
    readonly code: string,
    reason: string,
  ) {
    super(reason)
    this.name = 'SvgProfileError'
    this.code = code
  }
}
function fail(reason: string, code = 'invalid-output'): never {
  throw new SvgProfileError(code, reason)
}
const coord = (v: unknown) => finite(v, -8192, 8192)
function finite(v: unknown, min = -8192, max = 8192): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail('number domain')
  return Object.is(v, -0) ? 0 : (v as number)
}
function choice<const T extends string | number>(values: readonly T[]): (value: unknown) => T {
  return (v) => {
    if (!values.includes(v as T)) fail('enum')
    return v as T
  }
}
const integer = (v: unknown, min: number, max: number): number => {
  const n = finite(v, min, max)
  if (!Number.isSafeInteger(n)) fail('integer')
  return n
}
const fonts = [
  'sans',
  'arial-sans',
  'open-sans-sans',
  'trebuchet-verdana-arial-sans',
  'serif',
  'monospace',
] as const
const fontCss = {
  sans: 'sans-serif',
  'arial-sans': 'Arial, sans-serif',
  'open-sans-sans': '"Open Sans", sans-serif',
  'trebuchet-verdana-arial-sans': '"Trebuchet MS", Verdana, Arial, sans-serif',
  serif: 'serif',
  monospace: 'monospace',
}
export function createDocumentOutputBudget(): Budget {
  return { nodes: 0, text: 0, expanded: 0, work: 0, canonicalBytes: 0 }
}
function charge(b: Budget, d: number, n = 1) {
  if (d > 64 || (b.nodes += n) > 4096) fail('node/depth budget', 'limit-exceeded')
}
function plain(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('plain object required')
  const p = Object.getPrototypeOf(v)
  if (p !== Object.prototype && p !== null) fail('prototype')
  const ds = Object.getOwnPropertyDescriptors(v)
  if (Reflect.ownKeys(ds).some((k) => typeof k !== 'string' || !('value' in ds[k as string]!)))
    fail('accessor/symbol')
  return Object.fromEntries(Object.entries(ds).map(([k, d]) => [k, d.value as unknown]))
}
function object<R extends ParseMap, O extends ParseMap>(
  v: unknown,
  required: R,
  optional: O,
  b: Budget,
  d: number,
): Parsed<R> & Partial<Parsed<O>> {
  if (d > 64) fail('depth', 'limit-exceeded')
  const p = plain(v),
    allowed = new Set([...Object.keys(required), ...Object.keys(optional)])
  for (const k of Object.keys(p))
    if (!allowed.has(k)) {
      if (/^(animation|transition)/i.test(k))
        fail('effective motion not admitted', 'unsupported-animation')
      fail('unknown field ' + k)
    }
  const out: Record<string, unknown> = {}
  for (const [k, parse] of Object.entries(required)) {
    if (!Object.hasOwn(p, k)) fail('missing ' + k)
    out[k] = parse(p[k], b, d + 1)
  }
  for (const [k, parse] of Object.entries(optional))
    if (Object.hasOwn(p, k)) out[k] = parse(p[k], b, d + 1)
  return out as Parsed<R> & Partial<Parsed<O>>
}
function array<T>(v: unknown, parse: Parser<T>, b: Budget, d: number, max = 4096): T[] {
  if (d > 64 || !Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || v.length > max)
    fail('array/depth budget', 'limit-exceeded')
  const keys = Reflect.ownKeys(v)
  if (
    keys.length !== v.length + 1 ||
    keys.some((k) => typeof k !== 'string' || (k !== 'length' && !/^(0|[1-9][0-9]*)$/.test(k)))
  )
    fail('sparse/custom array')
  const out: T[] = []
  for (let i = 0; i < v.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(v, String(i))
    if (!desc || !('value' in desc)) fail('array accessor')
    out.push(parse(desc.value as unknown, b, d + 1))
  }
  return out
}
const list =
  <T>(parse: Parser<T>, max = 4096): Parser<T[]> =>
  (v, b, d) =>
    array(v, parse, b, d, max)
function tuple<const P extends readonly Parser<unknown>[]>(
  v: unknown,
  parsers: P,
  b: Budget,
  d: number,
): { readonly [K in keyof P]: ReturnType<P[K]> } {
  const out = array(v, (x) => x, b, d, parsers.length)
  if (out.length !== parsers.length) fail('tuple arity')
  return out.map((x, i) => parsers[i]!(x, b, d + 1)) as {
    readonly [K in keyof P]: ReturnType<P[K]>
  }
}
function text(v: unknown, b: Budget): string {
  const max = 4096
  if (
    typeof v !== 'string' ||
    v.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(v)
  )
    fail('text domain')
  // Reject lone surrogates, which cannot round-trip through XML.
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = v.charCodeAt(++i)
      if (!(n >= 0xdc00 && n <= 0xdfff)) fail('unpaired surrogate')
    } else if (c >= 0xdc00 && c <= 0xdfff) fail('unpaired surrogate')
  }
  b.text += v.length
  if (b.text > 262144) fail('text budget', 'limit-exceeded')
  return v
}
const id = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(v)) fail('local ID')
  return v
}
const styleId = (v: unknown) => integer(v, 0, 4095)
const length: Parser<Length> = (v, b, d) =>
  object(v, { value: coord, unit: choice(['user', 'px', 'em', 'percent']) }, {}, b, d)
const positiveLength: Parser<Length> = (v, b, d) => {
  const x = length(v, b, d)
  finite(x.value, 0, 8192)
  return x
}
const rgba: Parser<Rgba> = (v, b, d) =>
  tuple(
    v,
    [
      (x) => finite(x, 0, 255),
      (x) => finite(x, 0, 255),
      (x) => finite(x, 0, 255),
      (x) => finite(x, 0, 1),
    ],
    b,
    d,
  )
const box: Parser<readonly [number, number, number, number]> = (v, b, d) =>
  tuple(v, [coord, coord, (x) => finite(x, 0, 8192), (x) => finite(x, 0, 8192)], b, d)
function transform(v: unknown, b: Budget, d: number): Transform {
  charge(b, d)
  const p = plain(v)
  switch (p.kind) {
    case 'matrix':
      return object(
        p,
        {
          kind: choice(['matrix']),
          values: (x, b, d) =>
            tuple(
              x,
              [
                (x) => finite(x, -64, 64),
                (x) => finite(x, -64, 64),
                (x) => finite(x, -64, 64),
                (x) => finite(x, -64, 64),
                coord,
                coord,
              ],
              b,
              d,
            ),
        },
        {},
        b,
        d,
      )
    case 'translate':
      return object(p, { kind: choice(['translate']), x: coord, y: coord }, {}, b, d)
    case 'scale':
      return object(
        p,
        { kind: choice(['scale']), x: (x) => finite(x, -64, 64), y: (x) => finite(x, -64, 64) },
        {},
        b,
        d,
      )
    case 'rotate':
      return object(
        p,
        {
          kind: choice(['rotate']),
          degrees: (x) => finite(x, -360000, 360000),
          cx: coord,
          cy: coord,
        },
        {},
        b,
        d,
      )
    case 'skewX':
    case 'skewY':
      return object(
        p,
        { kind: choice(['skewX', 'skewY']), degrees: (x) => finite(x, -80, 80) },
        {},
        b,
        d,
      )
    default:
      fail('transform kind')
  }
}
function paint(v: unknown, b: Budget, d: number): Paint {
  const p = plain(v)
  if (p.kind === 'none') return object(p, { kind: choice(['none']) }, {}, b, d)
  if (p.kind === 'color') return object(p, { kind: choice(['color']), rgba }, {}, b, d)
  return object(p, { kind: choice(['gradient']), ref: id }, {}, b, d)
}
function filter(v: unknown, b: Budget, d: number): FilterValue {
  const p = plain(v)
  if (p.kind === 'unresolved-local')
    return object(p, { kind: choice(['unresolved-local']) }, {}, b, d)
  if (p.kind === 'none') return object(p, { kind: choice(['none']) }, {}, b, d)
  if (p.kind === 'definition') return object(p, { kind: choice(['definition']), ref: id }, {}, b, d)
  return object(
    p,
    {
      kind: choice(['cssDropShadow']),
      shadows: list((v, b, d) => {
        charge(b, d)
        return object(
          v,
          { dx: coord, dy: coord, blur: (x) => finite(x, 0, 32), color: rgba },
          {},
          b,
          d,
        )
      }, 4),
    },
    {},
    b,
    d,
  )
}
const styleParsers = {
  shapeRendering: choice(['auto', 'optimizeSpeed', 'crispEdges', 'geometricPrecision']),
  fill: paint,
  stroke: paint,
  fillOpacity: (x) => finite(x, 0, 1),
  strokeOpacity: (x) => finite(x, 0, 1),
  opacity: (x) => finite(x, 0, 1),
  fillRule: choice(['nonzero', 'evenodd']),
  clipRule: choice(['nonzero', 'evenodd']),
  strokeWidth: positiveLength,
  dashArray: list((v, b, d) => {
    charge(b, d)
    return positiveLength(v, b, d)
  }, 4096),
  dashOffset: length,
  lineCap: choice(['butt', 'round', 'square']),
  lineJoin: choice(['miter', 'round', 'bevel']),
  miterLimit: (x) => finite(x, 1, 64),
  display: choice(['inline', 'none']),
  visibility: choice(['visible', 'hidden', 'collapse']),
  overflow: choice(['visible', 'hidden']),
  mixBlendMode: choice(['normal', 'multiply']),
  isolation: choice(['auto', 'isolate']),
  filter,
  clipPath: id,
  colorInterpolation: choice(['sRGB', 'linearRGB']),
  colorInterpolationFilters: choice(['sRGB', 'linearRGB']),
  fontId: choice(fonts),
  fontSize: positiveLength,
  fontWeight: choice([100, 200, 300, 400, 500, 600, 700, 800, 900]),
  fontStyle: choice(['normal', 'italic', 'oblique']),
  letterSpacing: length,
  wordSpacing: length,
  textAnchor: choice(['start', 'middle', 'end']),
  dominantBaseline: choice([
    'auto',
    'alphabetic',
    'central',
    'middle',
    'hanging',
    'text-before-edge',
    'text-after-edge',
  ]),
  alignmentBaseline: choice([
    'auto',
    'baseline',
    'alphabetic',
    'central',
    'middle',
    'hanging',
    'before-edge',
    'after-edge',
  ]),
  decoration: choice(['none', 'underline', 'overline', 'line-through']),
  whiteSpace: choice(['normal', 'pre', 'pre-wrap', 'nowrap']),
  textTransform: choice(['none', 'uppercase', 'lowercase', 'capitalize']),
} satisfies ParseMap
const parseStyle: Parser<SvgStyle> = (v, b, d) => {
  charge(b, d)
  return object(v, {}, styleParsers, b, d)
}
const common = {
  style: styleId,
  transforms: list(transform, 64),
  transformOrigin: (v, b, d) => tuple(v, [length, length], b, d),
  transformBox: choice(['fill-box', 'stroke-box', 'view-box']),
  title: text,
  description: text,
} satisfies ParseMap
const marked = { ...common, markerStart: id, markerMid: id, markerEnd: id }
const dimensions = {
  x: coord,
  y: coord,
  width: (x) => finite(x, 0, 8192),
  height: (x: unknown) => finite(x, 0, 8192),
} satisfies ParseMap
const textFields = {
  x: list(length, 4096),
  y: list(length, 4096),
  dx: list(length, 4096),
  dy: list(length, 4096),
}
function pathCommand(v: unknown, b: Budget, d: number): PathCommand {
  charge(b, d)
  const a = array(v, (x) => x, b, d, 8),
    op = a[0]
  const arities: Readonly<Record<string, number>> = {
    M: 2,
    L: 2,
    T: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    A: 7,
    Z: 0,
  }
  const n = arities[typeof op === 'string' ? op.toUpperCase() : '']
  if (n === undefined || typeof op !== 'string' || op.length !== 1 || a.length !== n + 1)
    fail('path command/arity')
  const out = [op, ...a.slice(1).map(coord)]
  if (op.toUpperCase() === 'A') {
    finite(out[1], 0, 8192)
    finite(out[2], 0, 8192)
    choice([0, 1])(out[4])
    choice([0, 1])(out[5])
  }
  return out as unknown as PathCommand
}
function pathCommands(v: unknown, b: Budget, d: number): readonly PathCommand[] {
  const a = array(v, pathCommand, b, d)
  if (a.length && a[0]![0].toUpperCase() !== 'M') fail('path must begin with moveto')
  let open = false
  for (const c of a) {
    const k = c[0].toUpperCase()
    if (k === 'M') open = true
    else if (!open) fail('path requires subpath')
  }
  return a
}
function textChild(v: unknown, b: Budget, d: number): TextChild {
  const p = plain(v)
  if (p.kind === 'textRun') {
    charge(b, d)
    return object(p, { kind: choice(['textRun']), text }, {}, b, d)
  }
  return textNode(p, b, d, 'tspan') as SvgTspan
}
function textNode(
  v: unknown,
  b: Budget,
  d: number,
  kind: 'text' | 'tspan' = 'text',
): SvgText | SvgTspan {
  charge(b, d)
  return object(
    v,
    { kind: choice([kind]), children: list(textChild) },
    { ...common, ...textFields, xmlSpace: choice(['default', 'preserve']) },
    b,
    d,
  )
}
function textBox(v: unknown, b: Budget, d: number): SvgTextBox {
  charge(b, d)
  return object(
    v,
    {
      kind: choice(['textBox']),
      box,
      text,
      color: rgba,
      fontId: choice(fonts),
      fontSizePx: (x) => finite(x, 1, 512),
      fontWeight: choice([100, 200, 300, 400, 500, 600, 700, 800, 900]),
      fontStyle: choice(['normal', 'italic', 'oblique']),
      lineHeight: (v, b, d) =>
        v === 'normal' ? v : object(v, { px: (x) => finite(x, 0, 1024) }, {}, b, d),
      hAlign: choice(['start', 'center', 'end']),
      vAlign: choice(['top', 'middle', 'bottom']),
      whiteSpace: choice(['normal', 'pre', 'pre-wrap', 'nowrap']),
      overflowWrap: choice(['normal', 'break-word']),
      wordBreak: choice(['normal', 'break-all', 'keep-all']),
    },
    {
      ...common,
      background: rgba,
      outerBoxSizing: choice(['content-box', 'border-box']),
      innerBoxSizing: choice(['content-box', 'border-box']),
      textTransform: styleParsers.textTransform,
      letterSpacing: length,
      wordSpacing: length,
      decoration: styleParsers.decoration,
    },
    b,
    d,
  )
}
function node(v: unknown, b: Budget, d: number): SvgNode {
  const p = plain(v)
  if (p.kind === 'text') return textNode(p, b, d) as SvgText
  if (p.kind === 'textBox') return textBox(p, b, d)
  charge(b, d)
  switch (p.kind) {
    case 'group':
      return object(p, { kind: choice(['group']), children: list(node) }, common, b, d)
    case 'rect':
      return object(
        p,
        { kind: choice(['rect']), ...dimensions },
        { ...common, rx: (x) => finite(x, 0, 8192), ry: (x) => finite(x, 0, 8192) },
        b,
        d,
      )
    case 'circle':
      return object(
        p,
        { kind: choice(['circle']), cx: coord, cy: coord, r: (x) => finite(x, 0, 8192) },
        common,
        b,
        d,
      )
    case 'ellipse':
      return object(
        p,
        {
          kind: choice(['ellipse']),
          cx: coord,
          cy: coord,
          rx: (x) => finite(x, 0, 8192),
          ry: (x) => finite(x, 0, 8192),
        },
        common,
        b,
        d,
      )
    case 'line':
      return object(
        p,
        { kind: choice(['line']), x1: coord, y1: coord, x2: coord, y2: coord },
        marked,
        b,
        d,
      )
    case 'path':
      return object(p, { kind: choice(['path']), commands: pathCommands }, marked, b, d)
    case 'polygon':
    case 'polyline':
      return object(
        p,
        {
          kind: choice(['polygon', 'polyline']),
          points: list((v, b, d) => {
            charge(b, d)
            return tuple(v, [coord, coord], b, d)
          }),
        },
        marked,
        b,
        d,
      )
    case 'use':
      return object(p, { kind: choice(['use']), ref: id }, { ...common, ...dimensions }, b, d)
    case 'textAlternative':
      return object(
        p,
        {
          kind: choice(['textAlternative']),
          primary: textBox,
          fallback: (v, b, d) => textNode(v, b, d) as SvgText,
        },
        common,
        b,
        d,
      )
    default:
      fail('unsupported node kind', 'unsupported-feature')
  }
}
const units = choice(['userSpaceOnUse', 'objectBoundingBox'])
function definition(v: unknown, b: Budget, d: number): SvgDefinition {
  charge(b, d)
  const p = plain(v),
    base = { id }
  switch (p.kind) {
    case 'clipPath':
      return object(
        p,
        { ...base, kind: choice(['clipPath']), units, children: list(node) },
        { transforms: list(transform, 64) },
        b,
        d,
      )
    case 'marker':
      return object(
        p,
        {
          ...base,
          kind: choice(['marker']),
          width: (x) => finite(x, 0, 8192),
          height: (x) => finite(x, 0, 8192),
          refX: length,
          refY: length,
          units: choice(['strokeWidth', 'userSpaceOnUse']),
          orient: (v, b, d) =>
            typeof v === 'string'
              ? choice(['auto', 'auto-start-reverse'])(v)
              : object(v, { degrees: (x) => finite(x, -360000, 360000) }, {}, b, d),
          children: list(node),
        },
        { viewBox: box, style: styleId },
        b,
        d,
      )
    case 'linearGradient':
      return object(
        p,
        {
          ...base,
          kind: choice(['linearGradient']),
          units,
          x1: length,
          y1: length,
          x2: length,
          y2: length,
          spread: choice(['pad', 'reflect', 'repeat']),
          stops: list((v, b, d) => {
            charge(b, d)
            return object(v, { offset: (x) => finite(x, 0, 1), color: rgba }, {}, b, d)
          }, 4096),
        },
        { transforms: list(transform, 64) },
        b,
        d,
      )
    case 'dropShadowFilter':
      return object(
        p,
        {
          ...base,
          kind: choice(['dropShadowFilter']),
          units,
          primitiveUnits: units,
          region: (v, b, d) => tuple(v, [length, length, positiveLength, positiveLength], b, d),
          colorInterpolation: choice(['sRGB', 'linearRGB']),
          dx: coord,
          dy: coord,
          stdDeviation: (v, b, d) =>
            tuple(v, [(x) => finite(x, 0, 32), (x) => finite(x, 0, 32)], b, d),
          color: rgba,
        },
        {},
        b,
        d,
      )
    case 'symbol':
      return object(
        p,
        { ...base, kind: choice(['symbol']), children: list(node) },
        {
          viewBox: box,
          width: (x) => finite(x, 0, 8192),
          height: (x) => finite(x, 0, 8192),
          style: styleId,
        },
        b,
        d,
      )
    default:
      fail('definition kind', 'unsupported-feature')
  }
}
function image(v: unknown, b: Budget, d: number): SvgImage {
  charge(b, d)
  charge(b, d + 2, 2)
  const p = object(
    v,
    {
      type: choice(['svg-image']),
      profile: choice(['bounded-svg-v1']),
      width: (x) => finite(x, 1, 8192),
      height: (x) => finite(x, 1, 8192),
      rasterBounds: box,
      viewBox: box,
      aspect: (v, b, d) =>
        object(
          v,
          {
            align: choice([
              'none',
              'xMinYMin',
              'xMidYMin',
              'xMaxYMin',
              'xMinYMid',
              'xMidYMid',
              'xMaxYMid',
              'xMinYMax',
              'xMidYMax',
              'xMaxYMax',
            ]),
            fit: choice(['meet', 'slice']),
          },
          {},
          b,
          d,
        ),
      styles: list(parseStyle),
      definitions: list(definition),
      children: list(node),
      motion: (v) => {
        if (v !== 'static') fail('effective animation not supported', 'unsupported-animation')
        return 'static' as const
      },
    },
    { title: text, description: text, rootStyle: styleId },
    b,
    d,
  )
  if (p.viewBox[2] <= 0 || p.viewBox[3] <= 0 || p.width * p.height > LIMITS.surfacePixels)
    fail('surface', 'limit-exceeded')
  const [rasterX, rasterY, rasterWidth, rasterHeight] = p.rasterBounds
  if (
    rasterWidth <= 0 ||
    rasterHeight <= 0 ||
    rasterX > 0 ||
    rasterY > 0 ||
    rasterX + rasterWidth < p.width ||
    rasterY + rasterHeight < p.height
  )
    fail('raster region must contain the root viewport')
  const pixelWidth = Math.ceil(rasterX + rasterWidth) - Math.floor(rasterX)
  const pixelHeight = Math.ceil(rasterY + rasterHeight) - Math.floor(rasterY)
  if (
    pixelWidth > LIMITS.coordinate ||
    pixelHeight > LIMITS.coordinate ||
    pixelWidth * pixelHeight > LIMITS.surfacePixels
  )
    fail('raster surface', 'limit-exceeded')
  // Charge canonical elements absent from transport AST exactly once in the
  // stored tree. Expansion below reuses the same fixed-element cost per instance.
  function chargeGenerated(n: SvgRecord, depth: number): void {
    const generated = fixedElements(n)
    if (generated.count) charge(b, depth + generated.height - 1, generated.count)
    for (const child of childNodes(n)) chargeGenerated(child, depth + 1)
  }
  chargeGenerated(p, d + 1)
  for (const definition of p.definitions) chargeGenerated(definition, d + 3)
  validateReferences(p, b, d + 2)
  if (b.nodes > 4096) fail('aggregate expanded nodes', 'limit-exceeded')
  validateGeometryCost(p, b, LIMITS, fail)
  return p
}
function childNodes(n: SvgRecord): readonly Tree[] {
  return n.children ?? (n.kind === 'textAlternative' ? [n.primary!, n.fallback!] : [])
}
type PaintContext = Pick<SvgStyle, 'fill' | 'stroke'>
function effectivePaint(n: SvgRecord, img: SvgImage, inherited: PaintContext): PaintContext {
  const own = n.style === undefined ? {} : img.styles[n.style]
  if (!own) fail('style index')
  return {
    ...inherited,
    ...(own.fill === undefined ? {} : { fill: own.fill }),
    ...(own.stroke === undefined ? {} : { stroke: own.stroke }),
  }
}
function refsFor(n: SvgRecord, img: SvgImage, effective: PaintContext): [string, string, number][] {
  const refs: [string, string, number][] = []
  if (n.kind === 'use') refs.push([n.ref!, 'symbol', 1])
  const markers = documentSvgMarkerInstances({
    kind: n.kind ?? '',
    ...(n.commands ? { commands: n.commands } : {}),
    ...(n.points ? { points: n.points } : {}),
  })
  for (const k of ['markerStart', 'markerEnd', 'markerMid'] as const)
    if (n[k]) refs.push([n[k]!, 'marker', markers[k]])
  if (n.style !== undefined) {
    if (n.style >= img.styles.length) fail('style index')
    const own = img.styles[n.style]!
    if (own.clipPath) refs.push([own.clipPath, 'clipPath', 1])
    if (own.filter?.kind === 'definition') refs.push([own.filter.ref, 'dropShadowFilter', 1])
  }
  // Containers propagate paint; each drawable instance consumes its effective
  // gradient, including through symbols/markers. Filters and clips do not inherit.
  if (
    ['rect', 'circle', 'ellipse', 'line', 'path', 'polyline', 'polygon', 'textRun'].includes(
      n.kind ?? '',
    )
  ) {
    for (const key of ['fill', 'stroke'] as const) {
      if (key === 'fill' && n.kind === 'line') continue
      const paint = effective[key]
      if (paint?.kind === 'gradient') refs.push([paint.ref, 'linearGradient', 1])
    }
  }
  return refs
}
function styleRefs(s: SvgStyle): [string, string, number][] {
  const r: [string, string, number][] = []
  for (const k of ['fill', 'stroke'] as const) {
    const paint = s[k]
    if (paint?.kind === 'gradient') r.push([paint.ref, 'linearGradient', 1])
  }
  if (s.clipPath) r.push([s.clipPath, 'clipPath', 1])
  if (s.filter?.kind === 'definition') r.push([s.filter.ref, 'dropShadowFilter', 1])
  return r
}
function fixedElements(n: SvgRecord): { count: number; height: number } {
  const labels = Number(n.title !== undefined) + Number(n.description !== undefined)
  if (n.kind === 'textBox') return { count: labels + 2, height: 3 }
  if (n.kind === 'dropShadowFilter') return { count: labels + 1, height: 2 }
  return { count: labels, height: labels ? 2 : 1 }
}
function baseCost(n: SvgRecord): number {
  return (
    1 +
    fixedElements(n).count +
    (n.commands?.length ?? 0) +
    (n.points?.length ?? 0) +
    (n.transforms?.length ?? 0) +
    (n.stops?.length ?? 0)
  )
}
function validateReferences(img: SvgImage, b: Budget, startingDepth: number): void {
  const beforeExpanded = b.expanded
  function structuralCost(n: SvgRecord): number {
    return baseCost(n) + childNodes(n).reduce((sum, child) => sum + structuralCost(child), 0)
  }
  const structural =
    img.definitions.reduce((sum, n) => sum + structuralCost(n), 0) +
    img.children.reduce((sum, n) => sum + structuralCost(n), 0)
  const defs = new Map<string, SvgDefinition>()
  for (const d of img.definitions) {
    if (defs.has(d.id)) fail('duplicate definition')
    defs.set(d.id, d)
  }
  const active = new Set<string>(),
    memo = new Map<string, { count: number; height: number }>()
  const check = (id: string, kind: string): SvgDefinition => {
    const d = defs.get(id)
    if (!d || d.kind !== kind) fail('missing/wrong reference')
    return d
  }
  for (const s of img.styles) for (const [id, kind] of styleRefs(s)) check(id, kind)
  if (img.rootStyle !== undefined && img.rootStyle >= img.styles.length) fail('root style index')
  function cost(
    n: SvgRecord,
    depth: number,
    inherited: PaintContext,
  ): { count: number; height: number } {
    const effective = effectivePaint(n, img, inherited)
    if (depth > 64) fail('expanded depth', 'limit-exceeded')
    let count = baseCost(n),
      height = fixedElements(n).height
    for (const c of childNodes(n)) {
      const x = cost(c, depth + 1, effective)
      count += x.count
      if (count > 4096) fail('expanded cost', 'limit-exceeded')
      height = Math.max(height, 1 + x.height)
    }
    for (const [id, kind, times] of refsFor(n, img, effective)) {
      check(id, kind)
      // Markers inherit the styled root/defs ancestry, not their referring shape.
      // Symbol instances continue inheriting paint through their use element.
      const x = defCost(id, depth + 1, kind === 'marker' ? rootPaint : effective)
      count += x.count * times
      if (count > 4096) fail('expanded cost', 'limit-exceeded')
      height = Math.max(height, 1 + x.height)
    }
    if (count > 4096 || depth + height - 1 > 64) fail('expanded cost/depth', 'limit-exceeded')
    return { count, height }
  }
  function defCost(
    id: string,
    depth: number,
    inherited: PaintContext,
  ): { count: number; height: number } {
    const key = JSON.stringify([
      id,
      inherited.fill?.kind === 'gradient' ? inherited.fill.ref : null,
      inherited.stroke?.kind === 'gradient' ? inherited.stroke.ref : null,
    ])
    if (depth > 64) fail('reference depth', 'limit-exceeded')
    if (active.has(id)) fail('reference cycle')
    const cached = memo.get(key)
    if (cached) {
      if (depth + cached.height - 1 > 64) fail('reference depth', 'limit-exceeded')
      return cached
    }
    active.add(id)
    const c = cost(defs.get(id)!, depth, inherited)
    active.delete(id)
    memo.set(key, c)
    return c
  }
  // Count latent definitions as well as each expanded rendering instance. This is
  // deliberately conservative and bounded across all images in one result.
  const rootStyle = img.rootStyle === undefined ? {} : img.styles[img.rootStyle]!
  const rootPaint: PaintContext = {
    ...(rootStyle.fill === undefined ? {} : { fill: rootStyle.fill }),
    ...(rootStyle.stroke === undefined ? {} : { stroke: rootStyle.stroke }),
  }
  const addExpanded = (count: number) => {
    b.expanded += count
    if (b.expanded > 4096) fail('aggregate expansion', 'limit-exceeded')
  }
  for (const d of img.definitions) addExpanded(defCost(d.id, startingDepth + 1, rootPaint).count)
  for (const n of img.children) addExpanded(cost(n, startingDepth + 1, rootPaint).count)
  if (img.rootStyle !== undefined)
    for (const [id, kind] of styleRefs(img.styles[img.rootStyle]!).filter(
      ([, kind]) => kind !== 'linearGradient',
    )) {
      check(id, kind)
      addExpanded(defCost(id, startingDepth + 1, rootPaint).count)
    }
  b.nodes += Math.max(0, b.expanded - beforeExpanded - structural)
  if (b.expanded > 4096 || b.nodes > 4096) fail('aggregate expansion', 'limit-exceeded')
}

function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze)
    Object.freeze(v)
  }
  return v
}
// Check serialized transport size before constructing normalized arrays. Never
// invoke toJSON/getters; structured-clone data is the intended boundary input.
function checkInputBudget(value: unknown) {
  let bytes = 0
  const active = new Set<object>(),
    encoder = new TextEncoder()
  const add = (s: string) => {
    if (s.length > LIMITS.bytes) fail('input bytes', 'limit-exceeded')
    bytes += encoder.encode(s).byteLength
    if (bytes > LIMITS.bytes) fail('input bytes', 'limit-exceeded')
  }
  function walk(v: unknown, depth: number) {
    if (depth > 64) fail('input depth', 'limit-exceeded')
    if (v === null || typeof v === 'boolean') {
      add(String(v))
      return
    }
    if (typeof v === 'string') {
      if (v.length > LIMITS.bytes) fail('input text bytes', 'limit-exceeded')
      add(JSON.stringify(v))
      return
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail('nonfinite input')
      add(String(v))
      return
    }
    if (typeof v !== 'object' || active.has(v)) fail('non-data/cycle')
    active.add(v)
    const isArray = Array.isArray(v)
    if (isArray && Object.getPrototypeOf(v) !== Array.prototype) fail('array prototype')
    const p = isArray ? v : plain(v)
    const keys = Reflect.ownKeys(p).filter((k) => !(isArray && k === 'length'))
    if (keys.length > 4096) fail('input collection', 'limit-exceeded')
    if (isArray && (keys.length !== v.length || keys.some((k, i) => k !== String(i))))
      fail('array shape')
    add(isArray ? '[' : '{')
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!,
        desc = Object.getOwnPropertyDescriptor(p, k)
      if (typeof k !== 'string' || !desc || !('value' in desc)) fail('accessor/symbol')
      if (i) add(',')
      if (!isArray) {
        add(JSON.stringify(k))
        add(':')
      }
      walk(desc.value, depth + 1)
    }
    add(isArray ? ']' : '}')
    active.delete(v)
  }
  walk(value, 0)
}
export function copyDocumentSvgImage(value: unknown, b: Budget, depth: number): SvgImage {
  checkInputBudget(value)
  const copied = freeze(image(value, b, depth))
  const canonical = serializeDocumentSvgImage(copied)
  b.canonicalBytes += new TextEncoder().encode(canonical).byteLength
  if (b.canonicalBytes > LIMITS.bytes) fail('aggregate canonical SVG bytes', 'limit-exceeded')
  return copied
}
const escape = (v: unknown): string =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  )
const attr = (k: string, v: unknown) => (v === undefined ? '' : ' ' + k + '="' + escape(v) + '"')
const len = (l: Length) => String(l.value) + { user: '', px: 'px', em: 'em', percent: '%' }[l.unit]
const color = (c: Rgba) => 'rgba(' + c.join(',') + ')'
export function serializeDocumentSvgImage(
  img: SvgImage,
  options: { readonly idPrefix?: string } = {},
) {
  const prefix = options.idPrefix ?? 'svgprofile'
  id(prefix)
  const ids = new Map(img.definitions.map((d, i) => [d.id, prefix + '-d' + i]))
  const ref = (x: string) => ids.get(x) ?? fail('serializer missing ref')
  const paint = (s: Paint) =>
    s.kind === 'none' ? 'none' : s.kind === 'color' ? color(s.rgba) : 'url(#' + ref(s.ref) + ')'
  function transformText(t: Transform): string {
    if (t.kind === 'matrix') return 'matrix(' + t.values.join(' ') + ')'
    if (t.kind === 'translate' || t.kind === 'scale') return t.kind + '(' + t.x + ' ' + t.y + ')'
    if (t.kind === 'rotate') return 'rotate(' + t.degrees + ' ' + t.cx + ' ' + t.cy + ')'
    return t.kind + '(' + t.degrees + ')'
  }
  const filterText = (f: FilterValue) =>
    f.kind === 'unresolved-local'
      ? 'url(#' + prefix + '-unresolved-filter)'
      : f.kind === 'none'
        ? 'none'
        : f.kind === 'definition'
          ? 'url(#' + ref(f.ref) + ')'
          : f.shadows
              .map(
                (s) =>
                  'drop-shadow(' +
                  s.dx +
                  'px ' +
                  s.dy +
                  'px ' +
                  s.blur +
                  'px ' +
                  color(s.color) +
                  ')',
              )
              .join(' ')
  const styleNames: Record<string, string> = {
    shapeRendering: 'shape-rendering',
    fillOpacity: 'fill-opacity',
    strokeOpacity: 'stroke-opacity',
    fillRule: 'fill-rule',
    clipRule: 'clip-rule',
    strokeWidth: 'stroke-width',
    dashArray: 'stroke-dasharray',
    dashOffset: 'stroke-dashoffset',
    lineCap: 'stroke-linecap',
    lineJoin: 'stroke-linejoin',
    miterLimit: 'stroke-miterlimit',
    mixBlendMode: 'mix-blend-mode',
    colorInterpolation: 'color-interpolation',
    colorInterpolationFilters: 'color-interpolation-filters',
    fontId: 'font-family',
    fontSize: 'font-size',
    fontWeight: 'font-weight',
    fontStyle: 'font-style',
    letterSpacing: 'letter-spacing',
    wordSpacing: 'word-spacing',
    textAnchor: 'text-anchor',
    dominantBaseline: 'dominant-baseline',
    alignmentBaseline: 'alignment-baseline',
    decoration: 'text-decoration',
    whiteSpace: 'white-space',
    textTransform: 'text-transform',
    clipPath: 'clip-path',
  }
  function styleText(s: SvgStyle): string {
    return Object.entries(s)
      .map(([k, v]) => {
        const name = styleNames[k] ?? k
        const val =
          k === 'fill' || k === 'stroke'
            ? paint(v as Paint)
            : k === 'filter'
              ? filterText(v as FilterValue)
              : k === 'clipPath'
                ? 'url(#' + ref(v as string) + ')'
                : k === 'fontId'
                  ? fontCss[v as keyof typeof fontCss]
                  : k === 'dashArray'
                    ? (v as readonly Length[]).length
                      ? (v as readonly Length[]).map(len).join(' ')
                      : 'none'
                    : v && typeof v === 'object' && 'unit' in v
                      ? len(v as Length)
                      : String(v)
        return name + ':' + val
      })
      .join(';')
  }
  function commonAttrs(n: SvgRecord): string {
    let s = n.style === undefined ? '' : styleText(img.styles[n.style]!)
    if (n.transformOrigin)
      s += (s ? ';' : '') + 'transform-origin:' + n.transformOrigin.map(len).join(' ')
    if (n.transformBox) s += (s ? ';' : '') + 'transform-box:' + n.transformBox
    return (
      (s ? attr('style', s) : '') +
      (n.transforms?.length ? attr('transform', n.transforms.map(transformText).join(' ')) : '')
    )
  }
  const title = (n: { readonly title?: string; readonly description?: string }) =>
    (n.title === undefined ? '' : '<title>' + escape(n.title) + '</title>') +
    (n.description === undefined ? '' : '<desc>' + escape(n.description) + '</desc>')
  const bounded = (value: string): string => {
    if (new TextEncoder().encode(value).byteLength > LIMITS.bytes)
      fail('canonical SVG byte budget', 'limit-exceeded')
    return value
  }
  function joinRendered<T>(values: readonly T[], renderValue: (value: T) => string): string {
    let output = '',
      bytes = 0
    for (const value of values) {
      const part = renderValue(value)
      bytes += new TextEncoder().encode(part).byteLength
      if (bytes > LIMITS.bytes) fail('canonical SVG byte budget', 'limit-exceeded')
      output += part
    }
    return output
  }
  const tag = (name: string, a: string, body = '') =>
    bounded('<' + name + a + '>' + body + '</' + name + '>')
  function textAttrs(n: SvgText | SvgTspan): string {
    let a = commonAttrs(n)
    for (const k of ['x', 'y', 'dx', 'dy'] as const)
      if (n[k]) a += attr(k, n[k]!.map(len).join(' '))
    if (n.xmlSpace) a += attr('xml:space', n.xmlSpace)
    return a
  }
  function render(n: SvgRecord): string {
    if (n.kind === 'textRun') return escape(n.text)
    if (n.kind === 'text' || n.kind === 'tspan')
      return tag(
        n.kind,
        textAttrs(n as SvgText | SvgTspan),
        title(n) + joinRendered(n.children!, render),
      )
    const common = commonAttrs(n),
      children = joinRendered(n.children ?? [], render)
    if (n.kind === 'group') return tag('g', common, title(n) + children)
    if (n.kind === 'textAlternative')
      return tag('switch', common, title(n) + render(n.primary!) + render(n.fallback!))
    if (n.kind === 'textBox') {
      const [x, y, width, height] = n.box!
      const outer =
        'display:table;width:100%;height:100%;margin:0;padding:0;border:0;box-sizing:' +
        (n.outerBoxSizing ?? 'content-box') +
        (n.background ? ';background-color:' + color(n.background) : '')
      const inner =
        'display:table-cell;margin:0;padding:0;border:0;box-sizing:' +
        (n.innerBoxSizing ?? 'content-box') +
        ';text-align:' +
        n.hAlign +
        ';vertical-align:' +
        n.vAlign +
        ';color:' +
        color(n.color!) +
        ';font-family:' +
        fontCss[n.fontId!] +
        ';font-size:' +
        n.fontSizePx +
        'px;font-weight:' +
        n.fontWeight +
        ';font-style:' +
        n.fontStyle +
        ';line-height:' +
        (n.lineHeight === 'normal' ? 'normal' : n.lineHeight!.px + 'px') +
        ';white-space:' +
        n.whiteSpace +
        ';overflow-wrap:' +
        n.overflowWrap +
        ';word-break:' +
        n.wordBreak +
        (n.textTransform ? ';text-transform:' + n.textTransform : '') +
        (n.letterSpacing ? ';letter-spacing:' + len(n.letterSpacing) : '') +
        (n.wordSpacing ? ';word-spacing:' + len(n.wordSpacing) : '') +
        (n.decoration ? ';text-decoration:' + n.decoration : '')
      return tag(
        'foreignObject',
        common + attr('x', x) + attr('y', y) + attr('width', width) + attr('height', height),
        title(n) +
          tag(
            'div',
            attr('xmlns', 'http://www.w3.org/1999/xhtml') + attr('style', outer),
            tag('div', attr('style', inner), escape(n.text)),
          ),
      )
    }
    let a = common
    for (const k of [
      'x',
      'y',
      'width',
      'height',
      'cx',
      'cy',
      'r',
      'rx',
      'ry',
      'x1',
      'y1',
      'x2',
      'y2',
    ] as const)
      if (n[k] !== undefined) a += attr(k, n[k])
    if (n.commands) a += attr('d', n.commands.map((c) => c[0] + c.slice(1).join(' ')).join(' '))
    if (n.points) a += attr('points', n.points.map((p) => p.join(',')).join(' '))
    for (const k of ['markerStart', 'markerMid', 'markerEnd'] as const)
      if (n[k])
        a += attr(
          { markerStart: 'marker-start', markerMid: 'marker-mid', markerEnd: 'marker-end' }[k],
          'url(#' + ref(n[k]!) + ')',
        )
    if (n.kind === 'use') a += attr('href', '#' + ref(n.ref!))
    return tag(n.kind!, a, title(n))
  }
  function def(d: SvgDefinition): string {
    let a = attr('id', ref(d.id))
    if ('style' in d && d.style !== undefined) a += attr('style', styleText(img.styles[d.style]!))
    if ('viewBox' in d && d.viewBox) a += attr('viewBox', d.viewBox.join(' '))
    if ('transforms' in d && d.transforms?.length)
      a += attr(
        d.kind === 'linearGradient' ? 'gradientTransform' : 'transform',
        d.transforms.map(transformText).join(' '),
      )
    if (d.kind === 'clipPath')
      return tag('clipPath', a + attr('clipPathUnits', d.units), joinRendered(d.children, render))
    if (d.kind === 'symbol')
      return tag(
        'symbol',
        a + attr('width', d.width) + attr('height', d.height),
        joinRendered(d.children, render),
      )
    if (d.kind === 'marker')
      return tag(
        'marker',
        a +
          attr('markerWidth', d.width) +
          attr('markerHeight', d.height) +
          attr('refX', len(d.refX)) +
          attr('refY', len(d.refY)) +
          attr('markerUnits', d.units) +
          attr('orient', typeof d.orient === 'string' ? d.orient : d.orient.degrees),
        joinRendered(d.children, render),
      )
    if (d.kind === 'linearGradient') {
      a += attr('gradientUnits', d.units) + attr('spreadMethod', d.spread)
      for (const k of ['x1', 'y1', 'x2', 'y2'] as const) a += attr(k, len(d[k]))
      return tag(
        'linearGradient',
        a,
        d.stops
          .map((s) => tag('stop', attr('offset', s.offset) + attr('stop-color', color(s.color))))
          .join(''),
      )
    }
    for (const [i, k] of ['x', 'y', 'width', 'height'].entries()) a += attr(k, len(d.region[i]!))
    return tag(
      'filter',
      a +
        attr('filterUnits', d.units) +
        attr('primitiveUnits', d.primitiveUnits) +
        attr('color-interpolation-filters', d.colorInterpolation),
      tag(
        'feDropShadow',
        attr('dx', d.dx) +
          attr('dy', d.dy) +
          attr('stdDeviation', d.stdDeviation.join(' ')) +
          attr('flood-color', color(d.color)),
      ),
    )
  }
  const svg = tag(
    'svg',
    attr('xmlns', 'http://www.w3.org/2000/svg') +
      attr('width', img.width) +
      attr('height', img.height) +
      attr('viewBox', img.viewBox.join(' ')) +
      (img.rootStyle === undefined ? '' : attr('style', styleText(img.styles[img.rootStyle]!))) +
      attr(
        'preserveAspectRatio',
        img.aspect.align + (img.aspect.align === 'none' ? '' : ' ' + img.aspect.fit),
      ),
    title(img) +
      tag('defs', '', joinRendered(img.definitions, def)) +
      joinRendered(img.children, render),
  )
  const [rasterX, rasterY, rasterWidth, rasterHeight] = img.rasterBounds
  const outerLeft = Math.floor(rasterX),
    outerTop = Math.floor(rasterY)
  const outerWidth = Math.ceil(rasterX + rasterWidth) - outerLeft,
    outerHeight = Math.ceil(rasterY + rasterHeight) - outerTop
  const wrapped = tag(
    'svg',
    attr('xmlns', 'http://www.w3.org/2000/svg') +
      attr('width', outerWidth) +
      attr('height', outerHeight) +
      attr('viewBox', `${outerLeft} ${outerTop} ${outerWidth} ${outerHeight}`) +
      attr('preserveAspectRatio', 'none'),
    svg,
  )
  // Style-table expansion and XML escaping may exceed the transport size budget.
  if (new TextEncoder().encode(wrapped).byteLength > LIMITS.bytes)
    fail('canonical SVG byte budget', 'limit-exceeded')
  return wrapped
}

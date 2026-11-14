import type {
  SdkDocumentSvgBox as DocumentSvgBox,
  SdkDocumentSvgDefinition as DocumentSvgDefinition,
  SdkDocumentSvgImage as DocumentSvgImage,
  SdkDocumentSvgLength as DocumentSvgLength,
  SdkDocumentSvgMatrix as DocumentSvgMatrix,
  SdkDocumentSvgNode as DocumentSvgNode,
  SdkDocumentSvgPathCommand as DocumentSvgPathCommand,
  SdkDocumentSvgStyle as DocumentSvgStyle,
  SdkDocumentSvgTransform as DocumentSvgTransform,
  SdkDocumentSvgTspan as DocumentSvgTspan,
} from '@milkup/plugin-sdk'
import { fail } from './svg-primitives.js'

/** Plugin-private fidelity calculation. Measurements never cross the SDK wire
 * and never exempt the returned image from the host's independent safety checks.
 * Matrix/path primitives are intentionally local; this plugin has no core import.
 */
type Bounds = readonly [left: number, top: number, right: number, bottom: number]
type MaybeBounds = Bounds | null
type Point = readonly [x: number, y: number]
type ContainerDefinition = Extract<
  DocumentSvgDefinition,
  { kind: 'symbol' | 'marker' | 'clipPath' }
>
type GeometryNode = DocumentSvgNode | ContainerDefinition | DocumentSvgTspan
type MutableStyle = { -readonly [K in keyof DocumentSvgStyle]: DocumentSvgStyle[K] }
interface StyleContext {
  readonly style: DocumentSvgStyle
  readonly own: DocumentSvgStyle
  readonly font: number
  readonly stroke: number
}
interface PaintResult {
  readonly fill: MaybeBounds
  readonly ink: MaybeBounds
}
export interface PaintMeasurements {
  /** Local user-space glyph/FO paint bounds for this exact typed object.
   * SVG text/tspan boxes include descendants; their own stroke is added below.
   * FO boxes must include actual overflowing text ink as well as its frame.
   * Missing data rejects rather than guessing metrics or trusting a root bbox.
   */
  get(node: object): DocumentSvgBox | undefined
}
export interface PaintEnvelopeOptions {
  readonly rootOverflow?: 'visible' | 'hidden'
}
const IDENTITY: DocumentSvgMatrix = [1, 0, 0, 1, 0, 0]
const MAX_DEPTH = 64
const MAX_NODES = 4096
const MAX_COORDINATE = 32768

function multiply(a: DocumentSvgMatrix, b: DocumentSvgMatrix): DocumentSvgMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}
function union(a: MaybeBounds, b: MaybeBounds): MaybeBounds {
  if (!a) return b
  if (!b) return a
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}
function pointBounds(x: number, y: number): Bounds {
  return [x, y, x, y]
}
function inflate(box: MaybeBounds, x: number, y = x): MaybeBounds {
  return box ? [box[0] - x, box[1] - y, box[2] + x, box[3] + y] : null
}
function transformBounds(box: MaybeBounds, matrix: DocumentSvgMatrix): MaybeBounds {
  if (!box) return null
  let result: MaybeBounds = null
  // Two diagonal corners do not enclose a rotated or sheared rectangle.
  for (const x of [box[0], box[2]]) {
    for (const y of [box[1], box[3]]) {
      result = union(
        result,
        pointBounds(
          matrix[0] * x + matrix[2] * y + matrix[4],
          matrix[1] * x + matrix[3] * y + matrix[5],
        ),
      )
    }
  }
  return result
}
function trig(degrees: number): Point {
  const radians = (degrees * Math.PI) / 180
  return [Math.cos(radians), Math.sin(radians)]
}
function transformMatrix(transform: DocumentSvgTransform): DocumentSvgMatrix {
  switch (transform.kind) {
    case 'matrix':
      return transform.values
    case 'translate':
      return [1, 0, 0, 1, transform.x, transform.y]
    case 'scale':
      return [transform.x, 0, 0, transform.y, 0, 0]
    case 'rotate': {
      const [cos, sin] = trig(transform.degrees)
      return multiply(
        multiply([1, 0, 0, 1, transform.cx, transform.cy], [cos, sin, -sin, cos, 0, 0]),
        [1, 0, 0, 1, -transform.cx, -transform.cy],
      )
    }
    case 'skewX':
      return [1, 0, Math.tan((transform.degrees * Math.PI) / 180), 1, 0, 0]
    case 'skewY':
      return [1, Math.tan((transform.degrees * Math.PI) / 180), 0, 1, 0, 0]
  }
}
function viewportMatrix(
  box: DocumentSvgBox,
  width: number,
  height: number,
  aspect: DocumentSvgImage['aspect'] = { align: 'xMidYMid', fit: 'meet' },
): DocumentSvgMatrix {
  const [x, y, viewWidth, viewHeight] = box
  const sx = width / viewWidth
  const sy = height / viewHeight
  if (aspect.align === 'none') return [sx, 0, 0, sy, -x * sx, -y * sy]
  const scale = aspect.fit === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy)
  const ax = aspect.align.includes('xMin') ? 0 : aspect.align.includes('xMax') ? 1 : 0.5
  const ay = aspect.align.includes('YMin') ? 0 : aspect.align.includes('YMax') ? 1 : 0.5
  return [
    scale,
    0,
    0,
    scale,
    (width - viewWidth * scale) * ax - x * scale,
    (height - viewHeight * scale) * ay - y * scale,
  ]
}

/** Correct undersized endpoint radii, then enclose the complete rotated ellipse.
 * Both possible centers are included, so neither large-arc nor sweep can escape.
 */
function arcBounds(
  x: number,
  y: number,
  rx0: number,
  ry0: number,
  degrees: number,
  endX: number,
  endY: number,
): MaybeBounds {
  if (!rx0 || !ry0 || (x === endX && y === endY))
    return union(pointBounds(x, y), pointBounds(endX, endY))
  const [cos, sin] = trig(degrees)
  const dx = (x - endX) / 2
  const dy = (y - endY) / 2
  const xp = cos * dx + sin * dy
  const yp = -sin * dx + cos * dy
  const factor = Math.max(1, Math.hypot(xp / rx0, yp / ry0))
  const rx = rx0 * factor
  const ry = ry0 * factor
  const denominator = rx * rx * yp * yp + ry * ry * xp * xp
  const numerator = Math.max(0, rx * rx * ry * ry - denominator)
  const coefficient = denominator ? Math.sqrt(numerator / denominator) : 0
  const cxp = (coefficient * rx * yp) / ry
  const cyp = (-coefficient * ry * xp) / rx
  const ux = cos * cxp - sin * cyp
  const uy = sin * cxp + cos * cyp
  const mx = (x + endX) / 2
  const my = (y + endY) / 2
  const bx = Math.hypot(rx * cos, ry * sin)
  const by = Math.hypot(rx * sin, ry * cos)
  return union(
    [mx + ux - bx, my + uy - by, mx + ux + bx, my + uy + by],
    [mx - ux - bx, my - uy - by, mx - ux + bx, my - uy + by],
  )
}

/** Control-point hulls conservatively enclose Beziers, including reflected S/T controls. */
function pathBounds(commands: readonly DocumentSvgPathCommand[]): MaybeBounds {
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let previous = ''
  let control: Point | null = null
  let result: MaybeBounds = null
  const add = (px: number, py: number): void => {
    result = union(result, pointBounds(px, py))
  }
  for (const command of commands) {
    const operation = command[0].toUpperCase()
    const relative = operation !== command[0]
    const ox = relative ? x : 0
    const oy = relative ? y : 0
    switch (command[0]) {
      case 'Z':
      case 'z':
        x = startX
        y = startY
        control = null
        break
      case 'H':
      case 'h':
        x = command[1] + ox
        control = null
        break
      case 'V':
      case 'v':
        y = command[1] + oy
        control = null
        break
      case 'M':
      case 'm':
      case 'L':
      case 'l':
        x = command[1] + ox
        y = command[2] + oy
        control = null
        if (operation === 'M') {
          startX = x
          startY = y
        }
        break
      case 'C':
      case 'c':
        add(command[1] + ox, command[2] + oy)
        control = [command[3] + ox, command[4] + oy]
        add(control[0], control[1])
        x = command[5] + ox
        y = command[6] + oy
        break
      case 'S':
      case 's': {
        const reflected: Point =
          (previous === 'C' || previous === 'S') && control
            ? [2 * x - control[0], 2 * y - control[1]]
            : [x, y]
        add(reflected[0], reflected[1])
        control = [command[1] + ox, command[2] + oy]
        add(control[0], control[1])
        x = command[3] + ox
        y = command[4] + oy
        break
      }
      case 'Q':
      case 'q':
        control = [command[1] + ox, command[2] + oy]
        add(control[0], control[1])
        x = command[3] + ox
        y = command[4] + oy
        break
      case 'T':
      case 't': {
        const reflected: Point =
          (previous === 'Q' || previous === 'T') && control
            ? [2 * x - control[0], 2 * y - control[1]]
            : [x, y]
        add(reflected[0], reflected[1])
        control = reflected
        x = command[1] + ox
        y = command[2] + oy
        break
      }
      case 'A':
      case 'a': {
        const endX = command[6] + ox
        const endY = command[7] + oy
        result = union(result, arcBounds(x, y, command[1], command[2], command[3], endX, endY))
        x = endX
        y = endY
        control = null
        break
      }
    }
    add(x, y)
    previous = operation
  }
  return result
}

/** Local marker-presence calculation; the host independently charges multiplicity.
 * SVG 2 Painting 13.7.2 assigns start/end to the entire path, not each subpath;
 * every intervening vertex receives marker-mid, including subpath endpoints.
 * Closing adds a vertex at the initial point, even if it is already coincident.
 * Consecutive movetos retain their vertices (SVG 2 Paths 9.5.3). Empty data has
 * none. Zero-length segments are retained, conservatively including degenerate
 * arcs that a renderer may omit. A command after close starts a new subpath.
 * https://www.w3.org/TR/SVG2/painting.html#VertexMarkerProperties
 */
function documentSvgMarkerInstances(node: {
  readonly kind: string
  readonly commands?: readonly DocumentSvgPathCommand[]
  readonly points?: readonly Point[]
}): { readonly markerStart: number; readonly markerMid: number; readonly markerEnd: number } {
  let vertices = 0
  if (node.kind === 'line') vertices = 2
  else if (node.kind === 'polyline' || node.kind === 'polygon') {
    vertices = node.points?.length ?? 0
    if (node.kind === 'polygon' && vertices > 0) vertices += 1
  } else if (node.kind === 'path') {
    let active = false
    for (const command of node.commands ?? []) {
      const operation = command[0].toUpperCase()
      if (operation === 'M') {
        vertices += 1
        active = true
      } else {
        // The codec requires the first command to be M/m. After a close,
        // another drawing/close command introduces an implicit initial vertex.
        if (!active) vertices += 1
        vertices += 1
        active = operation !== 'Z'
      }
    }
  }
  const endpoint = vertices > 0 ? 1 : 0
  return { markerStart: endpoint, markerMid: Math.max(0, vertices - 2), markerEnd: endpoint }
}

const INHERITED_KEYS = [
  'shapeRendering',
  'fill',
  'stroke',
  'fillOpacity',
  'strokeOpacity',
  'fillRule',
  'clipRule',
  'strokeWidth',
  'dashArray',
  'dashOffset',
  'lineCap',
  'lineJoin',
  'miterLimit',
  'visibility',
  'fontId',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'wordSpacing',
  'textAnchor',
  'dominantBaseline',
  'alignmentBaseline',
  'decoration',
  'whiteSpace',
  'textTransform',
] as const satisfies readonly (keyof DocumentSvgStyle)[]

function inheritProperty<K extends keyof DocumentSvgStyle>(
  target: MutableStyle,
  source: DocumentSvgStyle,
  key: K,
): void {
  const value = source[key]
  if (value !== undefined) target[key] = value
}
function cssLength(length: DocumentSvgLength, font: number, basis: number): number {
  if (length.unit === 'em') return length.value * font
  if (length.unit === 'percent') return (length.value * basis) / 100
  return length.value
}

function fromBox(box: DocumentSvgBox): Bounds {
  if (box.some((value) => !Number.isFinite(value)) || box[2] < 0 || box[3] < 0)
    fail('invalid-output', 'paint measurement box')
  return [box[0], box[1], box[0] + box[2], box[1] + box[3]]
}
function checked(box: MaybeBounds): MaybeBounds {
  if (box?.some((value) => !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE))
    fail('limit-exceeded', 'paint envelope coordinates')
  return box
}
function painted(value: DocumentSvgStyle['fill'], opacity = 1, defaultPaint = true): boolean {
  if (opacity === 0) return false
  if (!value) return defaultPaint
  return value.kind !== 'none' && (value.kind !== 'color' || value.rgba[3] !== 0)
}

/** CSS-pixel raster viewport [x,y,width,height], visible overflow rounded outwards and unioned
 * with the unchanged original viewport. Its negative offset is not a transform
 * of the original inner SVG. Call only after conversion/reference validation.
 */
export function measureSvgPaintBounds(
  image: Omit<DocumentSvgImage, 'rasterBounds'>,
  measurements: PaintMeasurements,
  options: PaintEnvelopeOptions = {},
): DocumentSvgBox {
  const original: Bounds = fromBox([0, 0, image.width, image.height])
  checked(original)
  const rootStyle = image.rootStyle === undefined ? {} : image.styles[image.rootStyle]
  if (!rootStyle) fail('invalid-output', 'paint root style')
  const overflow = options.rootOverflow ?? rootStyle.overflow ?? 'hidden'
  if (overflow === 'hidden') return [0, 0, image.width, image.height]
  const definitions = new Map(image.definitions.map((node) => [node.id, node]))
  let visited = 0
  function charge(n = 1): void {
    visited += n
    if (visited > MAX_NODES) fail('limit-exceeded', 'paint envelope expansion')
  }
  function definition<K extends DocumentSvgDefinition['kind']>(
    id: string,
    kind: K,
  ): Extract<DocumentSvgDefinition, { kind: K }> {
    const value = definitions.get(id)
    if (!value || value.kind !== kind) fail('invalid-output', 'paint reference kind')
    // Runtime discriminator checked above; generic K cannot be narrowed by TS.
    return value as Extract<DocumentSvgDefinition, { kind: K }>
  }
  function measured(node: object): Bounds {
    const box = measurements.get(node)
    if (!box) fail('unsupported-feature', 'paint envelope requires local text/FO ink measurement')
    return checked(fromBox(box)) ?? fail('invalid-output', 'empty paint measurement')
  }
  function styleFor(
    node: GeometryNode,
    parent: StyleContext,
    viewport: DocumentSvgBox,
  ): StyleContext {
    const own = 'style' in node && node.style !== undefined ? image.styles[node.style] : {}
    if (!own) fail('invalid-output', 'paint style index')
    const inherited: MutableStyle = {}
    for (const key of INHERITED_KEYS) inheritProperty(inherited, parent.style, key)
    const style: DocumentSvgStyle = { ...inherited, ...own }
    const font =
      node.kind === 'textBox'
        ? node.fontSizePx
        : own.fontSize
          ? cssLength(own.fontSize, parent.font, parent.font)
          : parent.font
    const diagonal = Math.hypot(viewport[2], viewport[3]) / Math.SQRT2
    const stroke = style.strokeWidth ? cssLength(style.strokeWidth, font, diagonal) : 1
    if (
      ![font, stroke].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= MAX_COORDINATE,
      )
    )
      fail('limit-exceeded', 'paint inherited length')
    return { own, style, font, stroke }
  }
  function visit(
    node: GeometryNode,
    parent: StyleContext,
    viewport: DocumentSvgBox,
    depth = 1,
  ): PaintResult {
    charge()
    if (depth > MAX_DEPTH) fail('limit-exceeded', 'paint envelope depth/reference cycle')
    const context = styleFor(node, parent, viewport),
      style = context.style
    if (style.display === 'none') return { fill: null, ink: null }
    let local = IDENTITY
    if ('transforms' in node) {
      charge(node.transforms?.length ?? 0)
      for (const transform of node.transforms ?? [])
        local = multiply(local, transformMatrix(transform))
    }
    let fill: MaybeBounds = null,
      ink: MaybeBounds = null
    let shape = false
    const add = (result: PaintResult): void => {
      fill = union(fill, result.fill)
      ink = union(ink, result.ink)
    }
    switch (node.kind) {
      case 'rect':
        fill = fromBox([node.x, node.y, node.width, node.height])
        shape = true
        break
      case 'circle':
        fill = fromBox([node.cx - node.r, node.cy - node.r, 2 * node.r, 2 * node.r])
        shape = true
        break
      case 'ellipse':
        fill = fromBox([node.cx - node.rx, node.cy - node.ry, 2 * node.rx, 2 * node.ry])
        shape = true
        break
      case 'line':
        fill = union(pointBounds(node.x1, node.y1), pointBounds(node.x2, node.y2))
        shape = true
        break
      case 'path':
        charge(node.commands.length)
        fill = pathBounds(node.commands)
        shape = true
        break
      case 'polyline':
      case 'polygon':
        charge(node.points.length)
        for (const point of node.points) fill = union(fill, pointBounds(point[0], point[1]))
        shape = true
        break
      case 'text':
      case 'tspan':
        if (style.decoration && style.decoration !== 'none')
          fail('unsupported-feature', 'paint text decoration requires measured decoration ink')
        fill = measured(node)
        shape = true
        break
      case 'textBox':
        fill = fromBox(node.box)
        ink = union(fill, measured(node))
        break
      case 'group':
      case 'symbol':
      case 'marker':
      case 'clipPath':
        for (const child of node.children) add(visit(child, context, viewport, depth + 1))
        break
      case 'textAlternative':
        add(visit(node.primary, context, viewport, depth + 1))
        add(visit(node.fallback, context, viewport, depth + 1))
        break
      case 'use': {
        const symbol = definition(node.ref, 'symbol')
        const width = node.width ?? symbol.width ?? viewport[2]
        const height = node.height ?? symbol.height ?? viewport[3]
        const mapping = symbol.viewBox ? viewportMatrix(symbol.viewBox, width, height) : IDENTITY
        const placement = multiply([1, 0, 0, 1, node.x ?? 0, node.y ?? 0], mapping)
        const result = visit(symbol, context, symbol.viewBox ?? viewport, depth + 1)
        add({
          fill: transformBounds(result.fill, placement),
          ink: transformBounds(result.ink, placement),
        })
        break
      }
      default: {
        const unsupported: never = node
        return fail('unsupported-feature', 'unknown paint node: ' + String(unsupported))
      }
    }
    if (shape && fill) {
      const visible = style.visibility !== 'hidden' && style.visibility !== 'collapse'
      if (visible && node.kind !== 'line' && painted(style.fill, style.fillOpacity)) ink = fill
      if (visible && painted(style.stroke, style.strokeOpacity, false) && context.stroke > 0) {
        const join =
          style.lineJoin === undefined || style.lineJoin === 'miter'
            ? Math.max(1, style.miterLimit ?? 4)
            : 1
        // A diagonal square cap has a corner sqrt(2)*halfWidth from its endpoint.
        const cap = style.lineCap === 'square' ? Math.SQRT2 : 1
        ink = union(ink, inflate(fill, (context.stroke * Math.max(join, cap)) / 2))
      }
    }
    if (node.kind === 'text' || node.kind === 'tspan') {
      // A parent's getBBox includes child glyphs, but not their differing stroke.
      for (const child of node.children)
        if (child.kind === 'tspan') add(visit(child, context, viewport, depth + 1))
    }
    if (
      node.kind === 'line' ||
      node.kind === 'path' ||
      node.kind === 'polyline' ||
      node.kind === 'polygon'
    ) {
      const count = documentSvgMarkerInstances(node)
      for (const key of ['markerStart', 'markerMid', 'markerEnd'] as const) {
        const id = node[key]
        if (!id || !count[key]) continue
        const marker = definition(id, 'marker')
        const markerViewport: DocumentSvgBox = marker.viewBox ?? [0, 0, marker.width, marker.height]
        const markerContext = styleFor(marker, rootContext, markerViewport)
        const mapping = marker.viewBox
          ? viewportMatrix(marker.viewBox, marker.width, marker.height)
          : IDENTITY
        const result = visit(marker, rootContext, markerViewport, depth + 1)
        const box = transformBounds(result.ink, mapping)
        if (!box) continue
        const refX = cssLength(marker.refX, markerContext.font, markerViewport[2])
        const refY = cssLength(marker.refY, markerContext.font, markerViewport[3])
        const reference = transformBounds(pointBounds(refX, refY), mapping)
        if (!reference) fail('invalid-output', 'paint marker reference')
        const unit = marker.units === 'strokeWidth' ? context.stroke : 1
        let radius = 0
        for (const x of [box[0], box[2]])
          for (const y of [box[1], box[3]])
            radius = Math.max(radius, Math.hypot(x - reference[0], y - reference[1]) * unit)
        // Every marker anchor is inside the path's control hull. A circle about
        // that hull covers all actual start/mid/end rotations without guesses.
        ink = union(ink, inflate(fill, radius))
      }
    }
    if ('transformOrigin' in node && node.transformOrigin) {
      // The converter normally bakes the measured local CTM. A control hull is
      // an enclosing box, not the exact geometry needed for a percentage origin.
      if (node.transformBox === 'fill-box' || node.transformBox === 'stroke-box')
        fail('unsupported-feature', 'paint transform origin requires canonical local matrix')
      const reference = fromBox(viewport)
      const x =
        reference[0] + cssLength(node.transformOrigin[0], context.font, reference[2] - reference[0])
      const y =
        reference[1] + cssLength(node.transformOrigin[1], context.font, reference[3] - reference[1])
      local = multiply(multiply([1, 0, 0, 1, x, y], local), [1, 0, 0, 1, -x, -y])
    }
    const filter = context.own.filter
    if (filter?.kind === 'cssDropShadow') {
      for (const shadow of filter.shadows) {
        // Filter Effects 13.2 leaves nonzero CSS blur's paint region to the UA.
        // 3*sigma is not a cross-engine complete-ink guarantee. Do not crop it.
        if (shadow.blur !== 0)
          fail('unsupported-feature', 'CSS blurred shadow requires proven UA paint extent')
        if (shadow.color[3] && ink)
          ink = union(ink, [
            ink[0] + shadow.dx,
            ink[1] + shadow.dy,
            ink[2] + shadow.dx,
            ink[3] + shadow.dy,
          ])
      }
    } else if (filter?.kind === 'definition') {
      const effect = definition(filter.ref, 'dropShadowFilter')
      if (ink) {
        const bounds = fill ?? fail('unsupported-feature', 'filter without geometric bounds')
        const width = bounds[2] - bounds[0],
          height = bounds[3] - bounds[1]
        const objectUnits = effect.units === 'objectBoundingBox'
        const resolve = (length: DocumentSvgLength, axis: number, size: number): number =>
          objectUnits
            ? (length.unit === 'percent' ? length.value / 100 : length.value) * size
            : cssLength(length, context.font, axis)
        if (
          objectUnits &&
          effect.region.some((length) => length.unit !== 'user' && length.unit !== 'percent')
        )
          fail('unsupported-feature', 'paint objectBoundingBox filter length')
        const x = resolve(effect.region[0], viewport[2], width) + (objectUnits ? bounds[0] : 0)
        const y = resolve(effect.region[1], viewport[3], height) + (objectUnits ? bounds[1] : 0)
        const w = resolve(effect.region[2], viewport[2], width),
          h = resolve(effect.region[3], viewport[3], height)
        // Actual object bbox can be smaller than a path control hull. Bound all
        // resulting filter-region positions instead of substituting a fake bbox.
        ink = objectUnits
          ? inflate(bounds, Math.abs(x - bounds[0]) + w, Math.abs(y - bounds[1]) + h)
          : fromBox([x, y, w, h])
      }
    } else if (filter && filter.kind !== 'none' && filter.kind !== 'unresolved-local') {
      const unsupported: never = filter
      fail('unsupported-feature', 'unknown paint filter: ' + String(unsupported))
    }
    if (context.own.clipPath && ink) {
      const clip = definition(context.own.clipPath, 'clipPath')
      // Conservative omission of clipping avoids using a path control hull as
      // an exact objectBoundingBox. Still recurse to reject unsupported content.
      visit(clip, context, viewport, depth + 1)
    }
    if (context.own.opacity === 0) ink = null
    checked(fill)
    checked(ink)
    return {
      fill: checked(transformBounds(fill, local)),
      ink: checked(transformBounds(ink, local)),
    }
  }
  const defaults: StyleContext = { style: { fontId: 'sans' }, own: {}, font: 16, stroke: 1 }
  const root: Extract<DocumentSvgNode, { kind: 'group' }> = {
    kind: 'group',
    ...(image.rootStyle === undefined ? {} : { style: image.rootStyle }),
    children: image.children,
  }
  // Marker definitions inherit from the root/defs tree, not their referencing
  // shape. markerUnits alone still uses that shape's resolved stroke width.
  const rootContext = styleFor(root, defaults, image.viewBox)
  const result = visit(root, defaults, image.viewBox)
  const css = checked(
    transformBounds(
      result.ink,
      viewportMatrix(image.viewBox, image.width, image.height, image.aspect),
    ),
  )
  const box = union(original, css) ?? original
  const left = Math.floor(box[0]),
    top = Math.floor(box[1])
  return [left, top, Math.ceil(box[2]) - left, Math.ceil(box[3]) - top]
}

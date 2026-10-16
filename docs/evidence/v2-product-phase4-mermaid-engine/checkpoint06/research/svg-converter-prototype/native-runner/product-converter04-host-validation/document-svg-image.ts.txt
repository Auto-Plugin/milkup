/** Closed, inert SVG image data. No raw markup, CSS, URLs or host objects. */
export type DocumentSvgRgba = readonly [r: number, g: number, b: number, a: number]
export type DocumentSvgLength = {
  readonly value: number
  readonly unit: 'user' | 'px' | 'em' | 'percent'
}
export type DocumentSvgMatrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
]
export type DocumentSvgBox = readonly [x: number, y: number, width: number, height: number]
/** Local opaque IDs only, never URI strings; reference kind is also checked. */
export type DocumentSvgLocalId = string
export type DocumentSvgStyleId = number
export type DocumentSvgPaint =
  | { readonly kind: 'none' }
  | { readonly kind: 'color'; readonly rgba: DocumentSvgRgba }
  | { readonly kind: 'gradient'; readonly ref: DocumentSvgLocalId }
export type DocumentSvgTransform =
  | { readonly kind: 'matrix'; readonly values: DocumentSvgMatrix }
  | { readonly kind: 'translate'; readonly x: number; readonly y: number }
  | { readonly kind: 'scale'; readonly x: number; readonly y: number }
  | { readonly kind: 'rotate'; readonly degrees: number; readonly cx: number; readonly cy: number }
  | { readonly kind: 'skewX' | 'skewY'; readonly degrees: number }
export type DocumentSvgPathCommand =
  | readonly ['M' | 'm' | 'L' | 'l' | 'T' | 't', number, number]
  | readonly ['H' | 'h' | 'V' | 'v', number]
  | readonly ['C' | 'c', number, number, number, number, number, number]
  | readonly ['S' | 's' | 'Q' | 'q', number, number, number, number]
  | readonly ['A' | 'a', number, number, number, 0 | 1, 0 | 1, number, number]
  | readonly ['Z' | 'z']
export type DocumentSvgShadow = {
  readonly dx: number
  readonly dy: number /** CSS blurRadius differs from SVG stdDeviation. */
  readonly blur: number
  readonly color: DocumentSvgRgba
}
export type DocumentSvgFilterValue =
  | { readonly kind: 'none' }
  | { readonly kind: 'unresolved-local' }
  | { readonly kind: 'definition'; readonly ref: DocumentSvgLocalId }
  | { readonly kind: 'cssDropShadow'; readonly shadows: readonly DocumentSvgShadow[] }
/** No arbitrary styles. A deduplicated entry describes this element, not descendants. */
export interface DocumentSvgStyle {
  readonly shapeRendering?: 'auto' | 'optimizeSpeed' | 'crispEdges' | 'geometricPrecision'
  readonly fill?: DocumentSvgPaint
  readonly stroke?: DocumentSvgPaint
  readonly fillOpacity?: number
  readonly strokeOpacity?: number
  readonly opacity?: number
  readonly fillRule?: 'nonzero' | 'evenodd'
  readonly clipRule?: 'nonzero' | 'evenodd'
  readonly strokeWidth?: DocumentSvgLength
  readonly dashArray?: readonly DocumentSvgLength[]
  readonly dashOffset?: DocumentSvgLength
  readonly lineCap?: 'butt' | 'round' | 'square'
  readonly lineJoin?: 'miter' | 'round' | 'bevel'
  readonly miterLimit?: number
  readonly display?: 'inline' | 'none'
  readonly visibility?: 'visible' | 'hidden' | 'collapse'
  readonly overflow?: 'visible' | 'hidden'
  readonly mixBlendMode?: 'normal' | 'multiply'
  readonly isolation?: 'auto' | 'isolate'
  readonly filter?: DocumentSvgFilterValue
  readonly clipPath?: DocumentSvgLocalId
  readonly colorInterpolation?: 'sRGB' | 'linearRGB'
  readonly colorInterpolationFilters?: 'sRGB' | 'linearRGB'
  /** Host-approved offline font mapping; never a CSS or URL string. */
  readonly fontId?:
    | 'sans'
    | 'arial-sans'
    | 'open-sans-sans'
    | 'trebuchet-verdana-arial-sans'
    | 'serif'
    | 'monospace'
  readonly fontSize?: DocumentSvgLength
  readonly fontWeight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
  readonly fontStyle?: 'normal' | 'italic' | 'oblique'
  readonly letterSpacing?: DocumentSvgLength
  readonly wordSpacing?: DocumentSvgLength
  readonly textAnchor?: 'start' | 'middle' | 'end'
  readonly dominantBaseline?:
    | 'auto'
    | 'alphabetic'
    | 'central'
    | 'middle'
    | 'hanging'
    | 'text-before-edge'
    | 'text-after-edge'
  readonly alignmentBaseline?:
    | 'auto'
    | 'baseline'
    | 'alphabetic'
    | 'central'
    | 'middle'
    | 'hanging'
    | 'before-edge'
    | 'after-edge'
  readonly decoration?: 'none' | 'underline' | 'overline' | 'line-through'
  readonly whiteSpace?: 'normal' | 'pre' | 'pre-wrap' | 'nowrap'
  readonly textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
}
export interface DocumentSvgCommon {
  readonly style?: DocumentSvgStyleId
  readonly transforms?: readonly DocumentSvgTransform[]
  /** Typed local origin, only if helper cannot safely canonicalize CSS transform. */
  readonly transformOrigin?: readonly [DocumentSvgLength, DocumentSvgLength]
  readonly transformBox?: 'fill-box' | 'stroke-box' | 'view-box'
  readonly title?: string
  readonly description?: string
}
export interface DocumentSvgMarked extends DocumentSvgCommon {
  readonly markerStart?: DocumentSvgLocalId
  readonly markerMid?: DocumentSvgLocalId
  readonly markerEnd?: DocumentSvgLocalId
}
export type DocumentSvgTextChild =
  { readonly kind: 'textRun'; readonly text: string } | DocumentSvgTspan
export interface DocumentSvgTspan extends DocumentSvgCommon {
  readonly kind: 'tspan'
  readonly x?: readonly DocumentSvgLength[]
  readonly y?: readonly DocumentSvgLength[]
  readonly dx?: readonly DocumentSvgLength[]
  readonly dy?: readonly DocumentSvgLength[]
  readonly xmlSpace?: 'default' | 'preserve'
  readonly children: readonly DocumentSvgTextChild[]
}
export interface DocumentSvgText extends DocumentSvgCommon {
  readonly kind: 'text'
  readonly xmlSpace?: 'default' | 'preserve'
  readonly x?: readonly DocumentSvgLength[]
  readonly y?: readonly DocumentSvgLength[]
  readonly dx?: readonly DocumentSvgLength[]
  readonly dy?: readonly DocumentSvgLength[]
  readonly children: readonly DocumentSvgTextChild[]
}
/** Canonical serializer emits exactly div(table)>div(table-cell)>plain text.
 * No XHTML tree, attributes, class, style-string or HTML escapes are accepted.
 */
export interface DocumentSvgTextBox extends DocumentSvgCommon {
  readonly kind: 'textBox'
  readonly box: DocumentSvgBox
  readonly text: string
  readonly outerBoxSizing?: 'content-box' | 'border-box'
  readonly innerBoxSizing?: 'content-box' | 'border-box'
  readonly textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  readonly letterSpacing?: DocumentSvgLength
  readonly wordSpacing?: DocumentSvgLength
  readonly decoration?: 'none' | 'underline' | 'overline' | 'line-through'
  readonly color: DocumentSvgRgba
  readonly background?: DocumentSvgRgba
  readonly fontId:
    | 'sans'
    | 'arial-sans'
    | 'open-sans-sans'
    | 'trebuchet-verdana-arial-sans'
    | 'serif'
    | 'monospace'
  readonly fontSizePx: number
  readonly fontWeight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
  readonly fontStyle: 'normal' | 'italic' | 'oblique'
  readonly lineHeight: 'normal' | { readonly px: number }
  readonly hAlign: 'start' | 'center' | 'end'
  readonly vAlign: 'top' | 'middle' | 'bottom'
  readonly whiteSpace: 'normal' | 'pre' | 'pre-wrap' | 'nowrap'
  readonly overflowWrap: 'normal' | 'break-word'
  readonly wordBreak: 'normal' | 'break-all' | 'keep-all'
}
export type DocumentSvgNode =
  | (DocumentSvgCommon & { readonly kind: 'group'; readonly children: readonly DocumentSvgNode[] })
  | (DocumentSvgCommon & {
      readonly kind: 'rect'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly rx?: number
      readonly ry?: number
    })
  | (DocumentSvgCommon & {
      readonly kind: 'circle'
      readonly cx: number
      readonly cy: number
      readonly r: number
    })
  | (DocumentSvgCommon & {
      readonly kind: 'ellipse'
      readonly cx: number
      readonly cy: number
      readonly rx: number
      readonly ry: number
    })
  | (DocumentSvgMarked & {
      readonly kind: 'line'
      readonly x1: number
      readonly y1: number
      readonly x2: number
      readonly y2: number
    })
  | (DocumentSvgMarked & {
      readonly kind: 'path'
      readonly commands: readonly DocumentSvgPathCommand[]
    })
  | (DocumentSvgMarked & {
      readonly kind: 'polyline' | 'polygon'
      readonly points: readonly (readonly [number, number])[]
    })
  | DocumentSvgText
  | DocumentSvgTextBox
  /** Bounded local reference; no URL, remote href or nested document. */
  | (DocumentSvgCommon & {
      readonly kind: 'use'
      readonly ref: DocumentSvgLocalId
      readonly x?: number
      readonly y?: number
      readonly width?: number
      readonly height?: number
    })
  /** Only known, equivalent text alternatives; preserve browser branch semantics. */
  | (DocumentSvgCommon & {
      readonly kind: 'textAlternative'
      readonly primary: DocumentSvgTextBox
      readonly fallback: DocumentSvgText
    })
export interface DocumentSvgDefBase {
  readonly id: DocumentSvgLocalId
}
export type DocumentSvgDefinition =
  | (DocumentSvgDefBase & {
      readonly kind: 'clipPath'
      readonly units: 'userSpaceOnUse' | 'objectBoundingBox'
      readonly transforms?: readonly DocumentSvgTransform[]
      readonly children: readonly DocumentSvgNode[]
    })
  | (DocumentSvgDefBase & {
      readonly kind: 'marker'
      readonly viewBox?: DocumentSvgBox
      readonly width: number
      readonly height: number
      readonly refX: DocumentSvgLength
      readonly refY: DocumentSvgLength
      readonly units: 'strokeWidth' | 'userSpaceOnUse'
      readonly orient: 'auto' | 'auto-start-reverse' | { readonly degrees: number }
      readonly style?: DocumentSvgStyleId
      readonly children: readonly DocumentSvgNode[]
    })
  | (DocumentSvgDefBase & {
      readonly kind: 'linearGradient'
      readonly units: 'userSpaceOnUse' | 'objectBoundingBox'
      readonly x1: DocumentSvgLength
      readonly y1: DocumentSvgLength
      readonly x2: DocumentSvgLength
      readonly y2: DocumentSvgLength
      readonly spread: 'pad' | 'reflect' | 'repeat'
      readonly transforms?: readonly DocumentSvgTransform[]
      readonly stops: readonly { readonly offset: number; readonly color: DocumentSvgRgba }[]
    })
  | (DocumentSvgDefBase & {
      readonly kind: 'dropShadowFilter'
      readonly units: 'userSpaceOnUse' | 'objectBoundingBox'
      readonly primitiveUnits: 'userSpaceOnUse' | 'objectBoundingBox'
      readonly region: readonly [
        DocumentSvgLength,
        DocumentSvgLength,
        DocumentSvgLength,
        DocumentSvgLength,
      ]
      readonly colorInterpolation: 'sRGB' | 'linearRGB'
      readonly dx: number
      readonly dy: number
      readonly stdDeviation: readonly [number, number]
      readonly color: DocumentSvgRgba
    })
  | (DocumentSvgDefBase & {
      readonly kind: 'symbol'
      readonly viewBox?: DocumentSvgBox
      readonly width?: number
      readonly height?: number
      readonly style?: DocumentSvgStyleId
      readonly children: readonly DocumentSvgNode[]
    })
export interface DocumentSvgImage {
  readonly type: 'svg-image'
  readonly profile: 'bounded-svg-v1'
  readonly width: number
  readonly height: number
  /** [x, y, width, height] in root CSS pixels; includes the root viewport and all visible ink. */
  readonly rasterBounds: DocumentSvgBox
  readonly viewBox: DocumentSvgBox
  readonly aspect: {
    readonly align:
      | 'none'
      | 'xMinYMin'
      | 'xMidYMin'
      | 'xMaxYMin'
      | 'xMinYMid'
      | 'xMidYMid'
      | 'xMaxYMid'
      | 'xMinYMax'
      | 'xMidYMax'
      | 'xMaxYMax'
    readonly fit: 'meet' | 'slice'
  }
  /** Full data included and budgeted; indexes alone never authorize shared resources. */
  readonly styles: readonly DocumentSvgStyle[]
  readonly rootStyle?: DocumentSvgStyleId
  readonly definitions: readonly DocumentSvgDefinition[]
  readonly children: readonly DocumentSvgNode[]
  readonly title?: string
  readonly description?: string
  /** Converter rejects effective animation before producing this profile. */
  readonly motion: 'static'
}

/** Converter errors are not accepted ready-image nodes. Host shows original source. */
export type DocumentSvgConversionFailure =
  | { readonly code: 'unsupported-animation'; readonly reason: string }
  | { readonly code: 'unsafe-output'; readonly reason: string }
  | { readonly code: 'unsupported-feature'; readonly reason: string }
  | { readonly code: 'limit-exceeded'; readonly reason: string }
  | { readonly code: 'font-unavailable'; readonly reason: string }
  | { readonly code: 'invalid-output'; readonly reason: string }

import type {
  SdkDocumentSvgBox,
  SdkDocumentSvgDefinition,
  SdkDocumentSvgImage,
  SdkDocumentSvgNode,
  SdkDocumentSvgStyle,
} from '@milkup/plugin-sdk'
import { describe, expect, it } from 'vitest'
import { measureSvgPaintBounds } from './paint-envelope.js'
import { ConversionError } from './svg-primitives.js'

type Input = Omit<SdkDocumentSvgImage, 'rasterBounds'>
const black = { kind: 'color', rgba: [0, 0, 0, 1] } as const
const user = (value: number) => ({ value, unit: 'user' }) as const
const emptyMeasurements = new WeakMap<object, SdkDocumentSvgBox>()
function image(children: readonly SdkDocumentSvgNode[], extra: Partial<Input> = {}): Input {
  return {
    type: 'svg-image',
    profile: 'bounded-svg-v1',
    width: 100,
    height: 100,
    viewBox: [0, 0, 100, 100],
    aspect: { align: 'none', fit: 'meet' },
    styles: [{ overflow: 'visible' }],
    rootStyle: 0,
    definitions: [],
    children,
    motion: 'static',
    ...extra,
  }
}
const rect: SdkDocumentSvgNode = { kind: 'rect', x: 0, y: 0, width: 10, height: 10 }
function contains(box: SdkDocumentSvgBox, x: number, y: number): void {
  expect(box[0]).toBeLessThanOrEqual(x)
  expect(box[1]).toBeLessThanOrEqual(y)
  expect(box[0] + box[2]).toBeGreaterThanOrEqual(x)
  expect(box[1] + box[3]).toBeGreaterThanOrEqual(y)
}
function measure(input: Input): SdkDocumentSvgBox {
  return measureSvgPaintBounds(input, emptyMeasurements)
}

describe('plugin-private SVG paint envelope', () => {
  it('retains the original fractional viewport for hidden overflow without asking for text metrics', () => {
    const text: SdkDocumentSvgNode = {
      kind: 'text',
      children: [{ kind: 'textRun', text: 'Journey' }],
    }
    expect(
      measure(image([text], { width: 100.25, height: 39.75, styles: [{ overflow: 'hidden' }] })),
    ).toEqual([0, 0, 100.25, 39.75])
  })

  it('includes negative stroke ink rather than clipping it to the root viewport', () => {
    const styles: readonly SdkDocumentSvgStyle[] = [
      { overflow: 'visible', stroke: black, strokeWidth: user(14), lineJoin: 'round' },
    ]
    expect(measure(image([rect], { styles }))).toEqual([-7, -7, 107, 107])
  })

  it('covers diagonal square cap corners with round joins', () => {
    const line: SdkDocumentSvgNode = { kind: 'line', x1: 0, y1: 0, x2: 20, y2: 20 }
    const box = measure(
      image([line], {
        styles: [
          {
            overflow: 'visible',
            stroke: black,
            strokeWidth: user(10),
            lineCap: 'square',
            lineJoin: 'round',
          },
        ],
      }),
    )
    contains(box, -5 * Math.SQRT2, 0)
  })

  it('transforms all four corners of an anisotropic rotated shape', () => {
    const box = measure(
      image([
        {
          kind: 'rect',
          x: 0,
          y: 0,
          width: 10,
          height: 40,
          transforms: [{ kind: 'rotate', degrees: 45, cx: 0, cy: 0 }],
        },
      ]),
    )
    contains(box, -40 / Math.SQRT2, 40 / Math.SQRT2)
    contains(box, 10 / Math.SQRT2, 10 / Math.SQRT2)
  })

  it('maps user-space ink through the root viewBox and nonuniform CSS viewport', () => {
    expect(
      measure(
        image([{ kind: 'rect', x: 0, y: 0, width: 10, height: 10 }], {
          width: 200,
          height: 100,
          viewBox: [10, 10, 100, 100],
        }),
      ),
    ).toEqual([-20, -10, 220, 110])
  })

  it('preserves root meet letterboxing instead of assuming independent axis scales', () => {
    expect(
      measure(
        image([{ kind: 'rect', x: -20, y: 0, width: 10, height: 10 }], {
          width: 200,
          height: 100,
          aspect: { align: 'xMidYMid', fit: 'meet' },
        }),
      ),
    ).toEqual([0, 0, 200, 100])
  })

  it('corrects undersized arc radii before enclosing the painted arc', () => {
    const box = measure(
      image([
        {
          kind: 'path',
          commands: [
            ['M', 0, 0],
            ['A', 1, 1, 0, 0, 1, 100, 0],
          ],
        },
      ]),
    )
    contains(box, 50, -50)
  })

  it('includes reflected quadratic and cubic control extents', () => {
    const box = measure(
      image([
        {
          kind: 'path',
          commands: [
            ['M', 0, 0],
            ['Q', 0, 100, 10, 0],
            ['T', 20, 0],
            ['C', 20, 0, 30, 100, 40, 0],
            ['S', 50, 0, 60, 0],
          ],
        },
      ]),
    )
    // The reflected quadratic reaches -50 at its midpoint; the smooth cubic
    // also lies above the baseline, although no negative coordinates are given.
    contains(box, 15, -50)
    contains(box, 51.25, -37.5)
  })

  it('includes long end markers outside the original right edge', () => {
    const marker: SdkDocumentSvgDefinition = {
      kind: 'marker',
      id: 'end',
      width: 102,
      height: 2,
      refX: user(0),
      refY: user(0),
      units: 'userSpaceOnUse',
      orient: 'auto',
      children: [{ kind: 'rect', x: 0, y: 0, width: 102, height: 2 }],
    }
    const box = measure(
      image([{ kind: 'line', x1: 0, y1: 50, x2: 100, y2: 50, markerEnd: 'end' }], {
        definitions: [marker],
      }),
    )
    contains(box, 202, 52)
  })

  it.each([
    { box: [0, 0, 5, 5] as const, ref: [5, 5] as const },
    { box: [1, 2, 5, 5] as const, ref: [6, 7] as const },
  ])('maps marker reference and content together for viewBox $box', ({ box, ref }) => {
    const marker: SdkDocumentSvgDefinition = {
      kind: 'marker',
      id: 'mapped',
      width: 10,
      height: 10,
      viewBox: box,
      refX: user(ref[0]),
      refY: user(ref[1]),
      units: 'userSpaceOnUse',
      orient: { degrees: 0 },
      children: [{ kind: 'rect', x: box[0], y: box[1], width: box[2], height: box[3] }],
    }
    const bounds = measure(
      image([{ kind: 'line', x1: 0, y1: 0, x2: 0, y2: 0, markerEnd: 'mapped' }], {
        definitions: [marker],
      }),
    )
    contains(bounds, -10, -10)
  })

  it('preserves the mapped reference after reflecting the referencing shape', () => {
    const marker: SdkDocumentSvgDefinition = {
      kind: 'marker',
      id: 'mapped',
      width: 1000,
      height: 1000,
      viewBox: [-500, -500, 500, 500],
      refX: { value: 100, unit: 'percent' },
      refY: { value: 100, unit: 'percent' },
      units: 'userSpaceOnUse',
      orient: { degrees: 0 },
      children: [{ kind: 'rect', x: -500, y: -500, width: 500, height: 500 }],
    }
    const bounds = measure(
      image(
        [
          {
            kind: 'line',
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 0,
            markerEnd: 'mapped',
            transforms: [{ kind: 'scale', x: -1, y: 1 }],
          },
        ],
        { definitions: [marker] },
      ),
    )
    contains(bounds, 2000, -2000)
  })

  it('includes marker-mid on the intervening endpoints of disconnected subpaths', () => {
    const marker: SdkDocumentSvgDefinition = {
      kind: 'marker',
      id: 'middle',
      width: 10,
      height: 10,
      refX: user(0),
      refY: user(0),
      units: 'userSpaceOnUse',
      orient: { degrees: 0 },
      children: [{ kind: 'rect', x: -20, y: 0, width: 10, height: 10 }],
    }
    const box = measure(
      image(
        [
          {
            kind: 'path',
            markerMid: 'middle',
            commands: [
              ['M', 0, 0],
              ['L', 0, 10],
              ['M', 0, 20],
              ['L', 0, 30],
            ],
          },
        ],
        { definitions: [marker] },
      ),
    )
    contains(box, -20, 10)
  })

  it('maps symbol content before applying its translated use position', () => {
    const symbol: SdkDocumentSvgDefinition = {
      kind: 'symbol',
      id: 's',
      viewBox: [0, 0, 10, 10],
      children: [rect],
    }
    const box = measure(
      image([{ kind: 'use', ref: 's', x: -30, y: 0, width: 20, height: 20 }], {
        definitions: [symbol],
      }),
    )
    contains(box, -30, 0)
    contains(box, -10, 20)
  })

  it('uses explicit SVG filter clipping region, including shadow spill beyond the shape', () => {
    const filter: SdkDocumentSvgDefinition = {
      kind: 'dropShadowFilter',
      id: 'shadow',
      units: 'userSpaceOnUse',
      primitiveUnits: 'userSpaceOnUse',
      region: [user(-40), user(-30), user(180), user(160)],
      colorInterpolation: 'sRGB',
      dx: 10,
      dy: 20,
      stdDeviation: [5, 5],
      color: [0, 0, 0, 1],
    }
    expect(
      measure(
        image([rect], {
          definitions: [filter],
          styles: [{ overflow: 'visible', filter: { kind: 'definition', ref: 'shadow' } }],
        }),
      ),
    ).toEqual([-40, -30, 180, 160])
  })

  it('bounds zero-blur CSS shadows in order and rejects a guessed nonzero blur radius', () => {
    const styles: readonly SdkDocumentSvgStyle[] = [
      {
        overflow: 'visible',
        filter: {
          kind: 'cssDropShadow',
          shadows: [
            { dx: -20, dy: 0, blur: 0, color: [0, 0, 0, 1] },
            { dx: -20, dy: 0, blur: 0, color: [0, 0, 0, 1] },
          ],
        },
      },
    ]
    contains(measure(image([rect], { styles })), -40, 0)
    expect(() =>
      measure(
        image([rect], {
          styles: [
            {
              overflow: 'visible',
              filter: {
                kind: 'cssDropShadow',
                shadows: [{ dx: 0, dy: 0, blur: 2, color: [0, 0, 0, 1] }],
              },
            },
          ],
        }),
      ),
    ).toThrow(/proven UA paint extent/)
  })

  it('does not invent bounds for unresolved local filters', () => {
    expect(
      measure(
        image([rect], { styles: [{ overflow: 'visible', filter: { kind: 'unresolved-local' } }] }),
      ),
    ).toEqual([0, 0, 100, 100])
  })

  it('uses exact typed-node text identity and includes descendant stroke', () => {
    const span = { kind: 'tspan', style: 1, children: [{ kind: 'textRun', text: '字' }] } as const
    const text: SdkDocumentSvgNode = { kind: 'text', children: [span] }
    const measurements = new WeakMap<object, SdkDocumentSvgBox>([
      [text, [-2, 0, 10, 10]],
      [span, [-2, 0, 10, 10]],
    ])
    const result = measureSvgPaintBounds(
      image([text], {
        styles: [
          { overflow: 'visible' },
          { stroke: black, strokeWidth: user(4), lineJoin: 'round' },
        ],
      }),
      measurements,
    )
    contains(result, -4, -2)
    expect(() => measureSvgPaintBounds(image([{ ...text }]), measurements)).toThrow(/measurement/)
  })

  it('rejects visible text without a private measurement rather than guessing from font size', () => {
    expect(() =>
      measure(image([{ kind: 'text', children: [{ kind: 'textRun', text: 'italic j' }] }])),
    ).toThrow(/measurement/)
  })

  it('does not use a conservative path hull as an exact fill-box transform origin', () => {
    expect(() =>
      measure(image([{ ...rect, transformBox: 'fill-box', transformOrigin: [user(0), user(0)] }])),
    ).toThrow(/canonical local matrix/)
  })

  it('keeps clipping conservative without pretending its object bbox is exact', () => {
    const clip: SdkDocumentSvgDefinition = {
      kind: 'clipPath',
      id: 'clip',
      units: 'objectBoundingBox',
      children: [rect],
    }
    const box = measure(
      image([{ kind: 'rect', x: -50, y: 0, width: 10, height: 10, style: 1 }], {
        definitions: [clip],
        styles: [{ overflow: 'visible' }, { clipPath: 'clip' }],
      }),
    )
    contains(box, -50, 0)
  })

  it('rejects cyclic local references within a bounded traversal', () => {
    const symbol: SdkDocumentSvgDefinition = {
      kind: 'symbol',
      id: 'loop',
      children: [{ kind: 'use', ref: 'loop' }],
    }
    expect(() => measure(image([{ kind: 'use', ref: 'loop' }], { definitions: [symbol] }))).toThrow(
      ConversionError,
    )
  })

  it('rejects nonfinite private metrics', () => {
    const text: SdkDocumentSvgNode = { kind: 'text', children: [] }
    expect(() =>
      measureSvgPaintBounds(image([text]), new WeakMap([[text, [Number.NaN, 0, 1, 1] as const]])),
    ).toThrow(ConversionError)
  })
  it('does not inherit the referencing shape stroke:none into marker contents', () => {
    const marker: SdkDocumentSvgDefinition = {
      kind: 'marker',
      id: 'inherited',
      width: 1,
      height: 1,
      refX: user(0),
      refY: user(0),
      units: 'userSpaceOnUse',
      orient: { degrees: 0 },
      children: [{ kind: 'rect', x: 0, y: 0, width: 1, height: 1 }],
    }
    const bounds = measure(
      image([{ kind: 'line', x1: 0, y1: 0, x2: 0, y2: 0, style: 1, markerEnd: 'inherited' }], {
        definitions: [marker],
        styles: [
          { overflow: 'visible', stroke: black, strokeWidth: user(10), lineJoin: 'round' },
          { stroke: { kind: 'none' } },
        ],
      }),
    )
    contains(bounds, -5, -5)
  })

  it('resolves marker em reference using its own font and root inheritance', () => {
    const marker: SdkDocumentSvgDefinition = {
      kind: 'marker',
      id: 'font',
      width: 1,
      height: 1,
      refX: { value: 1, unit: 'em' },
      refY: user(0),
      units: 'userSpaceOnUse',
      orient: { degrees: 0 },
      style: 2,
      children: [{ kind: 'rect', x: 0, y: 0, width: 1, height: 1 }],
    }
    const bounds = measure(
      image([{ kind: 'line', x1: 0, y1: 0, x2: 0, y2: 0, style: 1, markerEnd: 'font' }], {
        definitions: [marker],
        styles: [
          { overflow: 'visible', fontSize: user(16) },
          { fontSize: user(1) },
          { fontSize: { value: 2, unit: 'em' } },
        ],
      }),
    )
    contains(bounds, -32, 0)
  })
})

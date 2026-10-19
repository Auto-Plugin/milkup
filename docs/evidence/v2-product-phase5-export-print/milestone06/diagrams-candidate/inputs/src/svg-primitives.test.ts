import { describe, expect, it } from 'vitest'
import {
  ConversionError,
  color,
  finite,
  fontId,
  length,
  localMatrix,
  numberList,
  parsePath,
} from './svg-primitives'

describe('closed SVG numeric and paint input', () => {
  it('preserves fractional percentage and em lengths without viewport guessing', () => {
    expect(length('12.5%')).toEqual({ value: 12.5, unit: 'percent' })
    expect(length('-0.125em')).toEqual({ value: -0.125, unit: 'em' })
  })
  it.each(['calc(1px + 2px)', '1rem', 'NaN', 'Infinity', '9000'])(
    'rejects unknown or oversized length %s',
    (value) => {
      expect(() => length(value)).toThrow(ConversionError)
    },
  )
  it('retains zero lengths and signs in lists', () => {
    expect(numberList('0,0 2 2 0')).toEqual([0, 0, 2, 2, 0])
    expect(numberList('1e2-20')).toEqual([100, -20])
  })
  it.each(['1,,2', '1,', 'url(#x)'])('rejects malformed numeric lists %s', (value) => {
    expect(() => numberList(value)).toThrow(ConversionError)
  })
  it('retains computed alpha and sRGB channels', () => {
    expect(color('rgba(16, 32, 64, 0.25)')).toEqual([16, 32, 64, 0.25])
    expect(color('color(srgb 0.2 0.4 0.6 / 0.5)')).toEqual([51, 102, 153, 0.5])
  })
  it.each(['url(#g)', 'rgb(256,0,0)', 'rgba(1,2,3,2)', 'color(display-p3 1 0 0)'])(
    'rejects unsupported color %s',
    (value) => {
      expect(() => color(value)).toThrow(ConversionError)
    },
  )
  it('keeps approved offline font sequences exact', () => {
    expect(fontId('"Open Sans", sans-serif')).toBe('open-sans-sans')
    expect(() => fontId('Arbitrary Remote Font')).toThrow(ConversionError)
  })
  it('rejects nonfinite and excessive coordinates', () => {
    expect(() => finite(Number.NaN)).toThrow(ConversionError)
    expect(() => finite(8193)).toThrow(ConversionError)
  })
})

describe('full ordinary SVG path grammar and local matrix values', () => {
  it('preserves compact arc flags and successive implicit coordinates', () => {
    expect(parsePath('M0 0 4 5A10 20 0 0110-20z')).toEqual([
      ['M', 0, 0],
      ['L', 4, 5],
      ['A', 10, 20, 0, 0, 1, 10, -20],
      ['z'],
    ])
  })
  it('retains cubic, smooth and quadratic operations without flattening', () => {
    expect(parsePath('M0 0C1 2 3 4 5 6s1 2 3 4Q5 6 7 8t9 10')).toEqual([
      ['M', 0, 0],
      ['C', 1, 2, 3, 4, 5, 6],
      ['s', 1, 2, 3, 4],
      ['Q', 5, 6, 7, 8],
      ['t', 9, 10],
    ])
  })
  it.each(['L0 0', 'M0', 'M0 0A-1 1 0 0 1 1 1', 'M0 0A1 1 0 2 1 1 1', 'M0 0R1 2'])(
    'rejects malformed path %s',
    (value) => {
      expect(() => parsePath(value)).toThrow(ConversionError)
    },
  )
  it('charges explicit close operations against the same path budget', () => {
    expect(() => parsePath('M0 0' + 'Z'.repeat(4096))).toThrow(ConversionError)
  })
  it('does not accept arbitrary CSS transforms or dimensional transforms', () => {
    expect(localMatrix('matrix(1,0,0,1,20,30)')).toEqual([
      { kind: 'matrix', values: [1, 0, 0, 1, 20, 30] },
    ])
    expect(() => localMatrix('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)')).toThrow(ConversionError)
  })
})

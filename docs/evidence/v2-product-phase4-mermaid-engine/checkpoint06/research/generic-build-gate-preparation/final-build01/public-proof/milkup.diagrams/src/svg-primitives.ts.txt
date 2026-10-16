import type {
  SdkDocumentSvgLength,
  SdkDocumentSvgPathCommand,
  SdkDocumentSvgRgba,
  SdkDocumentSvgStyle,
  SdkDocumentSvgTransform,
} from '@milkup/plugin-sdk'

export type ConversionCode =
  | 'invalid-output'
  | 'unsafe-output'
  | 'unsupported-feature'
  | 'unsupported-animation'
  | 'font-unavailable'
  | 'limit-exceeded'

export class ConversionError extends Error {
  constructor(
    readonly code: ConversionCode,
    reason: string,
    readonly path = '',
  ) {
    super(reason)
    this.name = 'ConversionError'
  }
}
export function fail(code: ConversionCode, reason: string, path = ''): never {
  throw new ConversionError(code, reason, path)
}
/** Matches the closed SVG text domain; never truncates semantic content. */
export function svgText(value: string, label = 'text'): string {
  if (value.length > 4096) fail('limit-exceeded', label + ' exceeds 4096 UTF16 units')
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) {
    fail('invalid-output', label + ' contains an XML-inexpressible character')
  }
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++i)
      if (!(low >= 0xdc00 && low <= 0xdfff))
        fail('invalid-output', label + ' contains an unpaired surrogate')
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail('invalid-output', label + ' contains an unpaired surrogate')
    }
  }
  return value
}
export function finite(value: unknown, label = 'number', limit = 8192): number {
  if (typeof value !== 'number' && typeof value !== 'string') fail('invalid-output', label)
  const n = Number(value)
  if (!Number.isFinite(n) || Math.abs(n) > limit) fail('limit-exceeded', label)
  return n
}
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i
export function length(value: string | null | undefined, fallback = '0'): SdkDocumentSvgLength {
  const text = (value ?? fallback).trim()
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|em|%)?$/i.exec(text)
  if (!match) fail('unsupported-feature', 'unsupported length: ' + text)
  const unit = match[2]?.toLowerCase()
  return {
    value: finite(match[1], 'length'),
    unit: unit === '%' ? 'percent' : unit === 'px' ? 'px' : unit === 'em' ? 'em' : 'user',
  }
}
export function numberList(value: string | null | undefined): number[] {
  let text = (value ?? '').trim()
  const out: number[] = []
  while (text) {
    const match = NUMBER.exec(text)
    if (!match) fail('invalid-output', 'invalid numeric list')
    out.push(finite(match[0]))
    text = text.slice(match[0].length)
    const separator = /^[\s,]*/.exec(text)![0]
    if ((separator.match(/,/g) ?? []).length > 1) fail('invalid-output', 'repeated comma')
    text = text.slice(separator.length)
    if (separator.includes(',') && !text) fail('invalid-output', 'trailing comma')
    if (out.length > 8192) fail('limit-exceeded', 'numeric list')
  }
  return out
}
export function lengthList(value: string | null | undefined): SdkDocumentSvgLength[] | undefined {
  return value?.trim()
    ? value
        .trim()
        .split(/[\s,]+/)
        .map((x) => length(x))
    : undefined
}
export function color(value: string): SdkDocumentSvgRgba {
  const text = value.trim()
  if (text === 'transparent') return [0, 0, 0, 0]
  let match = /^rgba?\((.*)\)$/i.exec(text)
  if (match) {
    const parts = match[1]!
      .trim()
      .split(/[\s,/]+/)
      .filter(Boolean)
    if (parts.length !== 3 && parts.length !== 4) fail('unsupported-feature', 'color arity')
    const channels = parts
      .slice(0, 3)
      .map((x) => (x.endsWith('%') ? finite(x.slice(0, -1)) * 2.55 : finite(x)))
    const a = parts[3]
    const alpha = a === undefined ? 1 : a.endsWith('%') ? finite(a.slice(0, -1)) / 100 : finite(a)
    if (channels.some((x) => x < 0 || x > 255) || alpha < 0 || alpha > 1)
      fail('invalid-output', 'color range')
    return [channels[0]!, channels[1]!, channels[2]!, alpha]
  }
  match = /^color\(srgb\s+(.+)\)$/i.exec(text)
  if (match) {
    const parts = match[1]!.split(/[\s/]+/).map(Number)
    if (
      parts.length < 3 ||
      parts.length > 4 ||
      parts.some((x) => !Number.isFinite(x) || x < 0 || x > 1)
    )
      fail('unsupported-feature', 'color srgb')
    return [parts[0]! * 255, parts[1]! * 255, parts[2]! * 255, parts[3] ?? 1]
  }
  match = /^#([a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.exec(text)
  if (match) {
    let hex = match[1]!
    if (hex.length === 3) hex = [...hex].map((x) => x + x).join('')
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1,
    ]
  }
  fail('unsupported-feature', 'unsupported computed color: ' + text)
}
const ARITIES: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
}
function arcFlag(value: number | undefined): 0 | 1 {
  if (value === 0 || value === 1) return value
  fail('invalid-output', 'arc flag')
}
function pathCommand(command: string, values: readonly number[]): SdkDocumentSvgPathCommand {
  switch (command) {
    case 'M':
    case 'm':
    case 'L':
    case 'l':
    case 'T':
    case 't':
      return [command, values[0]!, values[1]!]
    case 'H':
    case 'h':
    case 'V':
    case 'v':
      return [command, values[0]!]
    case 'C':
    case 'c':
      return [command, values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!]
    case 'S':
    case 's':
    case 'Q':
    case 'q':
      return [command, values[0]!, values[1]!, values[2]!, values[3]!]
    case 'A':
    case 'a':
      return [
        command,
        values[0]!,
        values[1]!,
        values[2]!,
        arcFlag(values[3]),
        arcFlag(values[4]),
        values[5]!,
        values[6]!,
      ]
    case 'Z':
    case 'z':
      return [command]
    default:
      fail('invalid-output', 'path command')
  }
}
export function parsePath(value: string): SdkDocumentSvgPathCommand[] {
  if (value.length > 262144) fail('limit-exceeded', 'path bytes')
  let position = 0,
    command: string | undefined,
    first = true
  const out: SdkDocumentSvgPathCommand[] = []
  const whitespace = () => {
    while (position < value.length && /\s/.test(value[position]!)) position++
  }
  while (true) {
    whitespace()
    if (position >= value.length) break
    let explicit = false
    if (/[a-z]/i.test(value[position]!)) {
      command = value[position++]!
      explicit = true
      if (!Object.hasOwn(ARITIES, command.toUpperCase())) fail('invalid-output', 'path command')
    }
    if (!command) fail('invalid-output', 'path must start with command')
    const upper = command.toUpperCase()
    if (first && upper !== 'M') fail('invalid-output', 'path starts without moveto')
    first = false
    if (upper === 'Z') {
      out.push(pathCommand(command, []))
      command = undefined
    } else {
      const values: number[] = []
      for (let j = 0; j < ARITIES[upper]!; j++) {
        whitespace()
        if (value[position] === ',') {
          if (j === 0 && explicit) fail('invalid-output', 'comma after command')
          position++
          whitespace()
          if (value[position] === ',') fail('invalid-output', 'repeated comma')
        }
        if (upper === 'A' && (j === 3 || j === 4)) {
          if (value[position] !== '0' && value[position] !== '1') fail('invalid-output', 'arc flag')
          values.push(Number(value[position++]))
        } else {
          const match = NUMBER.exec(value.slice(position))
          if (!match) fail('invalid-output', 'path parameter')
          values.push(finite(match[0], 'path coordinate'))
          position += match[0].length
        }
      }
      if (upper === 'A' && (values[0]! < 0 || values[1]! < 0))
        fail('invalid-output', 'negative arc radius')
      out.push(pathCommand(command, values))
      if (upper === 'M') command = command === 'M' ? 'L' : 'l'
    }
    if (out.length > 4096) fail('limit-exceeded', 'path command count')
  }
  return out
}
export function localMatrix(
  value: string | null | undefined,
): SdkDocumentSvgTransform[] | undefined {
  if (!value || value === 'none') return undefined
  const match = /^matrix\(([^)]+)\)$/.exec(value)
  if (!match) fail('unsupported-feature', '3D or unknown transform')
  const values = numberList(match[1])
  if (values.length !== 6) fail('invalid-output', 'matrix arity')
  return [
    {
      kind: 'matrix',
      values: [values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!],
    },
  ]
}
const FONTS: ReadonlyMap<string, NonNullable<SdkDocumentSvgStyle['fontId']>> = new Map([
  ['arial, sans-serif', 'arial-sans'],
  ['arial,sans-serif', 'arial-sans'],
  ['open sans, sans-serif', 'open-sans-sans'],
  ['open sans,sans-serif', 'open-sans-sans'],
  ['trebuchet ms, verdana, arial, sans-serif', 'trebuchet-verdana-arial-sans'],
  ['sans-serif', 'sans'],
  ['serif', 'serif'],
  ['monospace', 'monospace'],
])
export function fontId(value: string): NonNullable<SdkDocumentSvgStyle['fontId']> {
  const key = value.toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim()
  const id = FONTS.get(key)
  if (id) return id
  fail('font-unavailable', 'unmapped offline font sequence: ' + value)
}

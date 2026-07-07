import { createNode, type SyntaxNode } from '../cst/node'

export function parseInline(source: string, from = 0, to = source.length): readonly SyntaxNode[] {
  if (to <= from) {
    return []
  }

  const nodes: SyntaxNode[] = []
  let pos = from

  while (pos < to) {
    const parsed =
      parseHardBreak(source, pos, to) ??
      parseEscape(source, pos, to) ??
      parseCodeSpan(source, pos, to) ??
      parseImage(source, pos, to) ??
      parseLink(source, pos, to) ??
      parseAutolink(source, pos, to) ??
      parseStrong(source, pos, to) ??
      parseEmphasis(source, pos, to)

    if (parsed) {
      nodes.push(parsed.node)
      pos = parsed.next
      continue
    }

    const textEnd = findNextSpecial(source, pos + 1, to)
    nodes.push(createTextNode(source, pos, textEnd))
    pos = textEnd
  }

  return Object.freeze(nodes)
}

export function parseInlineText(
  source: string,
  from = 0,
  to = source.length,
): readonly SyntaxNode[] {
  if (to <= from) {
    return []
  }

  return Object.freeze([createTextNode(source, from, to)])
}

interface InlineParseResult {
  readonly node: SyntaxNode
  readonly next: number
}

function parseEscape(source: string, pos: number, to: number): InlineParseResult | undefined {
  if (source[pos] !== '\\' || pos + 1 >= to) {
    return undefined
  }

  return {
    node: createNode({
      type: 'escape',
      from: pos,
      to: pos + 2,
      status: 'valid',
      markerRanges: [{ from: pos, to: pos + 1 }],
      contentRanges: [{ from: pos + 1, to: pos + 2 }],
      data: { value: source.slice(pos + 1, pos + 2) },
    }),
    next: pos + 2,
  }
}

function parseHardBreak(source: string, pos: number, to: number): InlineParseResult | undefined {
  if (pos + 2 < to && source[pos] === ' ' && source[pos + 1] === ' ' && source[pos + 2] === '\n') {
    return {
      node: createNode({
        type: 'hardBreak',
        from: pos,
        to: pos + 3,
        status: 'valid',
        markerRanges: [{ from: pos, to: pos + 2 }],
        data: { kind: 'spaces' },
      }),
      next: pos + 3,
    }
  }

  if (pos + 1 < to && source[pos] === '\\' && source[pos + 1] === '\n') {
    return {
      node: createNode({
        type: 'hardBreak',
        from: pos,
        to: pos + 2,
        status: 'valid',
        markerRanges: [{ from: pos, to: pos + 1 }],
        data: { kind: 'backslash' },
      }),
      next: pos + 2,
    }
  }

  return undefined
}

function parseCodeSpan(source: string, pos: number, to: number): InlineParseResult | undefined {
  if (source[pos] !== '`') {
    return undefined
  }

  const markerTo = consumeRun(source, pos, to, '`')
  const markerLength = markerTo - pos
  const closing = findClosingRun(source, markerTo, to, '`', markerLength)

  if (closing === -1) {
    return {
      node: createNode({
        type: 'inlineCode',
        from: pos,
        to,
        status: 'incomplete',
        markerRanges: [{ from: pos, to: markerTo }],
        contentRanges: [{ from: markerTo, to }],
      }),
      next: to,
    }
  }

  return {
    node: createNode({
      type: 'inlineCode',
      from: pos,
      to: closing + markerLength,
      status: 'valid',
      markerRanges: [
        { from: pos, to: markerTo },
        { from: closing, to: closing + markerLength },
      ],
      contentRanges: [{ from: markerTo, to: closing }],
      data: { value: source.slice(markerTo, closing) },
    }),
    next: closing + markerLength,
  }
}

function parseImage(source: string, pos: number, to: number): InlineParseResult | undefined {
  if (source.slice(pos, pos + 2) !== '![') {
    return undefined
  }

  return parseLinkLike(source, pos, to, true)
}

function parseLink(source: string, pos: number, to: number): InlineParseResult | undefined {
  if (source[pos] !== '[') {
    return undefined
  }

  return parseLinkLike(source, pos, to, false)
}

function parseLinkLike(
  source: string,
  pos: number,
  to: number,
  image: boolean,
): InlineParseResult | undefined {
  const labelOpen = image ? pos + 1 : pos
  const labelStart = labelOpen + 1
  const labelClose = source.indexOf(']', labelStart)
  const initialMarkerRanges = image
    ? [
        { from: pos, to: pos + 1 },
        { from: labelOpen, to: labelOpen + 1 },
      ]
    : [{ from: labelOpen, to: labelOpen + 1 }]

  if (labelClose === -1 || labelClose >= to) {
    return {
      node: createNode({
        type: image ? 'image' : 'link',
        from: pos,
        to,
        status: 'incomplete',
        markerRanges: initialMarkerRanges,
        contentRanges: [{ from: labelStart, to }],
      }),
      next: to,
    }
  }

  const destinationOpen = labelClose + 1

  if (source[destinationOpen] !== '(' || destinationOpen >= to) {
    return undefined
  }

  const destinationStart = destinationOpen + 1
  const destinationClose = source.indexOf(')', destinationStart)
  const markerRanges = [
    ...initialMarkerRanges,
    { from: labelClose, to: labelClose + 1 },
    { from: destinationOpen, to: destinationOpen + 1 },
  ]

  if (destinationClose === -1 || destinationClose >= to) {
    return {
      node: createNode({
        type: image ? 'image' : 'link',
        from: pos,
        to,
        status: 'incomplete',
        markerRanges,
        contentRanges: [
          { from: labelStart, to: labelClose },
          { from: destinationStart, to },
        ],
        children: image ? [] : parseInline(source, labelStart, labelClose),
      }),
      next: to,
    }
  }

  return {
    node: createNode({
      type: image ? 'image' : 'link',
      from: pos,
      to: destinationClose + 1,
      status: 'valid',
      markerRanges: [...markerRanges, { from: destinationClose, to: destinationClose + 1 }],
      contentRanges: [
        { from: labelStart, to: labelClose },
        { from: destinationStart, to: destinationClose },
      ],
      children: image ? [] : parseInline(source, labelStart, labelClose),
      data: {
        label: source.slice(labelStart, labelClose),
        destination: source.slice(destinationStart, destinationClose),
      },
    }),
    next: destinationClose + 1,
  }
}

function parseAutolink(source: string, pos: number, to: number): InlineParseResult | undefined {
  if (source[pos] !== '<') {
    return undefined
  }

  const close = source.indexOf('>', pos + 1)

  if (close === -1 || close >= to) {
    return undefined
  }

  const value = source.slice(pos + 1, close)
  const kind = classifyAutolink(value)

  if (!kind) {
    return undefined
  }

  return {
    node: createNode({
      type: 'autolink',
      from: pos,
      to: close + 1,
      status: 'valid',
      markerRanges: [
        { from: pos, to: pos + 1 },
        { from: close, to: close + 1 },
      ],
      contentRanges: [{ from: pos + 1, to: close }],
      data: { kind, value },
    }),
    next: close + 1,
  }
}

function classifyAutolink(value: string): 'url' | 'email' | undefined {
  if (/^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/.test(value)) {
    return 'url'
  }

  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) {
    return 'email'
  }

  return undefined
}

function parseStrong(source: string, pos: number, to: number): InlineParseResult | undefined {
  if (source.slice(pos, pos + 2) !== '**') {
    return undefined
  }

  const closing = source.indexOf('**', pos + 2)

  if (closing === -1 || closing >= to) {
    return {
      node: createNode({
        type: 'strong',
        from: pos,
        to,
        status: 'incomplete',
        markerRanges: [{ from: pos, to: pos + 2 }],
        contentRanges: [{ from: pos + 2, to }],
      }),
      next: to,
    }
  }

  return {
    node: createNode({
      type: 'strong',
      from: pos,
      to: closing + 2,
      status: 'valid',
      markerRanges: [
        { from: pos, to: pos + 2 },
        { from: closing, to: closing + 2 },
      ],
      contentRanges: [{ from: pos + 2, to: closing }],
      children: parseInline(source, pos + 2, closing),
    }),
    next: closing + 2,
  }
}

function parseEmphasis(source: string, pos: number, to: number): InlineParseResult | undefined {
  if (source[pos] !== '*' || source[pos + 1] === '*') {
    return undefined
  }

  const closing = source.indexOf('*', pos + 1)

  if (closing === -1 || closing >= to) {
    return {
      node: createNode({
        type: 'emphasis',
        from: pos,
        to,
        status: 'incomplete',
        markerRanges: [{ from: pos, to: pos + 1 }],
        contentRanges: [{ from: pos + 1, to }],
      }),
      next: to,
    }
  }

  return {
    node: createNode({
      type: 'emphasis',
      from: pos,
      to: closing + 1,
      status: 'valid',
      markerRanges: [
        { from: pos, to: pos + 1 },
        { from: closing, to: closing + 1 },
      ],
      contentRanges: [{ from: pos + 1, to: closing }],
      children: parseInline(source, pos + 1, closing),
    }),
    next: closing + 1,
  }
}

function createTextNode(source: string, from: number, to: number): SyntaxNode {
  return createNode({
    type: 'text',
    from,
    to,
    status: 'valid',
    contentRanges: [{ from, to }],
    data: { value: source.slice(from, to) },
  })
}

function findNextSpecial(source: string, from: number, to: number): number {
  for (let pos = from; pos < to; pos += 1) {
    const char = source[pos]

    if (
      char === '\\' ||
      char === '`' ||
      char === '*' ||
      char === '[' ||
      char === '!' ||
      char === '<' ||
      (char === ' ' && source[pos + 1] === ' ' && source[pos + 2] === '\n')
    ) {
      return pos
    }
  }

  return to
}

function consumeRun(source: string, from: number, to: number, char: string): number {
  let pos = from

  while (pos < to && source[pos] === char) {
    pos += 1
  }

  return pos
}

function findClosingRun(
  source: string,
  from: number,
  to: number,
  char: string,
  length: number,
): number {
  for (let pos = from; pos < to; pos += 1) {
    if (source[pos] !== char) {
      continue
    }

    const end = consumeRun(source, pos, to, char)

    if (end - pos === length) {
      return pos
    }

    pos = end - 1
  }

  return -1
}

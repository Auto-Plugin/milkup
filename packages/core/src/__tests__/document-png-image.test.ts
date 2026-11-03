import { deflateSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  copyDocumentPresentationNode,
  copyDocumentPresentationRequest,
  copyDocumentPresentationResult,
  serializeDocumentPresentationNode,
} from '../document-presentation'
import {
  acquireDocumentPngImage,
  copyHostDocumentPresentationAggregate,
  copyHostDocumentPresentationNode,
  createDocumentPngImage,
  disposeDocumentPngImages,
  documentPngResourceStats,
  retainDocumentPngImages,
  type DocumentPngImage,
} from '../document-png-image'

// Real PNG chunks and compressed scanlines. Browser pixel fidelity is a
// separate native acceptance gate; these fixtures exercise the transport.
function chunk(type: string, data = new Uint8Array()): Uint8Array {
  const result = new Uint8Array(data.length + 12)
  const view = new DataView(result.buffer)
  view.setUint32(0, data.length)
  result.set(new TextEncoder().encode(type), 4)
  result.set(data, 8)
  let crc = 0xffffffff
  for (const byte of result.subarray(4, result.length - 4)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0)
  return result
}
function png(width = 2, height = 2, beforeData: readonly Uint8Array[] = []): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8
  header[9] = 6
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...beforeData,
    chunk('IDAT', deflateSync(new Uint8Array((width * 4 + 1) * height))),
    chunk('IEND'),
  ]
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}
const owned: DocumentPngImage[] = []
const decoded: Array<{ dispose(): void }> = []
function create(bytes = png(), width = 2, height = 2, release = vi.fn()) {
  const image = createDocumentPngImage({ bytes, width, height, release, title: 'Private diagram' })
  owned.push(image)
  return image
}
afterEach(() => {
  for (const owner of decoded.splice(0)) owner.dispose()
  for (const image of owned.splice(0)) disposeDocumentPngImages(image)
  expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
})
const request = copyDocumentPresentationRequest({
  documentId: 'private-png-test',
  version: 0,
  source: 'diagram source',
  from: 0,
  to: 14,
  fromLine: 1,
  toLine: 1,
  completeStart: true,
  completeEnd: true,
  contextKnown: true,
  protectedRanges: [],
  blocks: [],
  selection: { anchor: 14, head: 14 },
  theme: 'light',
  target: 'screen',
  width: 640,
})
function result(content: unknown) {
  return {
    complete: true,
    fragments: [{ from: 0, to: 14, layout: 'block', accessibleText: 'diagram', content }],
  }
}
const declarations = [{ id: 'private-fixture', contexts: ['text'] as const }]

describe('private PNG document presentation transport', () => {
  it('accepts only host-minted identity while the public grammar and serializer reject it', () => {
    const image = create()
    expect(copyHostDocumentPresentationNode(image)).toBe(image)
    expect(
      copyHostDocumentPresentationAggregate(result(image), request, declarations).fragments[0]
        ?.content,
    ).toBe(image)
    for (const value of [image, { ...image }, JSON.parse(JSON.stringify(image))]) {
      expect(() => copyDocumentPresentationNode(value)).toThrow()
      expect(() => copyDocumentPresentationResult(result(value), request, declarations)).toThrow()
      expect(() => serializeDocumentPresentationNode(value)).toThrow()
    }
    expect(() => copyHostDocumentPresentationNode({ ...image })).toThrow()
    expect(() =>
      copyHostDocumentPresentationAggregate(
        result(image),
        { ...request, target: 'export' },
        declarations,
      ),
    ).toThrow()
  })

  it('copies bytes before returning authority and freezes public metadata', () => {
    const bytes = png()
    const original = bytes.slice()
    const image = create(bytes)
    bytes.fill(0)
    const owner = acquireDocumentPngImage(image)
    decoded.push(owner)
    expect(owner.bytes).toEqual(original)
    expect(Object.isFrozen(image)).toBe(true)
    expect(Object.keys(image)).not.toContain('bytes')
  })

  it.each(['signature', 'crc', 'truncated', 'trailing', 'dimensions', 'apng', 'critical'] as const)(
    'rejects invalid %s before reserving resources',
    (kind) => {
      let bytes = png()
      let width = 2
      if (kind === 'signature') bytes[0] = 0
      if (kind === 'crc') bytes[29] = bytes[29]! ^ 1
      if (kind === 'truncated') bytes = bytes.subarray(0, bytes.length - 1)
      if (kind === 'trailing') bytes = new Uint8Array([...bytes, 0])
      if (kind === 'dimensions') width = 3
      if (kind === 'apng') bytes = png(2, 2, [chunk('acTL', new Uint8Array(8))])
      if (kind === 'critical') bytes = png(2, 2, [chunk('ABCD')])
      const release = vi.fn()
      expect(() => createDocumentPngImage({ bytes, width, height: 2, release })).toThrow()
      expect(release).not.toHaveBeenCalled()
      expect(documentPngResourceStats()).toEqual({ bytes: 0, images: 0, decodedOwners: 0 })
    },
  )

  it('retains unique image references once per result and releases native output exactly once', () => {
    const release = vi.fn()
    const image = create(png(), 2, 2, release)
    const tree = { type: 'group', children: [image, image] }
    retainDocumentPngImages(tree)
    disposeDocumentPngImages(tree)
    expect(release).not.toHaveBeenCalled()
    const owner = acquireDocumentPngImage(image)
    decoded.push(owner)
    disposeDocumentPngImages(image)
    expect(release).not.toHaveBeenCalled()
    owner.dispose()
    owner.dispose()
    expect(release).toHaveBeenCalledTimes(1)
    expect(() => acquireDocumentPngImage(image)).toThrow()
    expect(() => copyHostDocumentPresentationNode(image)).toThrow()
  })

  it('charges both the old and replacement decoded images against one total budget', () => {
    const bytes = png(4096, 4096)
    const old = create(bytes, 4096, 4096)
    const next = create(bytes, 4096, 4096)
    const first = acquireDocumentPngImage(old)
    decoded.push(first)
    const before = documentPngResourceStats()
    expect(before.decodedOwners).toBe(1)
    expect(() => acquireDocumentPngImage(next)).toThrow()
    expect(documentPngResourceStats()).toEqual(before)
    first.dispose()
    const replacement = acquireDocumentPngImage(next)
    decoded.push(replacement)
    expect(documentPngResourceStats().decodedOwners).toBe(1)
  })

  it('fails retain atomically when a result mixes a live token with a disposed token', () => {
    const release = vi.fn()
    const live = create(png(), 2, 2, release)
    const stale = create()
    disposeDocumentPngImages(stale)
    expect(() => retainDocumentPngImages([live, stale])).toThrow()
    disposeDocumentPngImages(live)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('still validates source ranges and the complete compound grammar around a private image', () => {
    const image = create()
    const mixed = { type: 'group', children: [{ type: 'text', text: 'caption' }, image] }
    expect(
      copyHostDocumentPresentationAggregate(result(mixed), request, declarations).fragments,
    ).toHaveLength(1)
    expect(() =>
      copyHostDocumentPresentationAggregate(
        result(mixed),
        { ...request, contextKnown: false },
        declarations,
      ),
    ).toThrow()
    expect(() =>
      copyHostDocumentPresentationAggregate(
        result({ type: 'group', children: [image, { type: 'raw-html', text: '<script/>' }] }),
        request,
        declarations,
      ),
    ).toThrow()
  })
})

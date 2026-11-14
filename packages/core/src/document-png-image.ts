import {
  copyDocumentPresentationNode,
  copyDocumentPresentationResult,
  DocumentPresentationError,
  type DocumentPresentationNode,
  type DocumentPresentationRequest,
  type DocumentPresentationResult,
  type DocumentRendererDeclaration,
} from './document-presentation'

// This module is an internal host entry point. Nothing here is exposed to the
// plugin SDK or its wire decoder. Only the exact objects in this realm's map
// carry image authority; JSON copies, matching IDs and structural casts do not.
declare const hostPngBrand: unique symbol
export interface DocumentPngImage {
  readonly type: 'host-png-image'
  readonly id: number
  readonly width: number
  readonly height: number
  readonly title: string
  readonly [hostPngBrand]: true
}
export const DOCUMENT_PNG_LIMITS = Object.freeze({
  imageBytes: 16 * 1024 * 1024,
  dimension: 8192,
  pixels: 16 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  images: 128,
})
interface Entry {
  bytes: Uint8Array
  references: number
  readonly release: () => void
}
const entries = new WeakMap<DocumentPngImage, Entry>()
let nextId = 0
let allocatedBytes = 0
let imageCount = 0
let decodedOwners = 0
const fail = (): never => {
  throw new DocumentPresentationError('invalid-output')
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})
function crc(bytes: Uint8Array, from: number, to: number): number {
  let value = 0xffffffff
  for (let index = from; index < to; index++)
    value = (value >>> 8) ^ crcTable[(value ^ bytes[index]!) & 255]!
  return (value ^ 0xffffffff) >>> 0
}
function validatePng(bytes: Uint8Array, width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > DOCUMENT_PNG_LIMITS.dimension ||
    height > DOCUMENT_PNG_LIMITS.dimension ||
    width * height > DOCUMENT_PNG_LIMITS.pixels ||
    bytes.length < 57 ||
    bytes.length > DOCUMENT_PNG_LIMITS.imageBytes ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  )
    fail()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let data = false
  let endedData = false
  let ended = false
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail()
    const length = view.getUint32(offset)
    if (length > bytes.length - offset - 12) fail()
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      crc(bytes, offset + 4, offset + 8 + length) !== view.getUint32(offset + 8 + length)
    )
      fail()
    if (offset === 8) {
      if (
        type !== 'IHDR' ||
        length !== 13 ||
        view.getUint32(16) !== width ||
        view.getUint32(20) !== height
      )
        fail()
      const depths: Record<number, readonly number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      }
      if (
        !depths[bytes[25]!]?.includes(bytes[24]!) ||
        bytes[26] !== 0 ||
        bytes[27] !== 0 ||
        bytes[28]! > 1
      )
        fail()
    } else if (type === 'IHDR') fail()
    else if (type === 'IDAT') {
      if (endedData) fail()
      data = true
    } else {
      if (data) endedData = true
      if (type === 'IEND') {
        if (!data || length !== 0 || offset + 12 !== bytes.length) fail()
        ended = true
      } else if (
        type === 'acTL' ||
        type === 'fcTL' ||
        type === 'fdAT' ||
        (type[0] === type[0]!.toUpperCase() && type !== 'PLTE')
      )
        fail()
    }
    offset += length + 12
  }
  if (!ended) fail()
}
function reserve(bytes: number): void {
  if (bytes > DOCUMENT_PNG_LIMITS.totalBytes - allocatedBytes) fail()
  allocatedBytes += bytes
}

/** Creates one transferable result ownership. The host releases native output
 * once all result/cache and decoded DOM owners have released their references. */
export function createDocumentPngImage(value: {
  readonly bytes: Uint8Array
  readonly width: number
  readonly height: number
  readonly title?: string
  readonly release: () => void
}): DocumentPngImage {
  if (
    !(value.bytes instanceof Uint8Array) ||
    typeof value.release !== 'function' ||
    (value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 8192)) ||
    imageCount >= DOCUMENT_PNG_LIMITS.images
  )
    fail()
  // Copy before validation so no caller can mutate accepted image content.
  if (value.bytes.byteLength > DOCUMENT_PNG_LIMITS.imageBytes) fail()
  const bytes = new Uint8Array(value.bytes)
  validatePng(bytes, value.width, value.height)
  reserve(bytes.byteLength)
  const image = Object.freeze({
    type: 'host-png-image' as const,
    id: ++nextId,
    width: value.width,
    height: value.height,
    title: value.title ?? '',
  }) as DocumentPngImage
  entries.set(image, { bytes, references: 1, release: value.release })
  imageCount++
  return image
}
export function isDocumentPngImage(value: unknown): value is DocumentPngImage {
  return !!value && typeof value === 'object' && entries.has(value as DocumentPngImage)
}
function entry(image: DocumentPngImage): Entry {
  const value = entries.get(image)
  if (!value || value.references <= 0) fail()
  return value!
}
function release(image: DocumentPngImage): void {
  const value = entries.get(image)
  if (!value || value.references <= 0) return
  if (--value.references) return
  allocatedBytes -= value.bytes.byteLength
  value.bytes = new Uint8Array()
  imageCount--
  try {
    value.release()
  } catch {
    /* A cleanup failure must not strand other owners. */
  }
}
function images(value: unknown): Set<DocumentPngImage> {
  const found = new Set<DocumentPngImage>()
  const visited = new Set<object>()
  const visit = (item: unknown, depth: number): void => {
    if (!item || typeof item !== 'object' || visited.has(item) || depth > 80) return
    visited.add(item)
    if (isDocumentPngImage(item)) {
      found.add(item)
      return
    }
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item)))
      if ('value' in descriptor) visit(descriptor.value, depth + 1)
  }
  visit(value, 0)
  return found
}
/** Internal inspection for releasing a failed cache fragment exactly once. */
export function documentPngImages(value: unknown): readonly DocumentPngImage[] {
  return Object.freeze([...images(value)])
}
/** Internal cache accounting; does not expose bytes or create another lease. */
export function documentPngImageByteLength(image: DocumentPngImage): number {
  return entry(image).bytes.byteLength
}
export function retainDocumentPngImages(value: unknown): void {
  const owned = images(value)
  for (const image of owned) entry(image)
  for (const image of owned) entry(image).references++
}
export function disposeDocumentPngImages(value: unknown): void {
  for (const image of images(value)) release(image)
}
/** A distinct DOM allocation is charged while old and new images coexist. */
export function acquireDocumentPngImage(image: DocumentPngImage): {
  readonly bytes: Uint8Array
  dispose(): void
} {
  const value = entry(image)
  const cost = value.bytes.byteLength + image.width * image.height * 4
  reserve(cost)
  value.references++
  decodedOwners++
  let disposed = false
  return {
    bytes: value.bytes,
    dispose() {
      if (disposed) return
      disposed = true
      allocatedBytes -= cost
      decodedOwners--
      release(image)
    },
  }
}
export function documentPngResourceStats(): Readonly<{
  bytes: number
  images: number
  decodedOwners: number
}> {
  return Object.freeze({ bytes: allocatedBytes, images: imageCount, decodedOwners })
}

// Validate the original closed public grammar with inert placeholders, then put
// back only authenticated objects at their exact paths. This never adds a PNG
// case to the public validator, serializer or plugin transport.
function withHostImages<T>(value: unknown, validate: (value: unknown) => T): T {
  const owned = new Map<string, DocumentPngImage>()
  let nodes = 0
  function prepare(item: unknown, path: string, depth: number): unknown {
    if (++nodes > 20_000 || depth > 80) fail()
    if (isDocumentPngImage(item)) {
      entry(item)
      owned.set(path, item)
      return { type: 'text', text: item.title }
    }
    if (!item || typeof item !== 'object') return item
    if (Array.isArray(item))
      return item.map((child, index) => prepare(child, `${path}/${index}`, depth + 1))
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      fail()
    const result: Record<string, unknown> = {}
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (!('value' in descriptor)) fail()
      Object.defineProperty(result, key, {
        value: prepare(descriptor.value, `${path}/${key}`, depth + 1),
        enumerable: true,
      })
    }
    return result
  }
  function restore(item: unknown, path: string): unknown {
    const image = owned.get(path)
    if (image) return image
    if (!item || typeof item !== 'object') return item
    if (Array.isArray(item))
      return Object.freeze(item.map((child, index) => restore(child, `${path}/${index}`)))
    return Object.freeze(
      Object.fromEntries(
        Object.entries(item).map(([key, child]) => [key, restore(child, `${path}/${key}`)]),
      ),
    )
  }
  return restore(validate(prepare(value, '', 0)), '') as T
}
export function copyHostDocumentPresentationNode(
  value: unknown,
  request?: DocumentPresentationRequest,
): DocumentPresentationNode {
  return withHostImages(value, (value) => copyDocumentPresentationNode(value, request))
}
export function copyHostDocumentPresentationResult(
  value: unknown,
  request: DocumentPresentationRequest,
  declaration?: DocumentRendererDeclaration | readonly DocumentRendererDeclaration[],
): DocumentPresentationResult {
  if (images(value).size && request.target !== 'screen') fail()
  return withHostImages(value, (value) =>
    copyDocumentPresentationResult(value, request, declaration),
  )
}
export function copyHostDocumentPresentationAggregate(
  value: unknown,
  request: DocumentPresentationRequest,
  declarations: readonly DocumentRendererDeclaration[],
): DocumentPresentationResult {
  return copyHostDocumentPresentationResult(value, request, declarations)
}

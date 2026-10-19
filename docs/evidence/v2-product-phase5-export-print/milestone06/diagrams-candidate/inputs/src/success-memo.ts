import type {
  SdkDocumentPresentationRequest,
  SdkDocumentPresentationResult,
} from '@milkup/plugin-sdk'

const MAX_ENTRIES = 4
const MAX_RETAINED_BYTES = 2 * 1024 * 1024
interface Environment {
  document: Document
  fonts: FontFaceSet
  ready: Promise<FontFaceSet>
  url: string
  width: number
  height: number
  dpr: number
}
interface Ticket {
  key: string
  environment: Environment
  generation: number
}
const entries = new Map<string, { value: string; bytes: number }>()
let retainedBytes = 0
let environment: Environment | undefined
let generation = 0

export function clearSuccessMemo(): void {
  entries.clear()
  retainedBytes = 0
  environment = undefined
  generation++
}
function same(a: Environment, b: Environment): boolean {
  return (
    a.document === b.document &&
    a.fonts === b.fonts &&
    a.ready === b.ready &&
    a.url === b.url &&
    a.width === b.width &&
    a.height === b.height &&
    a.dpr === b.dpr
  )
}
function current(): Environment | undefined {
  try {
    const doc = document,
      fonts = doc.fonts
    if (fonts.status !== 'loaded' || doc.styleSheets.length !== 0) return undefined
    const width = globalThis.innerWidth,
      height = globalThis.innerHeight,
      dpr = globalThis.devicePixelRatio
    if (![width, height, dpr].every((value) => Number.isFinite(value) && value > 0))
      return undefined
    return { document: doc, fonts, ready: fonts.ready, url: doc.URL, width, height, dpr }
  } catch {
    return undefined
  }
}
function synchronize(): Environment | undefined {
  const next = current()
  if (!next || !environment || !same(environment, next)) {
    clearSuccessMemo()
    environment = next
  }
  return next
}
export function beginSuccessMemo(request: SdkDocumentPresentationRequest): Ticket | undefined {
  const snapshot = synchronize()
  if (!snapshot) return undefined
  try {
    const key = JSON.stringify(request)
    if (key.length * 2 > MAX_RETAINED_BYTES) return undefined
    return { key, environment: snapshot, generation }
  } catch {
    return undefined
  }
}
export function readSuccessMemo(
  ticket: Ticket | undefined,
): SdkDocumentPresentationResult | undefined {
  if (!ticket) return undefined
  const entry = entries.get(ticket.key)
  return entry ? (JSON.parse(entry.value) as SdkDocumentPresentationResult) : undefined
}
export function publishSuccessMemo(
  ticket: Ticket | undefined,
  result: SdkDocumentPresentationResult,
  allSankey: boolean,
): SdkDocumentPresentationResult {
  // Called only after all render containers have been removed. A rendered SVG's
  // own stylesheet is expected during conversion, but not at either boundary.
  const snapshot = synchronize()
  if (
    !ticket ||
    !snapshot ||
    ticket.generation !== generation ||
    !same(ticket.environment, snapshot) ||
    !allSankey ||
    !result.complete ||
    result.fragments.length === 0 ||
    result.fragments.some((fragment) => fragment.status !== 'ready')
  )
    return result
  try {
    const value = JSON.stringify(result)
    const bytes = (ticket.key.length + value.length) * 2
    if (bytes > MAX_RETAINED_BYTES) return result
    const independent = JSON.parse(value) as SdkDocumentPresentationResult
    while (entries.size >= MAX_ENTRIES || retainedBytes + bytes > MAX_RETAINED_BYTES) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      retainedBytes -= entries.get(oldest)!.bytes
      entries.delete(oldest)
    }
    entries.set(ticket.key, { value, bytes })
    retainedBytes += bytes
    return independent
  } catch {
    // Optional reuse must never replace a valid rendering with a cache error.
    return result
  }
}

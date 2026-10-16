import { editingKeys, editingRecord, assertPluginEditingId } from './editing-schema'
export interface PluginResourcesOperationOptions {
  readonly signal?: AbortSignal
}
export interface PluginResourcesPrepareRequest {
  readonly pasteId?: string
}
export type PluginResourcesPrepareResult =
  { readonly status: 'ready'; readonly id: string } | { readonly status: 'cancelled' }
export type PluginResourcesMimeType = 'image/png' | 'image/jpeg' | 'image/webp'
export interface PluginResourcesSource {
  readonly id: string
  readonly name: string
  readonly mimeType: PluginResourcesMimeType
  readonly sizeBytes: number
}
export interface PluginResourcesStageRequest {
  readonly sourceId: string
  readonly snapshotId: string
  readonly strategy: 'assets' | 'document-assets'
}
export interface PluginResourcesAsset {
  readonly id: string
  readonly reference: string
  readonly mimeType: PluginResourcesMimeType
  readonly width: number
  readonly height: number
  readonly sizeBytes: number
}
export interface PluginResourcesHost {
  prepareDocument(
    request?: PluginResourcesPrepareRequest,
    options?: PluginResourcesOperationOptions,
  ): Promise<PluginResourcesPrepareResult>
  choose(
    intentId: string,
    options?: PluginResourcesOperationOptions,
  ): Promise<PluginResourcesSource | null>
  stage(
    request: PluginResourcesStageRequest,
    options?: PluginResourcesOperationOptions,
  ): Promise<PluginResourcesAsset>
  abort(id: string, options?: PluginResourcesOperationOptions): Promise<void>
}
export const PLUGIN_RESOURCES_ERROR_CODES = [
  'revoked',
  'invalid-input',
  'invalid-token',
  'gesture-required',
  'stale',
  'readonly',
  'busy',
  'too-large',
  'unsupported',
  'aborted',
  'unavailable',
] as const
export type PluginResourcesErrorCode = (typeof PLUGIN_RESOURCES_ERROR_CODES)[number]
export class PluginResourcesError extends Error {
  constructor(readonly code: PluginResourcesErrorCode) {
    super(`Resource operation failed: ${code}`)
    this.name = 'PluginResourcesError'
  }
}
function fail(): never {
  throw new PluginResourcesError('invalid-input')
}
export function assertPluginResourcesId(value: unknown): asserts value is string {
  try {
    assertPluginEditingId(value)
  } catch {
    fail()
  }
}
export function copyPluginResourcesPrepareRequest(value: unknown): PluginResourcesPrepareRequest {
  if (value === undefined) return Object.freeze({})
  if (!editingRecord(value) || !editingKeys(value, [], ['pasteId'])) fail()
  if (value.pasteId !== undefined) assertPluginResourcesId(value.pasteId)
  return Object.freeze({ ...value })
}
export function copyPluginResourcesPrepareResult(value: unknown): PluginResourcesPrepareResult {
  if (!editingRecord(value)) fail()
  if (value.status === 'cancelled' && editingKeys(value, ['status']))
    return Object.freeze({ status: 'cancelled' })
  if (value.status !== 'ready' || !editingKeys(value, ['status', 'id'])) fail()
  assertPluginResourcesId(value.id)
  return Object.freeze({ status: 'ready', id: value.id })
}
export function copyPluginResourcesStageRequest(value: unknown): PluginResourcesStageRequest {
  if (!editingRecord(value) || !editingKeys(value, ['sourceId', 'snapshotId', 'strategy'])) fail()
  assertPluginResourcesId(value.sourceId)
  assertPluginResourcesId(value.snapshotId)
  if (!['assets', 'document-assets'].includes(value.strategy as string)) fail()
  return Object.freeze({ ...value }) as unknown as PluginResourcesStageRequest
}
function mimeSize(value: Record<string, unknown>) {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType as string) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    (value.sizeBytes as number) < 1 ||
    (value.sizeBytes as number) > 16777216
  )
    fail()
}
export function copyPluginResourcesSource(value: unknown): PluginResourcesSource | null {
  if (value === null) return null
  if (!editingRecord(value) || !editingKeys(value, ['id', 'name', 'mimeType', 'sizeBytes'])) fail()
  assertPluginResourcesId(value.id)
  mimeSize(value)
  if (
    typeof value.name !== 'string' ||
    value.name.length > 256 ||
    /[\\/\x00-\x1f]/.test(value.name)
  )
    fail()
  return Object.freeze({ ...value }) as unknown as PluginResourcesSource
}
export function copyPluginResourcesAsset(value: unknown): PluginResourcesAsset {
  if (
    !editingRecord(value) ||
    !editingKeys(value, ['id', 'reference', 'mimeType', 'width', 'height', 'sizeBytes'])
  )
    fail()
  assertPluginResourcesId(value.id)
  mimeSize(value)
  for (const k of ['width', 'height'])
    if (!Number.isSafeInteger(value[k]) || (value[k] as number) < 1 || (value[k] as number) > 16384)
      fail()
  if ((value.width as number) * (value.height as number) > 40000000) fail()
  if (
    typeof value.reference !== 'string' ||
    value.reference.length > 2048 ||
    /[\\\x00-\x20:#?]/.test(value.reference) ||
    value.reference.startsWith('/') ||
    value.reference.split('/').some((p) => !p || p === '.' || p === '..')
  )
    fail()
  return Object.freeze({ ...value }) as unknown as PluginResourcesAsset
}

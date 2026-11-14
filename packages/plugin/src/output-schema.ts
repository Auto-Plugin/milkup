import { editingKeys as keys, editingRecord as record } from './editing-schema'

export interface PluginOutputOperationOptions {
  readonly signal?: AbortSignal
}
export type PluginOutputFormat = 'html' | 'pdf' | 'print'
export interface PluginOutputCaptureRequest {
  readonly format: PluginOutputFormat
  readonly scope: 'document' | 'selection'
  readonly resources: 'embed' | 'omit'
  readonly pageSize?: 'a4' | 'letter'
  readonly landscape?: boolean
}
export interface PluginOutputWarning {
  readonly code: string
  readonly message: string
}
/** Metadata only. Text, resources and original paths remain in the trusted host. */
export interface PluginOutputSnapshot {
  readonly id: string
  readonly documentId: string
  readonly version: number
  readonly title: string
  readonly from: number
  readonly to: number
  readonly lineCount: number
  readonly warnings: readonly PluginOutputWarning[]
}
export interface PluginOutputChooseTargetRequest {
  readonly snapshotId: string
}
export type PluginOutputTargetResult =
  | { readonly status: 'ready'; readonly id: string; readonly name: string }
  | { readonly status: 'cancelled' }
export interface PluginOutputWriteResult {
  readonly status: 'written'
  readonly name: string
  readonly bytes: number
}
export interface PluginOutputPrintResult {
  readonly status: 'printed' | 'cancelled'
}
export interface PluginOutputHost {
  capture(
    request: PluginOutputCaptureRequest,
    options?: PluginOutputOperationOptions,
  ): Promise<PluginOutputSnapshot>
  chooseTarget(
    request: PluginOutputChooseTargetRequest,
    options?: PluginOutputOperationOptions,
  ): Promise<PluginOutputTargetResult>
  write(targetId: string, options?: PluginOutputOperationOptions): Promise<PluginOutputWriteResult>
  print(
    snapshotId: string,
    options?: PluginOutputOperationOptions,
  ): Promise<PluginOutputPrintResult>
  release(id: string, options?: PluginOutputOperationOptions): Promise<void>
}
export const PLUGIN_OUTPUT_ERROR_CODES = [
  'revoked',
  'invalid-input',
  'invalid-token',
  'gesture-required',
  'stale',
  'busy',
  'too-large',
  'unsupported',
  'aborted',
  'conflict',
  'unavailable',
] as const
export type PluginOutputErrorCode = (typeof PLUGIN_OUTPUT_ERROR_CODES)[number]
export class PluginOutputError extends Error {
  constructor(readonly code: PluginOutputErrorCode) {
    super(`Output operation failed: ${code}`)
    this.name = 'PluginOutputError'
  }
}
export const PLUGIN_OUTPUT_LIMITS = Object.freeze({ leases: 8, operations: 8, warnings: 64 })
function fail(): never {
  throw new PluginOutputError('invalid-input')
}
export function assertPluginOutputId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail()
}
function integer(value: unknown, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail()
}
function name(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 256 ||
    /[\\/\x00-\x1f]/.test(value)
  )
    fail()
}
export function copyPluginOutputCaptureRequest(value: unknown): PluginOutputCaptureRequest {
  if (!record(value) || !keys(value, ['format', 'scope', 'resources'], ['pageSize', 'landscape']))
    fail()
  if (
    !['html', 'pdf', 'print'].includes(value.format as string) ||
    !['document', 'selection'].includes(value.scope as string) ||
    !['embed', 'omit'].includes(value.resources as string) ||
    (value.pageSize !== undefined && !['a4', 'letter'].includes(value.pageSize as string)) ||
    (value.landscape !== undefined && typeof value.landscape !== 'boolean')
  )
    fail()
  return Object.freeze({ ...value }) as unknown as PluginOutputCaptureRequest
}
export function copyPluginOutputSnapshot(value: unknown): PluginOutputSnapshot {
  if (
    !record(value) ||
    !keys(value, ['id', 'documentId', 'version', 'title', 'from', 'to', 'lineCount', 'warnings'])
  )
    fail()
  assertPluginOutputId(value.id)
  if (
    typeof value.documentId !== 'string' ||
    !value.documentId.length ||
    value.documentId.length > 512 ||
    /[\x00-\x1f]/.test(value.documentId)
  )
    fail()
  if (
    typeof value.title !== 'string' ||
    value.title.length > 256 ||
    /[\x00-\x1f]/.test(value.title)
  )
    fail()
  integer(value.version)
  integer(value.from)
  integer(value.to, value.from)
  integer(value.lineCount, 1)
  if (!Array.isArray(value.warnings) || value.warnings.length > PLUGIN_OUTPUT_LIMITS.warnings)
    fail()
  const warnings = value.warnings.map((warning: unknown) => {
    if (
      !record(warning) ||
      !keys(warning, ['code', 'message']) ||
      typeof warning.code !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(warning.code) ||
      typeof warning.message !== 'string' ||
      warning.message.length > 512 ||
      /[\x00-\x1f]/.test(warning.message)
    )
      fail()
    return Object.freeze({ code: warning.code, message: warning.message })
  })
  return Object.freeze({
    ...value,
    warnings: Object.freeze(warnings),
  }) as unknown as PluginOutputSnapshot
}
export function copyPluginOutputChooseTargetRequest(
  value: unknown,
): PluginOutputChooseTargetRequest {
  if (!record(value) || !keys(value, ['snapshotId'])) fail()
  assertPluginOutputId(value.snapshotId)
  return Object.freeze({ snapshotId: value.snapshotId })
}
export function copyPluginOutputTargetResult(value: unknown): PluginOutputTargetResult {
  if (!record(value)) fail()
  if (value.status === 'cancelled' && keys(value, ['status']))
    return Object.freeze({ status: 'cancelled' })
  if (value.status !== 'ready' || !keys(value, ['status', 'id', 'name'])) fail()
  assertPluginOutputId(value.id)
  name(value.name)
  return Object.freeze({ status: 'ready', id: value.id, name: value.name })
}
export function copyPluginOutputWriteResult(value: unknown): PluginOutputWriteResult {
  if (!record(value) || !keys(value, ['status', 'name', 'bytes']) || value.status !== 'written')
    fail()
  name(value.name)
  integer(value.bytes, 1)
  return Object.freeze({ status: 'written', name: value.name, bytes: value.bytes })
}
export function copyPluginOutputPrintResult(value: unknown): PluginOutputPrintResult {
  if (
    !record(value) ||
    !keys(value, ['status']) ||
    !['printed', 'cancelled'].includes(value.status as string)
  )
    fail()
  return Object.freeze({ status: value.status }) as PluginOutputPrintResult
}

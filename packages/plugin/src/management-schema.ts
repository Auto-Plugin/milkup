import { copyPluginSettingsDescriptor, type PluginSettingsDescriptor } from './settings-schema'

export interface PluginManagementSummary {
  readonly id: string
  readonly title: string
  readonly description: string
}
export interface PluginManagementSnapshot {
  readonly revision: number
  readonly items: readonly PluginManagementSummary[]
}
export interface PluginManagementIdentity {
  readonly pluginId: string
  readonly revision: number
}
export interface PluginManagementDifference {
  readonly declared: readonly string[]
  readonly approved: readonly string[]
  readonly added: readonly string[]
  readonly removed: readonly string[]
}
export interface PluginManagementDetails extends PluginManagementIdentity {
  readonly entryRevision: number
  /** Opaque host fingerprint; never a package path or an approval capability. */
  readonly candidate?: { readonly fingerprint: string; readonly version: string }
  readonly title: string
  readonly description: string
  readonly version: string
  readonly host: 'worker' | 'dom' | 'sidecar'
  readonly approvedHost?: 'worker' | 'dom' | 'sidecar'
  readonly state: 'enabled' | 'disabled' | 'failed' | 'pending' | 'removed'
  readonly compatibility: {
    readonly compatible: boolean
    readonly hostVersion: string
    readonly sdkVersion: string
    readonly requiredHost?: string
    readonly requiredSdk?: string
  }
  readonly permissions: PluginManagementDifference
  readonly networkOrigins: PluginManagementDifference
  readonly diagnostics: readonly {
    readonly code: string
    readonly message: string
    readonly severity: 'info' | 'warning' | 'error'
  }[]
  /** Declared schema/defaults only; never another plugin's stored user values. */
  readonly settings?: PluginSettingsDescriptor
}
export interface PluginManagementHostViewRequest extends PluginManagementIdentity {
  readonly view: 'details' | 'settings'
}
export interface PluginManagementHostViewResult {
  readonly status: 'opened' | 'cancelled'
}
export interface PluginManagementOperationOptions {
  readonly signal?: AbortSignal
}
export interface PluginManagementReadHost {
  snapshot(options?: PluginManagementOperationOptions): Promise<PluginManagementSnapshot>
  describe(
    input: PluginManagementIdentity,
    options?: PluginManagementOperationOptions,
  ): Promise<PluginManagementDetails>
}
export interface PluginManagementHost extends PluginManagementReadHost {
  requestHostView(
    input: PluginManagementHostViewRequest,
    options?: PluginManagementOperationOptions,
  ): Promise<PluginManagementHostViewResult>
}
export const PLUGIN_MANAGEMENT_ERROR_CODES = [
  'revoked',
  'invalid-input',
  'stale',
  'not-found',
  'gesture-required',
  'aborted',
  'busy',
  'unavailable',
] as const
export type PluginManagementErrorCode = (typeof PLUGIN_MANAGEMENT_ERROR_CODES)[number]
export class PluginManagementError extends Error {
  constructor(readonly code: PluginManagementErrorCode) {
    super(`Plugin management: ${code}`)
    this.name = 'PluginManagementError'
  }
}
export const PLUGIN_MANAGEMENT_LIMITS = Object.freeze({
  items: 512,
  operations: 16,
  bytes: 512 * 1024,
})
export function managementRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function managementKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  )
}
function fail(): never {
  throw new PluginManagementError('invalid-input')
}
function record(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!managementRecord(value) || !managementKeys(value, required, optional)) fail()
  return value
}
function text(value: unknown, max: number, empty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.length) ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
  )
    fail()
  return value
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail()
  return value as number
}
function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T)) fail()
  return value as T
}
function list<T>(value: unknown, max: number, copy: (item: unknown) => T): readonly T[] {
  if (!Array.isArray(value) || value.length > max) fail()
  return Object.freeze(value.map(copy))
}
function strings(value: unknown, maxLength: number): readonly string[] {
  const result = list(value, 256, (item) => text(item, maxLength))
  if (new Set(result).size !== result.length) fail()
  return result
}
function bounded<T>(value: T): T {
  if (new TextEncoder().encode(JSON.stringify(value)).length > PLUGIN_MANAGEMENT_LIMITS.bytes)
    throw new PluginManagementError('unavailable')
  return Object.freeze(value)
}
/** Presentation-only projection. Never use this to shorten permissions, origins or versions.
 * JSON byte budgets guarantee all 512 native summaries fit in the response budget.
 * Iteration stops at the small display budget, even for a 1 MiB source manifest. */
export function projectPluginManagementMetadata(input: {
  readonly name: string
  readonly description?: string
}): { readonly title: string; readonly description: string } {
  const display = (value: string, jsonBytes: number, utf16: number) => {
    let result = '',
      bytes = 2,
      units = 0
    for (const original of value) {
      const point = original.codePointAt(0)!
      const character = /[\x00-\x1f\x7f]/.test(original)
        ? ' '
        : point >= 0xd800 && point <= 0xdfff
          ? '\ufffd'
          : original
      const cost = new TextEncoder().encode(JSON.stringify(character)).length - 2
      if (bytes + cost + 3 > jsonBytes || units + character.length + 1 > utf16) return result + '…'
      result += character
      bytes += cost
      units += character.length
    }
    return result
  }
  return Object.freeze({
    title: display(input.name, 256, 160),
    description: display(input.description ?? '', 512, 1000),
  })
}
export function assertPluginManagementId(value: unknown): asserts value is string {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)*$/.test(text(value, 128))) fail()
}
export function copyPluginManagementIdentity(value: unknown): PluginManagementIdentity {
  const v = record(value, ['pluginId', 'revision'])
  assertPluginManagementId(v.pluginId)
  return Object.freeze({ pluginId: v.pluginId, revision: integer(v.revision) })
}
export function copyPluginManagementHostViewRequest(
  value: unknown,
): PluginManagementHostViewRequest {
  const v = record(value, ['pluginId', 'revision', 'view'])
  return Object.freeze({
    ...copyPluginManagementIdentity({ pluginId: v.pluginId, revision: v.revision }),
    view: choice(v.view, ['details', 'settings']),
  })
}
export function copyPluginManagementHostViewResult(value: unknown): PluginManagementHostViewResult {
  const v = record(value, ['status'])
  return Object.freeze({ status: choice(v.status, ['opened', 'cancelled']) })
}
export function copyPluginManagementSnapshot(value: unknown): PluginManagementSnapshot {
  const v = record(value, ['revision', 'items'])
  const items = list(v.items, PLUGIN_MANAGEMENT_LIMITS.items, (item) => {
    const s = record(item, ['id', 'title', 'description'])
    assertPluginManagementId(s.id)
    return Object.freeze({
      id: s.id,
      title: text(s.title, 160),
      description: text(s.description, 1000, true),
    })
  })
  if (new Set(items.map((item) => item.id)).size !== items.length) fail()
  return bounded({ revision: integer(v.revision), items })
}
function difference(value: unknown, maxLength: number): PluginManagementDifference {
  const v = record(value, ['declared', 'approved', 'added', 'removed'])
  const declared = strings(v.declared, maxLength),
    approved = strings(v.approved, maxLength),
    added = strings(v.added, maxLength),
    removed = strings(v.removed, maxLength)
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((item) => b.includes(item))
  if (
    !same(
      added,
      declared.filter((item) => !approved.includes(item)),
    ) ||
    !same(
      removed,
      approved.filter((item) => !declared.includes(item)),
    )
  )
    fail()
  return Object.freeze({ declared, approved, added, removed })
}
export function copyPluginManagementDetails(value: unknown): PluginManagementDetails {
  const v = record(
    value,
    [
      'pluginId',
      'revision',
      'entryRevision',
      'title',
      'description',
      'version',
      'host',
      'state',
      'compatibility',
      'permissions',
      'networkOrigins',
      'diagnostics',
    ],
    ['approvedHost', 'settings', 'candidate'],
  )
  const compatibility = record(
    v.compatibility,
    ['compatible', 'hostVersion', 'sdkVersion'],
    ['requiredHost', 'requiredSdk'],
  )
  if (typeof compatibility.compatible !== 'boolean') fail()
  let settings: PluginSettingsDescriptor | undefined
  if (v.settings !== undefined) {
    try {
      settings = copyPluginSettingsDescriptor(v.settings)
    } catch {
      fail()
    }
  }
  return bounded({
    ...copyPluginManagementIdentity({ pluginId: v.pluginId, revision: v.revision }),
    entryRevision: integer(v.entryRevision),
    ...(v.candidate === undefined
      ? {}
      : {
          candidate: (() => {
            const c = record(v.candidate, ['fingerprint', 'version'])
            const fingerprint = text(c.fingerprint, 128)
            if (!/^[A-Za-z0-9_-]+$/.test(fingerprint)) fail()
            return Object.freeze({
              fingerprint,
              version: text(c.version, PLUGIN_MANAGEMENT_LIMITS.bytes),
            })
          })(),
        }),
    title: text(v.title, 160),
    description: text(v.description, 1000, true),
    version: text(v.version, PLUGIN_MANAGEMENT_LIMITS.bytes),
    host: choice(v.host, ['worker', 'dom', 'sidecar']),
    ...(v.approvedHost === undefined
      ? {}
      : { approvedHost: choice(v.approvedHost, ['worker', 'dom', 'sidecar']) }),
    state: choice(v.state, ['enabled', 'disabled', 'failed', 'pending', 'removed']),
    compatibility: Object.freeze({
      compatible: compatibility.compatible,
      hostVersion: text(compatibility.hostVersion, 128),
      sdkVersion: text(compatibility.sdkVersion, 128),
      ...(compatibility.requiredHost === undefined
        ? {}
        : { requiredHost: text(compatibility.requiredHost, PLUGIN_MANAGEMENT_LIMITS.bytes) }),
      ...(compatibility.requiredSdk === undefined
        ? {}
        : { requiredSdk: text(compatibility.requiredSdk, PLUGIN_MANAGEMENT_LIMITS.bytes) }),
    }),
    permissions: difference(v.permissions, 128),
    networkOrigins: difference(v.networkOrigins, 2048),
    diagnostics: list(v.diagnostics, 34, (item) => {
      const d = record(item, ['code', 'message', 'severity'])
      return Object.freeze({
        code: text(d.code, 128),
        message: text(d.message, PLUGIN_MANAGEMENT_LIMITS.bytes),
        severity: choice(d.severity, ['info', 'warning', 'error']),
      })
    }),
    ...(settings ? { settings } : {}),
  })
}

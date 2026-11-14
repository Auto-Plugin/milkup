export type PluginSettingsScope = 'application' | 'plugin'
export type PluginSettingsValue = string | number | boolean
export type PluginSettingsValues = Readonly<Record<string, PluginSettingsValue>>
export type PluginSettingsField =
  | { readonly type: 'enum'; readonly options: readonly (string | number)[] }
  | {
      readonly type: 'number'
      readonly minimum: number
      readonly maximum: number
      readonly step?: number
      readonly allowZero?: boolean
    }
  | { readonly type: 'boolean' }
export type PluginSettingsSchema = Readonly<Record<string, PluginSettingsField>>
export interface PluginSettingsDescriptor {
  readonly schema: PluginSettingsSchema
  readonly defaults: PluginSettingsValues
}
export interface PluginSettingsSnapshot extends PluginSettingsDescriptor {
  readonly revision: number
  readonly values: PluginSettingsValues
}
export interface PluginSettingsTransaction {
  readonly id: string
  readonly snapshot: PluginSettingsSnapshot
}
export interface PluginSettingsOperationOptions {
  readonly signal?: AbortSignal
}
export interface PluginSettingsHost {
  describe(
    scope: PluginSettingsScope,
    options?: PluginSettingsOperationOptions,
  ): Promise<PluginSettingsDescriptor>
  get(
    scope: PluginSettingsScope,
    options?: PluginSettingsOperationOptions,
  ): Promise<PluginSettingsSnapshot>
  begin(
    scope: PluginSettingsScope,
    options?: PluginSettingsOperationOptions,
  ): Promise<PluginSettingsTransaction>
  preview(
    id: string,
    patch: PluginSettingsValues,
    options?: PluginSettingsOperationOptions,
  ): Promise<PluginSettingsSnapshot>
  commit(id: string, options?: PluginSettingsOperationOptions): Promise<PluginSettingsSnapshot>
  cancel(id: string, options?: PluginSettingsOperationOptions): Promise<void>
}
export const PLUGIN_SETTINGS_ERROR_CODES = [
  'revoked',
  'invalid-scope',
  'invalid-transaction',
  'invalid-input',
  'busy',
  'conflict',
  'aborted',
  'unavailable',
] as const
export type PluginSettingsErrorCode = (typeof PLUGIN_SETTINGS_ERROR_CODES)[number]
export class PluginSettingsError extends Error {
  constructor(readonly code: PluginSettingsErrorCode) {
    super(`Settings operation failed: ${code}`)
    this.name = 'PluginSettingsError'
  }
}
export function settingsRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
}
export function settingsKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  )
}
function invalid(): never {
  throw new PluginSettingsError('invalid-input')
}
export function assertPluginSettingsId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new PluginSettingsError('invalid-transaction')
}
export function assertPluginSettingsScope(value: unknown): asserts value is PluginSettingsScope {
  if (value !== 'application' && value !== 'plugin') throw new PluginSettingsError('invalid-scope')
}
function validKey(value: string): boolean {
  return (
    /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(value) &&
    !value.split('.').some((part) => ['__proto__', 'constructor', 'prototype'].includes(part))
  )
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
function scalar(value: unknown): value is PluginSettingsValue {
  return (
    typeof value === 'boolean' ||
    finite(value) ||
    (typeof value === 'string' && value.length <= 256)
  )
}
export function copyPluginSettingsSchema(value: unknown): PluginSettingsSchema {
  if (!settingsRecord(value)) invalid()
  const items = Object.entries(value)
  if (!items.length || items.length > 64) invalid()
  const schema: Record<string, PluginSettingsField> = {}
  for (const [key, field] of items) {
    if (!validKey(key) || !settingsRecord(field)) invalid()
    if (field.type === 'boolean' && settingsKeys(field, ['type']))
      schema[key] = Object.freeze({ type: 'boolean' })
    else if (
      field.type === 'enum' &&
      settingsKeys(field, ['type', 'options']) &&
      Array.isArray(field.options) &&
      field.options.length > 0 &&
      field.options.length <= 32 &&
      field.options.every((item) => typeof item !== 'boolean' && scalar(item)) &&
      new Set(field.options).size === field.options.length
    ) {
      schema[key] = Object.freeze({ type: 'enum', options: Object.freeze([...field.options]) })
    } else if (
      field.type === 'number' &&
      settingsKeys(field, ['type', 'minimum', 'maximum'], ['step', 'allowZero']) &&
      finite(field.minimum) &&
      finite(field.maximum) &&
      field.minimum <= field.maximum &&
      (!Object.hasOwn(field, 'step') || (finite(field.step) && field.step > 0)) &&
      (!Object.hasOwn(field, 'allowZero') || typeof field.allowZero === 'boolean')
    ) {
      schema[key] = Object.freeze({
        type: 'number',
        minimum: field.minimum,
        maximum: field.maximum,
        ...(field.step !== undefined ? { step: field.step as number } : {}),
        ...(field.allowZero !== undefined ? { allowZero: field.allowZero as boolean } : {}),
      })
    } else invalid()
  }
  return Object.freeze(schema)
}
export function copyPluginSettingsValues(
  value: unknown,
  schema?: PluginSettingsSchema,
  partial = false,
): PluginSettingsValues {
  if (!settingsRecord(value)) invalid()
  const entries = Object.entries(value)
  if ((!partial && entries.length === 0) || entries.length > 64 || (partial && !entries.length))
    invalid()
  if (schema && !partial && Object.keys(schema).length !== entries.length) invalid()
  const copied: Record<string, PluginSettingsValue> = {}
  for (const [key, item] of entries) {
    if (!validKey(key) || !scalar(item)) invalid()
    if (schema) {
      const field = Object.hasOwn(schema, key) ? schema[key] : undefined
      if (!field) invalid()
      if (field.type === 'boolean' && typeof item !== 'boolean') invalid()
      if (field.type === 'enum' && !field.options.includes(item as string | number)) invalid()
      if (field.type === 'number') {
        if (!finite(item)) invalid()
        if (!(field.allowZero && item === 0)) {
          if (item < field.minimum || item > field.maximum) invalid()
          if (field.step !== undefined) {
            const multiple = (item - field.minimum) / field.step
            if (!Number.isFinite(multiple) || Math.abs(multiple - Math.round(multiple)) > 1e-7)
              invalid()
          }
        }
      }
    }
    copied[key] = item
  }
  return Object.freeze(copied)
}
export function copyPluginSettingsDescriptor(value: unknown): PluginSettingsDescriptor {
  if (!settingsRecord(value) || !settingsKeys(value, ['schema', 'defaults'])) invalid()
  const schema = copyPluginSettingsSchema(value.schema)
  return Object.freeze({ schema, defaults: copyPluginSettingsValues(value.defaults, schema) })
}
export function copyPluginSettingsSnapshot(value: unknown): PluginSettingsSnapshot {
  if (
    !settingsRecord(value) ||
    !settingsKeys(value, ['revision', 'schema', 'defaults', 'values']) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  )
    invalid()
  const descriptor = copyPluginSettingsDescriptor({
    schema: value.schema,
    defaults: value.defaults,
  })
  return Object.freeze({
    ...descriptor,
    revision: value.revision as number,
    values: copyPluginSettingsValues(value.values, descriptor.schema),
  })
}
export function samePluginSettingsDescriptor(
  a: PluginSettingsDescriptor,
  b: PluginSettingsDescriptor,
): boolean {
  const keys = Object.keys(a.schema).sort()
  return (
    JSON.stringify(keys) === JSON.stringify(Object.keys(b.schema).sort()) &&
    keys.every((key) => {
      const first = a.schema[key]!,
        second = b.schema[key]!
      return (
        Object.keys(first).length === Object.keys(second).length &&
        Object.entries(first).every(
          ([name, value]) =>
            JSON.stringify(value) ===
            JSON.stringify((second as unknown as Record<string, unknown>)[name]),
        ) &&
        a.defaults[key] === b.defaults[key]
      )
    })
  )
}

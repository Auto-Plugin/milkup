import type { ActionInputField, ActionInputSchema, ActionPermission } from '@milkup/core'

export type PluginPermission = ActionPermission
export type PluginHostKind = 'worker' | 'sidecar'

export interface PluginManifest {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly host?: PluginHostKind
  readonly main?: string
  readonly resources?: readonly string[]
  readonly networkOrigins?: readonly string[]
  readonly description?: string
  readonly engines?: PluginEngineCompatibility
  readonly permissions?: readonly PluginPermission[]
  readonly contributes?: PluginContributionSet
}

export interface PluginContributionSet {
  readonly commands?: readonly PluginCommandContribution[]
  readonly keymaps?: readonly PluginKeymapContribution[]
  readonly renderers?: readonly PluginRendererContribution[]
  readonly markdownSyntax?: readonly PluginMarkdownSyntaxContribution[]
  readonly ui?: readonly PluginUiContribution[]
  readonly importers?: readonly PluginImporterContribution[]
  readonly documentTypes?: readonly PluginDocumentTypeContribution[]
}

export interface PluginEngineCompatibility {
  readonly milkup?: string
  readonly pluginSdk?: string
}

export interface PluginCommandContribution {
  readonly id: string
  readonly title: string
  readonly action: string
  readonly category?: string
  readonly permissions?: readonly PluginPermission[]
  readonly inputSchema?: ActionInputSchema
}

export interface PluginKeymapContribution {
  readonly command: string
  readonly key: string
  readonly when?: string
}

export interface PluginRendererContribution {
  readonly id: string
  readonly nodeType: string
  readonly module: string
}

export interface PluginMarkdownSyntaxContribution {
  readonly id: string
  readonly nodeType: string
  readonly pattern: string
  readonly flags?: string
  readonly block?: boolean
  readonly inline?: boolean
}

export type PluginUiSlot =
  'menu-page' | 'sidebar-panel' | 'bottom-panel' | 'document-toolbar' | 'statusbar' | 'modal'

export interface PluginUiContribution {
  readonly id: string
  readonly slot: PluginUiSlot
  readonly title: string
  readonly scope?: 'app' | 'document'
  readonly viewportUpdates?: boolean
}

export interface PluginImporterContribution {
  readonly id: string
  readonly title: string
  readonly extensions: readonly string[]
  readonly mimeTypes?: readonly string[]
  readonly target: 'markdown' | 'custom-view'
}

export interface PluginDocumentTypeContribution {
  readonly id: string
  readonly title: string
  readonly extensions: readonly string[]
  readonly readonly?: boolean
}

export interface PluginManifestValidationError {
  readonly path: string
  readonly message: string
}

export interface PluginManifestValidationResult {
  readonly ok: boolean
  readonly manifest?: PluginManifest
  readonly errors: readonly PluginManifestValidationError[]
}

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)*$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const ACTION_ID_PATTERN = /^[a-z][A-Za-z0-9]*(?:[.:][a-z][A-Za-z0-9]*)+$/
const KNOWN_PERMISSIONS = new Set<PluginPermission>([
  'document:read',
  'document:write',
  'view:read',
  'view:write',
  'file:read',
  'file:write',
  'file:delete',
  'app:control',
  'network:access',
])
const KNOWN_HOSTS = new Set<PluginHostKind>(['worker', 'sidecar'])
const KNOWN_UI_SLOTS = new Set<PluginUiSlot>([
  'menu-page',
  'sidebar-panel',
  'bottom-panel',
  'document-toolbar',
  'statusbar',
  'modal',
])
const KNOWN_UI_SCOPES = new Set<PluginUiContribution['scope']>(['app', 'document'])
const KNOWN_IMPORTER_TARGETS = new Set<PluginImporterContribution['target']>([
  'markdown',
  'custom-view',
])

export function parsePluginManifest(value: unknown): PluginManifest {
  const result = validatePluginManifest(value)

  if (!result.ok || !result.manifest) {
    throw new Error(
      `Invalid plugin manifest:\n${result.errors
        .map((error) => `- ${error.path}: ${error.message}`)
        .join('\n')}`,
    )
  }

  return result.manifest
}

export function validatePluginManifest(value: unknown): PluginManifestValidationResult {
  const errors: PluginManifestValidationError[] = []

  if (!isRecord(value)) {
    return invalid([{ path: '$', message: 'Manifest must be an object' }])
  }

  const id = readRequiredString(value, 'id', '$.id', errors)
  const name = readRequiredString(value, 'name', '$.name', errors)
  const version = readRequiredString(value, 'version', '$.version', errors)
  const host = readOptionalHost(value.host, errors)
  const main = readOptionalString(value, 'main', '$.main', errors)
  const resources = readOptionalStringArray(value.resources, '$.resources', errors)
  const networkOrigins = readOptionalStringArray(value.networkOrigins, '$.networkOrigins', errors)
  const description = readOptionalString(value, 'description', '$.description', errors)
  const engines = readOptionalEngines(value.engines, errors)
  const permissions = readPermissions(value.permissions, errors, '$.permissions')
  const contributes = readContributions(value.contributes, errors)

  validateCommandPermissionScope(contributes?.commands, permissions, errors)
  validateContributionIntegrity(contributes, errors)
  validateNetworkOrigins(networkOrigins, permissions, errors)

  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    errors.push({ path: '$.id', message: 'Plugin id must be kebab/dot case' })
  }

  if (version && !VERSION_PATTERN.test(version)) {
    errors.push({ path: '$.version', message: 'Version must be semver-like' })
  }

  if (errors.length > 0 || !id || !name || !version) {
    return invalid(errors)
  }

  return {
    ok: true,
    manifest: Object.freeze({
      id,
      name,
      version,
      ...(host ? { host } : {}),
      ...(main ? { main } : {}),
      ...(resources ? { resources: Object.freeze(resources) } : {}),
      ...(networkOrigins ? { networkOrigins: Object.freeze(networkOrigins) } : {}),
      ...(description ? { description } : {}),
      ...(engines ? { engines } : {}),
      ...(permissions.length > 0 ? { permissions: Object.freeze(permissions) } : {}),
      ...(contributes ? { contributes } : {}),
    }),
    errors: Object.freeze([]),
  }
}

function validateNetworkOrigins(
  origins: readonly string[] | undefined,
  permissions: readonly PluginPermission[],
  errors: PluginManifestValidationError[],
): void {
  if (!permissions.includes('network:access')) {
    return
  }

  if (!origins) {
    return
  }

  for (const [index, value] of origins.entries()) {
    try {
      const url = new URL(value)

      if (url.origin !== value || !['http:', 'https:'].includes(url.protocol)) {
        throw new Error('invalid origin')
      }
    } catch {
      errors.push({
        path: `$.networkOrigins[${index}]`,
        message: 'Network origin must be an exact HTTP(S) origin',
      })
    }
  }
}

function readOptionalHost(
  value: unknown,
  errors: PluginManifestValidationError[],
): PluginHostKind | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string' || !KNOWN_HOSTS.has(value as PluginHostKind)) {
    errors.push({
      path: '$.host',
      message: `Unknown plugin host: ${String(value)}`,
    })
    return undefined
  }

  return value as PluginHostKind
}

function readContributions(
  value: unknown,
  errors: PluginManifestValidationError[],
): PluginContributionSet | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    errors.push({ path: '$.contributes', message: 'Contributes must be an object' })
    return undefined
  }

  const commands = readArray(
    value.commands,
    '$.contributes.commands',
    readCommandContribution,
    errors,
  )
  const keymaps = readArray(value.keymaps, '$.contributes.keymaps', readKeymapContribution, errors)
  const renderers = readArray(
    value.renderers,
    '$.contributes.renderers',
    readRendererContribution,
    errors,
  )
  const markdownSyntax = readArray(
    value.markdownSyntax,
    '$.contributes.markdownSyntax',
    readMarkdownSyntaxContribution,
    errors,
  )
  const ui = readArray(value.ui, '$.contributes.ui', readUiContribution, errors)
  const importers = readArray(
    value.importers,
    '$.contributes.importers',
    readImporterContribution,
    errors,
  )
  const documentTypes = readArray(
    value.documentTypes,
    '$.contributes.documentTypes',
    readDocumentTypeContribution,
    errors,
  )

  return Object.freeze({
    ...(commands ? { commands: Object.freeze(commands) } : {}),
    ...(keymaps ? { keymaps: Object.freeze(keymaps) } : {}),
    ...(renderers ? { renderers: Object.freeze(renderers) } : {}),
    ...(markdownSyntax ? { markdownSyntax: Object.freeze(markdownSyntax) } : {}),
    ...(ui ? { ui: Object.freeze(ui) } : {}),
    ...(importers ? { importers: Object.freeze(importers) } : {}),
    ...(documentTypes ? { documentTypes: Object.freeze(documentTypes) } : {}),
  })
}

function readOptionalEngines(
  value: unknown,
  errors: PluginManifestValidationError[],
): PluginEngineCompatibility | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    errors.push({ path: '$.engines', message: 'Engines must be an object' })
    return undefined
  }

  const milkup = readOptionalString(value, 'milkup', '$.engines.milkup', errors)
  const pluginSdk = readOptionalString(value, 'pluginSdk', '$.engines.pluginSdk', errors)

  return Object.freeze({
    ...(milkup ? { milkup } : {}),
    ...(pluginSdk ? { pluginSdk } : {}),
  })
}

function readCommandContribution(
  value: unknown,
  path: string,
  errors: PluginManifestValidationError[],
): PluginCommandContribution | undefined {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Command contribution must be an object' })
    return undefined
  }

  const id = readRequiredString(value, 'id', `${path}.id`, errors)
  const title = readRequiredString(value, 'title', `${path}.title`, errors)
  const action = readRequiredString(value, 'action', `${path}.action`, errors)
  const category = readOptionalString(value, 'category', `${path}.category`, errors)
  const permissions = Object.prototype.hasOwnProperty.call(value, 'permissions')
    ? readPermissions(value.permissions, errors, `${path}.permissions`)
    : undefined
  const inputSchema = readOptionalInputSchema(value.inputSchema, `${path}.inputSchema`, errors)

  if (id && !ACTION_ID_PATTERN.test(id)) {
    errors.push({ path: `${path}.id`, message: 'Command id must be an action-style id' })
  }

  if (action && !ACTION_ID_PATTERN.test(action)) {
    errors.push({ path: `${path}.action`, message: 'Command action must be an action-style id' })
  }

  if (!id || !title || !action) {
    return undefined
  }

  return Object.freeze({
    id,
    title,
    action,
    ...(category ? { category } : {}),
    ...(permissions ? { permissions: Object.freeze(permissions) } : {}),
    ...(inputSchema ? { inputSchema } : {}),
  })
}

function readOptionalInputSchema(
  value: unknown,
  path: string,
  errors: PluginManifestValidationError[],
): ActionInputSchema | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    errors.push({ path, message: 'Input schema must be an object schema' })
    return undefined
  }

  if (value.type !== 'object') {
    errors.push({ path: `${path}.type`, message: 'Input schema type must be object' })
  }

  const properties = readOptionalInputSchemaProperties(
    value.properties,
    `${path}.properties`,
    errors,
  )

  return Object.freeze({
    type: 'object',
    ...(properties ? { properties } : {}),
  })
}

function readOptionalInputSchemaProperties(
  value: unknown,
  path: string,
  errors: PluginManifestValidationError[],
): Readonly<Record<string, ActionInputField>> | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    errors.push({ path, message: 'Input schema properties must be an object' })
    return undefined
  }

  const properties: Record<string, ActionInputField> = {}

  for (const [name, field] of Object.entries(value)) {
    const propertyPath = `${path}.${name}`

    if (!isRecord(field)) {
      errors.push({ path: propertyPath, message: 'Input schema property must be an object' })
      continue
    }

    const type = field.type

    if (!isInputFieldType(type)) {
      errors.push({
        path: `${propertyPath}.type`,
        message: `Invalid input schema field type: ${String(type)}`,
      })
      continue
    }

    const required = readOptionalBoolean(field, 'required', `${propertyPath}.required`, errors)
    const description = readOptionalString(
      field,
      'description',
      `${propertyPath}.description`,
      errors,
    )

    properties[name] = Object.freeze({
      type,
      ...(required !== undefined ? { required } : {}),
      ...(description ? { description } : {}),
    })
  }

  return Object.freeze(properties)
}

function isInputFieldType(value: unknown): value is ActionInputField['type'] {
  return value === 'string' || value === 'number' || value === 'boolean'
}

function readKeymapContribution(
  value: unknown,
  path: string,
  errors: PluginManifestValidationError[],
): PluginKeymapContribution | undefined {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Keymap contribution must be an object' })
    return undefined
  }

  const command = readRequiredString(value, 'command', `${path}.command`, errors)
  const key = readRequiredString(value, 'key', `${path}.key`, errors)
  const when = readOptionalString(value, 'when', `${path}.when`, errors)

  if (command && !ACTION_ID_PATTERN.test(command)) {
    errors.push({ path: `${path}.command`, message: 'Keymap command must be an action-style id' })
  }

  if (!command || !key) {
    return undefined
  }

  return Object.freeze({
    command,
    key,
    ...(when ? { when } : {}),
  })
}

function readRendererContribution(
  value: unknown,
  path: string,
  errors: PluginManifestValidationError[],
): PluginRendererContribution | undefined {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Renderer contribution must be an object' })
    return undefined
  }

  const id = readRequiredString(value, 'id', `${path}.id`, errors)
  const nodeType = readRequiredString(value, 'nodeType', `${path}.nodeType`, errors)
  const module = readRequiredString(value, 'module', `${path}.module`, errors)

  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    errors.push({ path: `${path}.id`, message: 'Renderer id must be kebab/dot case' })
  }

  if (!id || !nodeType || !module) {
    return undefined
  }

  return Object.freeze({ id, nodeType, module })
}

function readMarkdownSyntaxContribution(
  value: unknown,
  path: string,
  errors: PluginManifestValidationError[],
): PluginMarkdownSyntaxContribution | undefined {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Markdown syntax contribution must be an object' })
    return undefined
  }

  const id = readRequiredString(value, 'id', `${path}.id`, errors)
  const nodeType = readRequiredString(value, 'nodeType', `${path}.nodeType`, errors)
  const pattern = readRequiredString(value, 'pattern', `${path}.pattern`, errors)
  const flags = readOptionalString(value, 'flags', `${path}.flags`, errors)
  const block = readOptionalBoolean(value, 'block', `${path}.block`, errors)
  const inline = readOptionalBoolean(value, 'inline', `${path}.inline`, errors)

  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    errors.push({ path: `${path}.id`, message: 'Markdown syntax id must be kebab/dot case' })
  }

  if (!block && !inline) {
    errors.push({ path, message: 'Markdown syntax contribution must enable block or inline' })
  }

  if (nodeType && !/^[a-z][A-Za-z0-9.-]*$/.test(nodeType)) {
    errors.push({ path: `${path}.nodeType`, message: 'Markdown node type must be identifier-like' })
  }

  if (pattern) {
    validateMarkdownSyntaxPattern(pattern, flags, path, errors)
  }

  if (!id || !nodeType || !pattern) {
    return undefined
  }

  return Object.freeze({
    id,
    nodeType,
    pattern,
    ...(flags ? { flags } : {}),
    ...(block !== undefined ? { block } : {}),
    ...(inline !== undefined ? { inline } : {}),
  })
}

function validateMarkdownSyntaxPattern(
  pattern: string,
  flags: string | undefined,
  path: string,
  errors: PluginManifestValidationError[],
): void {
  if (pattern.length > 256) {
    errors.push({ path: `${path}.pattern`, message: 'Markdown syntax pattern is too long' })
    return
  }

  if (/\(\?[<!=]|\\[1-9]|\([^)]*(?:\*|\+|\{\d+,?\d*\})[^)]*\)(?:\*|\+|\{)/.test(pattern)) {
    errors.push({
      path: `${path}.pattern`,
      message: 'Markdown syntax pattern uses unsafe features',
    })
    return
  }

  if (flags && !/^[imu]*$/.test(flags)) {
    errors.push({ path: `${path}.flags`, message: 'Markdown syntax flags may only use i, m, or u' })
    return
  }

  try {
    new RegExp(pattern, flags)
  } catch {
    errors.push({ path: `${path}.pattern`, message: 'Markdown syntax pattern is invalid' })
  }
}

function readUiContribution(
  value: unknown,
  path: string,
  errors: PluginManifestValidationError[],
): PluginUiContribution | undefined {
  if (!isRecord(value)) {
    errors.push({ path, message: 'UI contribution must be an object' })
    return undefined
  }

  const id = readRequiredString(value, 'id', `${path}.id`, errors)
  const slot = readRequiredString(value, 'slot', `${path}.slot`, errors)
  const title = readRequiredString(value, 'title', `${path}.title`, errors)
  const scope = readOptionalString(value, 'scope', `${path}.scope`, errors)
  const viewportUpdates = readOptionalBoolean(
    value,
    'viewportUpdates',
    `${path}.viewportUpdates`,
    errors,
  )

  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    errors.push({ path: `${path}.id`, message: 'UI contribution id must be kebab/dot case' })
  }

  if (slot && !KNOWN_UI_SLOTS.has(slot as PluginUiSlot)) {
    errors.push({ path: `${path}.slot`, message: `Unknown UI slot: ${slot}` })
  }

  if (scope && !KNOWN_UI_SCOPES.has(scope as PluginUiContribution['scope'])) {
    errors.push({ path: `${path}.scope`, message: `Unknown UI scope: ${scope}` })
  }

  if (!id || !slot || !title || !KNOWN_UI_SLOTS.has(slot as PluginUiSlot)) {
    return undefined
  }

  const contribution: {
    id: string
    slot: PluginUiSlot
    title: string
    scope?: 'app' | 'document'
    viewportUpdates?: boolean
  } = {
    id,
    slot: slot as PluginUiSlot,
    title,
  }

  if (scope) {
    contribution.scope = scope as 'app' | 'document'
  }
  if (viewportUpdates !== undefined) {
    contribution.viewportUpdates = viewportUpdates
  }

  return Object.freeze(contribution)
}

function readImporterContribution(
  value: unknown,
  path: string,
  errors: PluginManifestValidationError[],
): PluginImporterContribution | undefined {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Importer contribution must be an object' })
    return undefined
  }

  const id = readRequiredString(value, 'id', `${path}.id`, errors)
  const title = readRequiredString(value, 'title', `${path}.title`, errors)
  const extensions = readStringArray(value.extensions, `${path}.extensions`, errors)
  const mimeTypes = readOptionalStringArray(value.mimeTypes, `${path}.mimeTypes`, errors)
  const target = readRequiredString(value, 'target', `${path}.target`, errors)

  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    errors.push({ path: `${path}.id`, message: 'Importer id must be kebab/dot case' })
  }

  if (target && !KNOWN_IMPORTER_TARGETS.has(target as PluginImporterContribution['target'])) {
    errors.push({ path: `${path}.target`, message: `Unknown importer target: ${target}` })
  }

  if (!id || !title || !extensions || !target) {
    return undefined
  }

  return Object.freeze({
    id,
    title,
    extensions: Object.freeze(extensions),
    ...(mimeTypes ? { mimeTypes: Object.freeze(mimeTypes) } : {}),
    target: target as PluginImporterContribution['target'],
  })
}

function readDocumentTypeContribution(
  value: unknown,
  path: string,
  errors: PluginManifestValidationError[],
): PluginDocumentTypeContribution | undefined {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Document type contribution must be an object' })
    return undefined
  }

  const id = readRequiredString(value, 'id', `${path}.id`, errors)
  const title = readRequiredString(value, 'title', `${path}.title`, errors)
  const extensions = readStringArray(value.extensions, `${path}.extensions`, errors)
  const readonly = readOptionalBoolean(value, 'readonly', `${path}.readonly`, errors)

  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    errors.push({
      path: `${path}.id`,
      message: 'Document type id must be kebab/dot case',
    })
  }

  if (!id || !title || !extensions) {
    return undefined
  }

  return Object.freeze({
    id,
    title,
    extensions: Object.freeze(extensions),
    ...(readonly !== undefined ? { readonly } : {}),
  })
}

function readPermissions(
  value: unknown,
  errors: PluginManifestValidationError[],
  path: string,
): PluginPermission[] {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    errors.push({ path, message: 'Permissions must be an array' })
    return []
  }

  const permissions: PluginPermission[] = []

  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || !KNOWN_PERMISSIONS.has(item as PluginPermission)) {
      errors.push({
        path: `${path}[${index}]`,
        message: `Unknown plugin permission: ${String(item)}`,
      })
      continue
    }

    permissions.push(item as PluginPermission)
  }

  return permissions
}

function validateCommandPermissionScope(
  commands: readonly PluginCommandContribution[] | undefined,
  manifestPermissions: readonly PluginPermission[],
  errors: PluginManifestValidationError[],
): void {
  if (!commands) {
    return
  }

  for (const [commandIndex, command] of commands.entries()) {
    if (!command.permissions) {
      continue
    }

    for (const [permissionIndex, permission] of command.permissions.entries()) {
      if (!manifestPermissions.includes(permission)) {
        errors.push({
          path: `$.contributes.commands[${commandIndex}].permissions[${permissionIndex}]`,
          message: `Command permission must be declared in top-level permissions: ${permission}`,
        })
      }
    }
  }
}

function validateContributionIntegrity(
  contributes: PluginContributionSet | undefined,
  errors: PluginManifestValidationError[],
): void {
  validateUniqueValues(
    contributes?.commands,
    '$.contributes.commands',
    'id',
    'Duplicate command id',
    errors,
  )
  validateUniqueValues(
    contributes?.commands,
    '$.contributes.commands',
    'action',
    'Duplicate command action',
    errors,
  )
  validateKnownKeymapCommands(contributes?.keymaps, contributes?.commands, errors)
  validateUniqueValues(
    contributes?.renderers,
    '$.contributes.renderers',
    'id',
    'Duplicate renderer id',
    errors,
  )
  validateUniqueValues(
    contributes?.markdownSyntax,
    '$.contributes.markdownSyntax',
    'id',
    'Duplicate markdown syntax id',
    errors,
  )
  validateUniqueValues(contributes?.ui, '$.contributes.ui', 'id', 'Duplicate UI id', errors)
  validateUniqueValues(
    contributes?.importers,
    '$.contributes.importers',
    'id',
    'Duplicate importer id',
    errors,
  )
  validateUniqueValues(
    contributes?.documentTypes,
    '$.contributes.documentTypes',
    'id',
    'Duplicate document type id',
    errors,
  )
  validateRenderableContributionIds(contributes, errors)
}

function validateRenderableContributionIds(
  contributes: PluginContributionSet | undefined,
  errors: PluginManifestValidationError[],
): void {
  const groups = [
    ['renderers', contributes?.renderers],
    ['ui', contributes?.ui],
    ['importers', contributes?.importers],
    ['documentTypes', contributes?.documentTypes],
  ] as const
  const seen = new Map<string, string>()

  for (const [group, items] of groups) {
    for (const [index, item] of (items ?? []).entries()) {
      const previous = seen.get(item.id)

      if (previous) {
        errors.push({
          path: `$.contributes.${group}[${index}].id`,
          message: `Renderable contribution id conflicts with ${previous}: ${item.id}`,
        })
      } else {
        seen.set(item.id, group)
      }
    }
  }
}

function validateUniqueValues<T extends Record<K, string>, K extends keyof T>(
  items: readonly T[] | undefined,
  path: string,
  key: K,
  message: string,
  errors: PluginManifestValidationError[],
): void {
  if (!items) {
    return
  }

  const seen = new Set<string>()

  for (const [index, item] of items.entries()) {
    const value = item[key]

    if (seen.has(value)) {
      errors.push({
        path: `${path}[${index}].${String(key)}`,
        message: `${message}: ${value}`,
      })
      continue
    }

    seen.add(value)
  }
}

function validateKnownKeymapCommands(
  keymaps: readonly PluginKeymapContribution[] | undefined,
  commands: readonly PluginCommandContribution[] | undefined,
  errors: PluginManifestValidationError[],
): void {
  if (!keymaps) {
    return
  }

  const commandActions = new Set((commands ?? []).map((command) => command.action))

  for (const [index, keymap] of keymaps.entries()) {
    if (!commandActions.has(keymap.command)) {
      errors.push({
        path: `$.contributes.keymaps[${index}].command`,
        message: `Keymap command must reference a contributed command action: ${keymap.command}`,
      })
    }
  }
}

function readArray<T>(
  value: unknown,
  path: string,
  readItem: (
    value: unknown,
    path: string,
    errors: PluginManifestValidationError[],
  ) => T | undefined,
  errors: PluginManifestValidationError[],
): T[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    errors.push({ path, message: 'Expected an array' })
    return undefined
  }

  return value
    .map((item, index) => readItem(item, `${path}[${index}]`, errors))
    .filter((item): item is T => item !== undefined)
}

function readRequiredString(
  object: Record<string, unknown>,
  key: string,
  path: string,
  errors: PluginManifestValidationError[],
): string | undefined {
  const value = object[key]

  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push({ path, message: 'Expected a non-empty string' })
    return undefined
  }

  return value
}

function readOptionalString(
  object: Record<string, unknown>,
  key: string,
  path: string,
  errors: PluginManifestValidationError[],
): string | undefined {
  const value = object[key]

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push({ path, message: 'Expected a non-empty string' })
    return undefined
  }

  return value
}

function readOptionalBoolean(
  object: Record<string, unknown>,
  key: string,
  path: string,
  errors: PluginManifestValidationError[],
): boolean | undefined {
  const value = object[key]

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    errors.push({ path, message: 'Expected a boolean' })
    return undefined
  }

  return value
}

function readStringArray(
  value: unknown,
  path: string,
  errors: PluginManifestValidationError[],
): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({ path, message: 'Expected a non-empty string array' })
    return undefined
  }

  const values: string[] = []

  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      errors.push({ path: `${path}[${index}]`, message: 'Expected a non-empty string' })
      continue
    }

    values.push(item)
  }

  return values
}

function readOptionalStringArray(
  value: unknown,
  path: string,
  errors: PluginManifestValidationError[],
): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  return readStringArray(value, path, errors)
}

function invalid(errors: readonly PluginManifestValidationError[]): PluginManifestValidationResult {
  return {
    ok: false,
    errors: Object.freeze([...errors]),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

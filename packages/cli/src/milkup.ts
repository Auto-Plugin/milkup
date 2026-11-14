import {
  ActionRegistry,
  BasicEditor,
  createBuiltinActions,
  EditorState,
  MemoryTextDocument,
  Selection,
  type ActionDefinition,
  type ActionPermission,
} from '@milkup/core'
import { createPlainTextPdfProvider, exportDocumentAsync, type ExportFormat } from '@milkup/export'
import {
  createPluginFileBroker,
  createIsolatedPluginModule,
  createPluginModuleIsolationHost,
  createPluginNetworkBroker,
  loadLocalPlugin,
  PluginRuntime,
  type PluginFileBrokerAdapter,
  type PluginManifest,
  type PluginModule,
  type PluginNetworkBrokerAdapter,
  type PluginPermission,
} from '@milkup/plugin'
import { readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { callAttachedApp } from './attached-app'

export interface CliResult {
  readonly exitCode: number
  readonly stdout?: string
  readonly stderr?: string
}

interface ParsedOptions {
  readonly positional: readonly string[]
  readonly flags: ReadonlyMap<string, string | boolean>
}

interface CliActionSummary {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly permissions: readonly string[]
  readonly risk: string
  readonly requiresConfirmation: boolean
}

const DEFAULT_HEADLESS_PERMISSIONS: readonly ActionPermission[] = [
  'document:read',
  'document:write',
  'view:read',
  'view:write',
]
const DEFAULT_HEADLESS_PLUGIN_PERMISSIONS: readonly PluginPermission[] =
  DEFAULT_HEADLESS_PERMISSIONS

export async function runCli(argv: readonly string[]): Promise<CliResult> {
  try {
    return await runCliUnsafe(argv)
  } catch (error) {
    return {
      exitCode: 1,
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runCliUnsafe(argv: readonly string[]): Promise<CliResult> {
  const [command, subcommand, ...rest] = argv

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return ok(helpText())
  }

  if (command === 'export') {
    return exportCommand(parseOptions([subcommand, ...rest].filter(isDefined)))
  }

  if (command === 'action') {
    if (subcommand === 'list') {
      return actionList(parseOptions(rest))
    }

    if (subcommand === 'describe') {
      return actionDescribe(parseOptions(rest))
    }

    if (subcommand === 'run') {
      return actionRun(parseOptions(rest))
    }

    throw new Error(`Unknown action subcommand: ${subcommand ?? ''}`)
  }

  throw new Error(`Unknown command: ${command}`)
}

async function actionList(options: ParsedOptions): Promise<CliResult> {
  const attachedUrl = stringFlag(options.flags.get('attached-url'))

  if (attachedUrl) {
    return jsonOk(
      await callAttachedApp(attachedUrl, 'action/list', {
        permissions: parsePermissions(options.flags.get('permissions')),
      }),
    )
  }

  const registry = await createRegistry(options)
  const permissions = parsePermissions(options.flags.get('permissions'))
  const actions = permissions.length > 0 ? registry.listAllowed(permissions) : registry.list()

  return jsonOk(actions.map(summarizeAction))
}

async function actionDescribe(options: ParsedOptions): Promise<CliResult> {
  const id = options.positional[0]

  if (!id) {
    throw new Error('Missing action id')
  }

  const attachedUrl = stringFlag(options.flags.get('attached-url'))

  if (attachedUrl) {
    return jsonOk(await callAttachedApp(attachedUrl, 'action/describe', { actionId: id }))
  }

  const action = requireAction(await createRegistry(options), id)
  return jsonOk(serializeAction(action))
}

async function actionRun(options: ParsedOptions): Promise<CliResult> {
  const id = options.positional[0]

  if (!id) {
    throw new Error('Missing action id')
  }

  const attachedUrl = stringFlag(options.flags.get('attached-url'))
  const input = parseJsonObjectFlag(options.flags.get('input'), {})
  const permissions = parsePermissions(options.flags.get('permissions'))

  if (attachedUrl) {
    return jsonOk(
      await callAttachedApp(attachedUrl, 'action/run', {
        actionId: id,
        input,
        permissions,
      }),
    )
  }

  const registry = await createRegistry(options)
  const action = requireAction(registry, id)
  const documentText = stringFlag(options.flags.get('document')) ?? ''
  const selection = parseSelectionFlag(options.flags.get('selection'), documentText.length)
  const editor = new BasicEditor(
    new EditorState({
      doc: new MemoryTextDocument(documentText),
      selection,
    }),
  )

  const output = await registry.run(
    action.id,
    {
      editor,
      permissions: permissions.length > 0 ? permissions : DEFAULT_HEADLESS_PERMISSIONS,
    },
    input,
  )

  return jsonOk({
    action: action.id,
    output,
    document: editor.state.doc.text,
    selection: {
      anchor: editor.state.selection.main.anchor,
      head: editor.state.selection.main.head,
    },
    canUndo: editor.state.history.canUndo,
    canRedo: editor.state.history.canRedo,
  })
}

async function exportCommand(options: ParsedOptions): Promise<CliResult> {
  const format = parseExportFormat(options.flags.get('format') ?? options.positional[0] ?? 'html')
  const documentId = stringFlag(options.flags.get('document-id')) ?? 'headless'
  const title = stringFlag(options.flags.get('title')) ?? documentId
  const outPath = stringFlag(options.flags.get('out'))
  const text = await resolveExportText(options)
  const result = await exportDocumentAsync(
    [
      {
        documentId,
        text,
        title,
      },
    ],
    {
      documentId,
      format,
      ...(format === 'pdf' ? { pdfProvider: createPlainTextPdfProvider() } : {}),
    },
  )

  if (result.content instanceof Uint8Array) {
    if (!outPath) {
      throw new Error('PDF export requires --out')
    }

    await writeFile(outPath, result.content)
    return jsonOk({
      documentId,
      format,
      out: outPath,
      bytes: result.content.byteLength,
    })
  }

  if (outPath) {
    await writeFile(outPath, result.content, 'utf8')
    return jsonOk({
      documentId,
      format,
      out: outPath,
      bytes: new TextEncoder().encode(result.content).byteLength,
    })
  }

  return ok(result.content)
}

async function createRegistry(options: ParsedOptions): Promise<ActionRegistry> {
  const registry = new ActionRegistry(createBuiltinActions())
  const manifestPath = stringFlag(options.flags.get('plugin-manifest'))

  if (!manifestPath) {
    return registry
  }

  const explicitModuleSpecifier = stringFlag(options.flags.get('plugin-module'))
  const plugin = await loadLocalPlugin(
    {
      manifestPath,
      ...(explicitModuleSpecifier ? { moduleSpecifier: explicitModuleSpecifier } : {}),
    },
    {
      readText: (path) => readFile(path, 'utf8'),
      importModule: async (specifier, context) =>
        import(resolveCliPluginModuleSpecifier(specifier, context.manifestPath)),
    },
  )
  const fileBroker = createCliPluginFileBroker(plugin.manifest, options, manifestPath)
  const networkBroker = createCliPluginNetworkBroker(plugin.manifest, options)
  const runtime = new PluginRuntime({
    actionRegistry: registry,
    allowedPermissions: parsePluginPermissions(options.flags.get('plugin-permissions')),
    fileBroker,
    networkBroker,
  })

  runtime.loadPlugin({
    manifest: plugin.manifest,
    ...(plugin.module
      ? {
          module: createCliIsolatedPluginModule(plugin.manifest, plugin.module, {
            fileBroker,
            networkBroker,
          }),
        }
      : {}),
  })
  await runtime.enablePlugin(plugin.manifest.id)

  return registry
}

function createCliIsolatedPluginModule(
  manifest: PluginManifest,
  module: PluginModule,
  brokers: {
    readonly fileBroker: ReturnType<typeof createCliPluginFileBroker>
    readonly networkBroker: ReturnType<typeof createCliPluginNetworkBroker>
  },
): PluginModule {
  return createIsolatedPluginModule({
    manifest,
    host: createPluginModuleIsolationHost({
      manifest,
      module,
      fileBroker: brokers.fileBroker,
      networkBroker: brokers.networkBroker,
    }),
  })
}

function createCliPluginFileBroker(
  manifest: PluginManifest,
  options: ParsedOptions,
  manifestPath: string,
) {
  const root = stringFlag(options.flags.get('plugin-root')) ?? dirname(manifestPath)

  return createPluginFileBroker({
    manifest,
    roots: [{ id: 'cli-plugin-root', path: resolve(dirname(manifestPath), root) }],
    adapter: createNodePluginFileBrokerAdapter(),
  })
}

function createNodePluginFileBrokerAdapter(): PluginFileBrokerAdapter {
  return {
    resolvePath: resolveNodePluginPath,
    readText: (path: string) => readFile(path, 'utf8'),
    writeText: (path: string, text: string) => writeFile(path, text, 'utf8'),
    deleteFile: (path: string) => rm(path, { force: false }),
  }
}

function createCliPluginNetworkBroker(manifest: PluginManifest, options: ParsedOptions) {
  const allowedOrigins = parsePluginNetworkOrigins(options.flags.get('plugin-network-origin'))

  return createPluginNetworkBroker({
    manifest,
    adapter: createNodePluginNetworkBrokerAdapter(),
    ...(allowedOrigins ? { allowedOrigins } : {}),
  })
}

function createNodePluginNetworkBrokerAdapter(): PluginNetworkBrokerAdapter {
  return {
    fetch: (url: string, init?: unknown) => {
      if (typeof globalThis.fetch !== 'function') {
        throw new Error('CLI plugin network fetch requires a runtime with global fetch')
      }

      return globalThis.fetch(url, init as Parameters<typeof globalThis.fetch>[1])
    },
  }
}

async function resolveNodePluginPath(path: string): Promise<string> {
  const absolutePath = resolve(path)

  try {
    return await realpath(absolutePath)
  } catch {
    const parent = dirname(absolutePath)
    const resolvedParent = await realpath(parent)

    return join(resolvedParent, basename(absolutePath))
  }
}

function requireAction(registry: ActionRegistry, id: string): ActionDefinition {
  const action = registry.get(id)

  if (!action) {
    throw new Error(`Unknown action: ${id}`)
  }

  return action
}

function summarizeAction(action: ActionDefinition): CliActionSummary {
  return {
    id: action.id,
    title: action.title,
    category: action.category,
    permissions: action.permissions ?? [],
    risk: action.risk ?? 'safe',
    requiresConfirmation: action.requiresConfirmation === true || action.risk === 'destructive',
  }
}

function serializeAction(action: ActionDefinition): Record<string, unknown> {
  return {
    ...summarizeAction(action),
    description: action.description,
    inputSchema: action.inputSchema,
  }
}

function parseOptions(args: readonly string[]): ParsedOptions {
  const positional: string[] = []
  const flags = new Map<string, string | boolean>()

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (!arg) {
      continue
    }

    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }

    const name = arg.slice(2)

    if (name.length === 0) {
      throw new Error('Invalid empty flag')
    }

    const next = args[index + 1]

    if (next && !next.startsWith('--')) {
      flags.set(name, next)
      index += 1
    } else {
      flags.set(name, true)
    }
  }

  return {
    positional: Object.freeze(positional),
    flags,
  }
}

function parseJsonObjectFlag(
  value: string | boolean | undefined,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  if (value === undefined) {
    return fallback
  }

  if (typeof value !== 'string') {
    throw new Error('Expected JSON object flag value')
  }

  const parsed = JSON.parse(value) as unknown

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected JSON object flag value')
  }

  return parsed as Record<string, unknown>
}

function parsePermissions(value: string | boolean | undefined): readonly ActionPermission[] {
  if (value === undefined) {
    return []
  }

  if (typeof value !== 'string') {
    throw new Error('Expected comma-separated permissions')
  }

  return Object.freeze(
    value
      .split(',')
      .map((permission) => permission.trim())
      .filter((permission): permission is ActionPermission => permission.length > 0),
  )
}

function parsePluginPermissions(value: string | boolean | undefined): readonly PluginPermission[] {
  if (value === undefined) {
    return DEFAULT_HEADLESS_PLUGIN_PERMISSIONS
  }

  if (typeof value !== 'string') {
    throw new Error('Expected comma-separated plugin permissions')
  }

  return Object.freeze(
    value
      .split(',')
      .map((permission) => permission.trim())
      .filter((permission): permission is PluginPermission => permission.length > 0),
  )
}

function parsePluginNetworkOrigins(
  value: string | boolean | undefined,
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error('Expected comma-separated plugin network origins')
  }

  return Object.freeze(
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
}

function resolveCliPluginModuleSpecifier(specifier: string, manifestPath: string): string {
  if (specifier.startsWith('file:') || /^[a-z][a-z0-9+.-]*:/iu.test(specifier)) {
    return specifier
  }

  if (specifier.startsWith('.')) {
    return pathToFileURL(resolve(dirname(manifestPath), specifier)).href
  }

  if (isAbsolute(specifier)) {
    return pathToFileURL(specifier).href
  }

  return specifier
}

function parseSelectionFlag(value: string | boolean | undefined, fallbackPos: number): Selection {
  if (value === undefined) {
    return Selection.cursor(fallbackPos)
  }

  if (typeof value !== 'string') {
    throw new Error('Expected selection flag value')
  }

  const [anchorRaw, headRaw] = value.split(':')
  const anchor = Number(anchorRaw)
  const head = headRaw === undefined ? anchor : Number(headRaw)

  if (!Number.isInteger(anchor) || !Number.isInteger(head)) {
    throw new Error(`Invalid selection: ${value}`)
  }

  return anchor === head ? Selection.cursor(anchor) : Selection.range(anchor, head)
}

async function resolveExportText(options: ParsedOptions): Promise<string> {
  const directDocument = stringFlag(options.flags.get('document'))
  const filePath = stringFlag(options.flags.get('from-file'))

  if (directDocument !== undefined && filePath !== undefined) {
    throw new Error('Use either --document or --from-file, not both')
  }

  if (directDocument !== undefined) {
    return directDocument
  }

  if (filePath !== undefined) {
    return readFile(filePath, 'utf8')
  }

  throw new Error('Missing export input: pass --document or --from-file')
}

function parseExportFormat(value: string | boolean | undefined): ExportFormat {
  if (value !== 'markdown' && value !== 'html' && value !== 'pdf') {
    throw new Error(`Invalid export format: ${String(value)}`)
  }

  return value
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error('Expected string flag value')
  }

  return value
}

function jsonOk(value: unknown): CliResult {
  return ok(`${JSON.stringify(value, null, 2)}`)
}

function ok(stdout: string): CliResult {
  return { exitCode: 0, stdout }
}

function helpText(): string {
  return [
    'milkup action list [--permissions permission,permission] [--attached-url url] [--plugin-manifest path]',
    'milkup action describe <action-id> [--attached-url url] [--plugin-manifest path]',
    'milkup action run <action-id> [--input json] [--attached-url url] [--document text] [--selection anchor[:head]] [--plugin-manifest path] [--plugin-root path] [--plugin-network-origin origin[,origin]]',
    'milkup export [--format markdown|html|pdf] (--document text | --from-file path) [--out path]',
  ].join('\n')
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

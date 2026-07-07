import {
  actionAllowed,
  type ActionDefinition,
  type ActionInputField,
  type ActionInputSchema,
  type ActionPermission,
  type ActionRegistry,
} from '@milkup/core'

export interface McpProjectionOptions {
  readonly permissions?: readonly ActionPermission[]
  readonly allowlist?: readonly string[]
}

export interface MilkupMcpTool {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: McpJsonObjectSchema
  readonly annotations: {
    readonly actionId: string
    readonly category: string
    readonly requiredPermissions: readonly ActionPermission[]
    readonly risk: string
    readonly requiresConfirmation: boolean
    readonly readOnlyHint: boolean
    readonly destructiveHint: boolean
  }
}

export interface McpJsonObjectSchema {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, McpJsonFieldSchema>>
  readonly required?: readonly string[]
}

export interface McpJsonFieldSchema {
  readonly type: 'string' | 'number' | 'boolean'
  readonly description?: string
}

export interface MilkupMcpResource {
  readonly uri: string
  readonly name: string
  readonly mimeType: string
  readonly text: string
}

export interface McpResourceContext {
  readonly currentDocument?: {
    readonly documentId: string
    readonly text: string
  }
  readonly currentSelection?: {
    readonly anchor: number
    readonly head: number
  }
  readonly workspaceFiles?: readonly string[]
}

export function createMcpTools(
  registry: ActionRegistry,
  options: McpProjectionOptions = {},
): readonly MilkupMcpTool[] {
  const permissions = options.permissions ?? []
  const allowlist = options.allowlist ? new Set(options.allowlist) : undefined

  return Object.freeze(
    registry
      .list()
      .filter((action) => !allowlist || allowlist.has(action.id))
      .filter((action) => actionAllowed(action, permissions))
      .map(actionToMcpTool),
  )
}

export function actionToMcpTool(action: ActionDefinition): MilkupMcpTool {
  const risk = action.risk ?? 'safe'

  return Object.freeze({
    name: actionIdToToolName(action.id),
    title: action.title,
    description: action.description ?? action.title,
    inputSchema: toMcpInputSchema(action.inputSchema),
    annotations: Object.freeze({
      actionId: action.id,
      category: action.category,
      requiredPermissions: Object.freeze([...(action.permissions ?? [])]),
      risk,
      requiresConfirmation: action.requiresConfirmation === true || risk === 'destructive',
      readOnlyHint: risk === 'safe',
      destructiveHint: risk === 'destructive',
    }),
  })
}

export function toMcpInputSchema(schema: ActionInputSchema | undefined): McpJsonObjectSchema {
  const properties: Record<string, McpJsonFieldSchema> = {}
  const required: string[] = []

  for (const [name, field] of Object.entries(schema?.properties ?? {})) {
    properties[name] = toMcpFieldSchema(field)

    if (field.required) {
      required.push(name)
    }
  }

  return Object.freeze({
    type: 'object',
    properties: Object.freeze(properties),
    ...(required.length > 0 ? { required: Object.freeze(required) } : {}),
  })
}

export function createMcpResources(context: McpResourceContext): readonly MilkupMcpResource[] {
  const resources: MilkupMcpResource[] = []

  if (context.currentDocument) {
    resources.push(
      freezeResource({
        uri: `milkup://documents/${encodeURIComponent(context.currentDocument.documentId)}/source`,
        name: 'Current Document',
        mimeType: 'text/markdown',
        text: context.currentDocument.text,
      }),
    )
  }

  if (context.currentSelection) {
    resources.push(
      freezeResource({
        uri: 'milkup://selection/current',
        name: 'Current Selection',
        mimeType: 'application/json',
        text: JSON.stringify(context.currentSelection, null, 2),
      }),
    )
  }

  if (context.workspaceFiles) {
    resources.push(
      freezeResource({
        uri: 'milkup://workspace/files',
        name: 'Workspace Files',
        mimeType: 'application/json',
        text: JSON.stringify([...context.workspaceFiles].sort(), null, 2),
      }),
    )
  }

  return Object.freeze(resources)
}

function actionIdToToolName(actionId: string): string {
  return `milkup_action_${actionId.replaceAll('.', '__').replaceAll(':', '__')}`
}

function toMcpFieldSchema(field: ActionInputField): McpJsonFieldSchema {
  return Object.freeze({
    type: field.type,
    ...(field.description ? { description: field.description } : {}),
  })
}

function freezeResource(resource: MilkupMcpResource): MilkupMcpResource {
  return Object.freeze(resource)
}

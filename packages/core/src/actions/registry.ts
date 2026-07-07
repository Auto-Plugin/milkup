import type { Editor } from '../editor/editor'

export type ActionCategory = 'core' | 'document' | 'view' | 'file' | 'plugin'

export type ActionRiskLevel = 'safe' | 'write' | 'destructive'

export type ActionPermission =
  | 'document:read'
  | 'document:write'
  | 'view:read'
  | 'view:write'
  | 'file:read'
  | 'file:write'
  | 'file:delete'
  | 'network:access'
  | 'app:control'

export interface ActionInputField {
  readonly type: 'string' | 'number' | 'boolean'
  readonly required?: boolean
  readonly description?: string
}

export interface ActionInputSchema {
  readonly type: 'object'
  readonly properties?: Readonly<Record<string, ActionInputField>>
}

export interface ActionDefinition<Input = unknown, Output = unknown> {
  readonly id: string
  readonly title: string
  readonly category: ActionCategory
  readonly description?: string
  readonly inputSchema?: ActionInputSchema
  readonly permissions?: readonly ActionPermission[]
  readonly risk?: ActionRiskLevel
  readonly requiresConfirmation?: boolean
  run(context: ActionContext, input: Input): Output | Promise<Output>
}

export interface ActionContext {
  readonly editor?: Editor
  readonly permissions?: readonly ActionPermission[]
  confirm?(request: ActionConfirmationRequest): boolean | Promise<boolean>
}

export interface ActionConfirmationRequest {
  readonly action: ActionDefinition
  readonly input: unknown
}

export interface ActionRunOptions {
  readonly requireConfirmationForWrites?: boolean
}

export class ActionRegistry {
  private readonly actions = new Map<string, ActionDefinition>()

  constructor(actions: readonly ActionDefinition[] = []) {
    for (const action of actions) {
      this.register(action)
    }
  }

  register(action: ActionDefinition): void {
    validateActionDefinition(action)

    if (this.actions.has(action.id)) {
      throw new Error(`Action is already registered: ${action.id}`)
    }

    this.actions.set(action.id, action)
  }

  unregister(id: string): boolean {
    return this.actions.delete(id)
  }

  get(id: string): ActionDefinition | undefined {
    return this.actions.get(id)
  }

  list(): readonly ActionDefinition[] {
    return Object.freeze(
      [...this.actions.values()].sort((left, right) => left.id.localeCompare(right.id)),
    )
  }

  listAllowed(permissions: readonly ActionPermission[] = []): readonly ActionDefinition[] {
    return Object.freeze(this.list().filter((action) => actionAllowed(action, permissions)))
  }

  async run(
    id: string,
    context: ActionContext,
    input: unknown = {},
    options: ActionRunOptions = {},
  ): Promise<unknown> {
    const action = this.actions.get(id)

    if (!action) {
      throw new Error(`Unknown action: ${id}`)
    }

    assertActionAllowed(action, context.permissions ?? [])
    validateActionInput(action, input)

    if (actionRequiresConfirmation(action, options)) {
      const accepted = await context.confirm?.({ action, input })

      if (!accepted) {
        throw new Error(`Action requires confirmation: ${action.id}`)
      }
    }

    return action.run(context, input)
  }
}

export function validateActionDefinition(action: ActionDefinition): void {
  if (!isActionId(action.id)) {
    throw new Error(`Invalid action id: ${action.id}`)
  }

  if (action.title.trim().length === 0) {
    throw new Error(`Action title must not be empty: ${action.id}`)
  }

  validateInputSchema(action)
}

export function validateActionInput(action: ActionDefinition, input: unknown): void {
  const schema = action.inputSchema

  if (!schema) {
    return
  }

  if (!isObjectRecord(input)) {
    throw new Error(`Action input must be an object: ${action.id}`)
  }

  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const value = input[name]

    if (field.required && value === undefined) {
      throw new Error(`Missing required action input "${name}" for ${action.id}`)
    }

    if (value !== undefined && typeof value !== field.type) {
      throw new Error(`Invalid action input "${name}" for ${action.id}`)
    }
  }
}

export function actionAllowed(
  action: ActionDefinition,
  permissions: readonly ActionPermission[],
): boolean {
  return (action.permissions ?? []).every((permission) => permissions.includes(permission))
}

export function assertActionAllowed(
  action: ActionDefinition,
  permissions: readonly ActionPermission[],
): void {
  if (!actionAllowed(action, permissions)) {
    throw new Error(`Action is not allowed: ${action.id}`)
  }
}

function validateInputSchema(action: ActionDefinition): void {
  const schema = action.inputSchema

  if (!schema) {
    return
  }

  if (schema.type !== 'object') {
    throw new Error(`Action input schema must be an object schema: ${action.id}`)
  }

  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    if (!isActionInputFieldType(field.type)) {
      throw new Error(`Invalid action input field type "${field.type}" for ${action.id}.${name}`)
    }
  }
}

function actionRequiresConfirmation(action: ActionDefinition, options: ActionRunOptions): boolean {
  return (
    action.requiresConfirmation === true ||
    action.risk === 'destructive' ||
    (options.requireConfirmationForWrites === true && action.risk === 'write')
  )
}

function isActionId(id: string): boolean {
  return /^[a-z][A-Za-z0-9]*(?:[.:][a-z][A-Za-z0-9]*)+$/.test(id)
}

function isActionInputFieldType(type: string): type is ActionInputField['type'] {
  return type === 'string' || type === 'number' || type === 'boolean'
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

import {
  ActionRegistry,
  BasicEditor,
  createBuiltinActions,
  EditorState,
  MemoryTextDocument,
  Selection,
  type ActionContext,
  type ActionPermission,
} from '@milkup/core'

import {
  createMcpResources,
  createMcpTools,
  type McpProjectionOptions,
  type McpResourceContext,
  type MilkupMcpResource,
  type MilkupMcpTool,
} from './projection'

export interface McpServerContext extends McpResourceContext {
  readonly registry?: ActionRegistry
  readonly permissions?: readonly ActionPermission[]
  readonly allowlist?: readonly string[]
  readonly actionContext?: ActionContext
}

export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id?: JsonRpcId
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcSuccessResponse {
  readonly jsonrpc: '2.0'
  readonly id: JsonRpcId
  readonly result: unknown
}

export interface JsonRpcErrorResponse {
  readonly jsonrpc: '2.0'
  readonly id: JsonRpcId
  readonly error: {
    readonly code: number
    readonly message: string
  }
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse

interface ToolCallParams {
  readonly name?: unknown
  readonly arguments?: unknown
}

const JSON_RPC_VERSION = '2.0'

export async function handleMcpJsonRpcRequest(
  request: JsonRpcRequest,
  context: McpServerContext = {},
): Promise<JsonRpcResponse | undefined> {
  if (request.id === undefined) {
    await handleNotification(request, context)
    return undefined
  }

  try {
    return success(request.id, await handleRequest(request, context))
  } catch (error) {
    return failure(request.id, -32000, error instanceof Error ? error.message : String(error))
  }
}

export function createDefaultMcpServerContext(): McpServerContext {
  return {
    registry: new ActionRegistry(createBuiltinActions()),
    permissions: ['document:read', 'document:write', 'view:read', 'view:write'],
  }
}

async function handleRequest(request: JsonRpcRequest, context: McpServerContext): Promise<unknown> {
  switch (request.method) {
    case 'initialize':
      return initializeResult()
    case 'tools/list':
      return {
        tools: toolsForContext(context),
      }
    case 'tools/call':
      return callTool(request.params, context)
    case 'resources/list':
      return {
        resources: resourcesForContext(context).map(toResourceDescriptor),
      }
    case 'resources/read':
      return readResource(request.params, context)
    default:
      throw new Error(`Unsupported MCP method: ${request.method}`)
  }
}

async function handleNotification(
  request: JsonRpcRequest,
  _context: McpServerContext,
): Promise<void> {
  if (request.method === 'notifications/initialized') {
    return
  }

  throw new Error(`Unsupported MCP notification: ${request.method}`)
}

function initializeResult(): unknown {
  return {
    protocolVersion: '2024-11-05',
    serverInfo: {
      name: 'milkup-mcp',
      version: '0.0.0',
    },
    capabilities: {
      tools: {},
      resources: {},
    },
  }
}

async function callTool(params: unknown, context: McpServerContext): Promise<unknown> {
  const parsed = parseToolCallParams(params)
  const registry = context.registry ?? new ActionRegistry(createBuiltinActions())
  const tools = toolsForContext({ ...context, registry })
  const tool = tools.find((candidate) => candidate.name === parsed.name)

  if (!tool) {
    throw new Error(`Unknown MCP tool: ${parsed.name}`)
  }

  const actionContext = createActionContext(context)
  const output = await registry.run(
    tool.annotations.actionId,
    actionContext,
    parsed.arguments ?? {},
  )

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(output, null, 2),
      },
    ],
  }
}

function readResource(params: unknown, context: McpServerContext): unknown {
  if (typeof params !== 'object' || params === null || !('uri' in params)) {
    throw new Error('resources/read requires a uri')
  }

  const uri = params.uri

  if (typeof uri !== 'string') {
    throw new Error('resources/read uri must be a string')
  }

  const resource = resourcesForContext(context).find((candidate) => candidate.uri === uri)

  if (!resource) {
    throw new Error(`Unknown MCP resource: ${uri}`)
  }

  return {
    contents: [
      {
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: resource.text,
      },
    ],
  }
}

function toolsForContext(context: McpServerContext): readonly MilkupMcpTool[] {
  const registry = context.registry ?? new ActionRegistry(createBuiltinActions())
  const options: McpProjectionOptions = {
    permissions: context.permissions ?? [],
    ...(context.allowlist ? { allowlist: context.allowlist } : {}),
  }

  return createMcpTools(registry, options)
}

function resourcesForContext(context: McpServerContext): readonly MilkupMcpResource[] {
  return createMcpResources(context)
}

function createActionContext(context: McpServerContext): ActionContext {
  if (context.actionContext) {
    return {
      ...context.actionContext,
      ...(context.permissions ? { permissions: context.permissions } : {}),
    }
  }

  const documentText = context.currentDocument?.text ?? ''
  const selection = context.currentSelection
    ? Selection.range(context.currentSelection.anchor, context.currentSelection.head)
    : Selection.cursor(documentText.length)

  return {
    permissions: context.permissions ?? [],
    editor: new BasicEditor(
      new EditorState({
        doc: new MemoryTextDocument(documentText),
        selection,
      }),
    ),
  }
}

function parseToolCallParams(params: unknown): Required<ToolCallParams> {
  if (typeof params !== 'object' || params === null) {
    throw new Error('tools/call requires params')
  }

  const name = 'name' in params ? params.name : undefined
  const args = 'arguments' in params ? params.arguments : {}

  if (typeof name !== 'string') {
    throw new Error('tools/call name must be a string')
  }

  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('tools/call arguments must be an object')
  }

  return {
    name,
    arguments: args,
  }
}

function toResourceDescriptor(resource: MilkupMcpResource): Omit<MilkupMcpResource, 'text'> {
  return {
    uri: resource.uri,
    name: resource.name,
    mimeType: resource.mimeType,
  }
}

function success(id: JsonRpcId, result: unknown): JsonRpcSuccessResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  }
}

function failure(id: JsonRpcId, code: number, message: string): JsonRpcErrorResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
    },
  }
}

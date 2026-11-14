export {
  createMcpResources,
  createMcpTools,
  toMcpInputSchema,
  type McpProjectionOptions,
  type MilkupMcpResource,
  type MilkupMcpTool,
} from './projection'
export {
  createDefaultMcpServerContext,
  handleMcpJsonRpcRequest,
  type JsonRpcErrorResponse,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcSuccessResponse,
  type McpServerContext,
} from './server'
export { runStdioMcpServer, type StdioMcpServerOptions } from './stdio'

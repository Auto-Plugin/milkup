import type { PluginIsolationRpcEndpoint } from './isolation-rpc'

export type PluginRenderControl =
  { readonly type: 'timeout'; readonly id: string } | { readonly type: 'error' | 'disposed' }
interface Authority {
  subscribe(listener: (event: PluginRenderControl) => void): () => void
}
const authorities = new WeakMap<object, Authority>()
// Internal lookup, deliberately not exported from the package index or SDK.
export function getPluginRenderAuthority(endpoint: object): Authority | undefined {
  return authorities.get(endpoint)
}
export function registerPluginRenderAuthority(endpoint: object, authority: Authority): void {
  authorities.set(endpoint, authority)
}

/** Host-only transport facade. The subscription must originate in a trusted
 * native/Worker owner, never in child data or plugin-provided configuration. */
export function createTrustedPluginRenderEndpoint(
  transport: PluginIsolationRpcEndpoint & {
    close?(): void | Promise<void>
    readonly instanceId?: string
  },
  subscribe: Authority['subscribe'],
): PluginIsolationRpcEndpoint & { close?(): void | Promise<void>; readonly instanceId?: string } {
  const endpoint = Object.freeze({
    postMessage: (message: unknown) => transport.postMessage(message),
    ...(transport.addEventListener
      ? {
          addEventListener: transport.addEventListener.bind(transport),
        }
      : {}),
    ...(transport.removeEventListener
      ? { removeEventListener: transport.removeEventListener.bind(transport) }
      : {}),
    ...(transport.on ? { on: transport.on.bind(transport) } : {}),
    ...(transport.off ? { off: transport.off.bind(transport) } : {}),
    ...(transport.close ? { close: transport.close.bind(transport) } : {}),
    ...(transport.instanceId !== undefined ? { instanceId: transport.instanceId } : {}),
  })
  registerPluginRenderAuthority(endpoint, { subscribe })
  return endpoint
}

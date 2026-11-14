/** Host-owned transaction gate. The callback is never obtained from plugin messages. */
export function gateActivationCapability<T extends object>(
  capability: T,
  isActive: () => boolean,
  isCommitted: () => boolean,
  readable: readonly string[],
  cleanup: readonly string[] = [],
  onViolation?: (error: Error) => void,
  contract: {
    readonly asynchronous?: (method: string) => boolean
    readonly revoked?: () => Error
  } = {},
): T {
  const revoked = contract.revoked ?? (() => new Error('Plugin capability was revoked'))
  return Object.freeze(
    Object.fromEntries(
      Object.entries(capability).map(([key, value]) => {
        if (typeof value !== 'function') return [key, value]
        const invoke = (...args: unknown[]) => {
          if (cleanup.includes(key)) return Reflect.apply(value, capability, args)
          if (!isActive()) throw revoked()
          if (!isCommitted() && !readable.includes(key)) {
            const error = new Error(`Plugin activation is not committed: ${key}`)
            onViolation?.(error)
            throw error
          }
          const result: unknown = Reflect.apply(value, capability, args)
          if (result instanceof Promise)
            return result.then((value) => {
              if (!isActive()) throw revoked()
              return value
            })
          return result
        }
        // Preserve declared Promise contracts even when rejection happens before dispatch.
        // Synchronous scanners and union-return root file functions remain synchronous.
        return [
          key,
          contract.asynchronous?.(key) && !cleanup.includes(key)
            ? async (...args: unknown[]) => invoke(...args)
            : invoke,
        ]
      }),
    ),
  ) as T
}

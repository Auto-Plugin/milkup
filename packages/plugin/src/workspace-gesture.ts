import type { ActionContext } from '@milkup/core'

const contexts = new WeakMap<object, string>()
const proofs = new Map<string, { expires: number; pluginId?: string }>()
const TTL = 5_000
const markedEvents = new WeakSet<Event>()

/** Trusted host entry only. Call immediately before ActionRegistry.run with the
 * same context object and the original click/keydown, never a forwarded boolean. */
export function markTrustedPluginCommand(context: ActionContext, event: Event): void {
  const previous = contexts.get(context)
  if (previous) proofs.delete(previous)
  contexts.delete(context)
  // Use native accessors to reject synthetic/subclass overrides and forged
  // Event-shaped objects, and reject replay after the original dispatch ends.
  try {
    if (!(event instanceof Event) || markedEvents.has(event)) return
    const type = Object.getOwnPropertyDescriptor(Event.prototype, 'type')?.get?.call(event)
    const phase = Object.getOwnPropertyDescriptor(Event.prototype, 'eventPhase')?.get?.call(event)
    const trustedGetter =
      Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted')?.get ??
      Object.getOwnPropertyDescriptor(event, 'isTrusted')?.get
    if (
      !trustedGetter?.call(event) ||
      phase === undefined ||
      phase === 0 || // Event.NONE; Node Event types omit the static constant.
      !['click', 'keydown'].includes(type)
    )
      return
  } catch {
    return
  }
  markedEvents.add(event)
  const now = Date.now()
  for (const [id, proof] of proofs) if (proof.expires <= now) proofs.delete(id)
  if (proofs.size >= 64) return
  const id = crypto.randomUUID()
  proofs.set(id, { expires: now + TTL })
  contexts.set(context, id)
}

/** Internal transport metadata. Never add this token as a property of SDK contexts. */
export function pluginCommandGesture(context: object, pluginId: string): string | undefined {
  const id = contexts.get(context)
  const proof = id ? proofs.get(id) : undefined
  if (!id || !proof || proof.expires <= Date.now()) return undefined
  if (proof.pluginId !== undefined && proof.pluginId !== pluginId) return undefined
  proof.pluginId = pluginId
  return id
}

export function bindPluginCommandGesture(context: object, proof: string | undefined): void {
  if (proof) contexts.set(context, proof)
}

export function consumePluginCommandGesture(
  proofId: string | undefined,
  pluginId: string,
): boolean {
  if (!proofId) return false
  const proof = proofs.get(proofId)
  if (!proof || proof.expires <= Date.now() || proof.pluginId !== pluginId) return false
  proofs.delete(proofId)
  return true
}

export function revokePluginCommandGestures(pluginId: string): void {
  for (const [id, proof] of proofs) if (proof.pluginId === pluginId) proofs.delete(id)
}

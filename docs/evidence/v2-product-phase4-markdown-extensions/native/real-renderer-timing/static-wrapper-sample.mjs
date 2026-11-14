// External diagnostic only; no deadline decisions or business changes.
const diagnosticProtocol = 'milkup.renderer-timing.diagnostic.v1'
const renderProtocol = 'milkup.plugin.document-render.v1'
const originalPost = globalThis.postMessage
const pending = new Set()
let emitted = 0
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)
const emit = (id, phase) => {
  if (emitted++ >= 4096) return
  const marker = {
    protocol: diagnosticProtocol,
    id,
    phase,
    wall: Date.now(),
    mono: performance.now(),
    timeOrigin: performance.timeOrigin,
  }
  try {
    Reflect.apply(originalPost, globalThis, [marker])
  } catch {
    /* Observability cannot change business exceptions. */
  }
}
globalThis.addEventListener('message', (event) => {
  const message = event.data
  if (message?.protocol !== renderProtocol || message.type !== 'render' || !validId(message.id))
    return
  if (pending.size >= 64) pending.delete(pending.values().next().value)
  pending.add(message.id)
  emit(message.id, 'render-received-observer')
})
globalThis.postMessage = function (...args) {
  const message = args[0]
  const matched =
    message?.protocol === renderProtocol &&
    message.type === 'result' &&
    validId(message.id) &&
    pending.has(message.id)
  if (matched) emit(message.id, 'result-posting')
  const returned = Reflect.apply(originalPost, this, args)
  if (matched) {
    emit(message.id, 'result-post-returned')
    pending.delete(message.id)
  }
  return returned
}
const originalModule =
  await import('data:text/javascript,export default Object.freeze({documentRenderers:{}})')
export default originalModule.default

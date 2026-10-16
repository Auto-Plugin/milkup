const protocol = 'milkup.plugin.document-render.v1'
const errors = [
  'invalid-input',
  'invalid-output',
  'revoked',
  'aborted',
  'busy',
  'timeout',
  'unavailable',
] as const
type ErrorCode = (typeof errors)[number]
type RenderResult = { readonly id: string } & (
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: ErrorCode }
)
/** Shared settlement grammar. A malformed child response must never clear a
 * supervisor deadline while the consumer continues waiting for a valid result. */
export function readDocumentRenderResult(value: unknown): RenderResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const message = value as Record<string, unknown>
  if (
    Object.keys(message).some(
      (key) => !['protocol', 'type', 'id', 'ok', 'value', 'error'].includes(key),
    ) ||
    message.protocol !== protocol ||
    message.type !== 'result' ||
    typeof message.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(message.id)
  )
    return
  if (message.ok === true && Object.hasOwn(message, 'value') && !Object.hasOwn(message, 'error'))
    return { id: message.id, ok: true, value: message.value }
  if (
    message.ok === false &&
    typeof message.error === 'string' &&
    errors.includes(message.error as ErrorCode) &&
    !Object.hasOwn(message, 'value')
  )
    return { id: message.id, ok: false, error: message.error as ErrorCode }
  return
}

import { parse } from 'es-module-lexer/js'

/** Validate the exact sealed bytes before creating the plugin's Blob module.
 * The lexer recognizes imports inside executable syntax without mistaking strings
 * or comments for code. It is not a general JavaScript syntax validator: the
 * module loader still validates syntax during restricted activation.
 */
export function validateClosedWorkerBundle(source: string, maxBytes = 32 * 1024 * 1024): string {
  if (source.length > maxBytes || new TextEncoder().encode(source).byteLength > maxBytes)
    throw new Error('Plugin Worker bundle exceeds the decoded byte limit')
  const [imports] = parse(source)
  // import.meta describes this module; every other import can fetch code outside
  // the catalog's verified byte snapshot, even when its specifier is computed.
  if (imports.some((item) => item.d !== -2))
    throw new Error('Plugin Worker must be a single closed bundle without module imports')
  return source
}

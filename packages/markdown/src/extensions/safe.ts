export type MarkdownExtensionHook = 'block' | 'inline'

export interface MarkdownExtensionContext {
  readonly extensionName: string
  readonly hook: MarkdownExtensionHook
}

export type MarkdownExtensionResult<T> =
  | {
      readonly ok: true
      readonly value: T
    }
  | {
      readonly ok: false
      readonly error: unknown
      readonly context: MarkdownExtensionContext
    }

export function runMarkdownExtensionSafely<T>(
  context: MarkdownExtensionContext,
  run: () => T,
): MarkdownExtensionResult<T> {
  try {
    return Object.freeze({
      ok: true,
      value: run(),
    })
  } catch (error) {
    return Object.freeze({
      ok: false,
      error,
      context: Object.freeze({ ...context }),
    })
  }
}

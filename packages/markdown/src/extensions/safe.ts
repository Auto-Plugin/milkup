export type MarkdownExtensionHook = 'block' | 'inline'

export interface MarkdownSyntaxExtension {
  readonly id: string
  readonly nodeType: string
  readonly pattern: string
  readonly flags?: string
  readonly block?: boolean
  readonly inline?: boolean
}

export function compileMarkdownSyntaxPattern(extension: MarkdownSyntaxExtension): RegExp {
  if (extension.pattern.length > 256) {
    throw new Error(`Markdown syntax pattern is too long: ${extension.id}`)
  }

  if (
    /\(\?[<!=]|\\[1-9]|\([^)]*(?:\*|\+|\{\d+,?\d*\})[^)]*\)(?:\*|\+|\{)/.test(extension.pattern)
  ) {
    throw new Error(`Markdown syntax pattern uses unsafe features: ${extension.id}`)
  }

  const flags = extension.flags ?? ''

  if (!/^[imu]*$/.test(flags)) {
    throw new Error(`Markdown syntax flags are invalid: ${extension.id}`)
  }

  return new RegExp(extension.pattern, flags)
}

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

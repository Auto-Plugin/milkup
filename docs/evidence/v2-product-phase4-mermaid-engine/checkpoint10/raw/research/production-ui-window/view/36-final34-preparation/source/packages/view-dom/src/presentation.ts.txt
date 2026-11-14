/** Host-controlled presentation only; never serialized into a document transaction. */
export interface EditorPresentation {
  readonly fontFamily: 'system' | 'serif' | 'monospace'
  readonly fontSize: number
  /** Unitless line-height multiplier. */
  readonly lineHeight: number
  /** Zero uses the available viewport width. */
  readonly contentWidth: number
  readonly indentation: 'spaces-2' | 'spaces-4' | 'tabs'
}

const fonts = {
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Serif CJK SC", serif',
  monospace: '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
} as const

export function validatePresentation(value: EditorPresentation): EditorPresentation {
  if (
    !Object.hasOwn(fonts, value.fontFamily) ||
    !Number.isFinite(value.fontSize) ||
    value.fontSize < 12 ||
    value.fontSize > 32 ||
    !Number.isFinite(value.lineHeight) ||
    value.lineHeight < 1.2 ||
    value.lineHeight > 2.4 ||
    !Number.isFinite(value.contentWidth) ||
    (value.contentWidth !== 0 && (value.contentWidth < 480 || value.contentWidth > 1200)) ||
    !['spaces-2', 'spaces-4', 'tabs'].includes(value.indentation)
  ) {
    throw new RangeError('Invalid editor presentation')
  }
  return Object.freeze({ ...value })
}

export function applyPresentation(dom: HTMLElement, value: EditorPresentation): void {
  const height = value.fontSize * value.lineHeight
  dom.style.fontFamily = fonts[value.fontFamily]
  dom.style.fontSize = `${value.fontSize}px`
  dom.style.lineHeight = `${height}px`
  dom.style.setProperty('--milkup-line-height', `${height}px`)
  dom.style.setProperty(
    '--milkup-content-width',
    value.contentWidth ? `${value.contentWidth}px` : 'none',
  )
}

export function samePresentationLayout(
  previous: EditorPresentation | undefined,
  next: EditorPresentation,
): boolean {
  return (
    previous !== undefined &&
    previous.fontFamily === next.fontFamily &&
    previous.fontSize === next.fontSize &&
    previous.lineHeight === next.lineHeight &&
    previous.contentWidth === next.contentWidth
  )
}

export function indentationText(value?: EditorPresentation): string {
  return value?.indentation === 'tabs' ? '\t' : value?.indentation === 'spaces-4' ? '    ' : '  '
}

export function presentationOutdent(text: string, value?: EditorPresentation): number {
  if (text.startsWith('\t')) return 1
  return Math.min(/^ */u.exec(text)![0].length, value?.indentation === 'spaces-4' ? 4 : 2)
}

const fontTypes = ['editor-font', 'code-font'] as const
const fontSizeTypes = ['editor-font-size', 'code-font-size', 'editor-font-size-h1', 'editor-font-size-h2', 'editor-font-size-h3', 'editor-font-size-h4', 'editor-font-size-h5', 'editor-font-size-h6'] as const

export interface Font {
  label: string
  value: string
}

export interface FontConfig {
  'editor-font': Font
  'code-font': Font
}

export interface FontSizeConfig {
  'editor-font-size': string
  'code-font-size': string
  'editor-font-size-h1': string
  'editor-font-size-h2': string
  'editor-font-size-h3': string
  'editor-font-size-h4': string
  'editor-font-size-h5': string
  'editor-font-size-h6': string
}

export interface FontConfigItem {
  label: string
  desc: string
  value: string
}

export type FontList = Font[]

export type FontType = (typeof fontTypes)[number]
export type FontSizeType = (typeof fontSizeTypes)[number]

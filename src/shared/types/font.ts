const fontTypes = ['editor-font', 'code-font'] as const

export interface Font {
  label: string
  value: string
}

export interface FontConfig {
  'editor-font': Font
  'code-font': Font
}

export interface FontConfigItem {
  label: string
  desc: string
  value: string
}

export type FontList = Font[]

export type FontType = (typeof fontTypes)[number]

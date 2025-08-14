// 默认主题
const supportedThemes = [
  'normal',
  'normal-dark',
  'crepe',
  'crepe-dark',
  'frame',
  'frame-dark',
] as const

export type ThemeName = (typeof supportedThemes)[number] | string

export interface Theme {
  name: ThemeName
  label: string
  description: string
  isCustom?: boolean
  data: {
    themeProperties?: Record<string, string>
    appCssProperties: Record<string, string>
    appCssPropertiesArray?: string[]
    milkdownCssProperties: Record<string, string>
    milkdownCssPropertiesArray?: string[]
  }
}

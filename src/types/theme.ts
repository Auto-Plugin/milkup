// 默认主题
const supportedThemes = [
  'normal',
  'normal-dark',
  'crepe',
  'crepe-dark',
  'frame',
  'frame-dark',
] as const

export type ThemeName = (typeof supportedThemes)[number]

export interface ThemeList {
  name: ThemeName
  label: string
  description: string
  data: {
    themeProperties: Record<string, string>
    appCssProperties: Record<string, string>
    appCssPropertiesArray: string[]
    milkdownCssProperties: Record<string, string>
    milkdownCssPropertiesArray: string[]
  }
}

export interface TempTheme {
  label: string
  description: string
  data: {
    themeProperties: Record<string, string>
    milkdownCssProperties: Record<string, string>

  }
}

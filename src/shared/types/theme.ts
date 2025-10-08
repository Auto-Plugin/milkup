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

// 检查对象是否为Theme类型
export function isThemeObject(obj: any): obj is Theme {
  return obj
    && typeof obj === 'object'
    && typeof obj.name === 'string'
    && typeof obj.label === 'string'
    && typeof obj.description === 'string'
    && obj.data
    && typeof obj.data === 'object'
    && obj.data.themeProperties
    && typeof obj.data.themeProperties === 'object'
}

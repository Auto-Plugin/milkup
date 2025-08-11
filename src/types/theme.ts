// 扩展主题支持
const supportedThemes = [
  'normal',
  'normal-dark',
  'crepe',
  'crepe-dark',
  'frame',
  'frame-dark',
] as const

export type ThemeName = (typeof supportedThemes)[number]

export interface Theme {
  name: string
  label: string
  color: string
  description: string
  variables: Record<string, string>
}

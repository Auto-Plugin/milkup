export const themeNameMap: Record<string, { label: string, description: string }> = {
  'normal': {
    label: '亮色',
    description: '明亮清新的标准主题，适合日常使用',
  },
  'normal-dark': {
    label: '暗色',
    description: '深色风格主题，减少夜间使用时的眼睛疲劳',
  },
  'crepe': {
    label: 'Github白色',
    description: '类似GitHub风格的明亮主题，干净整洁',
  },
  'crepe-dark': {
    label: 'Github暗色',
    description: 'GitHub深色模式风格，适合夜间或弱光环境',
  },
  'frame': {
    label: '护眼色',
    description: '纸张护眼色，适合长时间阅读',
  },
  'frame-dark': {
    label: '暖色',
    description: '暖色风格主题，适合长时间阅读',
  },
}

export const cssVarsDesMap: {
  app: Record<string, string>
  editor: Record<string, string>
} = {
  // 应用主题css变量
  app: {
    '--primary-color': '主色',
    '--secondary-color': '次色',
    '--background-color': '背景色',
    '--background-color-1': '背景色1',
    '--background-color-2': '背景色2',
    '--background-color-3': '背景色3',
    '--text-color': '文字色',
    '--text-color-1': '文字色1',
    '--text-color-2': '文字色2',
    '--text-color-3': '文字色3',
    '--placeholder-color': '占位符色',
    '--border-color': '边框色',
    '--border-color-1': '边框色1',
    '--border-color-2': '边框色2',
    '--hover-color': '悬停色',
    '--hover-background-color': '悬停背景色',
    '--active-color': '激活色',
    '--active-line-color': '激活线色',
    '--selected-color': '选中色',
    '--selected-background-color': '选中背景色',
    '--primary-color-transparent': '主色透明',
  },

  // 编辑器css变量
  editor: {
    '--crepe-color-background': '背景色',
    '--crepe-color-on-background': '背景色',
    '--crepe-color-surface': '表面色',
    '--crepe-color-surface-low': '表面低色',
    '--crepe-color-on-surface': '表面色',
    '--crepe-color-on-surface-variant': '表面变体色',
    '--crepe-color-outline': '轮廓色',
    '--crepe-color-primary': '主色',
    '--crepe-color-secondary': '次色',
    '--crepe-color-on-secondary': '次色',
    '--crepe-color-inverse': '反色',
    '--crepe-color-on-inverse': '反色',
    '--crepe-color-inline-code': '内联代码色',
    '--crepe-color-error': '错误色',
    '--crepe-color-hover': '悬停色',
    '--crepe-color-selected': '选中色',
    '--crepe-color-inline-area': '内联区域色',
  },
}

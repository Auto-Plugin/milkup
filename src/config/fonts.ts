import type { FontConfig, FontConfigItem, FontType } from '@/types/font'

// 默认字体配置
export const defaultFontConfig: FontConfig = {
  'app-font': { label: '应用默认字体', value: '-apple-system, BlinkMacSystemFont, \'Segoe UI\', Helvetica, Arial, sans-serif' },
  'editor-font': { label: '编辑器默认字体', value: '-apple-system, BlinkMacSystemFont, \'Segoe UI\', Helvetica, Arial, sans-serif' },
  'code-font': { label: '代码默认字体', value: '\'SFMono-Regular\', Consolas, \'Liberation Mono\', Menlo, monospace;' },
}

// 字体配置项
export const fontConfig: Record<FontType, FontConfigItem> = {
  'app-font': {
    label: '应用字体',
    desc: '用于应用界面的主要字体',
    value: 'app-font',
  },
  'editor-font': {
    label: '编辑器字体',
    desc: '用于文本编辑器的字体',
    value: 'editor-font',
  },
  'code-font': {
    label: '代码字体',
    desc: '用于代码显示的字体',
    value: 'code-font',
  },
}

// CSS字体变量
const fontCssVariables = {
  'app-font': '--crepe-font-default',
  'editor-font': '--crepe-font-default',
  'code-font': '--crepe-font-code',
}

import type { FontConfig, FontConfigItem, FontSizeConfig, FontSizeType, FontType } from '@/types/font'

// 默认字体配置
export const defaultFontConfig: FontConfig = {
  'editor-font': { label: '编辑器默认字体', value: '-apple-system, BlinkMacSystemFont, \'Segoe UI\', Helvetica, Arial, sans-serif' },
  'code-font': { label: '代码默认字体', value: '\'SFMono-Regular\', Consolas, \'Liberation Mono\', Menlo, monospace;' },
}

export const defaultFontSizeConfig: FontSizeConfig = {
  'editor-font-size': '16px',
  'code-font-size': '16px',
  'editor-font-size-h1': '24px',
  'editor-font-size-h2': '20px',
  'editor-font-size-h3': '18px',
  'editor-font-size-h4': '16px',
  'editor-font-size-h5': '14px',
  'editor-font-size-h6': '12px',
}

// 字体配置项
export const fontConfig: Record<FontType, FontConfigItem> = {
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

// 字体尺寸配置项
export const fontSizeConfig: Record<FontSizeType, FontConfigItem> = {
  'editor-font-size': {
    label: '编辑器字体大小',
    desc: '文本编辑器的字体大小',
    value: 'editor-font-size',
  },
  'code-font-size': {
    label: '代码字体大小',
    desc: '代码显示的字体大小',
    value: 'code-font-size',
  },
  'editor-font-size-h1': {
    label: '一级标题',
    desc: '一级标题的字体大小',
    value: 'editor-font-size-h1',
  },
  'editor-font-size-h2': {
    label: '二级标题',
    desc: '二级标题的字体大小',
    value: 'editor-font-size-h2',
  },
  'editor-font-size-h3': {
    label: '三级标题',
    desc: '三级标题的字体大小',
    value: 'editor-font-size-h3',
  },
  'editor-font-size-h4': {
    label: '四级标题',
    desc: '四级标题的字体大小',
    value: 'editor-font-size-h4',
  },
  'editor-font-size-h5': {
    label: '五级标题',
    desc: '五级标题的字体大小',
    value: 'editor-font-size-h5',
  },
  'editor-font-size-h6': {
    label: '六级标题',
    desc: '六级标题的字体大小',
    value: 'editor-font-size-h6',
  },
}

// CSS字体变量配置项
export const fontCssVariables = {
  'editor-font': '--milkup-font-default',
  'code-font': '--milkup-font-code',

}

export const fontSizeCssVariables = {
  'editor-font-size': '--milkup-font-size-default',
  'code-font-size': '--milkup-font-size-code',
  'editor-font-size-h1': '--milkup-font-size-h1',
  'editor-font-size-h2': '--milkup-font-size-h2',
  'editor-font-size-h3': '--milkup-font-size-h3',
  'editor-font-size-h4': '--milkup-font-size-h4',
  'editor-font-size-h5': '--milkup-font-size-h5',
  'editor-font-size-h6': '--milkup-font-size-h6',
}

// 字体尺寸选项
export const fontSizeOptions = [
  { label: '12px', value: '12px' },
  { label: '13px', value: '13px' },
  { label: '14px', value: '14px' },
  { label: '15px', value: '15px' },
  { label: '16px', value: '16px' },
  { label: '17px', value: '17px' },
  { label: '18px', value: '18px' },
  { label: '20px', value: '20px' },
  { label: '22px', value: '22px' },
  { label: '24px', value: '24px' },
]

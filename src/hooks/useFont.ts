import type { Font, FontConfig, FontList, FontType } from '@/types/font'
import { ref } from 'vue'
import { defaultFontConfig, fontCssVariables } from '@/config/fonts'
import fontManager from '@/utils/fontManager'

// 系统字体列表
const fontList = ref<FontList>([])

// 当前字体
const currentFont = ref<FontConfig | null>(null)

async function init() {
  const fonts = await fontManager.loadFonts()
  currentFont.value = fonts

  // 获取系统字体列表
  try {
    const systemFonts = await window.electronAPI.getSystemFonts()
    // 将字符串数组转换为 Font 对象数组
    fontList.value = systemFonts.map(fontName => ({
      label: fontName,
      value: fontName,
    }))

    // 将默认字体配置添加到字体列表
    fontList.value.unshift(...Object.values(defaultFontConfig))

    console.log(fontList.value)
    console.log(currentFont.value)

    setFont('editor-font', currentFont.value!['editor-font'] as Font)
    setFont('code-font', currentFont.value!['code-font'] as Font)
  } catch (error) {
    console.error('获取系统字体列表失败:', error)
  }
}

function setFont(type: FontType, font: Font) {
  fontManager.setFont(type, font)
  currentFont.value![type] = font

  const cssVariables = fontCssVariables[type]
  if (cssVariables && font) {
    console.log('font::: ', font)
    // 同时应用到 milkdown 编辑器

    const milkdownElement = document.querySelector('.milkdown')
    if (milkdownElement) {
      (milkdownElement as HTMLElement).style.setProperty(cssVariables, font as any, 'important')
    }
  }
}

function getFontList() {
  return fontList
}

export default function useFont() {
  return {
    fontList,
    currentFont,
    init,
    setFont,
    getFontList,
  }
}

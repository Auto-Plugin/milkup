import type { Font, FontConfig, FontList, FontType } from '@/types/font'
import { ref } from 'vue'
import { defaultFontConfig } from '@/config/fonts'
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
    console.log(systemFonts)
    // 将字符串数组转换为 Font 对象数组
    fontList.value = systemFonts.map(fontName => ({
      label: fontName,
      value: fontName,
    }))

    // 将默认字体配置添加到字体列表
    fontList.value.unshift(...Object.values(defaultFontConfig))

    console.log(fontList.value)
    console.log(currentFont.value)
  } catch (error) {
    console.error('获取系统字体列表失败:', error)
  }
}

function setFont(type: FontType, font: Font) {
  fontManager.setFont(type, font)
  currentFont.value![type] = font

  // 字体应用
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

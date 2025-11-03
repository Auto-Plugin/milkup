import type { Font, FontConfig, FontList, FontSizeConfig, FontSizeType, FontType } from '@/types/font'
import { computed, ref } from 'vue'
import { fontCssVariables, fontSizeCssVariables, fontSizeOptions } from '@/config/fonts'
import { useConfig } from './useConfig'

// 系统字体列表
const fontList = ref<FontList>([])

// 获取配置管理实例
const { getConf, setConf } = useConfig()

// 当前字体配置
const currentFont = computed(() => getConf('font').family)

// 当前字体尺寸配置
const currentFontSize = computed(() => getConf('font').size)

async function init() {
  // 获取系统字体列表
  try {
    const systemFonts = await window.electronAPI.getSystemFonts()
    // Font 对象数组
    fontList.value = systemFonts.map((fontName) => {
      const name = fontName.replace(/^['"]|['"]$/g, '')
      return {
        label: name,
        value: name,
      }
    })

    // 应用当前字体配置到 DOM
    const fontConfig = getConf('font').family
    const fontSizeConfig = getConf('font').size

    // 设置字体
    applyFont(fontConfig)
    // 设置字体尺寸
    applyFontSize(fontSizeConfig)
  } catch (error) {
    console.error('获取系统字体列表失败:', error)
  }
}

function setFont(type: FontType, font: Font) {
  setConf('font', `family.${type}`, font)
  applyFont(getConf('font').family)
}

function setFontSize(type: FontSizeType, fontSize: string) {
  setConf('font', `size.${type}`, fontSize)
  applyFontSize(getConf('font').size)
}

// 应用字体配置到 DOM 元素
function applyFont(fontConfig: FontConfig) {
  const milkdownElement = document.querySelector('#fontRoot') as HTMLElement
  if (!milkdownElement)
    return

  // 设置字体样式
  Object.entries(fontConfig).forEach(([type, font]) => {
    const cssVar = fontCssVariables[type as FontType]
    if (cssVar && font) {
      milkdownElement.style.setProperty(cssVar, font.value, 'important')
    }
  })
}

function applyFontSize(fontSizeConfig: FontSizeConfig) {
  const milkdownElement = document.querySelector('#fontRoot') as HTMLElement
  if (!milkdownElement)
    return

  Object.entries(fontSizeConfig).forEach(([type, fontSize]) => {
    const cssVar = fontSizeCssVariables[type as FontSizeType]
    if (cssVar && fontSize) {
      milkdownElement.style.setProperty(cssVar, fontSize, 'important')

      // get
      // const fontSize = window.getComputedStyle(document.documentElement).getPropertyValue(cssVar)
    }
  })
}

export default function useFont() {
  return {
    fontList,
    currentFont,
    currentFontSize,
    fontSizeOptions,
    init,
    setFont,
    setFontSize,
  }
}

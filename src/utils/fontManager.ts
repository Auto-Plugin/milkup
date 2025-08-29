import type { Font, FontConfig, FontType } from '@/types/font'
import { defaultFontConfig } from '@/config/fonts'

let customFonts: FontConfig = { ...defaultFontConfig }

let isDefault = true

// 监听器
const listeners: ((fonts: FontConfig) => void)[] = []

// 通知所有监听器
function notifyListeners() {
  listeners.forEach(listener => listener(customFonts as FontConfig))
}

// 立即获取字体配置
async function loadFonts() {
  const fonts = localStorage.getItem('custom-fonts')
  if (fonts) {
    customFonts = JSON.parse(fonts)
    isDefault = false
  }

  setupStorageListener()

  notifyListeners()
  return customFonts
}

// 监听 storage
function setupStorageListener() {
  window.addEventListener('storage', (e) => {
    if (e.key === 'custom-fonts') {
      loadFonts()
    }
  })
}

// 模块加载时立即执行
loadFonts()

function getFont() {
  if (isDefault) {
    loadFonts()
  }

  return customFonts
}

function setFont(type: FontType, font: Font) {
  customFonts[type] = font

  // 保存到本地
  localStorage.setItem('custom-fonts', JSON.stringify(customFonts))

  // 通知监听器
  notifyListeners()
}

// 监听字体变化
function onFontsChange(callback: (fonts: FontConfig) => void): (() => void) {
  listeners.push(callback)

  // 返回取消监听的函数
  return () => {
    const index = listeners.indexOf(callback)
    if (index >= 0) {
      listeners.splice(index, 1)
    }
  }
}

// 卸载监听器
function uninstallListeners() {
  // 移除 storage 事件监听器
  window.removeEventListener('storage', (e) => {
    if (e.key === 'custom-fonts') {
      loadFonts()
    }
  })
}

// 导出字体管理器
export default {
  customFonts,
  loadFonts,

  getFont,
  setFont,

  // 监听字体
  onFontsChange,
  uninstallListeners,

}

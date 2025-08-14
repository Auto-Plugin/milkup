import type { Theme, ThemeName } from '@/types/theme'

let localThemes: Theme[] = []

// 监听器
const listeners: ((themes: Theme[]) => void)[] = []

// 通知所有监听器
function notifyListeners() {
  listeners.forEach(listener => listener(localThemes))
}

// 立即加载主题
function loadThemes() {
  const themes = localStorage.getItem('custom-themes')

  if (themes) {
    localThemes = JSON.parse(themes)
  } else {
    localThemes = []
  }

  setupStorageListener()

  notifyListeners()
  return localThemes
}

// 监听 localStorage 变化
function setupStorageListener() {
  // 监听 storage 事件（跨标签页/窗口的 localStorage 变化）
  window.addEventListener('storage', (e) => {
    if (e.key === 'custom-themes') {
      loadThemes()
    }
  })
}

// 模块加载时立即执行
loadThemes()

function getThemes() {
  return localThemes
}

function getCurrentLocalTheme() {
  return localStorage.getItem('theme-name') || 'normal' as ThemeName
}

function setCurrentLocalTheme(theme: ThemeName) {
  localStorage.setItem('theme-name', theme)
}

function removeTheme(name: ThemeName) {
  // 删除本地存储中的主题
  localThemes = localThemes.filter(theme => theme.name !== name)

  // 保存到本地
  localStorage.setItem('custom-themes', JSON.stringify(localThemes))

  // 通知监听器
  notifyListeners()
}

function addTheme(theme: Theme) {
  localThemes.push(theme)

  // 保存到本地
  localStorage.setItem('custom-themes', JSON.stringify(localThemes))

  // 通知监听器
  notifyListeners()
}

// 监听主题变化
function onThemesChange(callback: (themes: Theme[] | null) => void): (() => void) {
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
    if (e.key === 'custom-themes') {
      loadThemes()
    }
  })
}

// 导出主题管理器
export default {
  localThemes,
  loadLocalThemes: loadThemes,
  getLocalThemes: getThemes,
  getCurrentLocalTheme,
  setCurrentLocalTheme,
  removeLocalTheme: removeTheme,
  addLocalTheme: addTheme,
  onThemesChange,
  uninstallListeners,
}

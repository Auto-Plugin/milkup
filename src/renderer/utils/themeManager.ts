import type { Theme, ThemeName } from '@/types/theme'

let localThemes: Theme[] = []

// 监听器
const listeners: ((themes: Theme[]) => void)[] = []

// 标记是否已设置storage监听器
let storageListenerSetup = false

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

// storage事件处理器 - 使用命名函数以便正确移除
function handleStorageChange(e: StorageEvent) {
  if (e.key === 'custom-themes') {
    loadThemes()
  }
}

// 监听 storage
function setupStorageListener() {
  // 防止重复注册
  if (storageListenerSetup) {
    return
  }

  window.addEventListener('storage', handleStorageChange)
  storageListenerSetup = true
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
  // 是否有存在的主题
  const editingThemeName = getEditingThemeFromStorage()

  // 覆盖
  if (editingThemeName) {
    // 删除旧主题
    localThemes = localThemes.filter(t => t.name !== editingThemeName)

    // 清理编辑
    clearEditingThemeFromStorage()
  }

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
  if (storageListenerSetup) {
    window.removeEventListener('storage', handleStorageChange)
    storageListenerSetup = false
  }

  // 清空所有主题变化监听器
  listeners.length = 0
}

// 获取编辑中的主题数据
function getEditingThemeFromStorage() {
  const theme = localStorage.getItem('editing-theme')

  return theme ? JSON.parse(theme) as ThemeName : null
}

// 设置编辑中的主题数据
function setEditingThemeToStorage(theme: ThemeName) {
  localStorage.setItem('editing-theme', JSON.stringify(theme))
}

// 清理编辑中的主题数据
function clearEditingThemeFromStorage() {
  localStorage.removeItem('editing-theme')
}

// 导出主题管理器
export default {
  localThemes,
  loadLocalThemes: loadThemes,

  // 增删改查
  getLocalThemes: getThemes,
  getCurrentLocalTheme,
  setCurrentLocalTheme,
  removeLocalTheme: removeTheme,
  addLocalTheme: addTheme,

  // 监听主题
  onThemesChange,
  uninstallListeners,

  // 编辑主题
  getEditingThemeFromStorage,
  setEditingThemeToStorage,
  clearEditingThemeFromStorage,
}

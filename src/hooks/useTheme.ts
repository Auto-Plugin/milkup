import type { Theme, ThemeName } from '@/types/theme'
import autolog from 'autolog.js'
import { onMounted, onUnmounted, ref, toRaw } from 'vue'
import { cssVarsDesMap, themeNameMap } from '@/config/theme'
import { isThemeObject } from '@/types/theme'
import themeManager from '@/utils/themeManager'
import { randomUUID } from '@/utils/tool'

const {
  localThemes,
  getLocalThemes,
  removeLocalTheme,
  addLocalTheme,
  onThemesChange,
  uninstallListeners,
  getCurrentLocalTheme,
  setCurrentLocalTheme,
  setEditingThemeToStorage,
  getEditingThemeFromStorage,
  clearEditingThemeFromStorage,
} = themeManager
const currentTheme = ref<ThemeName>('normal')
const tempTheme = ref<Theme>()

const themes = ref<Theme[]>([])

// 初始化主题
function init() {
  // 获取本地当前应用的主题name
  currentTheme.value = getCurrentLocalTheme()

  // 应用主题
  setTheme()
}

// 获取主题列表
function getThemes() {
  // 获取文件夹
  const themes = import.meta.glob('@/themes/*/theme.less', { eager: true })

  // 过滤出文件夹并生成主题名称
  const themeList: Theme[] = []

  for (const path in themes) {
    const pathParts = path.split('/')
    const folderName = pathParts[pathParts.length - 2] // 获取文件夹名

    // 所有css键和值
    const themeProperties: Record<string, string> = {}

    // 应用css键
    const appCssPropertiesArray: string[] = []

    // 编辑器css键
    const milkdownCssPropertiesArray: string[] = []

    // 应用css属性
    const appCssProperties: Record<string, string> = {}

    // 编辑器css属性
    const milkdownCssProperties: Record<string, string> = {}

    try {
      // 获取所有样式表
      const styleSheets = Array.from(document.styleSheets)

      // 查找主题
      const themeRules = styleSheets.flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules || sheet.rules)
        } catch (e) {
          return []
        }
      }).filter((rule) => {
        // ----------精确匹配主题类名------------------
        if (!(rule instanceof CSSStyleRule))
          return false

        const selectorText = rule.selectorText
        if (!selectorText)
          return false

        // eg：.theme-normal 不应该匹配到 .theme-normal-dark
        const exactThemeClass = `.theme-${folderName}`

        const themeClassPattern = new RegExp(`${exactThemeClass.replace('.', '\\.')}(?=\\s|$|\\{|\\,|\\+)`)
        return themeClassPattern.test(selectorText)
      })

      // 提取CSS变量和属性，区分应用CSS和编辑器CSS
      themeRules.forEach((rule) => {
        if (rule instanceof CSSStyleRule) {
          const style = rule.style
          for (let i = 0; i < style.length; i++) {
            const propertyName = style[i]
            const propertyValue = style.getPropertyValue(propertyName)

            // 区分应用CSS和编辑器CSS
            if (propertyName.startsWith('--crepe')) {
              // 编辑器CSS属性
              milkdownCssProperties[propertyName] = propertyValue
              milkdownCssPropertiesArray.push(propertyName)
            } else {
              // 应用CSS属性
              appCssProperties[propertyName] = propertyValue
              appCssPropertiesArray.push(propertyName)
            }

            // 总体css
            themeProperties[propertyName] = propertyValue
          }
        }
      })
    } catch (error) {
      console.warn(`匹配主题错误:`, error)
    }

    if (folderName) {
      // 将文件夹名称转换为主题名称格式（将连字符转换为下划线）
      const themeName = folderName
      themeList.unshift({
        name: themeName as ThemeName,
        label: themeNameMap[themeName as keyof typeof themeNameMap]?.label || themeName,
        description: themeNameMap[themeName as keyof typeof themeNameMap]?.description || '',
        data: {
          // 所有css
          themeProperties,
          // 应用css
          appCssProperties,
          appCssPropertiesArray,
          // 编辑器css
          milkdownCssProperties,
          milkdownCssPropertiesArray,
        },
      })
    }
  }

  // 合并本地主题
  const localThemesList = getLocalThemes()
  if (localThemesList && localThemesList.length > 0) {
    themeList.push(...localThemesList)
  }

  return themeList
}

// 根据类名获取主题
function getThemeByCn(cn: ThemeName) {
  if (!themes.value.length)
    themes.value = getThemes()

  const theme = themes.value.find(item => item.name === cn)

  if (!theme)
    return themes.value[0]

  return theme
}

// 设置主题
function setTheme(theme: ThemeName = currentTheme.value) {
  // 确保只获取一次
  if (!themes.value.length)
    themes.value = getThemes()

  // 是否存在该主题
  const isHasTheme = themes.value.some(list => list.name === theme)

  // 如果没有直接使用默认主题
  if (!isHasTheme) {
    theme = themes.value[0].name
  }

  const html = document.documentElement

  // 移除所有以 theme- 开头的类名
  const allClasses = Array.from(html.classList)
  const themeClasses = allClasses.filter(className => className.startsWith('theme-'))
  html.classList.remove(...themeClasses)

  // 移除之前可能存在的自定义主题样式
  const existingCustomStyle = document.getElementById('custom-theme-style')
  if (existingCustomStyle) {
    existingCustomStyle.remove()
  }

  // 查找当前主题数据
  const currentThemeData = themes.value.find(list => list.name === theme)

  // 注入 CSS
  if (currentThemeData?.isCustom) {
    const style = document.createElement('style')
    style.id = 'custom-theme-style'

    // 生成 CSS
    const cssVars = Object.entries(currentThemeData.data.themeProperties || {})
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n')

    style.textContent = `.theme-${theme} {${cssVars}}`
    document.head.appendChild(style)
  }

  // 应用
  html.classList.add(`theme-${theme}`)

  // 应用编辑器
  const id = 'milkdown-theme'
  let link = document.getElementById(id) as HTMLLinkElement | null

  if (!link) {
    link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }

  let basePath = ''
  if (import.meta.env.PROD) {
    basePath = '../renderer/public'
  }
  link.href = `${basePath}/milkdown-themes/${theme}/style.css`

  currentTheme.value = theme
  setCurrentLocalTheme(theme)
}

// 保存主题
function saveTheme() {
  if (!tempTheme.value)
    return

  // 转为普通变量
  const tempThemeData = toRaw(tempTheme.value)

  // 使用 themeManager 添加本地主题
  addLocalTheme(tempThemeData)

  // // 清空临时主题
  // tempTheme.value = undefined
}

// 添加临时主题
function addTempTheme(themeName?: ThemeName) {
  // 如果传入了主题名称，说明是编辑现有主题
  if (themeName) {
    // 存储到 localStorage
    setEditingThemeToStorage(themeName)

    window.electronAPI.openThemeEditor()
  } else {
    // 新增主题：基于当前主题创建新主题
    const themeList = themes.value.length ? themes.value : getThemes()

    let currentThemeData = themeList.find(item => item.name === currentTheme.value)

    if (!currentThemeData) {
      // 就用列表第一个主题来生成
      currentThemeData = themes.value[0]
    }

    const appCssProperties = currentThemeData.data.appCssProperties
    const milkdownCssProperties = currentThemeData.data.milkdownCssProperties

    const themeProperties = {
      ...appCssProperties,
      ...milkdownCssProperties,
    }

    const appCssPropertiesArray = Object.keys(appCssProperties)
    const milkdownCssPropertiesArray = Object.keys(milkdownCssProperties)

    const data = {
      appCssProperties,
      milkdownCssProperties,
      themeProperties,
      appCssPropertiesArray,
      milkdownCssPropertiesArray,
    }

    tempTheme.value = {
      name: `theme-custom-${randomUUID()}`,
      label: '自定义主题',
      description: '这是自定义主题，包含了用户自定义的css变量',
      isCustom: true,
      data,
    }
  }

  window.electronAPI.openThemeEditor()
}

// 删除本地主题
function removeTheme(themeName: ThemeName) {
  removeLocalTheme(themeName)

  // 重新获取主题列表
  themes.value = getThemes()
}

// 获取所有css变量解释
function getAllCssVarsDes() {
  return cssVarsDesMap
}

// 监听本地主题变化
function watchLocalThemes(callback: (themes: Theme[] | null) => void) {
  return onThemesChange(callback)
}

// 同步主题列表
onThemesChange((localThemesList) => {
  if (localThemesList) {
    themes.value = getThemes()
  }
})

// 导出主题
function exportTheme(themeName: ThemeName) {
  const theme = getThemeByCn(themeName)
  const dataStr = JSON.stringify(theme, null, 2)
  const dataBlob = new Blob([dataStr], { type: 'application/json' })
  const url = URL.createObjectURL(dataBlob)

  // 创建下载元素
  const link = document.createElement('a')
  link.href = url
  link.download = `${theme.label || theme.name}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  autolog.log('导出完成', 'success')
}

// 导入主题JSON
function importTheme(theme: any) {
  // parse
  const themeData = JSON.parse(theme)

  // 检查是否为Theme类型
  const isTheme = isThemeObject(themeData)

  if (!isTheme) {
    autolog.log('导入主题格式错误', 'error')
  }

  // 添加到本地主题
  addLocalTheme(themeData)
  autolog.log('导入主题完成', 'success')
}

onUnmounted(() => {
  uninstallListeners()
})

onMounted(() => { })

export default function useTheme() {
  return {
    // 主题变量
    themes,
    currentTheme,
    tempTheme,
    localThemes,

    // 增删改查
    init,
    getThemes,
    setTheme,
    saveTheme,
    removeTheme,
    getAllCssVarsDes,
    addTempTheme,
    getThemeByCn,

    // 监听主题
    watchLocalThemes,

    // 编辑主题
    getEditingThemeFromStorage,
    clearEditingThemeFromStorage,
    setEditingThemeToStorage,

    // 导出导入主题
    exportTheme,
    importTheme,
  }
}

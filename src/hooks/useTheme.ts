import type { TempTheme, ThemeList, ThemeName } from '@/types/theme'
import { ref } from 'vue'
import { cssVarsDesMap, themeNameMap } from '@/config/theme'

const currentTheme = ref<ThemeName>('normal')
const tempTheme = ref<TempTheme>()

const themes = ref<ThemeList[]>([])

// 初始化主题
function init() {
  const savedThemeName = localStorage.getItem('theme-name') || 'normal'
  currentTheme.value = savedThemeName as ThemeName

  // 应用主题
  setTheme()
}

// 获取主题列表
function getThemes() {
  // 获取文件夹
  const themes = import.meta.glob('@/themes/*/theme.less', { eager: true })

  // 过滤出文件夹并生成主题名称
  const themeList: ThemeList[] = []

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
  console.log(themeList)

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

function setTheme(theme: ThemeName = currentTheme.value, saveToStorage = true) {
  // 确保只获取一次
  if (!themes.value.length)
    themes.value = getThemes()

  // 是否为默认主题
  const isDefaultTheme = themes.value.some(list => list.name === theme)

  if (isDefaultTheme) {
    const html = document.documentElement

    // 确保移除其他主题类
    const classes = Object.keys(themeNameMap).map(item => `theme-${item}`)
    html.classList.remove(...classes)

    // 应用应用主题
    html.classList.add(`theme-${theme}`)

    // 应用编辑器主题
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

    if (saveToStorage) {
      localStorage.setItem('theme-name', theme)
    }
  } else {
    // 自定义主题
  }
}

function addTempTheme(theme?: string) {
  // 基于当前主题提取他的appCssProperties
  const themeList = themes.value.length ? themes.value : getThemes()

  let currentThemeData = themeList.find(item => item.name === currentTheme.value)

  if (!currentThemeData) {
    // 就用列表第一个主题来生成
    currentThemeData = themes.value[0]
  }

  const themeProperties = currentThemeData.data.themeProperties
  const milkdownCssProperties = currentThemeData.data.milkdownCssProperties

  tempTheme.value = {
    label: theme || '自定义主题',
    description: '这是自定义主题，包含了用户自定义的css变量',
    data: {
      themeProperties,
      milkdownCssProperties,
    },
  }

  console.log(tempTheme)
}

setTimeout(() => {
  addTempTheme('自定义主题')
}, 1000)

// 获取所有css变量解释
function getAllCssVarsDes() {
  return cssVarsDesMap
}

export default function useTheme() {
  return {
    currentTheme,
    tempTheme,
    init,
    getThemes,
    getThemeByCn,
    setTheme,
    getAllCssVarsDes,
    addTempTheme,
  }
}

import { createApp } from 'vue'
import ThemeEditor from './components/ThemeEditor.vue'
import './style.less'
import '@/themes/theme-main.less'
import '@milkdown/crepe/theme/common/style.css'
import '@/lib/iconfont/iconfont.css'

// 从本地存储获取自定义主题
function getCustomThemes(): any[] {
  const stored = localStorage.getItem('custom-themes')
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch (e) {
      console.error('解析自定义主题失败:', e)
      return []
    }
  }
  return []
}

// 应用自定义主题样式
function applyCustomThemeStyles(customTheme: any) {
  const styleId = 'custom-theme-styles'
  let styleElement = document.getElementById(styleId) as HTMLStyleElement | null

  if (!styleElement) {
    styleElement = document.createElement('style')
    styleElement.id = styleId
    document.head.appendChild(styleElement)
  }

  // 生成 CSS 变量
  const cssVars = Object.entries(customTheme.variables)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n')

  const milkdownVars = Object.entries(customTheme.variables)
    .filter(([key]) => key.startsWith('--crepe-'))
    .map(([key, value]) => `    ${key}: ${value};`)
    .join('\n')

  styleElement.textContent = `
html.theme-${customTheme.name} {
${cssVars}

  .milkdown {
${milkdownVars}

    --crepe-font-title: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
    --crepe-font-default: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
    --crepe-font-code: 'JetBrains Mono', 'Fira Code', Menlo, monospace;

    --crepe-shadow-1: 0px 1px 3px 1px rgba(0, 0, 0, 0.1), 0px 1px 2px 0px rgba(0, 0, 0, 0.15);
    --crepe-shadow-2: 0px 2px 6px 2px rgba(0, 0, 0, 0.1), 0px 1px 2px 0px rgba(0, 0, 0, 0.15);
  }
}`
}

// 应用当前主题
function applyCurrentTheme() {
  const savedThemeName = localStorage.getItem('theme-name') || 'normal'
  const savedThemeType = localStorage.getItem('theme-type') as 'light' | 'dark' || 'light'

  const html = document.documentElement

  // 检查是否是自定义主题
  const customThemesList = getCustomThemes()
  const isCustomTheme = customThemesList.some((theme: any) => theme.name === savedThemeName)

  if (isCustomTheme) {
    // 自定义主题：只应用CSS变量，不加载外部CSS文件
    console.log('应用自定义主题:', savedThemeName)

    // 移除所有主题类
    html.classList.remove('theme-normal', 'theme-normal-dark', 'theme-crepe', 'theme-crepe-dark', 'theme-frame', 'theme-frame-dark')
    customThemesList.forEach((theme: any) => {
      html.classList.remove(`theme-${theme.name}`)
    })

    // 添加自定义主题类
    html.classList.add(`theme-${savedThemeName}`)

    // 应用自定义样式
    const customTheme = customThemesList.find((theme: any) => theme.name === savedThemeName)
    if (customTheme) {
      applyCustomThemeStyles(customTheme)
    }

    // 对于自定义主题，使用默认的Milkdown主题作为基础
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

    // 使用默认的crepe主题作为Milkdown基础
    link.href = `${basePath}/milkdown-themes/crepe/style.css`
  } else {
    // 预设主题：加载对应的CSS文件
    console.log('应用预设主题:', savedThemeName)

    // 移除所有主题类
    html.classList.remove('theme-normal', 'theme-normal-dark', 'theme-crepe', 'theme-crepe-dark', 'theme-frame', 'theme-frame-dark')
    customThemesList.forEach((theme: any) => {
      html.classList.remove(`theme-${theme.name}`)
    })

    // 添加预设主题类
    html.classList.add(`theme-${savedThemeName}`)

    // 应用Milkdown编辑器主题
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

    // 设置Milkdown编辑器主题
    link.href = `${basePath}/milkdown-themes/${savedThemeName}/style.css`
  }
}

// 初始化主题
applyCurrentTheme()

const app = createApp(ThemeEditor)
app.mount('#theme-editor-app')

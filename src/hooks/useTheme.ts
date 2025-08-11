import type { Theme, ThemeName } from '@/types/theme'
import { ref } from 'vue'

const themeName = ref<ThemeName>('normal')

// 从本地存储获取自定义主题
function getCustomThemes(): Theme[] {
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
function applyCustomThemeStyles(customTheme: Theme) {
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

// 根据主题名称和类型应用主题
function applyTheme(name: ThemeName) {
  themeName.value = name

  const html = document.documentElement

  // 检查是否是自定义主题
  const customThemesList = getCustomThemes()
  const isCustomTheme = customThemesList.some(theme => theme.name === name)

  if (isCustomTheme) {
    // 自定义主题：只应用CSS变量，不加载外部CSS文件
    console.log('应用自定义主题:', name)

    // 移除所有主题类
    html.classList.remove('theme-normal', 'theme-normal-dark', 'theme-crepe', 'theme-crepe-dark', 'theme-frame', 'theme-frame-dark')
    customThemesList.forEach((theme) => {
      html.classList.remove(`theme-${theme.name}`)
    })

    // 添加自定义主题类
    html.classList.add(`theme-${name}`)

    // 应用自定义样式
    const customTheme = customThemesList.find(theme => theme.name === name)
    if (customTheme) {
      applyCustomThemeStyles(customTheme)
    }

    // 对于自定义主题，使用默认的Milkdown主题作为基础
    switchMilkTheme('crepe')
  } else {
    // 预设主题：加载对应的CSS文件
    console.log('应用预设主题:', name)

    // 移除所有主题类
    html.classList.remove('theme-normal', 'theme-normal-dark', 'theme-crepe', 'theme-crepe-dark', 'theme-frame', 'theme-frame-dark')
    customThemesList.forEach((theme) => {
      html.classList.remove(`theme-${theme.name}`)
    })

    // 添加预设主题类
    html.classList.add(`theme-${name}`)

    // 应用Milkdown编辑器主题
    switchMilkTheme(name)
  }

  // 保存主题设置
  localStorage.setItem('theme-name', name)
}

// 切换Milkdown编辑器主题
function switchMilkTheme(theme: string) {
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
  link.href = `${basePath}/milkdown-themes/${theme}/style.css`
}

export default function useTheme() {
  // 初始化：读取本地主题设置
  if (typeof window !== 'undefined') {
    const savedThemeName = localStorage.getItem('theme-name') as ThemeName | null

    if (savedThemeName) {
      // 应用保存的主题
      applyTheme(savedThemeName)
    } else {
      // 默认主题
      applyTheme('normal')
    }
  }

  // 提供方法
  return {
    themeName,
    setTheme: applyTheme,
    getTheme: getCustomThemes,
    applyCustomThemeStyles,
  }
}

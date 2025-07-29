import { ref } from 'vue'

const defaultThemes = ['light', 'dark']
type Theme = typeof defaultThemes[number]

const theme = ref<Theme>('light')

function applyTheme(newTheme: Theme) {
  theme.value = newTheme
  const html = document.documentElement
  if (newTheme === 'dark') {
    html.classList.add('dark')
    // switchMilkTheme('dark')
  }
  else {
    html.classList.remove('dark')
    // switchMilkTheme('light')
  }
  localStorage.setItem('theme', newTheme)
}
// @ts-expect-error
function switchMilkTheme(theme: 'light' | 'dark') {
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
  if (theme === 'light') {
    link.href = `${basePath}/milkdown-themes/nord/style.css`
  }
  else {
    link.href = `${basePath}/milkdown-themes/nord-dark/style.css`
  }
}
export default function useTheme() {
  // 初始化：读取本地主题
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('theme') as Theme | null
    if (saved === 'dark' || saved === 'light') {
      applyTheme(saved)
    }
    else {
      applyTheme('light') // 默认
    }
  }

  // 手动切换主题
  const toggleTheme = () => {
    const next = theme.value === 'light' ? 'dark' : 'light'
    applyTheme(next)
  }

  return {
    defaultThemes,
    theme,
    setTheme: applyTheme,
    toggleTheme,
  }
}

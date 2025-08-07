<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

interface ThemeOption {
  name: string
  label: string
  type: 'light' | 'dark'
  color: string // 主题色彩预览
  description: string // 主题描述
  isCustom?: boolean // 是否是自定义主题
}

interface CustomTheme {
  name: string
  label: string
  type: 'light' | 'dark'
  color: string
  description: string
  variables: Record<string, string>
}

// 预定义主题选项
const predefinedThemes: ThemeOption[] = [
  {
    name: 'normal',
    label: '亮色主题',
    type: 'light',
    color: '#88c0d0',
    description: '明亮清新的标准主题，适合日常使用',
  },
  {
    name: 'normal-dark',
    label: '暗色主题',
    type: 'dark',
    color: '#3b4252',
    description: '深色风格主题，减少夜间使用时的眼睛疲劳',
  },
  {
    name: 'crepe',
    label: 'GitHub主题',
    type: 'light',
    color: '#ffffff',
    description: '类似GitHub风格的明亮主题，干净整洁',
  },
  {
    name: 'crepe-dark',
    label: '深色GitHub主题',
    type: 'dark',
    color: '#0d1117',
    description: 'GitHub深色模式风格，适合夜间或弱光环境',
  },
  {
    name: 'frame',
    label: '纸张护眼色',
    type: 'light',
    color: '#f5f5dc',
    description: '类似纸张的米色背景，减少视觉疲劳，适合长时间阅读',
  },
  {
    name: 'frame-dark',
    label: '暖色主题',
    type: 'dark',
    color: '#2d2d2d',
    description: '温暖的深色主题，减轻眼睛负担，带来舒适的夜间使用体验',
  },
]

// 自定义主题
const customThemes = ref<ThemeOption[]>([])

// 合并所有主题选项
const themeOptions = computed(() => {
  return [...predefinedThemes, ...customThemes.value]
})

// 当前主题
const currentThemeName = ref(localStorage.getItem('theme-name') || 'normal')

// 计算当前主题对象
const currentTheme = computed(() => {
  return themeOptions.value.find(t => t.name === currentThemeName.value) || themeOptions.value[0]
})

// 设置主题
function setMilkdownTheme(themeName: string, themeType: 'light' | 'dark') {
  const html = document.documentElement

  // 检查是否是自定义主题
  const customThemeList = getCustomThemes()
  const isCustomTheme = customThemeList.some(theme => theme.name === themeName)

  if (isCustomTheme) {
    // 自定义主题：只应用CSS变量，不加载外部CSS文件
    console.log('应用自定义主题:', themeName)

    // 移除所有主题类
    html.classList.remove('theme-normal', 'theme-normal-dark', 'theme-crepe', 'theme-crepe-dark', 'theme-frame', 'theme-frame-dark')
    customThemeList.forEach((theme) => {
      html.classList.remove(`theme-${theme.name}`)
    })

    // 添加自定义主题类
    html.classList.add(`theme-${themeName}`)

    // 应用自定义样式
    const customTheme = customThemeList.find(theme => theme.name === themeName)
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
    console.log('应用预设主题:', themeName)

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

    // 加载预设主题的CSS文件
    link.href = `${basePath}/milkdown-themes/${themeName}/style.css`

    // 移除所有主题类
    html.classList.remove('theme-normal', 'theme-normal-dark', 'theme-crepe', 'theme-crepe-dark', 'theme-frame', 'theme-frame-dark')
    customThemeList.forEach((theme) => {
      html.classList.remove(`theme-${theme.name}`)
    })

    // 添加预设主题类
    html.classList.add(`theme-${themeName}`)
  }

  // 保存主题设置并更新当前主题状态
  localStorage.setItem('theme-name', themeName)
  localStorage.setItem('theme-type', themeType)
  currentThemeName.value = themeName
}

// 应用自定义主题样式
function applyCustomThemeStyles(customTheme: CustomTheme) {
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

// 主题切换
function handleChangeTheme(option: ThemeOption) {
  setMilkdownTheme(option.name, option.type)
}

// 打开自定义主题编辑器
function handleCreateCustomTheme() {
  console.log('开始创建自定义主题...')

  // 复制当前主题并保存为临时主题
  const currentThemeName = localStorage.getItem('theme-name') || 'normal'
  const currentThemeType = localStorage.getItem('theme-type') as 'light' | 'dark' || 'light'

  console.log('当前主题信息:', { currentThemeName, currentThemeType })

  // 创建临时主题名称
  const tempThemeName = `temp-theme-${Date.now()}`

  // 获取当前主题的变量 - 改进版本
  const html = document.documentElement
  const milkdownElement = document.querySelector('.milkdown') as HTMLElement
  const milkdownRoot = document.querySelector('#milkdown') as HTMLElement

  // 收集所有CSS变量
  const variables: Record<string, string> = {}
  const cssVars = [
    '--primary-color',
    '--secondary-color',
    '--background-color',
    '--background-color-1',
    '--background-color-2',
    '--background-color-3',
    '--text-color',
    '--text-color-1',
    '--text-color-2',
    '--text-color-3',
    '--placeholder-color',
    '--border-color',
    '--border-color-1',
    '--border-color-2',
    '--hover-color',
    '--hover-background-color',
    '--active-color',
    '--active-line-color',
    '--selected-color',
    '--selected-background-color',
    '--primary-color-transparent',
    '--crepe-color-background',
    '--crepe-color-on-background',
    '--crepe-color-surface',
    '--crepe-color-surface-low',
    '--crepe-color-on-surface',
    '--crepe-color-on-surface-variant',
    '--crepe-color-outline',
    '--crepe-color-primary',
    '--crepe-color-secondary',
    '--crepe-color-on-secondary',
    '--crepe-color-inverse',
    '--crepe-color-on-inverse',
    '--crepe-color-inline-code',
    '--crepe-color-error',
    '--crepe-color-hover',
    '--crepe-color-selected',
    '--crepe-color-inline-area',
  ]

  // 从多个元素获取变量，确保获取完整
  const elements = [html, milkdownElement, milkdownRoot].filter(Boolean)

  cssVars.forEach((varName) => {
    let value = ''

    // 优先从根元素获取
    const htmlStyle = getComputedStyle(html)
    value = htmlStyle.getPropertyValue(varName).trim()

    // 如果根元素没有，尝试从milkdown元素获取
    if (!value && milkdownElement) {
      const milkdownStyle = getComputedStyle(milkdownElement)
      value = milkdownStyle.getPropertyValue(varName).trim()
    }

    // 如果还是没有，尝试从milkdown根元素获取
    if (!value && milkdownRoot) {
      const milkdownRootStyle = getComputedStyle(milkdownRoot)
      value = milkdownRootStyle.getPropertyValue(varName).trim()
    }

    if (value) {
      variables[varName] = value
      console.log(`找到变量 ${varName}: ${value}`)
    } else {
      console.warn(`未找到CSS变量: ${varName}`)
    }
  })

  console.log('收集到的临时主题变量:', variables)
  console.log('变量数量:', Object.keys(variables).length)

  // 创建临时主题对象
  const tempTheme = {
    name: tempThemeName,
    label: '临时主题',
    type: currentThemeType,
    color: variables['--primary-color'] || '#4a90e2',
    description: '基于当前主题的临时主题',
    variables,
  }

  // 保存临时主题到localStorage
  const customThemesList = getCustomThemes()
  customThemesList.push(tempTheme)
  localStorage.setItem('custom-themes', JSON.stringify(customThemesList))

  console.log('临时主题已保存:', tempThemeName)
  console.log('保存的主题变量数量:', Object.keys(tempTheme.variables).length)
  console.log('localStorage中的主题列表:', customThemesList.map(t => ({ name: t.name, varCount: Object.keys(t.variables || {}).length })))

  // 应用临时主题
  setMilkdownTheme(tempThemeName, currentThemeType)

  console.log('临时主题已应用，准备打开主题编辑器...')

  // 打开主题编辑器
  if (window.electronAPI && (window.electronAPI as any).openThemeEditor) {
    ; (window.electronAPI as any).openThemeEditor()
  }
}

// 显示通知消息
function showNotification(message: string, type: 'success' | 'error' = 'success') {
  // 创建通知元素
  const notification = document.createElement('div')
  notification.className = `theme-notification ${type}`
  notification.textContent = message

  // 添加到页面
  document.body.appendChild(notification)

  // 3秒后自动移除
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification)
    }
  }, 3000)
}

// 显示确认对话框
function showConfirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('div')
    dialog.className = 'theme-confirm-dialog'
    dialog.innerHTML = `
      <div class="dialog-content">
        <p>${message}</p>
        <div class="dialog-buttons">
          <button class="btn-cancel">取消</button>
          <button class="btn-confirm">确定</button>
        </div>
      </div>
    `

    document.body.appendChild(dialog)

    const cancelBtn = dialog.querySelector('.btn-cancel')
    const confirmBtn = dialog.querySelector('.btn-confirm')

    const cleanup = () => {
      if (dialog.parentNode) {
        dialog.parentNode.removeChild(dialog)
      }
    }

    cancelBtn?.addEventListener('click', () => {
      cleanup()
      resolve(false)
    })

    confirmBtn?.addEventListener('click', () => {
      cleanup()
      resolve(true)
    })
  })
}

// 拖拽加载JSON主题文件
function handleDragOver(event: DragEvent) {
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'copy'

  // 添加拖拽悬停效果
  const target = event.currentTarget as HTMLElement
  target.classList.add('drag-over')
}

function handleDragLeave(event: DragEvent) {
  // 移除拖拽悬停效果
  const target = event.currentTarget as HTMLElement
  target.classList.remove('drag-over')
}

async function handleDrop(event: DragEvent) {
  event.preventDefault()

  // 移除拖拽悬停效果
  const target = event.currentTarget as HTMLElement
  target.classList.remove('drag-over')

  const files = event.dataTransfer?.files
  if (!files || files.length === 0)
    return

  const file = files[0]
  if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
    showNotification('请拖拽JSON格式的主题文件', 'error')
    return
  }

  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const themeData = JSON.parse(e.target?.result as string)

      // 验证主题数据格式
      if (!themeData.name || !themeData.label || !themeData.variables) {
        showNotification('主题文件格式不正确，请确保包含name、label和variables字段', 'error')
        return
      }

      // 检查主题名称是否已存在
      const existingThemes = getCustomThemes()
      const existingTheme = existingThemes.find(t => t.name === themeData.name)

      if (existingTheme) {
        const confirmed = await showConfirmDialog(`主题"${themeData.name}"已存在，是否覆盖？`)
        if (!confirmed)
          return
      }

      // 添加或更新主题
      const customTheme: CustomTheme = {
        name: themeData.name,
        label: themeData.label,
        type: themeData.type || 'light',
        color: themeData.color || '#4a90e2',
        description: themeData.description || '从JSON文件导入的主题',
        variables: themeData.variables,
      }

      if (existingTheme) {
        // 更新现有主题
        const index = existingThemes.findIndex(t => t.name === themeData.name)
        existingThemes[index] = customTheme
      } else {
        // 添加新主题
        existingThemes.push(customTheme)
      }

      // 保存到localStorage
      localStorage.setItem('custom-themes', JSON.stringify(existingThemes))

      // 更新组件状态
      customThemes.value = existingThemes.map(theme => ({
        name: theme.name,
        label: theme.label,
        type: theme.type,
        color: theme.color,
        description: theme.description,
        isCustom: true,
      }))

      showNotification(`主题"${customTheme.label}"已成功导入！`)
    } catch (error) {
      console.error('解析主题文件失败:', error)
      showNotification('主题文件格式错误，请检查JSON格式', 'error')
    }
  }

  reader.readAsText(file)
}

// 编辑临时主题
function handleEditTempTheme(themeName: string) {
  console.log('开始编辑临时主题:', themeName)

  // 应用临时主题
  setMilkdownTheme(themeName, 'light') // 临时主题类型默认为light

  console.log('临时主题已应用，准备打开主题编辑器...')

  // 打开主题编辑器
  if (window.electronAPI && (window.electronAPI as any).openThemeEditor) {
    ; (window.electronAPI as any).openThemeEditor()
  }
}

// 导出主题
function handleExportTheme(themeName: string) {
  console.log('开始导出主题:', themeName)

  const customThemesList = getCustomThemes()
  const theme = customThemesList.find(theme => theme.name === themeName)

  if (!theme) {
    console.error('未找到主题:', themeName)
    return
  }

  // 创建导出数据
  const exportData = {
    ...theme,
    exportDate: new Date().toISOString(),
    version: '1.0.0',
  }

  // 创建下载链接
  const dataStr = JSON.stringify(exportData, null, 2)
  const dataBlob = new Blob([dataStr], { type: 'application/json' })
  const url = URL.createObjectURL(dataBlob)

  // 创建下载元素
  const link = document.createElement('a')
  link.href = url
  link.download = `${theme.label || theme.name}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  // 清理URL
  URL.revokeObjectURL(url)

  console.log('主题导出完成:', themeName)
}

// 删除自定义主题
function handleDeleteCustomTheme(themeName: string) {
  const customThemesList = getCustomThemes()
  const filteredList = customThemesList.filter(theme => theme.name !== themeName)
  localStorage.setItem('custom-themes', JSON.stringify(filteredList))

  // 如果删除的是当前主题，切换到默认主题
  if (currentThemeName.value === themeName) {
    setMilkdownTheme('normal', 'light')
  }

  // 更新组件状态
  loadCustomThemes()

  // 移除自定义样式
  const html = document.documentElement
  html.classList.remove(`theme-${themeName}`)
}

// 从本地存储获取自定义主题
function getCustomThemes(): CustomTheme[] {
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

// 加载自定义主题到组件状态
function loadCustomThemes() {
  const customThemesList = getCustomThemes()
  customThemes.value = customThemesList.map(theme => ({
    name: theme.name,
    label: theme.label,
    type: theme.type,
    color: theme.color,
    description: theme.description,
    isCustom: true,
  }))
}

// 处理来自主题编辑器窗口的保存事件
function handleCustomThemeSaved(theme: CustomTheme) {
  // 保存到本地存储
  const customThemesList = getCustomThemes()

  // 检查是否已存在同名主题
  const existingIndex = customThemesList.findIndex(t => t.name === theme.name)
  if (existingIndex >= 0) {
    customThemesList[existingIndex] = theme
  } else {
    customThemesList.push(theme)
  }

  localStorage.setItem('custom-themes', JSON.stringify(customThemesList))

  // 更新组件状态
  loadCustomThemes()

  // 自动应用新创建的主题
  setMilkdownTheme(theme.name, theme.type)
}

// 初始化主题
function initTheme() {
  const savedThemeName = localStorage.getItem('theme-name') || 'normal'
  const savedThemeType = localStorage.getItem('theme-type') as 'light' | 'dark' || 'light'

  // 应用保存的主题
  setMilkdownTheme(savedThemeName, savedThemeType)
}

// 组件挂载时初始化
onMounted(() => {
  loadCustomThemes()
  initTheme()

  // 监听来自主题编辑器的保存事件
  if (window.electronAPI) {
    window.electronAPI.on('custom-theme-saved', handleCustomThemeSaved)
  }
})
</script>

<template>
  <div class="ThemePageBox">
    <div class="theme-header">
      <h2>选择您喜欢的主题风格</h2>
    </div>

    <div class="theme-grid">
      <!-- 现有主题 -->
      <div
        v-for="option in themeOptions" :key="option.name" class="theme-card"
        :class="{ active: option.name === currentThemeName }" @click.stop="handleChangeTheme(option)"
      >
        <div class="theme-preview" :style="{ backgroundColor: option.color }">
          <div class="preview-content" :class="option.type === 'dark' ? 'dark-preview' : 'light-preview'">
            <div class="preview-header"></div>
            <div class="preview-lines">
              <div class="preview-line"></div>
              <div class="preview-line"></div>
              <div class="preview-line"></div>
            </div>
          </div>
        </div>
        <div class="theme-info">
          <div class="theme-title">
            <h3>{{ option.label }}</h3>
            <div v-if="option.isCustom" class="theme-actions">
              <button
                v-if="option.name.startsWith('temp-theme-')" class="edit-btn" title="编辑临时主题"
                @click.stop="handleEditTempTheme(option.name)"
              >
                <svg
                  t="1754554776090" class="icon" viewBox="0 0 1024 1024" version="1.1"
                  xmlns="http://www.w3.org/2000/svg" p-id="4251" width="16" height="16"
                >
                  <path
                    d="M832 512q0-14.016 8.992-23.008T864 480t23.008 8.992T896 512v352q0 14.016-8.992 23.008T864 896H160q-14.016 0-23.008-8.992T128 864V160q0-14.016 8.992-23.008T160 128h352q14.016 0 23.008 8.992T544 160t-8.992 23.008T512 192H192v640h640V512z m-361.984 42.016l52.992-7.008L847.008 222.016q12.992-12.992 8.512-30.496t-22.496-22.496-31.008 8L477.024 501.024zM892 132q28 28 28 67.488t-28 68.512L560.992 599.008q-8 8-19.008 10.016l-104.992 15.008q-16 2.016-27.008-9.504t-8.992-27.488L416 482.048q0.992-11.008 8.992-18.016L756.992 132.032q28.992-28 67.488-28t67.488 28z"
                    p-id="4252"
                  ></path>
                </svg>
              </button>
              <button class="export-btn" title="导出主题" @click.stop="handleExportTheme(option.name)">
                <svg t="1754554833984" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4409" width="16" height="16"><path d="M160 832h704q14.016 0 23.008 8.992T896 864t-8.992 23.008T864 896H160q-14.016 0-23.008-8.992T128 864t8.992-23.008T160 832z m384-253.984l236-236 46.016 44.992L509.024 704l-316.992-316.992 44.992-44.992 243.008 243.008V128.032h64v450.016z" p-id="4410"></path></svg>
              </button>
              <button class="delete-btn" title="删除自定义主题" @click.stop="handleDeleteCustomTheme(option.name)">
                <svg
                  t="1754554743858" class="icon" viewBox="0 0 1024 1024" version="1.1"
                  xmlns="http://www.w3.org/2000/svg" p-id="4093" width="16" height="16"
                >
                  <path
                    d="M764 215.008L512 467.008 260 215.008q-10.016-8.992-22.496-8.992t-22.016 9.504-9.504 22.016 8.992 22.496l252 252-252 252q-12.992 12.992-8.512 31.008t22.016 22.496 31.488-8.512l252-252 252 252q10.016 8.992 22.496 8.992t22.016-9.504 9.504-22.016-8.992-22.496L556.992 512l252-252q12.992-12.992 8.512-31.008t-22.496-22.496-31.008 8.512z"
                    p-id="4094"
                  ></path>
                </svg>
              </button>
            </div>
          </div>
          <p>{{ option.description }}</p>
        </div>
      </div>

      <!-- 添加自定义主题按钮 -->
      <div
        class="theme-card add-custom-theme"
        @click="handleCreateCustomTheme"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <div class="add-custom-preview">
          <div class="add-icon">
            +
          </div>
          <div class="drag-hint-overlay">
            <svg class="drag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7,10 12,15 17,10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>拖拽JSON文件导入</span>
          </div>
        </div>
        <div class="theme-info">
          <h3>自定义主题(Beta)</h3>
          <p>创建自定义主题风格或拖拽JSON文件导入</p>
        </div>
      </div>
    </div>

    <div class="current-theme">
      <div class="current-theme-info">
        <h3>当前主题: {{ currentTheme.label }}</h3>
        <p>{{ currentTheme.description }}</p>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.ThemePageBox {
  width: 100%;
  height: 100%;
  padding: 0 20px 20px 20px;

  .theme-header {
    margin-bottom: 24px;

    h2 {
      font-size: 20px;
      color: var(--text-color);
      margin-bottom: 8px;
    }

    p {
      font-size: 14px;
      color: var(--text-color-2);
    }
  }

  .theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 16px;
    margin-bottom: 24px;

    .theme-card {
      background: var(--background-color-2);
      border: 1px solid var(--border-color-2);
      border-radius: 6px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      &.active {
        border-color: var(--primary-color);
        box-shadow: 0 0 0 2px var(--primary-color-transparent);
      }

      &.add-custom-theme {
        border-style: dashed;
        border-color: var(--border-color-1);
        position: relative;

        &:hover {
          border-color: var(--primary-color);
          background: var(--hover-background-color);
        }

        &.drag-over {
          border-color: var(--primary-color);
          background: var(--primary-color-transparent);
          transform: scale(1.02);
        }

        .add-custom-preview {
          height: 140px;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--background-color-1);
          position: relative;

          .add-icon {
            font-size: 48px;
            color: var(--text-color-3);
            font-weight: 300;
            transition: opacity 0.2s;
          }

          .drag-hint-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(74, 144, 226, 0.9);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: white;
            opacity: 0;
            transition: opacity 0.2s;
            border-radius: 6px 6px 0 0;

            .drag-icon {
              width: 32px;
              height: 32px;
              margin-bottom: 8px;
            }

            span {
              font-size: 12px;
              font-weight: 500;
            }
          }

          &:hover .drag-hint-overlay {
            opacity: 1;
          }
        }
      }

      .theme-preview {
        height: 140px;
        width: 100%;
        padding: 12px;

        .preview-content {
          height: 100%;
          border-radius: 4px;
          padding: 8px;

          &.light-preview {
            background-color: rgba(255, 255, 255, 0.85);
            color: #333;
          }

          &.dark-preview {
            background-color: rgba(0, 0, 0, 0.75);
            color: #eee;
          }

          .preview-header {
            height: 12px;
            width: 70%;
            background-color: currentColor;
            opacity: 0.7;
            border-radius: 4px;
            margin-bottom: 12px;
          }

          .preview-lines {
            display: flex;
            flex-direction: column;
            gap: 6px;

            .preview-line {
              height: 8px;
              background-color: currentColor;
              opacity: 0.5;
              border-radius: 4px;

              &:nth-child(1) {
                width: 100%;
              }

              &:nth-child(2) {
                width: 85%;
              }

              &:nth-child(3) {
                width: 65%;
              }
            }
          }
        }
      }

      .theme-info {
        padding: 12px;

        .theme-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;

          h3 {
            font-size: 16px;
            color: var(--text-color);
            margin: 0;
          }

          .theme-actions {
            display: flex;
            gap: 6px;
            align-items: center;

            .edit-btn {
              background: none;
              border: none;
              color: var(--text-color-3);
              font-size: 14px;
              cursor: pointer;
              width: 30px;
              height: 30px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 3px;
              opacity: 0.7;
              transition: all 0.2s ease;

              &:hover {
                background: var(--hover-background-color);
                color: var(--text-color-1);
                opacity: 1;
              }

              .icon {
                width: 20px;
                height: 20px;
                fill: currentColor;
              }
            }

            .export-btn {
              background: none;
              border: none;
              color: var(--text-color-3);
              font-size: 14px;
              cursor: pointer;
              width: 30px;
              height: 30px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 3px;
              opacity: 0.7;
              transition: all 0.2s ease;

              &:hover {
                background: var(--hover-background-color);
                color: var(--text-color-1);
                opacity: 1;
              }

              .icon {
                width: 20px;
                height: 20px;
                fill: currentColor;
              }
            }

            .delete-btn {
              background: none;
              border: none;
              color: var(--text-color-3);
              font-size: 18px;
              cursor: pointer;
              width: 30px;
              height: 30px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 3px;
              opacity: 0.7;
              transition: all 0.2s ease;

              &:hover {
                background: var(--hover-background-color);
                color: var(--text-color-1);
                opacity: 1;
              }

              .icon {
                width: 20px;
                height: 20px;
                fill: currentColor;
              }
            }
          }
        }

        h3 {
          font-size: 16px;
          color: var(--text-color);
          margin-bottom: 6px;
        }

        p {
          font-size: 13px;
          color: var(--text-color-2);
          line-height: 1.4;
          margin: 0;
        }
      }
    }
  }

  .current-theme {
    padding: 16px;
    background: var(--background-color-3);
    border-radius: 6px;

    .current-theme-info {
      h3 {
        font-size: 16px;
        color: var(--text-color);
        margin-bottom: 4px;
      }

      p {
        font-size: 14px;
        color: var(--text-color-2);
      }
          }
    }
  }

  // 通知样式
  .theme-notification {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 16px;
    border-radius: 6px;
    color: white;
    font-size: 14px;
    z-index: 10000;
    animation: slideIn 0.3s ease;

    &.success {
      background: #10b981;
    }

    &.error {
      background: #ef4444;
    }
  }

  // 确认对话框样式
  .theme-confirm-dialog {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;

    .dialog-content {
      background: var(--background-color-2);
      border: 1px solid var(--border-color-1);
      border-radius: 8px;
      padding: 24px;
      max-width: 400px;
      width: 90%;

      p {
        margin: 0 0 20px 0;
        color: var(--text-color);
        font-size: 16px;
      }

      .dialog-buttons {
        display: flex;
        gap: 12px;
        justify-content: flex-end;

        button {
          padding: 8px 16px;
          border-radius: 4px;
          border: none;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;

          &.btn-cancel {
            background: var(--background-color-1);
            color: var(--text-color-2);
            border: 1px solid var(--border-color-1);

            &:hover {
              background: var(--hover-background-color);
              color: var(--text-color-1);
            }
          }

          &.btn-confirm {
            background: var(--primary-color);
            color: white;

            &:hover {
              background: var(--active-color);
            }
          }
        }
      }
    }
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
</style>

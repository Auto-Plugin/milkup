<script setup lang="ts">
import autolog from 'autolog.js'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import useTheme from '@/hooks/useTheme'
import MilkdownEditor from './MilkdownEditor.vue'

const { getTheme: getCustomThemes } = useTheme()

// 错误消息
const errorMessage = ref('')

// 主题变量
const themeVariables = ref<Record<string, string>>({})

// 是否有临时主题
const hasTempTheme = ref(false)

// 主题标签和描述
const themeLabel = ref('')
const themeDescription = ref('')

// 初始化主题变量 - 基于当前主题
function initThemeVariables() {
  console.log('开始初始化主题变量...')

  // 获取自定义主题列表
  const customThemesList = getCustomThemes()
  console.log('自定义主题列表:', customThemesList.map(t => t.name))

  // 查找临时主题（以 temp-theme- 开头的主题）
  const tempTheme = customThemesList.find(theme => theme.name.startsWith('temp-theme-'))

  if (tempTheme) {
    // 如果找到临时主题，使用临时主题的变量
    console.log('找到临时主题:', tempTheme.name)
    console.log('临时主题变量数量:', Object.keys(tempTheme.variables || {}).length)
    console.log('临时主题变量详情:', tempTheme.variables)

    themeVariables.value = { ...tempTheme.variables }
    hasTempTheme.value = true

    // 加载主题标签和描述
    themeLabel.value = tempTheme.label || ''
    themeDescription.value = tempTheme.description || ''

    console.log('基于临时主题初始化变量:', tempTheme.name, themeVariables.value)

    // 立即应用临时主题变量到DOM
    updatePreview()
    return
  }

  console.log('未找到临时主题，使用当前主题变量')

  // 如果没有临时主题，使用当前主题的变量
  const currentThemeName = localStorage.getItem('theme-name') || 'normal'

  console.log('当前主题信息:', { currentThemeName })

  // 获取当前主题的CSS变量
  const html = document.documentElement
  const computedStyle = getComputedStyle(html)

  // 定义需要获取的CSS变量列表
  const cssVariables = [
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
  ]

  // 获取当前主题的变量值
  const currentVariables: Record<string, string> = {}
  cssVariables.forEach((varName) => {
    const value = computedStyle.getPropertyValue(varName).trim()
    if (value) {
      currentVariables[varName] = value
    } else {
      console.warn(`未找到CSS变量: ${varName}`)
    }
  })

  console.log('获取到的应用变量:', currentVariables)

  // 获取Milkdown相关的变量
  const milkdownVariables = [
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

  // 尝试从多个位置获取Milkdown变量
  const getMilkdownVariables = () => {
    // 从milkdown元素获取变量
    const milkdownElement = document.querySelector('.milkdown') as HTMLElement
    if (milkdownElement) {
      const milkdownStyle = getComputedStyle(milkdownElement)
      milkdownVariables.forEach((varName) => {
        const value = milkdownStyle.getPropertyValue(varName).trim()
        if (value) {
          currentVariables[varName] = value
        }
      })
    }

    // 从milkdown根元素获取变量
    const milkdownRoot = document.querySelector('#milkdown') as HTMLElement
    if (milkdownRoot) {
      const milkdownStyle = getComputedStyle(milkdownRoot)
      milkdownVariables.forEach((varName) => {
        const value = milkdownStyle.getPropertyValue(varName).trim()
        if (value) {
          currentVariables[varName] = value
        }
      })
    }

    // 从document获取变量（作为后备）
    milkdownVariables.forEach((varName) => {
      const value = computedStyle.getPropertyValue(varName).trim()
      if (value && !currentVariables[varName]) {
        currentVariables[varName] = value
      }
    })
  }

  // 立即尝试获取
  getMilkdownVariables()

  console.log('获取到的Milkdown变量:', Object.keys(currentVariables).filter(key => key.startsWith('--crepe-')))

  // 设置初始变量
  themeVariables.value = currentVariables

  console.log('基于当前主题初始化变量:', currentThemeName, currentVariables)

  // 如果Milkdown还没有加载，延迟获取
  if (Object.keys(currentVariables).filter(key => key.startsWith('--crepe-')).length === 0) {
    setTimeout(() => {
      getMilkdownVariables()
      // 更新变量，保留已有的变量
      const updatedVariables = { ...themeVariables.value, ...currentVariables }
      themeVariables.value = updatedVariables
      console.log('延迟获取Milkdown变量:', updatedVariables)
    }, 1000)
  }
}

// 关闭窗口
function handleClose() {
  console.log('主题编辑器关闭按钮被点击')
  if (window.electronAPI) {
    console.log('调用主题编辑器窗口控制: close')
    window.electronAPI.themeEditorWindowControl('close')
  } else {
    console.log('window.electronAPI 不存在')
  }
}

// 更新预览
function updatePreview() {
  console.log('开始更新预览，变量数量:', Object.keys(themeVariables.value).length)

  // 缓存DOM元素，避免重复查询
  const html = document.documentElement
  const milkdownElement = document.querySelector('.milkdown') as HTMLElement
  const milkdownRoot = document.querySelector('#milkdown') as HTMLElement

  console.log('找到的DOM元素:', {
    html: !!html,
    milkdownElement: !!milkdownElement,
    milkdownRoot: !!milkdownRoot,
  })

  // 分离应用变量和Milkdown变量，减少遍历次数
  const appVariables: Record<string, string> = {}
  const milkdownVariables: Record<string, string> = {}

  Object.entries(themeVariables.value).forEach(([key, value]) => {
    if (value) {
      if (key.startsWith('--crepe-')) {
        milkdownVariables[key] = value
      } else {
        appVariables[key] = value
      }
    }
  })

  console.log('分离的变量:', {
    appVariables: Object.keys(appVariables).length,
    milkdownVariables: Object.keys(milkdownVariables).length,
  })

  // 批量应用应用变量到根元素
  console.log('应用应用变量到根元素:', Object.keys(appVariables))
  Object.entries(appVariables).forEach(([key, value]) => {
    html.style.setProperty(key, value)
  })

  // 批量应用Milkdown变量到相关元素
  if (milkdownElement) {
    console.log('应用Milkdown变量到milkdown元素:', Object.keys(milkdownVariables))
    Object.entries(milkdownVariables).forEach(([key, value]) => {
      milkdownElement.style.setProperty(key, value)
    })
  }

  if (milkdownRoot) {
    console.log('应用Milkdown变量到milkdown根元素:', Object.keys(milkdownVariables))
    Object.entries(milkdownVariables).forEach(([key, value]) => {
      milkdownRoot.style.setProperty(key, value)
    })
  }

  // 只在必要时处理所有Milkdown子元素（性能优化）
  if (Object.keys(milkdownVariables).length > 0) {
    const milkdownElements = document.querySelectorAll('.milkdown *, #milkdown *')
    milkdownElements.forEach((element) => {
      if (element instanceof HTMLElement) {
        Object.entries(milkdownVariables).forEach(([key, value]) => {
          element.style.setProperty(key, value)
        })
      }
    })
  }
}

// 保存主题
function handleSave() {
  // 获取自定义主题列表
  const customThemesList = getCustomThemes()

  // 查找临时主题
  const tempTheme = customThemesList.find(theme => theme.name.startsWith('temp-theme-'))

  if (tempTheme) {
    // 更新临时主题的变量
    tempTheme.variables = { ...themeVariables.value }
    tempTheme.color = themeVariables.value['--primary-color'] || '#4a90e2'
    tempTheme.label = themeLabel.value || '自定义主题'
    tempTheme.description = themeDescription.value || '自定义创建的主题'

    // 更新localStorage中的临时主题
    const updatedList = customThemesList.map(theme =>
      theme.name === tempTheme.name ? tempTheme : theme,
    )
    localStorage.setItem('custom-themes', JSON.stringify(updatedList))

    // 通知主窗口主题已更新
    if (window.electronAPI) {
      window.electronAPI.saveCustomTheme(tempTheme)
    }

    // 显示保存成功提示
    autolog.log('主题保存成功', 'success')

    // 保存成功后关闭窗口
    setTimeout(() => {
      if (window.electronAPI) {
        window.electronAPI.themeEditorWindowControl('close')
      }
    }, 300)
  } else {
    // 如果没有临时主题，创建新的自定义主题
    const themeName = `custom-theme-${Date.now()}`

    const customTheme = {
      name: themeName,
      label: themeLabel.value || '自定义主题',
      color: themeVariables.value['--primary-color'] || '#4a90e2',
      description: themeDescription.value || '自定义创建的主题',
      variables: themeVariables.value,
    }

    // 保存主题
    if (window.electronAPI) {
      window.electronAPI.saveCustomTheme(customTheme)
    }

    // 显示保存成功提示
    autolog.log('主题保存成功', 'success')

    // 保存成功后关闭窗口
    setTimeout(() => {
      if (window.electronAPI) {
        window.electronAPI.themeEditorWindowControl('close')
      }
    }, 1000) // 延迟1秒让用户看到保存成功的反馈
  }
}

// 缓存上一次的变量值，用于比较变化
let lastVariables: Record<string, string> = {}

// 防抖函数
function debounce<T extends (...args: any[]) => any>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  return function (this: any, ...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      func.apply(this, args)
    }, delay)
  }
}

// 防抖版本的更新预览函数
const debouncedUpdatePreview = debounce(() => {
  updatePreview()
}, 50)

// 监听变量变化，实时更新预览
function watchThemeVariables() {
  // 使用 watch 监听 themeVariables 的变化
  watch(themeVariables, (newVariables: Record<string, string>) => {
    // 检查是否有实际变化
    const hasChanges = Object.keys(newVariables).some((key) => {
      return newVariables[key] !== lastVariables[key]
    })

    // 如果没有变化，跳过更新
    if (!hasChanges) {
      return
    }

    // 使用防抖更新
    debouncedUpdatePreview()

    // 更新缓存
    lastVariables = { ...newVariables }
  }, { deep: true })
}

// 组件挂载时初始化
onMounted(() => {
  console.log('主题编辑器组件挂载...')

  // 立即初始化基本变量
  initThemeVariables()
  watchThemeVariables()

  // 初始化缓存
  lastVariables = { ...themeVariables.value }

  // 延迟获取更完整的变量，确保所有元素都已加载
  setTimeout(() => {
    console.log('延迟获取变量...')

    // 检查是否有临时主题
    const customThemesList = getCustomThemes()
    const tempTheme = customThemesList.find(theme => theme.name.startsWith('temp-theme-'))

    if (tempTheme) {
      console.log('发现临时主题，使用临时主题变量:', tempTheme.name)
      themeVariables.value = { ...tempTheme.variables }
      hasTempTheme.value = true
      console.log('临时主题变量已设置:', tempTheme.variables)
    } else {
      console.log('未发现临时主题，重新获取当前主题变量')

      // 重新获取变量，确保获取到最新的值
      const html = document.documentElement
      const computedStyle = getComputedStyle(html)

      // 重新获取所有变量
      const allVariables = [
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

      const updatedVariables: Record<string, string> = {}
      allVariables.forEach((varName) => {
        const value = computedStyle.getPropertyValue(varName).trim()
        if (value) {
          updatedVariables[varName] = value
        }
      })

      // 更新变量，保留已有的变量
      themeVariables.value = { ...themeVariables.value, ...updatedVariables }
      console.log('延迟更新变量:', updatedVariables)
    }

    // 应用预览
    console.log('准备应用预览，当前变量:', themeVariables.value)
    updatePreview()
  }, 100)
})

// 组件卸载时处理
onUnmounted(() => {
  console.log('主题编辑器组件卸载...')

  // 如果编辑的是临时主题但没有保存，则恢复原始主题
  if (hasTempTheme.value) {
    console.log('编辑临时主题但未保存，恢复原始主题')
    // 这里可以添加恢复原始主题的逻辑
  }
})

// 主题预设
const themePresets = {
  'default-light': {
    name: '默认浅色',
    variables: {
      '--primary-color': '#4a90e2',
      '--secondary-color': '#6c757d',
      '--background-color': '#ffffff',
      '--background-color-1': '#f8f9fa',
      '--background-color-2': '#e9ecef',
      '--background-color-3': '#dee2e6',
      '--text-color': '#212529',
      '--text-color-1': '#495057',
      '--text-color-2': '#6c757d',
      '--text-color-3': '#adb5bd',
      '--placeholder-color': '#6c757d',
      '--border-color': '#dee2e6',
      '--border-color-1': '#e9ecef',
      '--border-color-2': '#f8f9fa',
      '--hover-color': '#4a90e2',
      '--hover-background-color': '#e3f2fd',
      '--active-color': '#1976d2',
      '--active-line-color': '#e3f2fd',
      '--selected-color': '#4a90e2',
      '--selected-background-color': '#e3f2fd',
      '--primary-color-transparent': 'rgba(74, 144, 226, 0.1)',
      '--crepe-color-background': '#ffffff',
      '--crepe-color-on-background': '#212529',
      '--crepe-color-surface': '#f8f9fa',
      '--crepe-color-surface-low': '#ffffff',
      '--crepe-color-on-surface': '#212529',
      '--crepe-color-on-surface-variant': '#495057',
      '--crepe-color-outline': '#dee2e6',
      '--crepe-color-primary': '#4a90e2',
      '--crepe-color-secondary': '#6c757d',
      '--crepe-color-on-secondary': '#ffffff',
      '--crepe-color-inverse': '#212529',
      '--crepe-color-on-inverse': '#ffffff',
      '--crepe-color-inline-code': '#f8f9fa',
      '--crepe-color-error': '#dc3545',
      '--crepe-color-hover': '#e3f2fd',
      '--crepe-color-selected': '#e3f2fd',
      '--crepe-color-inline-area': '#f8f9fa',
    },
  },
  'default-dark': {
    name: '默认深色',
    variables: {
      '--primary-color': '#64b5f6',
      '--secondary-color': '#90a4ae',
      '--background-color': '#121212',
      '--background-color-1': '#1e1e1e',
      '--background-color-2': '#2d2d2d',
      '--background-color-3': '#424242',
      '--text-color': '#ffffff',
      '--text-color-1': '#e0e0e0',
      '--text-color-2': '#bdbdbd',
      '--text-color-3': '#9e9e9e',
      '--placeholder-color': '#9e9e9e',
      '--border-color': '#424242',
      '--border-color-1': '#616161',
      '--border-color-2': '#757575',
      '--hover-color': '#64b5f6',
      '--hover-background-color': '#1e3a5f',
      '--active-color': '#42a5f5',
      '--active-line-color': '#1e3a5f',
      '--selected-color': '#64b5f6',
      '--selected-background-color': '#1e3a5f',
      '--primary-color-transparent': 'rgba(100, 181, 246, 0.1)',
      '--crepe-color-background': '#121212',
      '--crepe-color-on-background': '#ffffff',
      '--crepe-color-surface': '#1e1e1e',
      '--crepe-color-surface-low': '#2d2d2d',
      '--crepe-color-on-surface': '#ffffff',
      '--crepe-color-on-surface-variant': '#e0e0e0',
      '--crepe-color-outline': '#424242',
      '--crepe-color-primary': '#64b5f6',
      '--crepe-color-secondary': '#90a4ae',
      '--crepe-color-on-secondary': '#000000',
      '--crepe-color-inverse': '#ffffff',
      '--crepe-color-on-inverse': '#000000',
      '--crepe-color-inline-code': '#2d2d2d',
      '--crepe-color-error': '#f44336',
      '--crepe-color-hover': '#1e3a5f',
      '--crepe-color-selected': '#1e3a5f',
      '--crepe-color-inline-area': '#2d2d2d',
    },
  },
  'github-light': {
    name: 'GitHub 浅色',
    variables: {
      '--primary-color': '#24292e',
      '--secondary-color': '#586069',
      '--background-color': '#ffffff',
      '--background-color-1': '#f6f8fa',
      '--background-color-2': '#f1f3f4',
      '--background-color-3': '#e1e4e8',
      '--text-color': '#24292e',
      '--text-color-1': '#586069',
      '--text-color-2': '#6a737d',
      '--text-color-3': '#959da5',
      '--placeholder-color': '#959da5',
      '--border-color': '#e1e4e8',
      '--border-color-1': '#f1f3f4',
      '--border-color-2': '#f6f8fa',
      '--hover-color': '#0366d6',
      '--hover-background-color': '#f6f8fa',
      '--active-color': '#0366d6',
      '--active-line-color': '#f6f8fa',
      '--selected-color': '#0366d6',
      '--selected-background-color': '#f6f8fa',
      '--primary-color-transparent': 'rgba(3, 102, 214, 0.1)',
      '--crepe-color-background': '#ffffff',
      '--crepe-color-on-background': '#24292e',
      '--crepe-color-surface': '#f6f8fa',
      '--crepe-color-surface-low': '#ffffff',
      '--crepe-color-on-surface': '#24292e',
      '--crepe-color-on-surface-variant': '#586069',
      '--crepe-color-outline': '#e1e4e8',
      '--crepe-color-primary': '#0366d6',
      '--crepe-color-secondary': '#586069',
      '--crepe-color-on-secondary': '#ffffff',
      '--crepe-color-inverse': '#24292e',
      '--crepe-color-on-inverse': '#ffffff',
      '--crepe-color-inline-code': '#f6f8fa',
      '--crepe-color-error': '#d73a49',
      '--crepe-color-hover': '#f6f8fa',
      '--crepe-color-selected': '#f6f8fa',
      '--crepe-color-inline-area': '#f6f8fa',
    },
  },
  'github-dark': {
    name: 'GitHub 深色',
    variables: {
      '--primary-color': '#f0f6fc',
      '--secondary-color': '#8b949e',
      '--background-color': '#0d1117',
      '--background-color-1': '#161b22',
      '--background-color-2': '#21262d',
      '--background-color-3': '#30363d',
      '--text-color': '#f0f6fc',
      '--text-color-1': '#c9d1d9',
      '--text-color-2': '#8b949e',
      '--text-color-3': '#6e7681',
      '--placeholder-color': '#6e7681',
      '--border-color': '#30363d',
      '--border-color-1': '#21262d',
      '--border-color-2': '#161b22',
      '--hover-color': '#58a6ff',
      '--hover-background-color': '#21262d',
      '--active-color': '#58a6ff',
      '--active-line-color': '#21262d',
      '--selected-color': '#58a6ff',
      '--selected-background-color': '#21262d',
      '--primary-color-transparent': 'rgba(88, 166, 255, 0.1)',
      '--crepe-color-background': '#0d1117',
      '--crepe-color-on-background': '#f0f6fc',
      '--crepe-color-surface': '#161b22',
      '--crepe-color-surface-low': '#21262d',
      '--crepe-color-on-surface': '#f0f6fc',
      '--crepe-color-on-surface-variant': '#c9d1d9',
      '--crepe-color-outline': '#30363d',
      '--crepe-color-primary': '#58a6ff',
      '--crepe-color-secondary': '#8b949e',
      '--crepe-color-on-secondary': '#0d1117',
      '--crepe-color-inverse': '#f0f6fc',
      '--crepe-color-on-inverse': '#0d1117',
      '--crepe-color-inline-code': '#21262d',
      '--crepe-color-error': '#f85149',
      '--crepe-color-hover': '#21262d',
      '--crepe-color-selected': '#21262d',
      '--crepe-color-inline-area': '#21262d',
    },
  },
}

// 应用主题预设
function applyThemePreset(presetKey: string) {
  const preset = themePresets[presetKey as keyof typeof themePresets]
  if (preset) {
    themeVariables.value = { ...preset.variables }
    console.log('应用主题预设:', preset.name)
  }
}

// 重置到当前主题
function resetToCurrentTheme() {
  initThemeVariables()
  console.log('重置到当前主题')
}

// 示例Markdown内容
const demoContent = `
<br />

# MilkUp

<br />

> 这是一段测试文字

<br />

***

<br />

* item1
* item2
* item3

代码：

\`\`\`JavaScript
const text = "Hello Word!"
console.log(text)
\`\`\`

<br />

| 1  | 2  | 3  |
| :- | :- | :- |
| 1  | 2  | 3  |
| 1  | 2  | 3  |


`
</script>

<template>
  <div class="theme-editor">
    <!-- 标题栏 -->
    <div class="TitleBarBox">
      <div class="title">
        主题编辑器
      </div>
      <div class="window-controls">
        <span class="iconfont icon-close" @click="handleClose"></span>
      </div>
    </div>

    <div class="editor-container">
      <!-- 左侧配置面板 -->
      <div class="config-panel">
        <div class="panel-header">
          <h2>主题配置</h2>
        </div>

        <div class="panel-content">
          <!-- 错误消息 -->
          <div v-if="errorMessage" class="error-message">
            {{ errorMessage }}
          </div>

          <!-- 主题信息配置 -->
          <div class="config-section">
            <div class="section-header">
              <h3>主题信息</h3>
              <div class="section-description">
                设置主题的名称和描述
              </div>
            </div>
            <div class="form-section">
              <div class="variable-item">
                <label>主题名称</label>
                <input
                  v-model="themeLabel" type="text" class="text-input" placeholder="输入主题名称"
                  @change="updatePreview"
                />
              </div>
              <div class="variable-item">
                <label>主题描述</label>
                <textarea
                  v-model="themeDescription" class="text-area" placeholder="输入主题描述" rows="3"
                  @change="updatePreview"
                ></textarea>
              </div>
            </div>
          </div>

          <!-- 主题预设 -->
          <div class="config-section">
            <div class="section-header">
              <h3>主题预设</h3>
              <div class="section-description">
                快速应用预设主题
              </div>
            </div>
            <div class="form-section">
              <div class="preset-buttons">
                <button
                  v-for="(preset, key) in themePresets" :key="key" class="preset-btn"
                  @click="applyThemePreset(key)"
                >
                  {{ preset.name }}
                </button>
              </div>
            </div>
          </div>

          <!-- 应用颜色配置 -->
          <div class="config-section">
            <div class="section-header">
              <h3>应用颜色配置</h3>
              <div class="section-description">
                配置应用界面的颜色主题
              </div>
            </div>

            <!-- 基础颜色配置 -->
            <div class="form-section">
              <h4>基础颜色</h4>
              <div class="variables-list">
                <div class="variable-item">
                  <label>主色调</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--primary-color']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--primary-color']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>次要色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--secondary-color']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--secondary-color']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>背景色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--background-color']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--background-color']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>背景色1</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--background-color-1']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--background-color-1']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- 文字颜色配置 -->
            <div class="form-section">
              <h4>文字颜色</h4>
              <div class="variables-list">
                <div class="variable-item">
                  <label>主要文字</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--text-color']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--text-color']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>次要文字</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--text-color-1']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--text-color-1']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>第三级文字</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--text-color-2']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--text-color-2']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>占位符文字</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--placeholder-color']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--placeholder-color']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- 边框颜色配置 -->
            <div class="form-section">
              <h4>边框颜色</h4>
              <div class="variables-list">
                <div class="variable-item">
                  <label>主要边框</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--border-color']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--border-color']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>次要边框</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--border-color-1']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--border-color-1']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>第三级边框</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--border-color-2']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--border-color-2']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- 交互颜色配置 -->
            <div class="form-section">
              <h4>交互颜色</h4>
              <div class="variables-list">
                <div class="variable-item">
                  <label>悬停颜色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--hover-color']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--hover-color']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>悬停背景</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--hover-background-color']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--hover-background-color']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>激活颜色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--active-color']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--active-color']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>选中颜色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--selected-color']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--selected-color']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 编辑器颜色配置 -->
          <div class="config-section">
            <div class="section-header">
              <h3>编辑器颜色配置</h3>
              <div class="section-description">
                配置Markdown编辑器的颜色主题
              </div>
            </div>

            <div class="form-section">
              <h4>编辑器颜色</h4>
              <div class="variables-list">
                <div class="variable-item">
                  <label>编辑器背景</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-background']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-background']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器主色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-primary']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-primary']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器文字</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-on-background']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-on-background']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器表面色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-surface']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-surface']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器轮廓色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-outline']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-outline']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器表面色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-surface-low']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-surface-low']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器表面文字</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-on-surface']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-on-surface']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器表面变体文字</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-on-surface-variant']" type="color"
                      class="color-picker" @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-on-surface-variant']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器次要色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-secondary']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-secondary']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器次要色文字</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-on-secondary']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-on-secondary']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器内联代码色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-inline-code']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-inline-code']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器错误色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-error']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-error']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器悬停色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-hover']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-hover']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器选中色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-selected']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-selected']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
                <div class="variable-item">
                  <label>编辑器内联区域色</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables['--crepe-color-inline-area']" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables['--crepe-color-inline-area']" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="panel-footer">
          <div class="button-group">
            <button class="btn-reset" @click="resetToCurrentTheme">
              重置
            </button>
            <button class="btn-save" @click="handleSave">
              保存主题
            </button>
          </div>
        </div>
      </div>

      <!-- 右侧预览面板 -->
      <div class="preview-panel">
        <div class="panel-header">
          <h2>实时预览</h2>
        </div>
        <div class="preview-content">
          <MilkdownEditor :model-value="demoContent" class="preview-editor" />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.theme-editor {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--background-color);
  color: var(--text-color);
}

// 保存成功提示样式
.save-success-toast {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  background: var(--primary-color);
  color: white;
  padding: 12px 20px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateX(100%);
  opacity: 0;
  transition: all 0.3s ease;

  &.show {
    transform: translateX(0);
    opacity: 1;
  }

  .toast-content {
    display: flex;
    align-items: center;
    gap: 8px;

    .toast-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    span {
      font-size: 14px;
      font-weight: 500;
    }
  }
}

.TitleBarBox {
  -webkit-app-region: drag;
  /* ✅ 允许拖动窗口 */
  height: 32px;
  background: var(--background-color-1);
  color: var(--text-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 0 12px;
  user-select: none;

  .window-controls {
    display: flex;
    -webkit-app-region: no-drag;

    /* ✅ 控制按钮不能拖动 */
    span {
      cursor: pointer;
      font-size: 16px;
      color: var(--text-color-1);
      padding: 8px;

      &:hover {
        background: var(--hover-color);
      }

      &.icon-close:hover {
        background: #ff5f56;
        color: white;
      }
    }
  }
}

.editor-container {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.config-panel {
  width: 350px;
  background: var(--background-color-1);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;

  .panel-header {
    padding: 16px;
    border-bottom: 1px solid var(--border-color);

    h2 {
      margin: 0;
      font-size: 16px;
      color: var(--text-color);
    }
  }

  .panel-content {
    flex: 1;
    padding: 16px;
    overflow-y: auto;

    .error-message {
      background: #fee;
      color: #c33;
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 16px;
      border: 1px solid #fcc;
    }

    .config-section {
      margin-bottom: 32px;
      border: 1px solid var(--border-color-1);
      border-radius: 8px;
      overflow: hidden;
      background: var(--background-color);

      .section-header {
        padding: 16px;
        background: var(--background-color-2);
        border-bottom: 1px solid var(--border-color);

        h3 {
          margin: 0 0 4px 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-color);
        }

        .section-description {
          font-size: 12px;
          color: var(--text-color-2);
          line-height: 1.4;
        }
      }
    }

    .form-section {
      margin-bottom: 24px;
      padding: 16px;

      h4 {
        margin: 0 0 12px 0;
        font-size: 14px;
        color: var(--text-color);
        border-bottom: 1px solid var(--border-color-1);
        padding-bottom: 6px;
        font-weight: 500;
      }

      .form-group {
        margin-bottom: 12px;

        label {
          display: block;
          margin-bottom: 4px;
          font-size: 12px;
          color: var(--text-color);
          font-weight: 500;
        }

        input,
        select,
        textarea {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid var(--border-color);
          border-radius: 4px;
          background: var(--background-color);
          color: var(--text-color);
          font-size: 12px;

          &:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 2px var(--primary-color-transparent);
          }

          &:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
        }

        textarea {
          resize: vertical;
          font-family: inherit;
        }
      }

      .variables-list {
        display: flex;
        flex-direction: column;
        gap: 8px;

        .variable-item {
          label {
            display: block;
            margin-bottom: 4px;
            font-size: 11px;
            color: var(--text-color);
          }

          .color-input-group {
            display: flex;
            gap: 6px;

            .color-picker {
              width: 40px;
              height: 28px;
              border: 1px solid var(--border-color);
              border-radius: 4px;
              cursor: pointer;
              background: none;

              &::-webkit-color-swatch-wrapper {
                padding: 1px;
              }

              &::-webkit-color-swatch {
                border: none;
                border-radius: 2px;
              }

              &:disabled {
                cursor: not-allowed;
              }
            }

            .color-text {
              flex: 1;
              font-size: 11px;
            }
          }
        }

        // 文本输入字段样式
        .text-input {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid var(--border-color);
          border-radius: 4px;
          background: var(--background-color);
          color: var(--text-color);
          font-size: 12px;

          &:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 2px var(--primary-color-transparent);
          }
        }

        .text-area {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid var(--border-color);
          border-radius: 4px;
          background: var(--background-color);
          color: var(--text-color);
          font-size: 12px;
          resize: vertical;
          font-family: inherit;
          min-height: 60px;

          &:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 2px var(--primary-color-transparent);
          }
        }
      }

      .preset-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;

        .preset-btn {
          padding: 8px 12px;
          background: var(--background-color-2);
          color: var(--text-color);
          border: 1px solid var(--border-color);
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          transition: all 0.2s ease;

          &:hover {
            background: var(--hover-background-color);
            border-color: var(--hover-color);
          }

          &:active {
            background: var(--active-color);
            color: white;
          }
        }
      }
    }
  }

  .panel-footer {
    padding: 16px;
    border-top: 1px solid var(--border-color);

    .button-group {
      display: flex;
      gap: 8px;

      .btn-reset {
        flex: 1;
        padding: 10px;
        background: var(--background-color-2);
        color: var(--text-color);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;

        &:hover {
          background: var(--hover-background-color);
          border-color: var(--hover-color);
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .btn-save {
        flex: 1;
        padding: 10px;
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;

        &:hover {
          opacity: 0.9;
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .btn-export {
        flex: 1;
        padding: 10px;
        background: #4a90e2;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;

        &:hover {
          opacity: 0.9;
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }
    }
  }
}

.preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;

  .panel-header {
    padding: 16px;
    border-bottom: 1px solid var(--border-color);
    background: var(--background-color-1);

    h2 {
      margin: 0;
      font-size: 16px;
      color: var(--text-color);
    }
  }

  .preview-content {
    flex: 1;
    padding: 16px;
    background: var(--background-color);
    overflow: auto;

    .preview-editor {
      width: 100%;
      height: 100%;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      overflow: hidden;
    }
  }
}
</style>

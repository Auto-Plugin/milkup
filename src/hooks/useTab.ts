import { computed, ref } from 'vue'
import { processImagePaths, setCurrentMarkdownFilePath } from '@/plugins/imagePathPlugin'
import emitter from '@/renderer/events'

export interface Tab {
  id: string
  name: string
  filePath: string | null
  content: string
  originalContent: string
  isModified: boolean
  scrollRatio?: number
}

const tabs = ref<Tab[]>([])
const activeTabId = ref<string | null>(null)

// 初始化时创建一个默认的未命名文档
const defaultTab: Tab = {
  id: generateId(),
  name: 'Untitled',
  filePath: null,
  content: '',
  originalContent: '',
  isModified: false,
  scrollRatio: 0,
}
tabs.value.push(defaultTab)
activeTabId.value = defaultTab.id

// 生成唯一ID
function generateId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// 从文件路径获取文件名
function getFileName(filePath: string | null): string {
  if (!filePath)
    return 'Untitled'
  const parts = filePath.split(/[\\/]/)
  return parts.at(-1) ?? 'Untitled'
}

// 检查文件是否已打开
function isFileAlreadyOpen(filePath: string): Tab | null {
  return tabs.value.find(tab => tab.filePath === filePath) || null
}

// 添加tab
function add(tab: Tab) {
  // 检查是否已存在相同文件路径的tab
  if (tab.filePath) {
    const existingTab = isFileAlreadyOpen(tab.filePath)
    if (existingTab) {
      // 如果文件已打开，直接切换到该tab
      setActive(existingTab.id)
      return existingTab
    }
  }

  tabs.value.push(tab)
  setActive(tab.id)
  return tab
}

// 关闭tab
function close(id: string) {
  const tabIndex = tabs.value.findIndex(tab => tab.id === id)
  if (tabIndex === -1)
    return

  const isActiveTab = activeTabId.value === id
  tabs.value.splice(tabIndex, 1)

  // 如果关闭的是当前活跃tab，需要切换到其他tab
  if (isActiveTab) {
    if (tabs.value.length > 0) {
      // 优先切换到下一个tab，如果没有则切换到上一个
      const nextIndex = tabIndex < tabs.value.length ? tabIndex : tabIndex - 1
      setActive(tabs.value[nextIndex].id)
    } else {
      activeTabId.value = null
    }
  }
}

// 设置活跃tab
function setActive(id: string) {
  if (!tabs.value.find(tab => tab.id === id))
    return
  activeTabId.value = id
}

// 获取当前tab
function getCurrentTab() {
  return tabs.value.find(tab => tab.id === activeTabId.value) || null
}

// 更新当前tab的内容
function updateCurrentTabContent(content: string, isModified?: boolean) {
  const currentTab = getCurrentTab()
  if (currentTab) {
    currentTab.content = content
    if (isModified !== undefined) {
      currentTab.isModified = isModified
    } else {
      currentTab.isModified = content !== currentTab.originalContent
    }
  }
}

// 更新当前tab的滚动位置
function updateCurrentTabScrollRatio(ratio: number) {
  const currentTab = getCurrentTab()
  if (currentTab) {
    currentTab.scrollRatio = ratio
  }
}

// 保存当前tab
async function saveCurrentTab(): Promise<boolean> {
  const currentTab = getCurrentTab()
  if (!currentTab)
    return false

  try {
    const saved = await window.electronAPI.saveFile(currentTab.filePath, currentTab.content)
    if (saved) {
      currentTab.filePath = saved
      currentTab.originalContent = currentTab.content
      currentTab.isModified = false
      return true
    }
  } catch (error) {
    console.error('保存文件失败:', error)
  }
  return false
}

// 从文件创建新tab
async function createTabFromFile(filePath: string, content: string): Promise<Tab> {
  // 处理图片路径
  const processedContent = await processImagePaths(content, filePath)

  const tab: Tab = {
    id: generateId(),
    name: getFileName(filePath),
    filePath,
    content: processedContent,
    originalContent: content,
    isModified: false,
    scrollRatio: 0,
  }

  return add(tab)
}

// 创建新文件tab
function createNewTab(): Tab {
  const tab: Tab = {
    id: generateId(),
    name: 'Untitled',
    filePath: null,
    content: '',
    originalContent: '',
    isModified: false,
    scrollRatio: 0,
  }

  return add(tab)
}

// 切换tab并同步内容
async function switchToTab(id: string) {
  const targetTab = tabs.value.find(tab => tab.id === id)
  if (!targetTab)
    return

  // 设置当前tab为活跃状态
  setActive(id)

  // 设置当前文件路径用于图片路径解析
  if (targetTab.filePath) {
    setCurrentMarkdownFilePath(targetTab.filePath)
  } else {
    setCurrentMarkdownFilePath(null)
  }

  // 触发内容更新事件
  emitter.emit('tab:switch', targetTab)
}

// 计算属性
const hasUnsavedTabs = computed(() => {
  return tabs.value.some(tab => tab.isModified)
})

const currentTab = computed(() => getCurrentTab())

function useTab() {
  return {
    // 状态
    tabs,
    activeTabId,
    currentTab,
    hasUnsavedTabs,

    // 基础操作
    add,
    close,
    setActive,
    getCurrentTab,

    // 高级操作
    updateCurrentTabContent,
    updateCurrentTabScrollRatio,
    saveCurrentTab,
    createTabFromFile,
    createNewTab,
    switchToTab,

    // 工具函数
    generateId,
    getFileName,
    isFileAlreadyOpen,
  }
}

export default useTab

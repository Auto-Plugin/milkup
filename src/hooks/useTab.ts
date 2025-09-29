import type { Ref } from 'vue'
import type { Tab } from '@/types/tab'
import { computed, nextTick, ref, watch } from 'vue'
import { processImagePaths, setCurrentMarkdownFilePath } from '@/plugins/imagePathPlugin'
import emitter from '@/renderer/events'
import { randomUUID } from '@/utils/tool'
import { isShowOutline } from './useOutline'

const tabs = ref<Tab[]>([])
const activeTabId = ref<string | null>(null)

const defaultName = 'Untitled'

const defaultTabUUid = randomUUID()
// 初始化时创建一个默认的未命名文档
const defaultTab: Tab = {
  id: defaultTabUUid,
  name: defaultName,
  filePath: null,
  content: '',
  originalContent: '',
  isModified: false,
  scrollRatio: 0,
}
tabs.value.push(defaultTab)
activeTabId.value = defaultTab.id
window.electronAPI?.onOpenFileAtLaunch((_payload) => {
  if (tabs.value.length === 1 && tabs.value[0].id === defaultTabUUid && !tabs.value[0].isModified) {
    tabs.value = []
  }
})

// 从文件路径获取文件名
function getFileName(filePath: string | null): string {
  if (!filePath)
    return defaultName
  const parts = filePath.split(/[\\/]/)
  return parts.at(-1) ?? defaultName
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
      switchToTab(tabs.value[nextIndex].id)
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

// 更新当前tab的文件信息（用于文件覆盖场景）
function updateCurrentTabFile(filePath: string, content: string, name?: string) {
  const currentTab = getCurrentTab()
  if (currentTab) {
    currentTab.filePath = filePath
    currentTab.content = content
    currentTab.originalContent = content
    currentTab.isModified = false
    if (name) {
      currentTab.name = name
    } else {
      currentTab.name = getFileName(filePath)
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
      currentTab.name = getFileName(saved) // 更新标签名称
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
    id: randomUUID(),
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
    id: randomUUID(),
    name: defaultName,
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

// 获取所有未保存的标签页
function getUnsavedTabs() {
  return tabs.value.filter(tab => tab.isModified)
}

// 确保激活的tab在可视区域内
function ensureActiveTabVisible(containerRef: Ref<HTMLElement | null>) {
  const container = containerRef.value
  if (!container || !activeTabId.value)
    return

  // 查找激活的tab元素
  const activeTabElement = container.querySelector(`[data-tab-id="${activeTabId.value}"]`) as HTMLElement
  if (!activeTabElement)
    return

  const containerRect = container.getBoundingClientRect()
  const tabRect = activeTabElement.getBoundingClientRect()

  const paddingOffset = 12 // 额外的内边距

  // 考虑tabbar的偏移量（当大纲显示时，tabbar向右偏移25%）
  // 由于TabBar使用margin-left: 25%，所以偏移量是相对于父容器的25%
  const offsetLeft = isShowOutline.value ? containerRect.width * 0.25 : 0

  // 调试信息
  console.log('ensureActiveTabVisible debug:', {
    isShowOutline: isShowOutline.value,
    containerWidth: containerRect.width,
    offsetLeft,
    tabRect: { left: tabRect.left, right: tabRect.right },
    containerRect: { left: containerRect.left, right: containerRect.right },
    paddingOffset,
    leftBoundary: containerRect.left + paddingOffset + offsetLeft,
    rightBoundary: containerRect.right - paddingOffset,
  })

  // 检查tab是否完全在可视区域内（包括阴影和偏移）
  const isFullyVisible
    = tabRect.left >= (containerRect.left + paddingOffset + offsetLeft)
      && tabRect.right <= (containerRect.right - paddingOffset)

  console.log('isFullyVisible:', isFullyVisible)

  if (!isFullyVisible) {
    // 计算tab相对于容器的位置
    const tabOffsetLeft = activeTabElement.offsetLeft

    // 计算可视区域的边界（考虑偏移量）
    // 当有大纲显示时，TabBar有margin-left: 25%，所以可视区域从25%开始
    const visibleLeft = paddingOffset
    const visibleRight = container.clientWidth - paddingOffset

    let scrollLeft = 0

    // 如果tab在左侧被遮挡
    if (tabRect.left < containerRect.left + paddingOffset + offsetLeft) {
      // 将tab滚动到可视区域的左侧
      // 当有大纲显示时，需要考虑TabBar的margin-left偏移
      scrollLeft = tabOffsetLeft - visibleLeft
      // console.log('Left adjustment:', { tabOffsetLeft, visibleLeft, scrollLeft })
    } else if (tabRect.right > containerRect.right - paddingOffset) {
      // 如果tab在右侧被遮挡
      // 将tab滚动到可视区域的右侧
      scrollLeft = tabOffsetLeft - visibleRight + activeTabElement.offsetWidth
      console.log('Right adjustment:', { tabOffsetLeft, visibleRight, tabWidth: activeTabElement.offsetWidth, scrollLeft })
    }

    // 确保滚动位置不会超出边界
    // 当有偏移时，最小滚动位置需要考虑偏移量
    const minScrollLeft = isShowOutline.value ? -offsetLeft : 0
    const maxScrollLeft = container.scrollWidth - container.clientWidth
    scrollLeft = Math.max(minScrollLeft, Math.min(scrollLeft, maxScrollLeft))

    console.log('Final scroll position:', { scrollLeft, minScrollLeft, maxScrollLeft })

    container.scrollTo({
      left: scrollLeft,
      behavior: 'smooth',
    })
  }
}

// 横向滚动
function handleWheelScroll(event: WheelEvent, containerRef: Ref<HTMLElement | null>) {
  event.preventDefault()

  // 获取滚轮滚动距离
  const scrollAmount = event.deltaY

  const container = containerRef.value
  if (!container)
    return

  container.scrollBy({
    left: scrollAmount,
    behavior: 'smooth',
  })
}

// 带确认的关闭tab
function closeWithConfirm(id: string) {
  const tabToClose = tabs.value.find(tab => tab.id === id)
  if (!tabToClose)
    return

  // 检查是否是最后一个tab
  const isLastTab = tabs.value.length === 1

  // 检查是否有未保存的内容
  if (tabToClose.isModified) {
    // 触发自定义确认对话框，传递tab信息和是否是最后一个tab
    emitter.emit('tab:close-confirm', {
      tabId: id,
      tabName: tabToClose.name,
      isLastTab,
    })
    return
  }

  // 如果没有未保存内容
  if (isLastTab) {
    // 如果是最后一个tab，直接关闭应用
    window.electronAPI.closeDiscard()
  } else {
    // 否则直接关闭tab
    close(id)
  }
}

// 拖动排序功能
function reorderTabs(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex)
    return

  // 移动tab到新位置
  const [movedTab] = tabs.value.splice(fromIndex, 1)
  tabs.value.splice(toIndex, 0, movedTab)
}

// 设置tab容器的滚动监听
function setupTabScrollListener(containerRef: Ref<HTMLElement | null>) {
  // 监听激活tab变化，确保其可见
  watch(activeTabId, () => {
    nextTick(() => {
      ensureActiveTabVisible(containerRef)
    })
  })
}

// 计算属性：格式化tab显示名称
const formattedTabs = computed(() => {
  return tabs.value.map(tab => ({
    ...tab,
    displayName: tab.isModified ? `*${tab.name}` : tab.name,
  }))
})

const currentTab = computed(() => getCurrentTab())

// 是否偏移
const shouldOffsetTabBar = computed(() => isShowOutline.value)

function useTab() {
  return {
    // 状态
    tabs,
    activeTabId,
    currentTab,
    formattedTabs,
    hasUnsavedTabs,
    getUnsavedTabs,
    shouldOffsetTabBar,
    add,
    close,
    setActive,
    getCurrentTab,

    // 更新
    updateCurrentTabContent,
    updateCurrentTabScrollRatio,
    saveCurrentTab,
    createTabFromFile,
    updateCurrentTabFile,
    createNewTab,
    switchToTab,

    // UI
    ensureActiveTabVisible,
    handleWheelScroll,
    closeWithConfirm,
    setupTabScrollListener,

    // 拖动
    reorderTabs,

    // 工具
    randomUUID,
    getFileName,
    isFileAlreadyOpen,
  }
}

export default useTab

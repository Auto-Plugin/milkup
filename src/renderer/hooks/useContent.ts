import { computed, ref, watch } from 'vue'
import emitter from '@/renderer/events'
import useTab from './useTab'

const contentInfo = {
  markdown: ref(''),
  originalContent: ref(''), // 打开或保存后的原始内容
  filePath: ref(''),
}
const isModified = computed(() => contentInfo.markdown.value !== contentInfo.originalContent.value)

// 延迟初始化watch监听器，避免模块加载时立即调用useTab
let isWatcherInitialized = false

function initializeWatchers() {
  if (isWatcherInitialized)
    return

  // ✅ 在第一次调用useContent时才获取useTab实例
  const { updateCurrentTabContent, currentTab } = useTab()

  // 监听内容变化，同步到当前tab
  watch(contentInfo.markdown, (newContent) => {
    updateCurrentTabContent(newContent)
  }, { deep: true })

  // 监听Tab切换，更新本地内容
  emitter.on('tab:switch', (tab: any) => {
    contentInfo.markdown.value = tab.content
    contentInfo.originalContent.value = tab.originalContent
    contentInfo.filePath.value = tab.filePath || ''
  })

  // 监听文件变动（如重新加载），更新本地内容
  emitter.on('file:Change', () => {
    if (currentTab.value) {
      contentInfo.markdown.value = currentTab.value.content
      contentInfo.originalContent.value = currentTab.value.originalContent
      contentInfo.filePath.value = currentTab.value.filePath || ''
    }
  })

  // 初始化时如果已有Tab，同步内容
  if (currentTab.value) {
    contentInfo.markdown.value = currentTab.value.content
    contentInfo.originalContent.value = currentTab.value.originalContent
    contentInfo.filePath.value = currentTab.value.filePath || ''
  }

  watch(isModified, (newValue) => {
    // 只有在有内容时才通知主进程保存状态
    // 如果 markdown 为空且 originalContent 也为空，说明是新建文档，不需要通知
    if (contentInfo.markdown.value || contentInfo.originalContent.value) {
      window.electronAPI.changeSaveStatus(!newValue) // 通知主进程保存状态, 修改后(isModified==true) isSaved 为 false
    }
  }, { immediate: true })

  isWatcherInitialized = true
}

export default () => {
  // ✅ 在第一次调用useContent时初始化watchers
  initializeWatchers()

  return {
    ...contentInfo,
    isModified,
  }
}

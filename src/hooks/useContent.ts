import { computed, ref, watch } from 'vue'
import { changeSaveStatus } from '@/renderer/services'
import useTab from './useTab'

const contentInfo = {
  markdown: ref(''),
  originalContent: ref(''), // 打开或保存后的原始内容
  filePath: ref(''),
}
const isModified = computed(() => contentInfo.markdown.value !== contentInfo.originalContent.value)

// 获取 useTab 实例
const { updateCurrentTabContent } = useTab()

// 监听内容变化，同步到当前tab
watch(contentInfo.markdown, (newContent) => {
  updateCurrentTabContent(newContent)
}, { deep: true })

watch(isModified, (newValue) => {
  // 只有在有内容时才通知主进程保存状态
  // 如果 markdown 为空且 originalContent 也为空，说明是新建文档，不需要通知
  if (contentInfo.markdown.value || contentInfo.originalContent.value) {
    changeSaveStatus(!newValue) // 通知主进程保存状态, 修改后(isModified==true) isSaved 为 false
  }
}, { immediate: true })

export default () => {
  return {
    ...contentInfo,
    isModified,
  }
}

import { computed, ref, watch } from 'vue'

const contentInfo = {
  markdown: ref(''),
  originalContent: ref(''), // 打开或保存后的原始内容
  filePath: ref(''),
}
const isModified = computed(() => contentInfo.markdown.value !== contentInfo.originalContent.value)

watch(isModified, (newValue) => {
  window.electronAPI.changeSaveStatus(!newValue) // 通知主进程保存状态, 修改后(isModified==true) isSaved 为 false
}, { immediate: true })

export default () => {
  return {
    ...contentInfo,
    isModified,
  }
}

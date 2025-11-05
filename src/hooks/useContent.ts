import { computed, getCurrentInstance, onUnmounted, ref, watch } from 'vue'
import useTab from './useTab'

const contentInfo = {
  markdown: ref(''),
  originalContent: ref(''), // 打开或保存后的原始内容
  filePath: ref(''),
}
const isModified = computed(() => contentInfo.markdown.value !== contentInfo.originalContent.value)
const currentScrollRatio = ref(0)
const isInitialized = ref(false)

// 获取 useTab 实例
const { updateCurrentTabContent, updateCurrentTabScrollRatio } = useTab()

// 监听内容变化，同步到当前tab
watch(contentInfo.markdown, (newContent) => {
  updateCurrentTabContent(newContent)
}, { deep: true })

// 监听滚动位置变化，同步到当前tab
watch(currentScrollRatio, (newRatio) => {
  updateCurrentTabScrollRatio(newRatio)
})

watch(isModified, (newValue) => {
  // 只有在有内容时才通知主进程保存状态
  // 如果 markdown 为空且 originalContent 也为空，说明是新建文档，不需要通知
  if (contentInfo.markdown.value || contentInfo.originalContent.value) {
    window.electronAPI.changeSaveStatus(!newValue) // 通知主进程保存状态, 修改后(isModified==true) isSaved 为 false
  }
}, { immediate: true })

function recordScrollRatio(wrapper: Element) {
  currentScrollRatio.value = wrapper.scrollTop / (wrapper.scrollHeight - wrapper.clientHeight)
}
// 统一的滚动处理函数，保证 add/remove 使用同一引用
function scrollHandler(e: Event) {
  const target = e.currentTarget as Element | null
  if (target)
    recordScrollRatio(target)
}

function initScrollListener() {
  if (isInitialized.value)
    return
  const milkdownWrapper = document.querySelector('.scrollView.milkdown')
  const codeMirrorWrapper = document.querySelector('.cm-scroller')
  if (milkdownWrapper) {
    milkdownWrapper.addEventListener('scroll', () => scrollHandler)
  } else if (codeMirrorWrapper) {
    codeMirrorWrapper.addEventListener('scroll', () => scrollHandler)
  }
  isInitialized.value = true
}

function removeScrollListener() {
  const milkdownWrapper = document.querySelector('.scrollView.milkdown')
  const codeMirrorWrapper = document.querySelector('.cm-scroller')
  if (milkdownWrapper) {
    milkdownWrapper.removeEventListener('scroll', () => scrollHandler)
  } else if (codeMirrorWrapper) {
    codeMirrorWrapper.removeEventListener('scroll', () => scrollHandler)
  }
  isInitialized.value = false
}

export default () => {
  if (getCurrentInstance()) {
    onUnmounted(() => {
      removeScrollListener()
    })
  }

  return {
    ...contentInfo,
    isModified,
    currentScrollRatio,
    initScrollListener,
  }
}

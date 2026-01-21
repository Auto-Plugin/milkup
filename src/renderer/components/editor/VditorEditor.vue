<script setup lang='ts'>
import Vditor from 'vditor'
import { onBeforeUnmount, onMounted } from 'vue'
import emitter from '@/renderer/events'
import useTab from '@/renderer/hooks/useTab'

const props = defineProps<{
  modelValue: string
}>()
const emit = defineEmits(['update:modelValue'])
let vditorInstance: Vditor
const { currentTab, updateCurrentTabScrollRatio } = useTab()

onMounted(() => {
  vditorInstance = new Vditor('vditor', {
    height: '100%',
    width: '100%',
    value: props.modelValue,
    placeholder: '开始写点什么吧...',
    toolbar: [],
    preview: {
      hljs: {
        style: 'github-dark',
      },
    },
    after: () => {
      // initScrollListener()
      const el = document.querySelector('.vditor-reset')
      if (el) {
        // 恢复滚动位置
        const tab = currentTab.value
        if (tab && (tab.scrollRatio || 0) > 0) {
          const scrollHeight = el.scrollHeight || 0
          const targetScrollTop = scrollHeight * (tab.scrollRatio || 0)
          el.scrollTop = targetScrollTop
        }

        // 监听滚动
        el.addEventListener('scroll', () => {
          const scrollTop = el.scrollTop
          const scrollHeight = el.scrollHeight - el.clientHeight
          const ratio = scrollHeight === 0 ? 0 : scrollTop / scrollHeight
          updateCurrentTabScrollRatio(ratio)
        })
      }
    },
    input: (value: string) => {
      emit('update:modelValue', value)
      emitOutlineUpdate()
    },
  })
  setTimeout(() => {
    emitOutlineUpdate()
  }, 1000)
})
onBeforeUnmount(() => {
  vditorInstance?.destroy()
})

function emitOutlineUpdate() {
  const headings = parseHeadings(vditorInstance.getValue())
  emitter.emit('outline:Update', headings)
}
function parseHeadings(markdown: string) {
  const lines = markdown.split('\n')
  const headings = []
  let idCounter = 0
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.*)/)
    if (match) {
      const level = match[1].length
      const text = match[2].trim()
      // text 括号等特殊字符替换为 -
      const id = `ir-${text.replace(/[^\w\u00A0-\uFFFF-]/g, '-')}_${idCounter}`
      headings.push({ level, text, id })
    }
    idCounter++
  }
  return headings
}
</script>

<template>
  <div class="VidtorBox">
    <div id="vditor"></div>
  </div>
</template>

<style lang='less' scoped>
.VidtorBox {
  width: 100%;
  height: 100%;
}
</style>

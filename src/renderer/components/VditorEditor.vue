<script setup lang='ts'>
import Vditor from 'vditor'
import { onBeforeUnmount, onMounted } from 'vue'
import useContent from '@/hooks/useContent'
import emitter from '../events'

const props = defineProps<{
  modelValue: string
}>()
const emit = defineEmits(['update:modelValue'])
let vditorInstance: Vditor
const { currentScrollRatio, initScrollListener } = useContent()

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
      initScrollListener()
      if (currentScrollRatio.value > 0) {
        const el = document.querySelector('.vditor-reset')
        if (!el)
          return
        const scrollHeight = el.scrollHeight || 0
        const targetScrollTop = scrollHeight * currentScrollRatio.value
        el.scrollTop = targetScrollTop
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

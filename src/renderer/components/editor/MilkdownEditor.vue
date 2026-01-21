<script setup lang="ts">
import type { Ctx } from '@milkdown/kit/ctx'
import { vue } from '@codemirror/lang-vue'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import { upload, uploadConfig } from '@milkdown/kit/plugin/upload'
import { outline, replaceAll } from '@milkdown/kit/utils'
import { automd } from '@milkdown/plugin-automd'
import { commonmark } from '@milkdown/preset-commonmark'
import { TextSelection } from '@milkdown/prose/state'
import { enhanceConfig } from '@renderer/enhance/crepe/config'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { uploader } from '@/plugins/customPastePlugin'
import { htmlPlugin } from '@/plugins/hybridHtmlPlugin/rawHtmlPlugin'
import { diagram } from '@/plugins/mermaidPlugin'
import emitter from '@/renderer/events'
import useTab from '@/renderer/hooks/useTab'

import { ensureTrailingNewline, fixUnclosedCodeBlock, normalizeMarkdown } from '@/renderer/utils/text'

const props = defineProps<{
  modelValue: string
  readOnly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const { currentTab } = useTab()

const lastEmittedValue = ref<string | null>(null)
const scrollViewRef = ref<HTMLElement | null>(null)

function updateScrollRatio(e: Event) {
  const target = e.target as HTMLElement
  const scrollTop = target.scrollTop
  const scrollHeight = target.scrollHeight - target.clientHeight
  const ratio = scrollHeight === 0 ? 0 : scrollTop / scrollHeight
  if (currentTab.value) {
    currentTab.value.scrollRatio = ratio
  }
}

let crepe: Crepe | null = null

onMounted(async () => {
  await nextTick()
  // 预览模式下支持自定义css文件路径解析
  // 还有在源码模式下 支持自定义字体大小调节
  // 还有 切换 源码和预览模式 以及 目录打开与关闭 搞个可以自定义的快捷键

  // crepe 有更好的用户体验👇
  crepe = new Crepe({
    root: document.querySelector('#milkdown') as HTMLElement,
    defaultValue: normalizeMarkdown(fixUnclosedCodeBlock(ensureTrailingNewline(props.modelValue.toString()))),
    featureConfigs: {
      'code-mirror': {
        extensions: [vue()],
      },
      ...enhanceConfig,
    },
  })
  crepe.on((lm) => {
    lm.markdownUpdated((Ctx, nextMarkdown) => {
      lastEmittedValue.value = nextMarkdown
      emit('update:modelValue', nextMarkdown)
      emitOutlineUpdate(Ctx)
    })
    lm.mounted(async (Ctx) => {
      emitOutlineUpdate(Ctx)
      setSelectionAndScrollToView(Ctx)
      // 监听滚动事件
      // 监听滚动事件
      // const view = Ctx.get(editorViewCtx)
      // view.dom.addEventListener('scroll', (e) => {
      //   console.log('e::: ', e)
      //   const scrollTop = view.dom.scrollTop
      //   const scrollHeight = view.dom.scrollHeight - view.dom.clientHeight
      //   const ratio = scrollHeight === 0 ? 0 : scrollTop / scrollHeight
      //   currentTab.value!.scrollRatio = ratio
      // })
    })
    lm.selectionUpdated((Ctx) => {
      // 获取光标位置
      try {
        nextTick(() => {
          const view = Ctx.get(editorViewCtx)
          const serializer = Ctx.get(serializerCtx)
          const sel = view.state.selection
          const head = sel.head ? sel.head : sel.head // 对应光标位置
          // 获取光标之前的文档部分
          const before = view.state.doc.cut(0, head)
          // 序列化为 Markdown 源码
          const markdownBefore = serializer(before)
          currentTab.value!.codeMirrorCursorOffset = markdownBefore.length
          currentTab.value!.milkdownCursorOffset = head
        })
      } catch (err) {
        console.error('获取光标位置失败:', err)
      }
    })
  })
  const editor = crepe.editor
  editor.ctx.inject(uploadConfig.key)
  editor
    .use(automd)
    .use(upload)
    .use(htmlPlugin)
    .use(diagram)
    .use(commonmark)
  props.readOnly && crepe.setReadonly(true)
  await crepe.create()

  editor.ctx.update(uploadConfig.key, prev => ({ ...prev, uploader }))

  watch(() => props.modelValue, (newValue) => {
    if (newValue === lastEmittedValue.value) {
      return
    }
    if (crepe && newValue !== undefined) {
      editor.action(replaceAll(newValue))
      // Update lastEmittedValue to avoid immediate echo if editor emits back synchronously
      lastEmittedValue.value = newValue

      // Restore scroll position
      nextTick(() => {
        if (scrollViewRef.value && currentTab.value) {
          const scrollRatio = currentTab.value.scrollRatio ?? 0
          const targetScrollTop = scrollRatio * (scrollViewRef.value.scrollHeight - scrollViewRef.value.clientHeight)
          scrollViewRef.value.scrollTop = targetScrollTop
        }
      })
    }
  })
})
onBeforeUnmount(() => {
  if (crepe) {
    crepe.destroy()
    crepe = null
  }
})

function emitOutlineUpdate(ctx: Ctx) {
  const headings = outline()(ctx)
  emitter.emit('outline:Update', headings)
}
function setSelectionAndScrollToView(Ctx: Ctx) {
  try {
    const view = Ctx.get(editorViewCtx)
    const size = view.state.doc.content.size
    const rawPos = currentTab.value?.milkdownCursorOffset ?? 1
    // 设置光标位置
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, rawPos))
    view.dispatch(tr)
    const clamped = Math.max(1, Math.min(rawPos, Math.max(1, size - 1)))
    const dom = view.domAtPos(clamped).node as HTMLElement
    // 检查是 文本节点还是 元素节点
    if (dom.nodeType === Node.TEXT_NODE) {
      const parent = dom.parentElement!
      parent.scrollIntoView({ behavior: 'instant', block: 'center' })
    } else {
      dom.scrollIntoView({ behavior: 'instant', block: 'center' })
    }
  } catch {
    if (currentTab.value!.milkdownCursorOffset !== null && currentTab.value!.milkdownCursorOffset! > 0) {
      currentTab.value!.milkdownCursorOffset!--
      setSelectionAndScrollToView(Ctx)
    }
  }
}
</script>

<template>
  <div class="editor-box">
    <div ref="scrollViewRef" class="scrollView milk" @scroll="updateScrollRatio">
      <div id="milkdown"></div>
    </div>
  </div>
</template>

<style scoped lang="less">
.editor-box {
  width: 100%;
  height: 100%;
  display: flex;

  .scrollView {
    flex: 1;
    height: 100%;
    overflow-y: auto;
    background: var(--background-color-1);
  }
}
</style>

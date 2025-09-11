<script setup lang="ts">
import type { Ctx } from '@milkdown/kit/ctx'
import { Crepe } from '@milkdown/crepe'
import { upload, uploadConfig } from '@milkdown/kit/plugin/upload'
import { outline } from '@milkdown/kit/utils'
import { automd } from '@milkdown/plugin-automd'
import { enhanceConfig } from '@renderer/enhance/crepe/config'
import { onMounted } from 'vue'
import useContent from '@/hooks/useContent'
import { uploader } from '@/plugins/customPastePlugin'
import { htmlPlugin } from '@/plugins/hybridHtmlPlugin/rawHtmlPlugin'
import { diagram } from '@/plugins/mermaidPlugin'
import emitter from '../events'

const props = defineProps<{
  modelValue: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const { currentScrollRatio, initScrollListener } = useContent()

onMounted(async () => {
  // 预览模式下支持自定义css文件路径解析
  // 还有在源码模式下 支持自定义字体大小调节
  // 还有 切换 源码和预览模式 以及 目录打开与关闭 搞个可以自定义的快捷键

  // crepe 有更好的用户体验👇
  const crepe = new Crepe({
    root: document.querySelector('#milkdown') as HTMLElement,
    defaultValue: props.modelValue.toString(),
    featureConfigs: {
      ...enhanceConfig,
    },
  })
  crepe.on((lm) => {
    lm.markdownUpdated((Ctx, nextMarkdown) => {
      emit('update:modelValue', nextMarkdown)
      emitOutlineUpdate(Ctx)
    })
    lm.mounted((Ctx) => {
      emitOutlineUpdate(Ctx)
    })
  })
  const editor = crepe.editor
  editor.ctx.inject(uploadConfig.key)
  editor
    .use(automd)
    .use(upload)
    .use(htmlPlugin)
    .use(diagram)
    // .use(container)
  // .use(commonmark)

  await crepe.create()
  editor.ctx.update(uploadConfig.key, prev => ({ ...prev, uploader }))
  initScrollListener()
  // 滚动到指定位置
  if (currentScrollRatio.value > 0) {
    const el = document.querySelector('.scrollView.milkdown')
    if (!el)
      return
    const scrollHeight = el.scrollHeight || 0
    const targetScrollTop = scrollHeight * currentScrollRatio.value
    el.scrollTop = targetScrollTop
  }

  followCodeMirrorCursor()
})

function emitOutlineUpdate(ctx: Ctx) {
  const headings = outline()(ctx)
  emitter.emit('outline:Update', headings)
}

function followCodeMirrorCursor() {
  const TARGET_SELECTOR = '.ͼq.cm-cursor'

  // 1. 定义 IntersectionObserver 回调
  const intersectionCallback = (entries: any[]) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        entry.target.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }
    })
  }

  // 2. 创建 IntersectionObserver（但不立即观察）
  const observer = new IntersectionObserver(intersectionCallback, {
    threshold: 0.1,
  })

  // 3. 使用 MutationObserver 监听 DOM 变化
  const mutationObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      // 检查是否有节点被添加
      if (mutation.addedNodes.length) {
        // 在新增的节点中查找目标元素
        const target = document.querySelector(TARGET_SELECTOR)
        if (target) {
          observer.observe(target)
          mutationObserver.disconnect() // 停止监听（可选）
        }
      }
    })
  })

  // 4. 开始监听整个文档的 DOM 变化
  mutationObserver.observe(document.body, {
    childList: true, // 监听子节点的添加/删除
    subtree: true, // 监听所有后代节点
  })

  // 5. 检查元素是否已经存在（避免等待 DOM 变化）
  const existingTarget = document.querySelector(TARGET_SELECTOR)
  if (existingTarget) {
    observer.observe(existingTarget)
    mutationObserver.disconnect() // 停止监听（可选）
  }
}
</script>

<template>
  <div class="editor-box">
    <div class="scrollView">
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

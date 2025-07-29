<script setup lang="ts">
import type { Ctx } from '@milkdown/kit/ctx'
import { Crepe } from '@milkdown/crepe'
import { upload, uploadConfig } from '@milkdown/kit/plugin/upload'
import { outline } from '@milkdown/kit/utils'
import { automd } from '@milkdown/plugin-automd'
import { commonmark } from '@milkdown/preset-commonmark'
import { onMounted } from 'vue'
import { uploader } from '@/plugins/customPastePlugin'

import emitter from '../events'

const props = defineProps<{
  modelValue: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

onMounted(async () => {
  // 预览模式下支持自定义css文件路径解析
  // 还有在源码模式下 支持自定义字体大小调节
  // 还有 切换 源码和预览模式 以及 目录打开与关闭 搞个可以自定义的快捷键

  // crepe 有更好的用户体验👇
  const crepe = new Crepe({
    root: document.querySelector('#milkdown') as HTMLElement,
    defaultValue: props.modelValue.toString(),
    featureConfigs: {
      placeholder: {
        text: '开始写点什么吧...',
        mode: 'doc',
      },
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
  editor.use(commonmark)
    .use(automd)
    .use(upload)
  await crepe.create()
  editor.ctx.update(uploadConfig.key, prev => ({ ...prev, uploader }))
})
function emitOutlineUpdate(ctx: Ctx) {
  const headings = outline()(ctx)
  emitter.emit('outline:Update', headings)
}
</script>

<template>
  <div class="editor-box">
    <div class="scrollView">
      <div id="milkdown" />
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

    >div {
      height: 100%;
    }
  }
}
</style>

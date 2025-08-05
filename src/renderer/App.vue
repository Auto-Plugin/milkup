<script setup lang="ts">
import { MilkdownProvider } from '@milkdown/vue'
import { nextTick, ref, watch } from 'vue'
import useContent from '@/hooks/useContent'
import useFile from '@/hooks/useFile'
import { isShowOutline } from '@/hooks/useOutline'
import { useSaveConfirmDialog } from '@/hooks/useSaveConfirmDialog'
import useSourceCode from '@/hooks/useSourceCode'
import useTheme from '@/hooks/useTheme'
import useTitle from '@/hooks/useTitle'
import MarkdownSourceEditor from './components/MarkdownSourceEditor.vue'
import MilkdownEditor from './components/MilkdownEditor.vue'
import Outline from './components/Outline.vue'
import SaveConfirmDialog from './components/SaveConfirmDialog.vue'
import StatusBar from './components/StatusBar.vue'
import TitleBar from './components/TitleBar.vue'
import emitter from './events'

const { updateTitle } = useTitle()
const { markdown } = useContent()
const { theme } = useTheme()
const { isShowSource } = useSourceCode()
const { isDialogVisible, showDialog, handleSave, handleDiscard, handleCancel } = useSaveConfirmDialog()
const { onSave } = useFile()
const isShowEditors = ref(true)

watch(markdown, () => {
  updateTitle()
})
watch([theme, isShowSource], () => {
  reBuildMilkdown()
})
emitter.on('file:Change', () => {
  reBuildMilkdown()
})

// 监听关闭确认事件
window.electronAPI.on('close:confirm', async () => {
  const result = await showDialog()
  if (result === 'save') {
    await onSave()
  } else if (result === 'discard') {
    // 直接关闭应用
    window.electronAPI.closeDiscard()
  }
})

// 监听保存触发事件
window.electronAPI.on('trigger-save', async () => {
  await onSave()
})

function reBuildMilkdown() {
  isShowEditors.value = false
  nextTick(() => {
    isShowEditors.value = true
  })
}
</script>

<template>
  <TitleBar />
  <div v-if="isShowEditors" class="editorArea">
    <Transition name="fade" mode="out-in">
      <div v-show="isShowOutline && !isShowSource" class="outlineBox">
        <Outline />
      </div>
    </Transition>
    <div class="editorBox">
      <MilkdownProvider v-if="!isShowSource">
        <MilkdownEditor v-model="markdown" />
      </MilkdownProvider>
      <MarkdownSourceEditor v-else-if="isShowSource" v-model="markdown" />
    </div>
  </div>
  <StatusBar :content="markdown" />
  <SaveConfirmDialog
    :visible="isDialogVisible"
    @save="handleSave"
    @discard="handleDiscard"
    @cancel="handleCancel"
  />
</template>

<style scoped lang="less">
.editorArea {
  height: 0;
  flex: 1;
  display: flex;

  .outlineBox {
    width: 25%;
    height: 100%;
    transition: 0.2s;
  }

  .editorBox {
    flex: 1;
    width: 0;
  }
}
</style>

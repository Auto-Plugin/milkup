<script setup lang="ts">
import { MilkdownProvider } from '@milkdown/vue'
import { useContext } from '@/hooks/useContext'
import MarkdownSourceEditor from './components/MarkdownSourceEditor.vue'
import MilkdownEditor from './components/MilkdownEditor.vue'
import Outline from './components/Outline.vue'
import SaveConfirmDialog from './components/SaveConfirmDialog.vue'
import StatusBar from './components/StatusBar.vue'
import TitleBar from './components/TitleBar.vue'

// 使用整合的context hook
const {
  markdown,
  isShowSource,
  isShowOutline,
  isDialogVisible,
  dialogType,
  fileName,
  tabName,
  isShowEditors,
  pendingCloseTab,
  handleSave,
  handleDiscard,
  handleCancel,
  handleOverwrite,
} = useContext()
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
    :type="dialogType"
    :tab-name="tabName || pendingCloseTab?.tabName"
    :file-name="fileName"
    @save="handleSave"
    @discard="handleDiscard"
    @cancel="handleCancel"
    @overwrite="handleOverwrite"
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

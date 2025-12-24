<script setup lang="ts">
import { MilkdownProvider } from '@milkdown/vue'
import { SaveConfirmDialog, UpdateConfirmDialog } from '@renderer/components/core/dialog'
import { MarkdownSourceEditor, MilkdownEditor } from '@renderer/components/core/editor'
import { Outline, StatusBar, TitleBar } from '@renderer/components/core/layout'
import { useContext } from '@/hooks/useContext'
import { MilkupProvider } from './context'

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
  isUpdateDialogVisible,
  currentTab,

  handleSave,
  handleDiscard,
  handleCancel,
  handleOverwrite,
  handleIgnore,
  handleLater,
  handleUpdate,
} = useContext()
</script>

<template>
  <TitleBar />
  <div id="fontRoot">
    <div v-if="isShowEditors" class="editorArea">
      <Transition name="fade" mode="out-in">
        <div v-show="isShowOutline && !isShowSource" class="outlineBox">
          <Outline />
        </div>
      </Transition>
      <div class="editorBox">
        <MilkdownProvider v-if="!isShowSource">
          <MilkupProvider>
            <MilkdownEditor v-model="markdown" :read-only="currentTab?.readOnly" />
          </MilkupProvider>
        </MilkdownProvider>
        <MarkdownSourceEditor v-else-if="isShowSource" v-model="markdown" :read-only="currentTab?.readOnly" />
      </div>
    </div>
  </div>
  <StatusBar :content="markdown" />
  <SaveConfirmDialog
    :visible="isDialogVisible" :type="dialogType" :tab-name="tabName || pendingCloseTab?.tabName"
    :file-name="fileName" @save="handleSave" @discard="handleDiscard" @cancel="handleCancel"
    @overwrite="handleOverwrite"
  />
  <UpdateConfirmDialog
    :visible="isUpdateDialogVisible" @get="handleUpdate" @ignore="handleIgnore"
    @cancel="handleLater"
  />
</template>

<style scoped lang="less">
#fontRoot {
  height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

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

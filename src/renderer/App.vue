<script setup lang="ts">
import { MilkdownProvider } from '@milkdown/vue'
import { useContext } from '@/hooks/useContext'
import MarkdownSourceEditor from './components/MarkdownSourceEditor.vue'
import MilkdownEditor from './components/MilkdownEditor.vue'
import Outline from './components/Outline.vue'
import SaveConfirmDialog from './components/SaveConfirmDialog.vue'
import StatusBar from './components/StatusBar.vue'
import TitleBar from './components/TitleBar.vue'
import UpdateConfirmDialog from './components/UpdateConfirmDialog.vue'
// import VditorEditor from './components/VditorEditor.vue'
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
            <!-- <VditorEditor v-model="markdown" /> -->
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

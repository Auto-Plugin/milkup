<script setup lang="ts">
import { MilkdownProvider } from '@milkdown/vue'
import useContent from '@/hooks/useContent'
import { useContext } from '@/hooks/useContext'
import useFont from '@/hooks/useFont'
import useOtherConfig from '@/hooks/useOtherConfig'
import { isShowOutline } from '@/hooks/useOutline'
import { useSaveConfirmDialog } from '@/hooks/useSaveConfirmDialog'
import useSourceCode from '@/hooks/useSourceCode'
import useSpellCheck from '@/hooks/useSpellCheck'
import useTab from '@/hooks/useTab'
import useTheme from '@/hooks/useTheme'
import { useUpdateDialog } from '@/hooks/useUpdateDialog'
import MarkdownSourceEditor from './components/MarkdownSourceEditor.vue'
import MilkdownEditor from './components/MilkdownEditor.vue'
import Outline from './components/Outline.vue'
import SaveConfirmDialog from './components/SaveConfirmDialog.vue'
import StatusBar from './components/StatusBar.vue'
import TitleBar from './components/TitleBar.vue'
import UpdateConfirmDialog from './components/UpdateConfirmDialog.vue'
import { MilkupProvider } from './context'

// ✅ 应用级事件协调器（仅负责事件监听和协调）
const { isShowEditors, reBuildMilkdown } = useContext()

// ✅ 直接使用各个hooks（而不是通过useContext转发）
const { markdown } = useContent()
const { init: initTheme } = useTheme()
const { init: initFont } = useFont()
const { init: initOtherConfig } = useOtherConfig()
const { isShowSource } = useSourceCode()
const { currentTab } = useTab()
const { isDialogVisible, dialogType, fileName, tabName, handleSave, handleDiscard, handleCancel, handleOverwrite } = useSaveConfirmDialog()
const { isDialogVisible: isUpdateDialogVisible, handleIgnore, handleLater, handleUpdate } = useUpdateDialog()

// 初始化配置
useSpellCheck()
initTheme()
initFont()
initOtherConfig()
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
    :visible="isDialogVisible" :type="dialogType" :tab-name="tabName"
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

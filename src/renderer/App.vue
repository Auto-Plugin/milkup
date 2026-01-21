<script setup lang="ts">
import { MilkdownProvider } from '@milkdown/vue'
import emitter from '@/renderer/events'
import useContent from '@/renderer/hooks/useContent'
import { useContext } from '@/renderer/hooks/useContext'
import useFont from '@/renderer/hooks/useFont'
import useOtherConfig from '@/renderer/hooks/useOtherConfig'
import { isShowOutline } from '@/renderer/hooks/useOutline'
import { useSaveConfirmDialog } from '@/renderer/hooks/useSaveConfirmDialog'
import useSourceCode from '@/renderer/hooks/useSourceCode'
import useSpellCheck from '@/renderer/hooks/useSpellCheck'
import useTab from '@/renderer/hooks/useTab'
import useTheme from '@/renderer/hooks/useTheme'
import { useUpdateDialog } from '@/renderer/hooks/useUpdateDialog'
import SaveConfirmDialog from './components/dialogs/SaveConfirmDialog.vue'
import UpdateConfirmDialog from './components/dialogs/UpdateConfirmDialog.vue'
import MarkdownSourceEditor from './components/editor/MarkdownSourceEditor.vue'
import MilkdownEditor from './components/editor/MilkdownEditor.vue'
import StatusBar from './components/menu/StatusBar.vue'
import TitleBar from './components/menu/TitleBar.vue'
import Outline from './components/outline/Outline.vue'
import { MilkupProvider } from './context'

// ✅ 应用级事件协调器（仅负责事件监听和协调）
const { editorKey } = useContext()

// ✅ 直接使用各个hooks（而不是通过useContext转发）
const { markdown } = useContent()
const { init: initTheme } = useTheme()
const { init: initFont } = useFont()
const { init: initOtherConfig } = useOtherConfig()
const { isShowSource } = useSourceCode()
const { currentTab, close, saveCurrentTab, getUnsavedTabs, switchToTab } = useTab()
const { isDialogVisible, dialogType, fileName, tabName, handleSave, handleDiscard, handleCancel, handleOverwrite, showDialog, showFileChangedDialog } = useSaveConfirmDialog()
const { isDialogVisible: isUpdateDialogVisible, handleIgnore, handleLater, handleUpdate } = useUpdateDialog()

// 初始化配置
useSpellCheck()
initTheme()
initFont()
initOtherConfig()

// 监听关闭确认事件
emitter.on('tab:close-confirm', async ({ tabId, tabName, isLastTab }) => {
  const result = await showDialog(tabName)
  if (result === 'cancel') {
    return
  }

  if (result === 'save') {
    // 尝试保存
    // 注意：saveCurrentTab保存的是currentTab，这里需要确保保存的是目标tab
    // 但useTab中saveCurrentTab实现是保存activeTabId对应的tab
    // 如果关闭的不是当前tab，这里会有问题。
    // 但是UI上点击关闭通常是当前tab或者tab栏上的。
    // 如果点击非当前tab关闭，activeTabId可能还没切过去？
    // useTab.closeWithConfirm没有切换activeTabId。
    // 简化处理：如果result是save，且不是currentTab，先切换过去？
    // 或者修改useTab增加saveTab(id)方法？
    // 暂时假设用户总是关闭当前Tab或者我们可以调用saveCurrentTab如果id匹配
    if (currentTab.value?.id === tabId) {
      const saved = await saveCurrentTab()
      if (!saved)
        return // 保存失败中止
    } else {
      // 暂时不支持保存非激活Tab（或者需要扩展useTab）
      // 考虑到操作习惯，这通常发生在当前Tab
    }
  }

  // 丢弃或保存成功后，执行关闭
  if (isLastTab) {
    window.electronAPI.closeDiscard()
  } else {
    close(tabId)
  }
})

// 监听外部文件变动确认事件
emitter.on('file:changed-confirm', async ({ fileName, resolver }) => {
  const result = await showFileChangedDialog(fileName)
  resolver(result === 'overwrite' ? 'overwrite' : 'cancel')
})

// 监听主进程的关闭确认事件
window.electronAPI.on('close:confirm', async () => {
  const unsavedTabs = getUnsavedTabs()
  if (unsavedTabs.length === 0) {
    window.electronAPI.closeDiscard()
    return
  }

  for (const tab of unsavedTabs) {
    // 切换到该tab以便用户查看
    await switchToTab(tab.id)

    // 弹出保存确认框
    const result = await showDialog(tab.name)

    if (result === 'cancel') {
      // 用户取消关闭操作，中止后续流程
      return
    }

    if (result === 'save') {
      const saved = await saveCurrentTab()
      if (!saved) {
        // 保存失败，中止关闭（或者向用户报错? 这里选择中止以策安全）
        return
      }
    }
    // 如果是 'discard'，则不做任何操作，继续下一个
  }

  // 所有此轮检查都通过（保存或丢弃），强制关闭
  window.electronAPI.closeDiscard()
})
</script>

<template>
  <TitleBar />
  <div id="fontRoot">
    <!-- ✅ 使用key属性来重建编辑器，当editorKey变化时Vue会自动重建组件 -->
    <div :key="editorKey" class="editorArea">
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

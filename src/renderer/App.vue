<script setup lang="ts">
import emitter from "@/renderer/events";
import useContent from "@/renderer/hooks/useContent";
import { useContext } from "@/renderer/hooks/useContext";
import useFont from "@/renderer/hooks/useFont";
import useOtherConfig from "@/renderer/hooks/useOtherConfig";
import { isShowOutline } from "@/renderer/hooks/useOutline";
import { useSaveConfirmDialog } from "@/renderer/hooks/useSaveConfirmDialog";
import useSourceCode from "@/renderer/hooks/useSourceCode";
import useSpellCheck from "@/renderer/hooks/useSpellCheck";
import useTab from "@/renderer/hooks/useTab";
import useTheme from "@/renderer/hooks/useTheme";
import { useUpdateDialog } from "@/renderer/hooks/useUpdateDialog";
import SaveConfirmDialog from "./components/dialogs/SaveConfirmDialog.vue";
import UpdateConfirmDialog from "./components/dialogs/UpdateConfirmDialog.vue";
import MilkupEditor from "./components/editor/MilkupEditor.vue";
import StatusBar from "./components/menu/StatusBar.vue";
import TitleBar from "./components/menu/TitleBar.vue";
import Outline from "./components/outline/Outline.vue";

// ✅ 应用级事件协调器（仅负责事件监听和协调）
const { editorKey } = useContext();

// ✅ 直接使用各个hooks（而不是通过useContext转发）
const { markdown } = useContent();
const { init: initTheme } = useTheme();
const { init: initFont } = useFont();
const { init: initOtherConfig } = useOtherConfig();
const { isShowSource } = useSourceCode(); // 用于控制大纲显示
const { init: initSpellCheck } = useSpellCheck();
const { currentTab, close, saveCurrentTab, getUnsavedTabs, switchToTab } = useTab();
const {
  isDialogVisible,
  dialogType,
  fileName,
  tabName,
  handleSave,
  handleDiscard,
  handleCancel,
  handleOverwrite,
  showDialog,
} = useSaveConfirmDialog();
const {
  isDialogVisible: isUpdateDialogVisible,
  updateStatus,
  downloadProgress,
  handleIgnore,
  handleUpdate,
  handleMinimize,
  handleRestore,
  handleCancel: handleUpdateCancel,
  showDialog: showUpdateDialog,
} = useUpdateDialog();

// 编辑器类型：'milkdown' | 'milkup'
// 监听主进程的关闭确认事件
window.electronAPI.on("close:confirm", async () => {
  await handleSafeClose("close");
});

// 监听Tab关闭确认事件
const handleTabCloseConfirm = async (payload: any) => {
  const { tabId, tabName } = payload;
  const result = await showDialog(tabName);

  if (result === "save") {
    // 只有保存并成功才关闭
    const saved = await saveCurrentTab();
    if (saved) {
      close(tabId);
    }
  } else if (result === "discard") {
    // 放弃更改，直接关闭
    close(tabId);
  }
  // cancel 则不做任何操作
};
emitter.on("tab:close-confirm", handleTabCloseConfirm);

const onUpdateAvailable = (payload: any) => {
  const info = payload || {};

  localStorage.setItem("updateInfo", JSON.stringify(info));
  const ignoredVersion = localStorage.getItem("ignoredVersion");

  if (ignoredVersion !== info.version) {
    showUpdateDialog();
  }
};

// 监听主进程的更新可用事件 (Auto Update)
window.electronAPI.on("update:available", onUpdateAvailable);

// 监听手动检查的更新可用事件 (Manual Check from About)
import { onMounted, onUnmounted } from "vue";
onMounted(() => {
  initTheme();
  initFont();
  initOtherConfig();
  initSpellCheck();
  emitter.on("update:available", onUpdateAvailable);
});
onUnmounted(() => {
  emitter.off("update:available", onUpdateAvailable);
  emitter.off("tab:close-confirm", handleTabCloseConfirm);
});

// Reuse safe close logic
async function handleSafeClose(action: "close" | "update") {
  const unsavedTabs = getUnsavedTabs();
  if (unsavedTabs.length === 0) {
    if (action === "update") {
      await window.electronAPI.quitAndInstall();
    } else {
      window.electronAPI.closeDiscard();
    }
    return;
  }

  for (const tab of unsavedTabs) {
    // 切换到该tab以便用户查看
    await switchToTab(tab.id);

    // 弹出保存确认框
    const result = await showDialog(tab.name);

    if (result === "cancel") {
      // 用户取消关闭操作，中止后续流程
      return;
    }

    if (result === "save") {
      const saved = await saveCurrentTab();
      if (!saved) {
        // 保存失败，中止关闭
        return;
      }
    }
    // 如果是 'discard'，则不做任何操作，继续下一个
  }

  // 所有此轮检查都通过（保存或丢弃），强制关闭/更新
  if (action === "update") {
    window.electronAPI.quitAndInstall();
  } else {
    window.electronAPI.closeDiscard();
  }
}

// Overwrite handleUpdateInstall to check for unsaved changes
const handleInstall = async () => {
  await handleSafeClose("update");
};
</script>

<template>
  <TitleBar />
  <div id="fontRoot">
    <!-- ✅ 使用key属性来重建编辑器，当editorKey变化时Vue会自动重建组件 -->
    <div :key="editorKey" class="editorArea">
      <Transition name="fade" mode="out-in">
        <div v-show="isShowOutline" class="outlineBox">
          <Outline />
        </div>
      </Transition>
      <div class="editorBox">
        <!-- Milkup 编辑器（新内核，支持源码模式） -->
        <MilkupEditor v-model="markdown" :read-only="currentTab?.readOnly" />
      </div>
    </div>
  </div>
  <StatusBar
    :content="markdown"
    :update-status="updateStatus"
    :download-progress="downloadProgress"
    :is-update-dialog-visible="isUpdateDialogVisible"
    @restore-update="handleRestore"
  />
  <SaveConfirmDialog
    :visible="isDialogVisible"
    :type="dialogType"
    :tab-name="tabName"
    :file-name="fileName"
    @save="handleSave"
    @discard="handleDiscard"
    @cancel="handleCancel"
    @overwrite="handleOverwrite"
  />
  <UpdateConfirmDialog
    :visible="isUpdateDialogVisible"
    :status="updateStatus"
    :progress="downloadProgress"
    @get="handleUpdate"
    @install="handleInstall"
    @ignore="handleIgnore"
    @cancel="handleUpdateCancel"
    @minimize="handleMinimize"
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

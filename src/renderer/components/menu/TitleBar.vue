<script setup lang="ts">
import autotoast from "autotoast.js";
import { computed, onUnmounted, ref } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import useTab from "@/renderer/hooks/useTab";
import TabBar from "@/renderer/components/workspace/TabBar.vue";
import MenuDropDown from "./MenuDropDown.vue";

const isWin = window.electronAPI.platform === "win32";
const { currentTab } = useTab();

const isFullScreen = ref(false);
function minimize() {
  window.electronAPI?.windowControl?.("minimize");
}
function toggleMaximize() {
  window.electronAPI?.windowControl?.("maximize");
}
async function close() {
  window.electronAPI?.windowControl?.("close");
}
window.electronAPI.on("close", () => {
  close();
});

// 监听主进程的最大化/还原事件，同步按钮状态
function handleMaximizedChange(maximized: boolean) {
  isFullScreen.value = maximized;
}
function handleFullscreenChange(fullscreen: boolean) {
  isFullScreen.value = fullscreen;
}
window.electronAPI.on("window:maximized-change", handleMaximizedChange);
window.electronAPI.on("window:fullscreen-change", handleFullscreenChange);

function getDirectoryPath(filePath: string): string {
  const normalizedPath = filePath.replace(/[\\/]+$/, "");
  const separator = normalizedPath.includes("\\") ? "\\" : "/";
  const parts = normalizedPath.split(/[\\/]/);
  parts.pop();
  return parts.join(separator);
}

const currentFileMeta = computed(() => {
  const tab = currentTab.value;
  const filePath = tab?.filePath ?? "";
  const fileName = tab?.name || "未打开文档";
  const directoryPath = filePath ? getDirectoryPath(filePath) : "";

  return {
    fileName,
    filePath,
    directoryPath,
    canOperate: Boolean(filePath),
    hint: filePath ? directoryPath : tab ? "新建文档，保存后可定位所在文件夹" : "当前没有打开文档",
  };
});

async function revealCurrentFile() {
  const filePath = currentFileMeta.value.filePath;
  if (!filePath) return;

  const opened = await window.electronAPI.revealFileInFolder(filePath);
  if (!opened) {
    autotoast.show("无法打开所在文件夹", "error");
  }
}

async function copyCurrentFilePath() {
  const filePath = currentFileMeta.value.filePath;
  if (!filePath) return;

  const copied = await window.electronAPI.writeTextToClipboard(filePath);
  if (copied) {
    autotoast.show("已复制文件路径", "success");
    return;
  }

  autotoast.show("复制文件路径失败", "error");
}

onUnmounted(() => {
  window.electronAPI.removeListener?.("window:maximized-change", handleMaximizedChange);
  window.electronAPI.removeListener?.("window:fullscreen-change", handleFullscreenChange);
});
</script>

<template>
  <div class="TitleBarBox">
    <template v-if="isWin">
      <MenuDropDown />
      <TabBar />
      <div
        class="titlebar-meta"
        :title="currentFileMeta.filePath || currentFileMeta.hint"
        :class="{ disabled: !currentFileMeta.canOperate }"
      >
        <div class="file-summary">
          <span class="file-status" :class="{ modified: currentTab?.isModified }"></span>
          <div class="file-text">
            <span class="file-name">{{ currentFileMeta.fileName }}</span>
            <span class="file-path">{{ currentFileMeta.hint }}</span>
          </div>
        </div>
        <div class="file-actions">
          <button
            class="file-action-btn"
            type="button"
            title="打开所在文件夹"
            :disabled="!currentFileMeta.canOperate"
            @click="revealCurrentFile"
          >
            <AppIcon name="folder-opened" />
          </button>
          <button
            class="file-action-btn"
            type="button"
            title="复制文件路径"
            :disabled="!currentFileMeta.canOperate"
            @click="copyCurrentFilePath"
          >
            <AppIcon name="document-copy" />
          </button>
        </div>
      </div>

      <div class="window-controls">
        <button class="window-control-btn" @click="minimize">
          <AppIcon name="min" />
        </button>
        <button class="window-control-btn" @click="toggleMaximize">
          <AppIcon :name="isFullScreen ? 'normal' : 'max'" />
        </button>
        <button class="window-control-btn close-btn" @click="close">
          <AppIcon name="close" />
        </button>
      </div>
    </template>
    <template v-else>
      <div class="mac-spacer"></div>
      <TabBar />
      <div
        class="titlebar-meta"
        :title="currentFileMeta.filePath || currentFileMeta.hint"
        :class="{ disabled: !currentFileMeta.canOperate }"
      >
        <div class="file-summary">
          <span class="file-status" :class="{ modified: currentTab?.isModified }"></span>
          <div class="file-text">
            <span class="file-name">{{ currentFileMeta.fileName }}</span>
            <span class="file-path">{{ currentFileMeta.hint }}</span>
          </div>
        </div>
        <div class="file-actions">
          <button
            class="file-action-btn"
            type="button"
            title="打开所在文件夹"
            :disabled="!currentFileMeta.canOperate"
            @click="revealCurrentFile"
          >
            <AppIcon name="folder-opened" />
          </button>
          <button
            class="file-action-btn"
            type="button"
            title="复制文件路径"
            :disabled="!currentFileMeta.canOperate"
            @click="copyCurrentFilePath"
          >
            <AppIcon name="document-copy" />
          </button>
        </div>
      </div>
      <div class="menu-host">
        <MenuDropDown />
      </div>
    </template>
  </div>
</template>

<style lang="less" scoped>
.TitleBarBox {
  -webkit-app-region: drag;
  height: 46px;
  padding-left: 6px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--background-color-1) 60%, transparent),
    var(--background-color-2)
  );
  color: var(--text-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  overflow: hidden;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color-1) 82%, transparent);

  .mac-spacer {
    width: 68px;
    flex-shrink: 0;
  }

  .menu-host {
    margin-right: 10px;
  }

  .titlebar-meta {
    min-width: 0;
    max-width: 360px;
    flex: 0 1 360px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 8px 7px 12px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--border-color-1) 80%, transparent);
    background: color-mix(in srgb, var(--background-color-1) 88%, transparent);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
    -webkit-app-region: no-drag;

    &.disabled {
      opacity: 0.72;
    }

    .file-summary {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
    }

    .file-status {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      flex-shrink: 0;
      background: color-mix(in srgb, var(--text-color-3) 60%, transparent);

      &.modified {
        background: #f59e0b;
        box-shadow: 0 0 0 4px color-mix(in srgb, #f59e0b 18%, transparent);
      }
    }

    .file-text {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .file-name,
    .file-path {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-name {
      font-size: 12px;
      line-height: 1.35;
      color: var(--text-color-1);
      font-weight: 600;
    }

    .file-path {
      font-size: 11px;
      line-height: 1.35;
      color: var(--text-color-3);
    }

    .file-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .file-action-btn {
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 9px;
      background: transparent;
      color: var(--text-color-2);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;

      &:hover:not(:disabled) {
        background: var(--hover-color);
        color: var(--text-color-1);
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }
    }
  }

  .window-controls {
    display: flex;
    -webkit-app-region: no-drag;
    height: 100%;
    align-items: center;
    justify-content: center;

    .window-control-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 16px;
      color: var(--text-color-1);
      height: 46px;
      width: 42px;
      border: none;
      background: transparent;

      &:hover {
        background: var(--hover-color);
      }

      &.close-btn:hover {
        background: #ff5f56;
        color: white;
      }
    }
  }
}

@media (max-width: 1120px) {
  .TitleBarBox {
    .titlebar-meta {
      max-width: 270px;
      flex-basis: 270px;
    }
  }
}

@media (max-width: 900px) {
  .TitleBarBox {
    .titlebar-meta {
      display: none;
    }
  }
}
</style>

<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import TabBar from "@/renderer/components/workspace/TabBar.vue";
import MenuDropDown from "./MenuDropDown.vue";

const isWin = window.electronAPI.platform === "win32";

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
</style>

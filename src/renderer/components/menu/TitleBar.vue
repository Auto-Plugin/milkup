<script setup lang="ts">
import { onUnmounted, ref } from "vue";
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
      <!-- <div class="title" @dblclick="toggleMaximize">
        {{ title }}
      </div> -->

      <TabBar />

      <div class="window-controls">
        <span class="iconfont icon-min" @click="minimize"></span>
        <span
          class="iconfont"
          :class="isFullScreen ? 'icon-normal' : 'icon-max'"
          @click="toggleMaximize"
        ></span>
        <span class="iconfont icon-close" @click="close"></span>
      </div>
    </template>
    <template v-else>
      <div style="width: 68px"></div>
      <!-- <div class="title" @dblclick="toggleMaximize">
        {{ title }}
      </div> -->
      <TabBar />
      <div style="margin-right: 10px">
        <MenuDropDown />
      </div>
    </template>
  </div>
</template>

<style lang="less" scoped>
.TitleBarBox {
  -webkit-app-region: drag;
  /* ✅ 允许拖动窗口 */
  height: 40px;
  background: var(--background-color-2);
  color: var(--text-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  overflow: hidden;
  // padding: 0 0 0 12px;
  // user-select: none;

  .window-controls {
    display: flex;
    -webkit-app-region: no-drag;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;

    /* ✅ 控制按钮不能拖动 */
    span {
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 16px;
      color: var(--text-color-1);
      height: 40px;
      width: 40px;

      // padding:  8px;
      // 保持长宽比

      &:hover {
        background: var(--hover-color);
      }

      &.icon-close:hover {
        background: #ff5f56;
        color: white;
      }
    }
  }
}
</style>

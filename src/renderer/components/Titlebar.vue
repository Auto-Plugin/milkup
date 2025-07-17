<script setup lang="ts">
import { ref } from "vue"
import useTitle from "../../hooks/useTitle"
import MenuDropDown from "./MenuDropDown.vue"
import { isWin } from "../lib/os"

const { title } = useTitle()

const isFullScreen = ref(false)
const minimize = () => {
  window.electronAPI?.windowControl?.("minimize")
}
const toggleMaximize = () => {
  isFullScreen.value = !isFullScreen.value
  window.electronAPI?.windowControl?.("maximize")
}
const close = () => window.electronAPI?.windowControl?.("close")
</script>

<template>
  <div class="TitlebarBox">
    <div v-if="!isWin"></div>
    <div class="title" @dblclick="toggleMaximize">{{ title }}</div>
    <MenuDropDown />
    <div class="window-controls" v-if="isWin">
      <span @click="minimize" class="iconfont icon-min"></span>
      <span
        @click="toggleMaximize"
        class="iconfont"
        :class="isFullScreen ? 'icon-normal' : 'icon-max'"
      ></span>
      <span @click="close" class="iconfont icon-close"></span>
    </div>
  </div>
</template>

<style lang="less" scoped>
.TitlebarBox {
  -webkit-app-region: drag; /* ✅ 允许拖动窗口 */
  height: 32px;
  background: var(--background-color-1);
  color: var(--text-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  padding-right: 0;
  user-select: none;
  .window-controls {
    display: flex;
    -webkit-app-region: no-drag; /* ✅ 控制按钮不能拖动 */
    span {
      cursor: pointer;
      font-size: 16px;
      color: var(--text-color-1);
      padding: 8px;
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

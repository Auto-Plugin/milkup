<script setup lang="ts">
import logo from '@/assets/icons/milkup.ico'
import { version } from '../../../package.json'

function openByDefaultBrowser(url: string) {
  window.electronAPI.openExternal(url)
}
</script>

<template>
  <div class="AboutBox">
    <div class="auto-plugin">
      <span class="iconfont icon-github link" @click="openByDefaultBrowser(`https://github.com/Auto-Plugin/milkup`)">Auto-Plugin</span>
    </div>
    <h1><img :src="logo" alt=""> MilkUp</h1>
    <p>一个基于 Milkdown 的 Markdown 编辑器</p>
    <p>version: v{{ version }}</p>
    <p>MIT Copyright © [2025] Larry Zhu</p>
    <p>Powered by <span class="link" @click="openByDefaultBrowser(`https://milkdown.dev`)">milkdown</span></p>
  </div>
</template>

<style lang="less" scoped>
.AboutBox {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  .auto-plugin {
    position: absolute;
    top: 12px;
    right: 12px;
    .icon-github {
      font-size: 12px;
      cursor: pointer;
      margin-left: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      &::before {
        font-size: 14px;
      }
    }
  }
  h1 {
    font-size: 20px;
    margin: 0;
    color: var(--text-color);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  img {
    width: 64px;
    height: 64px;
    vertical-align: middle;
    margin-right: 8px;
  }
  p {
    font-size: 14px;
    color: var(--text-color-2);
  }
}
</style>

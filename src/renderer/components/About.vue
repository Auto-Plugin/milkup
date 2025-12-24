<script setup lang="ts">
import autotoast from 'autotoast.js'
import { checkUpdate } from '@/api/update'
import logo from '@/assets/icons/milkup.ico'
import { version } from '../../../package.json'
import emitter from '../events'
import { openExternal } from '../services'

function openByDefaultBrowser(url: string) {
  openExternal(url)
}
const updateInfo = JSON.parse(localStorage.getItem('updateInfo') || '{}')

function handleCheckUpdate() {
  autotoast.show('正在检查更新...', 'info', 500)
  localStorage.removeItem('ignoredVersion')
  checkUpdate().then((updateInfo) => {
    if (updateInfo) {
      emitter.emit('update:available', updateInfo)
    }
  })
}
</script>

<template>
  <div class="AboutBox">
    <h1 class="link" @click="openByDefaultBrowser(`https://milkup.dev`)">
      <img :src="logo" alt="" /> milkup
    </h1>
    <p>
      <span class="link version" @click="handleCheckUpdate">
        <span>version: v{{ version }} </span><span v-if="updateInfo.version" class="updateTip">new</span>
      </span>
    </p>
    <p>MIT Copyright © [2025] Larry Zhu</p>
    <p>Powered by <span class="link" @click="openByDefaultBrowser(`https://milkdown.dev`)">milkdown</span></p>
    <p class="thanks">
      <span class="link" @click="openByDefaultBrowser(`https://github.com/Auto-Plugin/milkup/graphs/contributors`)">
        Thank you for the contribution from <span class="iconfont icon-github">Auto-Plugin</span></span>
    </p>
    <p class="tip">
      milkup 是完全免费开源的软件
    </p>
  </div>
</template>

<style lang="less" scoped>
.AboutBox {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  .version {
    font-size: 12px;
    color: var(--text-color-2);
    margin-top: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .updateTip {
    background: var(--secondary-color);
    color: white;
    font-size: 12px;
    border-radius: 4px;
    padding: 2px 12px;
    margin-left: 4px;
    vertical-align: middle;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .tip {
    position: absolute;
    bottom: 30px;
    font-size: 10px;
    color: var(--primary-color-transparent);
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

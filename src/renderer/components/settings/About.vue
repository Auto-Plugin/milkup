<script setup lang="ts">
import autotoast from "autotoast.js";
import logo from "@/assets/icons/milkup.ico";
import emitter from "@/renderer/events";
import { checkUpdate } from "@/renderer/services/api/update";
import { version } from "../../../../package.json";
import { ref } from "vue";
import LoadingIcon from "../ui/LoadingIcon.vue";

function openByDefaultBrowser(url: string) {
  window.electronAPI.openExternal(url);
}
const updateInfo = JSON.parse(localStorage.getItem("updateInfo") || "{}");
const isChecking = ref(false);

function handleCheckUpdate() {
  if (isChecking.value) {
    console.log("[About] Already checking for updates, skipping...");
    return;
  }

  console.log("[About] Starting update check...");
  isChecking.value = true;
  localStorage.removeItem("ignoredVersion");

  checkUpdate()
    .then((info) => {
      console.log("[About] Update check completed:", info);
      isChecking.value = false;

      if (info && info.version) {
        console.log("[About] New version available:", info.version);
        localStorage.setItem("updateInfo", JSON.stringify(info));
        emitter.emit("update:available", info);
      } else {
        console.log("[About] Already on latest version");
        autotoast.show("当前已为最新版本", "success");
      }
    })
    .catch((err) => {
      console.error("[About] checkUpdate error:", err);
      autotoast.show(`检查更新失败: ${err.message || "Unknown error"}`, "error");
      isChecking.value = false;
    })
    .finally(() => {
      // 确保状态总是被重置
      console.log("[About] Update check finished, resetting state");
      isChecking.value = false;
    });
}
</script>

<template>
  <div class="AboutBox">
    <h1 class="link" @click="openByDefaultBrowser(`https://milkup.dev`)">
      <img :src="logo" alt="" /> milkup
    </h1>
    <p>
      <span class="link version" @click="handleCheckUpdate">
        <span>version: v{{ version }} </span>
        <span v-if="isChecking" class="updateTip loading">
          <LoadingIcon />
        </span>
        <span v-else-if="updateInfo.version" class="updateTip">new</span>
      </span>
    </p>
    <p>MIT Copyright © [2025] Larry Zhu</p>
    <p>
      Powered by
      <span class="link" @click="openByDefaultBrowser(`https://milkup.dev`)">milkup core</span>
    </p>
    <p class="thanks">
      <span
        class="link"
        @click="openByDefaultBrowser(`https://github.com/Auto-Plugin/milkup/graphs/contributors`)"
      >
        Thank you for the contribution from
        <span class="iconfont icon-github">Auto-Plugin</span></span
      >
    </p>
    <p class="tip">milkup 是完全免费开源的软件</p>
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
    padding: 2px 8px;
    margin-left: 4px;
    vertical-align: middle;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &.loading {
      background: transparent;
      padding: 0;

      svg {
        font-size: 14px;
        color: var(--primary-color);
      }
    }
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
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

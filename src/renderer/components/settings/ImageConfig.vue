<script setup lang="ts">
import { ref } from "vue";
import Input from "@/ui/Input.vue";
import UploadConfig from "./UploadConfig.vue";

type PasteMethod = "local" | "base64" | "remote";
const pasteMethod = ref<PasteMethod>(
  (localStorage.getItem("pasteMethod") as PasteMethod) || "local"
);
const localPath = ref<string>("/temp");

function handleChangePasteMethod(method: PasteMethod) {
  pasteMethod.value = method;
  localStorage.setItem("pasteMethod", method);
}
function handleChangeLoaclPath() {
  localStorage.setItem("localImagePath", localPath.value);
}
</script>

<template>
  <div class="ImageConfigBox">
    <div class="options">
      <div class="slider-track">
        <div
          class="slider-thumb"
          :style="{
            transform:
              pasteMethod === 'local'
                ? 'translateX(0)'
                : pasteMethod === 'base64'
                  ? 'translateX(calc(100% + 4px))'
                  : 'translateX(calc(200% + 8px))',
          }"
        />
        <div
          class="option-item"
          :class="{ active: pasteMethod === 'local' }"
          @click="handleChangePasteMethod('local')"
        >
          <span>本地文件</span>
        </div>
        <div
          class="option-item"
          :class="{ active: pasteMethod === 'base64' }"
          @click="handleChangePasteMethod('base64')"
        >
          <span>转为 Base64</span>
        </div>
        <div
          class="option-item"
          :class="{ active: pasteMethod === 'remote' }"
          @click="handleChangePasteMethod('remote')"
        >
          <span>上传</span>
        </div>
      </div>
    </div>
    <div class="details">
      <div v-if="pasteMethod === 'local'">
        <Input
          v-model="localPath"
          placeholder="/temp"
          label="本地文件路径"
          @change="handleChangeLoaclPath"
        />
      </div>
      <div v-if="pasteMethod === 'base64'">图片将自动转为 base64（可能会增大文件体积）</div>
      <UploadConfig v-if="pasteMethod === 'remote'" />
    </div>
  </div>
</template>

<style lang="less" scoped>
.ImageConfigBox {
  display: flex;
  flex-direction: column;
  gap: 10px;

  .details {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;

    > div {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 0 10px;
      border-radius: 4px;
      gap: 12px;
    }
  }

  .options {
    width: 100%;
    display: flex;
    justify-content: flex-start;

    .slider-track {
      position: relative;
      display: inline-flex;
      background: var(--background-color-2);
      border-radius: 8px;
      padding: 4px;
      gap: 4px;
      border: 1px solid var(--border-color-1);

      .slider-thumb {
        position: absolute;
        top: 4px;
        left: 4px;
        width: 120px;
        height: calc(100% - 8px);
        background: var(--primary-color, #409eff);
        border-radius: 6px;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 1;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .option-item {
        position: relative;
        z-index: 2;
        flex: 1;
        padding: 8px 16px;
        cursor: pointer;
        user-select: none;
        transition: all 0.2s ease;
        border-radius: 6px;
        text-align: center;
        width: 120px;

        span {
          font-size: 13px;
          color: var(--text-color-2);
          transition: color 0.2s ease;
          font-weight: 500;
          display: inline-block;
        }

        &.active span {
          color: #ffffff;
        }

        &:hover:not(.active) {
          background: rgba(64, 158, 255, 0.05);
        }
      }
    }
  }
}
</style>

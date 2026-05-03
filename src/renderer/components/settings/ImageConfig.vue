<script setup lang="ts">
import { computed } from "vue";
import { useConfig } from "@/renderer/hooks/useConfig";
import UploadConfig from "./UploadConfig.vue";

type PasteMethod = "local" | "base64" | "remote";

const { config, setConf } = useConfig();

const pasteMethod = computed<PasteMethod>(() => config.value.image.pasteMethod);
const useFileNameFolder = computed(() => config.value.image.useFileNameFolder);
const localPath = computed<string>({
  get: () => config.value.image.localPath,
  set: (value) => {
    setConf("image", "localPath", value);
  },
});

function isAbsoluteLocalPath(pathValue: string): boolean {
  if (!pathValue) return false;

  if (window.electronAPI.platform === "win32") {
    return /^[a-zA-Z]:[\\/]/.test(pathValue) || /^\\\\[^\\]/.test(pathValue);
  }

  return pathValue.startsWith("/");
}

function handleChangePasteMethod(method: PasteMethod) {
  setConf("image", "pasteMethod", method);
}

function handleChangeLocalPath() {
  setConf("image", "localPath", localPath.value?.trim() || "/assets");
}

function toggleUseFileNameFolder() {
  setConf("image", "useFileNameFolder", !useFileNameFolder.value);
}

async function handleSelectDirectory() {
  if (useFileNameFolder.value) return;
  const defaultPath = isAbsoluteLocalPath(localPath.value) ? localPath.value : undefined;
  const result = await window.electronAPI.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    defaultPath,
  });

  if (!result || result.canceled || result.filePaths.length === 0) {
    return;
  }

  localPath.value = result.filePaths[0];
  handleChangeLocalPath();
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
      <div v-if="pasteMethod === 'local'" class="local-path-panel">
        <div class="path-input-container">
          <span class="input-label">本地文件路径</span>
          <div class="path-input-group">
            <button
              type="button"
              class="file-name-folder-btn"
              :class="{ active: useFileNameFolder }"
              @click="toggleUseFileNameFolder"
            >
              文件同名文件夹
            </button>
            <input
              v-model="localPath"
              type="text"
              placeholder="/assets"
              :disabled="useFileNameFolder"
              @change="handleChangeLocalPath"
            />
            <button
              type="button"
              class="path-picker-btn"
              :disabled="useFileNameFolder"
              @click="handleSelectDirectory"
            >
              选择位置
            </button>
          </div>
        </div>
        <div class="path-hint">
          {{
            useFileNameFolder
              ? "开启后会使用完整 Markdown 文件名创建同名文件夹，例如 demo.md/image.png。未保存文件首次粘贴图片时会询问处理方式。"
              : "相对路径基于当前 Markdown 文件目录，例如 `/assets` 会保存到当前文件目录下的 `assets` 文件夹；绝对路径会直接保存到指定目录。"
          }}
        </div>
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

  .local-path-panel {
    .path-input-container {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      white-space: nowrap;

      .input-label {
        min-width: 100px;
        display: inline-block;
      }

      .path-input-group {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      input {
        width: 100%;
        height: 40px;
        border: 1px solid var(--border-color-1);
        border-radius: 4px;
        outline: none;
        background-color: var(--background-color-1);
        color: var(--text-color-1);
        padding: 0 10px;
        font-size: 14px;
      }

      .file-name-folder-btn,
      .path-picker-btn {
        height: 40px;
        padding: 0 14px;
        border: 1px solid var(--border-color-1);
        border-radius: 4px;
        background: var(--background-color-2);
        color: var(--text-color-1);
        cursor: pointer;
        flex-shrink: 0;
        transition:
          background-color 0.2s,
          border-color 0.2s,
          color 0.2s,
          opacity 0.2s;
      }

      .file-name-folder-btn.active {
        border-color: var(--primary-color);
        background: var(--primary-color);
        color: #fff;
      }

      input:disabled,
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
    }

    .path-hint {
      color: var(--text-color-2);
      font-size: 12px;
      line-height: 1.6;
      white-space: normal;
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

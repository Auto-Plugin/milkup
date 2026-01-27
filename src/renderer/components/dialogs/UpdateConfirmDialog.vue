<script setup lang="ts">
import { Crepe } from "@milkdown/crepe";
import { nextTick, ref, watch } from "vue";

interface Props {
  visible: boolean;
  status: "idle" | "downloading" | "downloaded" | "error";
  progress: number;
}

interface Emits {
  (e: "ignore"): void;
  (e: "get"): void;
  (e: "install"): void;
  (e: "cancel"): void;
  (e: "minimize"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const updateInfo = ref(JSON.parse(localStorage.getItem("updateInfo") || "{}"));

function handleIgnore() {
  emit("ignore");
}

function handleGet() {
  emit("get");
}

function handleInstall() {
  emit("install");
}

function handleCancel() {
  emit("cancel");
}

function handleMinimize() {
  emit("minimize");
}

function openReleasePage() {
  // 假设 update info 中有 html_url 或者拼凑一个
  // 目前 custom逻辑里 url 是下载链接。
  // 但是 checkUpdate 返回的 updateInfo 里应该加一个 release page url
  // 我们暂时用 hardcode 或者假设 info 里有
  // 实际上 github api 返回的 html_url 就是 release page
  // 我们在 main process 里加一下
  if (updateInfo.value.releasePageUrl) {
    window.electronAPI.openExternal(updateInfo.value.releasePageUrl);
  } else {
    // Fallback
    window.electronAPI.openExternal("https://github.com/auto-plugin/milkup/releases");
  }
}

const updateLogContainer = ref<HTMLElement | null>(null);

watch(
  () => props.visible,
  (newVal) => {
    if (newVal) {
      updateInfo.value = JSON.parse(localStorage.getItem("updateInfo") || "{}");
      nextTick(() => {
        // 避免重复创建
        if (updateLogContainer.value) {
          updateLogContainer.value.innerHTML = "";
          const preview = new Crepe({
            root: updateLogContainer.value,
            defaultValue: updateInfo.value.notes || "更新日志加载失败，请前往官网下载最新版本。",
            featureConfigs: {
              // 这里可以添加更多的配置选项
            },
          });
          preview.setReadonly(true);
          preview.create();
        }
      });
    }
  }
);
</script>

<template>
  <Transition name="dialog-fade" appear>
    <div v-if="visible" class="dialog-overlay">
      <div class="dialog-content" @click.stop>
        <div class="dialog-header">
          <h3>milkup 新版本现已发布！</h3>
          <span class="link" @click="openReleasePage"
            >前往发布页 <i class="iconfont icon-link"></i
          ></span>
        </div>

        <!-- 进度条区域 - 固定在内容上方 -->
        <div v-if="status === 'downloading' || status === 'downloaded'" class="progress-section">
          <div class="progress-info">
            <span>{{ status === "downloaded" ? "下载完成" : "正在下载..." }}</span>
            <span>{{ progress }}%</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" :style="{ width: `${progress}%` }"></div>
          </div>
        </div>

        <div class="dialog-body">
          <h4 class="version-tag">{{ updateInfo.version }}</h4>
          <div ref="updateLogContainer" class="milkdownPreview"></div>
        </div>

        <div class="dialog-footer">
          <!-- 下载中状态显示最小化 -->
          <template v-if="status === 'downloading'">
            <button class="btn btn-secondary" @click="handleCancel">取消</button>
            <button class="btn btn-secondary" @click="handleMinimize">最小化</button>
          </template>

          <template v-else>
            <button
              class="btn btn-secondary"
              @click="handleIgnore"
              :disabled="status === 'downloaded'"
            >
              忽略本次更新
            </button>
            <button
              class="btn btn-secondary"
              @click="handleCancel"
              :disabled="status === 'downloaded'"
            >
              稍后提醒我
            </button>
            <div>
              <button v-if="status === 'idle' || status === 'error'" class="btn" @click="handleGet">
                立即更新
              </button>
              <button
                v-else-if="status === 'downloaded'"
                class="btn btn-overwrite"
                @click="handleInstall"
              >
                重启安装
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="less">
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: all 0.3s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-from .dialog-content,
.dialog-fade-leave-to .dialog-content {
  transform: translateY(-20px) scale(0.95);
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
}

.dialog-content {
  background: var(--background-color-1);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  width: 450px;
  max-width: 90vw;
  transition: transform 0.3s ease;
  border: 1px solid var(--border-color-1);
  display: flex;
  flex-direction: column;
  max-height: 80vh;
}

.dialog-header {
  padding: 20px 24px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-color-1);

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-color);
  }

  .link {
    font-size: 12px;
    color: var(--primary-color);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;

    &:hover {
      text-decoration: underline;
    }
  }
}

.progress-section {
  padding: 16px 24px;
  background: var(--background-color-2);
  border-bottom: 1px solid var(--border-color-1);
}

.progress-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-color-2);
}

.progress-bar-bg {
  width: 100%;
  height: 6px;
  background-color: var(--border-color-1);
  border-radius: 3px;
  overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  background-color: var(--primary-color);
  transition: width 0.3s ease;
}

.dialog-body {
  padding: 16px 24px;
  flex: 1;
  overflow-y: auto;
  min-height: 150px;

  h4.version-tag {
    margin: 0 0 12px 0;
    font-size: 14px;
    color: var(--text-color-1);
    background: var(--background-color-2);
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
  }

  p {
    margin: 0;
    font-size: 14px;
    color: var(--text-color-2);
    line-height: 1.5;
  }

  .milkdownPreview#updateLog {
    :deep(.ProseMirror) {
      padding: 0;
    }

    :deep(.milkdown-block-handle) {
      display: none;
    }
  }
}

.dialog-footer {
  padding: 16px 24px;
  display: flex;
  justify-content: flex-end; // Right align generally
  gap: 12px;
  background: var(--background-color-2);
  border-top: 1px solid var(--border-color-1);
  border-radius: 0 0 8px 8px;

  // Custom alignment
  div {
    margin-left: auto;
  }
  // When downloading, we have Cancel | Minimize
  // Just use flex gap
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;

  &:active {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.btn-secondary {
  background: var(--background-color-1);
  color: var(--text-color-2);
  border: 1px solid var(--border-color-1);

  &:hover {
    background: var(--hover-background-color);
    color: var(--text-color-1);
    border-color: var(--border-color-2);
  }

  &:active {
    background: var(--active-color);
    color: var(--text-color);
  }
}

.btn-overwrite {
  // margin-left: 12px;
  background: #f56565;
  color: white;

  &:hover {
    background: #e53e3e;
  }

  &:active {
    background: #c53030;
  }
}
</style>

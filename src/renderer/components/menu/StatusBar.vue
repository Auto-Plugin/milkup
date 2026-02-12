<script setup lang="ts">
import { computed, ref } from "vue";
import { toggleShowOutline } from "@/renderer/hooks/useOutline";
import useSourceCode from "@/renderer/hooks/useSourceCode";

const props = defineProps<{
  content: string;
  updateStatus?: "idle" | "downloading" | "downloaded" | "error";
  downloadProgress?: number;
  isUpdateDialogVisible?: boolean;
}>();
const emit = defineEmits<{
  (e: "restore-update"): void;
}>();

const { isShowSource, toggleSourceCode } = useSourceCode();
const mode = ref<"chars" | "lines">("chars");

const displayText = computed(() => {
  const text = props.content ?? "";
  switch (mode.value) {
    case "chars":
      return `${countMarkdownChars(text)} 字符`;
    case "lines":
      return `${countMarkdownLines(text)} 行`;
    default:
      return "";
  }
});

function handleRestore() {
  emit("restore-update");
}

function cycleMode() {
  if (mode.value === "chars") mode.value = "lines";
  else if (mode.value === "lines") mode.value = "chars";
}
function countMarkdownLines(text: string, options = { skipEmpty: true }): number {
  if (!text) return 0;
  const rawLines = text.split(/\n{2,}|<br\s*\/?>| {2}\n/g);
  if (options.skipEmpty) {
    return rawLines.filter((line) => line.trim().length > 0).length;
  }
  return rawLines.length;
}
function countMarkdownChars(text: string): number {
  const base64Regex = /data:image\/[a-zA-Z]+;base64,[a-zA-Z0-9+/=]+/g;
  return (text.replaceAll("&#x20;", "").replace(base64Regex, "image").trim() || "").split("")
    .length;
}
window.electronAPI.on("view:toggleView", () => {
  toggleSourceCode();
});
</script>

<template>
  <div class="StatusBarBox">
    <div class="left-section">
      <div>
        <span class="iconfont icon-List-outlined" @click="toggleShowOutline()"></span>
        <span
          class="iconfont"
          :class="isShowSource ? 'icon-input' : 'icon-markdown'"
          @click.stop="toggleSourceCode()"
        >
        </span>
      </div>

      <!-- Update Progress (Centered-ish or just after icons) -->
      <div
        v-if="updateStatus === 'downloading' && !isUpdateDialogVisible"
        class="update-progress-bar"
        @click="handleRestore"
        title="点击恢复下载弹窗"
      >
        <span class="iconfont icon-download"></span>
        <span>正在下载 {{ downloadProgress }}%</span>
        <div class="mini-progress-bg">
          <div class="mini-progress-fill" :style="{ width: `${downloadProgress}%` }"></div>
        </div>
      </div>
      <div
        v-else-if="updateStatus === 'downloaded' && !isUpdateDialogVisible"
        class="update-progress-bar success"
        @click="handleRestore"
      >
        <span class="iconfont icon-check-circle"></span>
        <span>下载完成，点击安装</span>
      </div>
    </div>

    <span class="statusBarText" @click="cycleMode">{{ displayText }}</span>
  </div>
</template>

<style lang="less" scoped>
.StatusBarBox {
  user-select: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-color-1);
  text-align: right;
  background: var(--background-color-2);
  display: flex;
  justify-content: space-between;
  align-items: center;

  .left-section {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  span {
    padding: 2px 8px;
    display: inline-block;

    &:hover {
      background: var(--hover-color);
    }
  }
}

.statusBarText {
  font-size: 12px;
  margin: 2px 0;
  color: var(--text-color-3);
}

.update-progress-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-color-2);
  padding: 2px 8px;
  border-radius: 4px;
  transition: background 0.2s;

  &:hover {
    background: var(--hover-color);
  }

  &.success {
    color: var(--primary-color);
  }

  .mini-progress-bg {
    width: 60px;
    height: 4px;
    background: var(--border-color-1);
    border-radius: 2px;
    overflow: hidden;
  }

  .mini-progress-fill {
    height: 100%;
    background: var(--primary-color);
    transition: width 0.3s;
  }
}
</style>

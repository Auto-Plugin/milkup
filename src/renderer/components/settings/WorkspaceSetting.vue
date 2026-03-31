<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import { Switch } from "@renderer/components/ui/switch";
import { useConfig } from "@/renderer/hooks/useConfig";
import useWorkSpace from "@/renderer/hooks/useWorkSpace";
import { isAbsoluteLocalPath } from "@/renderer/utils/workspacePath";

const { config, setConf } = useConfig();
const { watchedDirPath, openWorkSpaceByPath } = useWorkSpace();

const startupPath = computed(() => config.value.workspace?.startupPath ?? "");
const autoExpandSidebar = computed(() => config.value.workspace?.autoExpandSidebar ?? false);
const isPathExists = ref(true);

async function handleSelectWorkspace() {
  const hadStartupPath = Boolean(startupPath.value);
  const defaultPath = isAbsoluteLocalPath(startupPath.value) ? startupPath.value : undefined;
  const result = await window.electronAPI.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "选择启动时打开的工作区",
    defaultPath,
  });

  if (!result || result.canceled || result.filePaths.length === 0) return;

  const selectedPath = result.filePaths[0];

  setConf("workspace", {
    ...config.value.workspace,
    startupPath: selectedPath,
  });

  if (!hadStartupPath && !watchedDirPath.value) {
    await openWorkSpaceByPath(selectedPath);
  }
}

function clearWorkspacePath() {
  setConf("workspace", {
    ...config.value.workspace,
    startupPath: "",
  });
}

function updateAutoExpandSidebar(value: boolean) {
  setConf("workspace", {
    ...config.value.workspace,
    autoExpandSidebar: value,
  });
}

async function checkWorkspacePath() {
  if (!startupPath.value) {
    isPathExists.value = true;
    return;
  }

  isPathExists.value = await window.electronAPI.workspaceExists(startupPath.value);
}

watch(
  startupPath,
  () => {
    checkWorkspacePath();
  },
  { immediate: true }
);

onMounted(() => {
  checkWorkspacePath();
});
</script>

<template>
  <div class="WorkspaceSettingBox">
    <div class="setting-row">
      <span class="row-label">启动工作区</span>
      <div class="path-field">
        <div class="path-row">
          <div
            class="path-input"
            :class="{ empty: !startupPath, invalid: startupPath && !isPathExists }"
          >
            <AppIcon name="folder-opened" />
            <span>{{ startupPath || "未设置，软件启动时不会自动打开文件夹" }}</span>
          </div>
          <button type="button" class="action-btn" @click="handleSelectWorkspace">选择位置</button>
          <button
            v-if="startupPath"
            type="button"
            class="action-btn subtle"
            @click="clearWorkspacePath"
          >
            清除
          </button>
        </div>
        <div v-if="startupPath && !isPathExists" class="path-tip">路径不存在</div>
      </div>
    </div>

    <div class="setting-row switch-row">
      <span class="row-label">左侧边栏</span>
      <div class="switch-wrapper">
        <Switch
          :model-value="autoExpandSidebar"
          label="启动时自动展开文件夹 / 大纲栏"
          @update:model-value="updateAutoExpandSidebar"
        />
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.WorkspaceSettingBox {
  display: flex;
  flex-direction: column;
  gap: 16px;

  .setting-row {
    display: flex;
    align-items: flex-start;
    gap: 14px;

    .row-label {
      min-width: 100px;
      padding-top: 10px;
      font-size: 14px;
      color: var(--text-color-1);
      flex-shrink: 0;
    }
  }

  .path-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .path-field {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .path-input {
    flex: 1;
    min-width: 280px;
    height: 40px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    background: var(--background-color-1);
    color: var(--text-color-1);
    transition:
      border-color 0.2s ease,
      color 0.2s ease,
      background 0.2s ease;

    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &.empty {
      color: var(--text-color-3);
    }

    &.invalid {
      border-color: #d35b5b;
    }
  }

  .action-btn {
    height: 40px;
    padding: 0 14px;
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    background: var(--background-color-1);
    color: var(--text-color-1);
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
      border-color: var(--border-color-2);
      background: var(--hover-background-color);
    }

    &.subtle {
      color: var(--text-color-2);
    }
  }

  .switch-wrapper {
    padding-top: 8px;
  }

  .path-tip {
    font-size: 12px;
    line-height: 1.4;
    color: #d35b5b;
  }
}

@media (max-width: 768px) {
  .WorkspaceSettingBox {
    .setting-row {
      flex-direction: column;
      gap: 8px;

      .row-label {
        min-width: auto;
        padding-top: 0;
      }
    }

    .path-input {
      min-width: 100%;
    }

    .switch-wrapper {
      padding-top: 0;
    }
  }
}
</style>

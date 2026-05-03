<script setup lang="ts">
import { computed } from "vue";
import { Switch } from "@/renderer/components/ui/switch";
import { useConfig } from "@/renderer/hooks/useConfig";

const { config, setConf } = useConfig();

const autoSave = computed({
  get: () => config.value.other.autoSave,
  set: (value: boolean) => setConf("other", "autoSave", value),
});
</script>

<template>
  <div class="auto-save-setting">
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-title">自动保存</span>
        <span class="setting-desc">开启后会在已保存过的文件内容变更后自动写回磁盘。</span>
      </div>
      <Switch v-model="autoSave" />
    </div>
  </div>
</template>

<style lang="less" scoped>
.auto-save-setting {
  border: 1px solid var(--border-color-1);
  border-radius: 8px;
  background: var(--background-color-2);

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .setting-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
  }

  .setting-desc {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-color-2);
  }
}
</style>

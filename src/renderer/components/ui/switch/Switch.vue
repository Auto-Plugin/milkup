<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean;
  label?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
}>();

function toggle() {
  emit("update:modelValue", !props.modelValue);
}
</script>

<template>
  <div class="switch-container" @click="toggle">
    <span v-if="label" class="label">{{ label }}</span>
    <div class="switch-track" :class="{ active: modelValue }">
      <div class="switch-thumb"></div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.switch-container {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  user-select: none;

  .label {
    font-size: 14px;
    color: var(--text-color-1);
  }

  .switch-track {
    width: 44px;
    height: 24px;
    background-color: var(--background-color-2);
    border: 1px solid var(--border-color-1);
    border-radius: 12px;
    position: relative;
    transition: all 0.3s ease;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);

    &.active {
      background-color: var(--primary-color);
      border-color: var(--primary-color);

      .switch-thumb {
        transform: translateX(20px);
        background-color: #fff;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }
    }

    .switch-thumb {
      width: 20px;
      height: 20px;
      background-color: var(--text-color-2);
      border-radius: 50%;
      position: absolute;
      top: 1px;
      left: 1px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }
  }

  &:hover {
    .switch-track {
      border-color: var(--primary-color);
      &:not(.active) {
        background-color: var(--hover-background-color);
      }
    }
  }
}
</style>

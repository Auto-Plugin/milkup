<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  modelValue: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: number): void;
}>();

const sliderRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);

const min = computed(() => props.min ?? 0);
const max = computed(() => props.max ?? 100);
const step = computed(() => props.step ?? 1);

// Percentage for CSS positioning
const percentage = computed(() => {
  const range = max.value - min.value;
  const value = props.modelValue - min.value;
  return Math.min(Math.max((value / range) * 100, 0), 100);
});

function updateValue(clientX: number) {
  if (!sliderRef.value) return;

  const rect = sliderRef.value.getBoundingClientRect();
  const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const percent = x / rect.width;

  const range = max.value - min.value;
  let newValue = min.value + range * percent;

  // Snap to step
  if (step.value > 0) {
    newValue = Math.round(newValue / step.value) * step.value;
  }

  // Clamp value
  newValue = Math.max(min.value, Math.min(newValue, max.value));

  // Clean floating point errors
  newValue = Number(newValue.toPrecision(12));

  emit("update:modelValue", newValue);
}

function handleMouseDown(e: MouseEvent) {
  isDragging.value = true;
  updateValue(e.clientX);

  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);
}

function handleMouseMove(e: MouseEvent) {
  if (isDragging.value) {
    updateValue(e.clientX);
  }
}

function handleMouseUp() {
  isDragging.value = false;
  window.removeEventListener("mousemove", handleMouseMove);
  window.removeEventListener("mouseup", handleMouseUp);
}
</script>

<template>
  <div class="slider-container">
    <div class="slider-header" v-if="label">
      <span class="label">{{ label }}</span>
      <span class="value">{{ modelValue }}</span>
    </div>
    <div class="slider-track-container" ref="sliderRef" @mousedown="handleMouseDown">
      <div class="slider-track">
        <div class="slider-fill" :style="{ width: `${percentage}%` }"></div>
      </div>
      <div
        class="slider-thumb"
        :style="{ left: `${percentage}%` }"
        :class="{ dragging: isDragging }"
      ></div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.slider-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;

  .slider-header {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    color: var(--text-color-1);

    .value {
      font-family: monospace;
      background: var(--background-color-2);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
    }
  }

  .slider-track-container {
    position: relative;
    height: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;

    &:hover {
      .slider-thumb {
        transform: scale(1.1);
        border-color: var(--primary-color);
      }
    }

    .slider-track {
      width: 100%;
      height: 4px;
      background-color: var(--border-color-1);
      border-radius: 2px;
      overflow: hidden;

      .slider-fill {
        height: 100%;
        background-color: var(--primary-color);
        border-radius: 2px;
      }
    }

    .slider-thumb {
      position: absolute;
      width: 16px;
      height: 16px;
      background-color: #fff;
      border: 2px solid var(--text-color-2);
      border-radius: 50%;
      top: 50%;
      margin-top: -8px;
      margin-left: -8px;
      cursor: grab;
      transition:
        transform 0.1s,
        border-color 0.2s;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

      &.dragging {
        cursor: grabbing;
        transform: scale(1.2);
        border-color: var(--primary-color);
        box-shadow: 0 0 0 4px rgba(var(--primary-color-rgb), 0.2);
      }
    }
  }
}
</style>

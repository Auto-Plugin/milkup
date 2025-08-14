<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { SketchPicker } from 'vue-color'
import 'vue-color/style.css'

interface Props {
  modelValue: string
  disabled?: boolean
  size?: 'small' | 'medium' | 'large'
}

interface Emits {
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  size: 'medium',
})

const emit = defineEmits<Emits>()

// 响应式数据
const isOpen = ref(false)
const popup = ref<HTMLElement>()
const isMounted = ref(false)
const colorBlock = ref<HTMLElement>()
const popupPosition = ref({ top: '0px', left: '0px' })

// 计算属性
const displayColor = computed(() => {
  return props.modelValue || 'transparent'
})

const colorValue = computed({
  get: () => props.modelValue || '#000000',
  set: (value) => {
    emit('update:modelValue', value)
    emit('change', value)
  },
})

const colorBlockSize = computed(() => {
  switch (props.size) {
    case 'small': return '24px'
    case 'large': return '40px'
    default: return '32px'
  }
})

// 方法
function calculatePopupPosition() {
  if (!colorBlock.value)
    return

  const rect = colorBlock.value.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  // 弹窗的预估尺寸
  const popupWidth = 220
  const popupHeight = 320

  let left = rect.right + 8 // 默认在右侧
  let top = rect.top

  // 如果右侧空间不够，显示在左侧
  if (left + popupWidth > viewportWidth) {
    left = rect.left - popupWidth - 8
  }

  // 如果底部空间不够，向上调整
  if (top + popupHeight > viewportHeight) {
    top = Math.max(8, viewportHeight - popupHeight - 8)
  }

  // 确保不超出顶部
  if (top < 8) {
    top = 8
  }

  popupPosition.value = {
    top: `${top}px`,
    left: `${left}px`,
  }
}

function togglePicker() {
  if (props.disabled)
    return

  if (!isOpen.value) {
    // 先设置为true，然后等待DOM更新
    isOpen.value = true
    nextTick(() => {
      // 计算弹窗位置
      calculatePopupPosition()
    })
  } else {
    isOpen.value = false
  }
}

// 点击外部关闭
function handleClickOutside(e: Event) {
  if (popup.value && !popup.value.contains(e.target as Node)
    && colorBlock.value && !colorBlock.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

// 生命周期
onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  window.removeEventListener('resize', handleResize)
})

// 窗口大小变化时重新计算位置
function handleResize() {
  if (isOpen.value) {
    nextTick(() => {
      calculatePopupPosition()
    })
  }
}
</script>

<template>
  <div class="color-picker-container">
    <!-- 颜色块 -->
    <div
      ref="colorBlock"
      class="color-block"
      :class="[`size-${size}`, { disabled }]"
      :style="{
        backgroundColor: displayColor,
        width: colorBlockSize,
        height: colorBlockSize,
      }"
      @click="togglePicker"
    >
      <div class="color-preview" :style="{ backgroundColor: displayColor }"></div>
    </div>

    <!-- 浮动的颜色选择器 -->
    <div v-if="isOpen" ref="popup" class="color-picker-popup" :style="popupPosition">
      <SketchPicker
        v-model="colorValue"
      />
    </div>
  </div>
</template>

<style lang="less" scoped>
.color-picker-container {
  position: relative;
  display: inline-block;
}

.color-block {
  position: relative;
  border-radius: 6px;
  border: 2px solid var(--border-color, #ddd);
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
  overflow: hidden;
  background-image:
    linear-gradient(45deg, #ccc 25%, transparent 25%),
    linear-gradient(-45deg, #ccc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ccc 75%),
    linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: 4px 4px;
  background-position: 0 0, 0 2px, 2px -2px, -2px 0px;

  &:hover {
    border-color: var(--primary-color, #4a90e2);
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }

  &.disabled {
    cursor: not-allowed;
    opacity: 0.5;

    &:hover {
      transform: none;
      border-color: var(--border-color, #ddd);
    }
  }

  .color-preview {
    width: 100%;
    height: 100%;
    border-radius: 4px;
  }

  .picker-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: rgba(255, 255, 255, 0.8);
    background: rgba(0, 0, 0, 0.3);
    border-radius: 50%;
    padding: 2px;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  &:hover .picker-icon {
    opacity: 1;
  }

  // 尺寸变体
  &.size-small {
    .picker-icon {
      width: 8px;
      height: 8px;
      padding: 1px;

      svg {
        width: 6px;
        height: 6px;
      }
    }
  }

  &.size-large {
    .picker-icon {
      width: 16px;
      height: 16px;
      padding: 3px;

      svg {
        width: 10px;
        height: 10px;
      }
    }
  }
}

.color-picker-popup {
  position: fixed;
  z-index: 1000;
  background: var(--background-color, #fff);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  padding: 12px;
  animation: fadeInUp 0.15s ease-out;
  will-change: transform, opacity;
  transform-origin: top left;

  // 确保SketchPicker样式正确
  :deep(.sketch-picker) {
    box-shadow: none !important;
    border: none !important;
    background: transparent !important;
  }

  :deep(.sketch-picker > div) {
    border-radius: 6px;
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

// 响应式调整
@media (max-width: 768px) {
  .color-picker-popup {
    max-width: 90vw;
    max-height: 90vh;
    overflow: auto;
  }
}
</style>

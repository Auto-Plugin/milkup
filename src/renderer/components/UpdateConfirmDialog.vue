<script setup lang="ts">
import { Crepe } from '@milkdown/crepe'
import { nextTick, ref, watch } from 'vue'

interface Props {
  visible: boolean
}

interface Emits {
  (e: 'ignore'): void
  (e: 'get'): void
  (e: 'cancel'): void
}

const { visible } = defineProps<Props>()
const emit = defineEmits<Emits>()
const updateInfo = ref(JSON.parse(localStorage.getItem('updateInfo') || '{}'))

function handleIgnore() {
  emit('ignore')
}

function handleGet() {
  emit('get')
}

function handleCancel() {
  emit('cancel')
}
watch(() => visible, (newVal) => {
  if (newVal) {
    updateInfo.value = JSON.parse(localStorage.getItem('updateInfo') || '{}')
    nextTick(() => {
      const preview = new Crepe({
        root: document.querySelector('#updateLog') as HTMLElement,
        defaultValue: updateInfo.value.notes || '更新日志加载失败，请前往官网下载最新版本。',
        featureConfigs: {
          // 这里可以添加更多的配置选项
        },
      })
      preview.setReadonly(true)
      preview.create()
    })
  }
})
</script>

<template>
  <Transition name="dialog-fade" appear>
    <div v-if="visible" class="dialog-overlay">
      <div class="dialog-content" @click.stop>
        <div class="dialog-header">
          <h3>
            milkup 新版本现已发布！
          </h3>
        </div>
        <div class="dialog-body">
          <h4>{{ updateInfo.version }}</h4>
          <div id="updateLog" class="milkdownPreview"></div>
        </div>
        <div class="dialog-footer">
          <button class="btn btn-secondary" @click="handleIgnore">
            忽略本次更新
          </button>
          <button class="btn btn-secondary" @click="handleCancel">
            稍后提醒我
          </button>
          <div>
            <button class="btn " @click="handleGet">
              前往下载
            </button>
          </div>
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
  min-width: 400px;
  max-width: 500px;
  transition: transform 0.3s ease;
  border: 1px solid var(--border-color-1);
}

.dialog-header {
  padding: 20px 24px 0;

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-color);
  }
}

.dialog-body {
  padding: 0 24px;
  margin: 16px 0;
  max-height: 60vh;
  overflow-y: auto;

  p {
    margin: 0;
    font-size: 14px;
    color: var(--text-color-2);
    line-height: 1.5;
  }

  .dialog-detail {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-color-3);
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
  padding: 0 24px 20px;
  display: flex;
  justify-content: space-between;
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
}

.btn-ignore {
  margin-right: 12px;
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-color) 100%);
  color: white;

  &:hover {
    opacity: 0.8;
  }

  &:active {
    background: var(--active-color);
  }
}

.btn-secondary {
  background: var(--background-color-2);
  color: var(--text-color-3);
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
  margin-left: 12px;
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

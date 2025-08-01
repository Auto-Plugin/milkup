<script setup lang="ts">
interface Props {
  visible: boolean
}

interface Emits {
  (e: 'save'): void
  (e: 'discard'): void
  (e: 'cancel'): void
}

const { visible } = defineProps<Props>()
const emit = defineEmits<Emits>()

function handleSave() {
  emit('save')
}

function handleDiscard() {
  emit('discard')
}

function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <Transition name="dialog-fade" appear>
    <div v-if="visible" class="dialog-overlay">
      <div class="dialog-content" @click.stop>
        <div class="dialog-header">
          <h3>确认关闭</h3>
        </div>
        <div class="dialog-body">
          <p>当前文档有未保存的修改，请选择操作：</p>
        </div>
        <div class="dialog-footer">
          <button class="btn btn-secondary" @click="handleDiscard">
            丢弃
          </button>
          <div>
            <button class="btn btn-save" @click="handleSave">
              保存
            </button>
            <button class="btn btn-secondary" @click="handleCancel">
              取消
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
  background: var(--bg-color, #ffffff);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  min-width: 400px;
  max-width: 500px;
  transition: transform 0.3s ease;
}

.dialog-header {
  padding: 20px 24px 0;

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-color, #333);
  }
}

.dialog-body {
  padding: 16px 24px;

  p {
    margin: 0;
    font-size: 14px;
    color: var(--text-secondary, #666);
    line-height: 1.5;
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

.btn-save {
  margin-right: 12px;
  background: linear-gradient(135deg, #74b9ff 0%, #0984e3 100%);
  color: white;
  box-shadow: 0 2px 8px rgba(116, 185, 255, 0.3);

  &:hover {
    background: linear-gradient(135deg, #6ab0f0 0%, #0873c4 100%);
    box-shadow: 0 4px 12px rgba(116, 185, 255, 0.4);
  }

  &:active {
    background: linear-gradient(135deg, #60a7e6 0%, #0762a5 100%);
  }
}

.btn-secondary {
  background: #f8f9fa;
  color: #6c757d;
  border: 1px solid #e9ecef;

  &:hover {
    background: #e9ecef;
    color: #495057;
    border-color: #dee2e6;
  }

  &:active {
    background: #dee2e6;
    color: #343a40;
  }
}

@media (prefers-color-scheme: dark) {
  .dialog-content {
    --bg-color: #1f1f1f;
    --text-color: #ffffff;
    --text-secondary: #a0a0a0;
  }

  .btn-save {
    background: linear-gradient(135deg, #74b9ff 0%, #0984e3 100%);
    color: white;
    box-shadow: 0 2px 8px rgba(116, 185, 255, 0.3);

    &:hover {
      background: linear-gradient(135deg, #6ab0f0 0%, #0873c4 100%);
      box-shadow: 0 4px 12px rgba(116, 185, 255, 0.4);
    }

    &:active {
      background: linear-gradient(135deg, #60a7e6 0%, #0762a5 100%);
    }
  }

  .btn-secondary {
    background: #2d3748;
    color: #a0aec0;
    border: 1px solid #4a5568;

    &:hover {
      background: #4a5568;
      color: #e2e8f0;
      border-color: #718096;
    }

    &:active {
      background: #718096;
      color: #f7fafc;
    }
  }
}
</style>

<script setup lang="ts">
type DialogType = 'close' | 'overwrite'

interface Props {
  visible: boolean
  tabName?: string
  type?: DialogType
  fileName?: string
}

interface Emits {
  (e: 'save'): void
  (e: 'discard'): void
  (e: 'cancel'): void
  (e: 'overwrite'): void
}

const { visible, tabName, type = 'close', fileName } = defineProps<Props>()
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

function handleOverwrite() {
  emit('overwrite')
}
</script>

<template>
  <Transition name="dialog-fade" appear>
    <div v-if="visible" class="dialog-overlay">
      <div class="dialog-content" @click.stop>
        <div class="dialog-header">
          <h3 v-if="type === 'close'">
            确认关闭
          </h3>
          <h3 v-else-if="type === 'overwrite'">
            文件已存在
          </h3>
        </div>
        <div class="dialog-body">
          <template v-if="type === 'close'">
            <p v-if="tabName">
              文档 "{{ tabName }}" 有未保存的修改，请选择操作：
            </p>
            <p v-else>
              当前文档有未保存的修改，请选择操作：
            </p>
          </template>
          <template v-else-if="type === 'overwrite'">
            <p v-if="fileName">
              文件 "{{ fileName }}" 已存在，是否要覆盖当前内容？
            </p>
            <p v-else>
              文件已存在，是否要覆盖当前内容？
            </p>
            <p class="dialog-detail">
              选择"保存"将先保存当前内容，然后打开新文件。
            </p>
          </template>
        </div>
        <div class="dialog-footer">
          <template v-if="type === 'close'">
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
          </template>
          <template v-else-if="type === 'overwrite'">
            <button class="btn btn-secondary" @click="handleCancel">
              取消
            </button>
            <div>
              <button class="btn btn-save" @click="handleSave">
                保存
              </button>
              <button class="btn btn-overwrite" @click="handleOverwrite">
                覆盖
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
  padding: 16px 24px;

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

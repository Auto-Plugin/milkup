<script setup lang='ts'>
import autolog from 'autolog.js'
import useContent from '@/hooks/useContent'
import usefile from '@/hooks/useFile'

const { onOpen, onSave, onSaveAs } = usefile()
const { isModified } = useContent()

function onOpenFolder() {
  autolog.log('功能开发中...')
}
function exportAsPDF() {
  autolog.log('功能开发中...')
}
function exportAsHTML() {
  autolog.log('功能开发中...')
}
function exportAsDocx() {
  autolog.log('功能开发中...')
}
</script>

<template>
  <div class="FileOptionsBox">
    <div class="baseOptions optionItem">
      <span class="title">文件</span>
      <div class="buttons">
        <button @click="onOpen">
          <span class="iconfont icon-document"></span>
          <span>打开</span>
        </button>
        <button @click="onOpenFolder">
          <span class="iconfont icon-folder-opened"></span>
          <span>打开文件夹</span>
        </button>
        <button @click="onSave">
          <span v-if="!isModified" class="iconfont icon-circle-check"></span>
          <span v-else class="iconfont icon-warning-outline"></span>
          <span>{{ isModified ? '保存' : '已保存' }}</span>
        </button>
        <button @click="onSaveAs">
          <span class="iconfont icon-document-copy"></span>
          <span>另存为</span>
        </button>
      </div>
    </div>
    <div class="export optionItem">
      <span class="title">导出为</span>
      <div class="buttons">
        <button @click="exportAsPDF">
          <span class="iconfont icon-pdf"></span>
          <span>PDF</span>
        </button>
        <button @click="exportAsHTML">
          <span class="iconfont icon-html"></span>
          <span>HTML</span>
        </button>
        <button @click="exportAsDocx">
          <span class="iconfont icon-input"></span>
          <span>Word</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style lang='less' scoped>
.FileOptionsBox {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 0 10px;
  box-sizing: border-box;

  .optionItem {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;

    .title {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 10px;
      color: var(--text-color);
      user-select: none;
      width: 100%;
      text-align: left;
    }

    .buttons {
      display: flex;
      gap: 10px;
      width: 100%;
    }

    &.export {
      .buttons {
        flex-direction: column;

        button {
          justify-content: flex-start;
          width: max-content;
          min-width: 50%;

          .iconfont {
            font-size: 28px;
          }
        }
      }
    }
  }

  button {
    min-height: 120px;
    padding: 5px 10px;
    flex: 1;
    border: none;
    cursor: pointer;
    font-size: 14px;
    background: none;
    border-radius: 4px;
    transition: background-color 0.3s;
    color: var(--text-color);
    border: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background-color: var(--border-color-1);
      border-color: var(--border-color-2);
    }

    .iconfont {
      font-size: 15px;
      vertical-align: middle;
      margin-right: 5px;
    }
  }
}
</style>

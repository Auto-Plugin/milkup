<script lang="ts" setup>
import type { TreeNode } from '@ui/tree'
import { Tree } from '@ui/tree'
import useTab from '@/hooks/useTab'
import useWorkSpace from '@/hooks/useWorkSpace'

const { workSpace, setWorkSpace } = useWorkSpace()
const { currentTab, openFile } = useTab()

// 打开文件夹选择对话框
function openFolder() {
  setWorkSpace()
}

function handleNodeClick({ path }: TreeNode) {
  openFile(path)
}
</script>

<template>
  <div class="WorkSpace">
    <Tree
      v-if="workSpace"
      :nodes="workSpace"
      :current-node="currentTab ? currentTab.filePath : null"
      @node-click="handleNodeClick"
    />
    <div v-else class="empty-state">
      <p>暂无打开的工作区</p>

      <div @click="openFolder">
        选择文件夹
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.WorkSpace {
  height: 100%;
  overflow: auto; // 同时支持垂直和横向滚动
  position: relative;

  // 隐藏滚动条但保持滚动功能
  scrollbar-width: none; // Firefox
  -ms-overflow-style: none; // IE/Edge

  &::-webkit-scrollbar {
    display: none; // Chrome/Safari/Opera
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;

    p {
      color: var(--text-color-2);
      font-size: 12px;
    }

    div {
      font-size: 12px;
      line-height: 12px;
      padding: 6px 15px;
      border-radius: 5px;
      cursor: pointer;
      background: var(--primary-color);
      color: var(--background-color-2);
      transition: all 0.3s ease;
    }

  }
}
</style>

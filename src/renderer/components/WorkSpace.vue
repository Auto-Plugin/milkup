<script lang="ts" setup>
import { Tree } from '@ui/tree'
import useTab from '@/hooks/useTab'
import useWorkSpace from '@/hooks/useWorkSpace'

const { workSpace, setWorkSpace } = useWorkSpace()
const { currentTab } = useTab()

// 打开文件夹选择对话框
function openFolder() {
  setWorkSpace()
}
</script>

<template>
  <div class="WorkSpace">
    <div v-if="workSpace" class="tree-container">
      <Tree
        v-for="node in workSpace"
        :key="node.path"
        :current-tab="currentTab"
        :node="node"
        :level="0"
      />
    </div>
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

  .tree-container {
    padding: 8px 4px;
    min-width: max-content; // 确保容器宽度适应内容
    width: 100%;
    // 为横向滚动添加一些额外的内边距
    // padding-right: 20px;
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

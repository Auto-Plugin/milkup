<script lang="ts" setup>
import type { TreeNodeProps } from './types'
import { computed } from 'vue'
import { useTreeContext } from './context'

const props = defineProps<TreeNodeProps>()

const { expandedNodes, currentNode, transitionHooks, handleNodeClick } = useTreeContext()

const isExpanded = computed(() => expandedNodes.has(props.node.path))

const isSelected = computed(() => currentNode.value === props.node.path)
</script>

<template>
  <div class="tree-node">
    <!-- 当前节点 -->
    <div
      class="node-item"
      :class="{ selected: isSelected }"
      :style="{ paddingLeft: `${10}px` }"
      @click="() => handleNodeClick(node)"
    >
      <!-- 展开/折叠图标 -->
      <span
        v-if="node.isDirectory && node.children"
        class="expand-icon"
        :class="{ expanded: isExpanded }"
      >
        <span class="iconfont icon-arrow-right" :class="{ active: isExpanded }"></span>
      </span>
      <span v-else class="expand-icon-placeholder"></span>

      <!-- 文件/文件夹图标 -->
      <span class="file-icon">
        <span
          class="iconfont"
          :class="[
            { active: isExpanded },
            node.isDirectory
              ? 'icon-folder-copy' : 'icon-markdown',
          ]"
        ></span>
      </span>

      <!-- 节点名称 -->
      <span class="node-name" :class="{ active: isExpanded, selected: isSelected }">{{ node.name }}</span>
    </div>

    <!-- 子节点容器 - 左右布局 -->
    <Transition
      name="fold"
      mode="in-out"
      @before-enter="transitionHooks.onBeforeEnter"
      @enter="transitionHooks.onEnter"
      @after-enter="transitionHooks.onAfterEnter"
      @before-leave="transitionHooks.onBeforeLeave"
      @leave="transitionHooks.onLeave"
      @after-leave="transitionHooks.onAfterLeave"
    >
      <div v-if="isExpanded && node.children" class="children-container">
        <!-- 左侧竖线 -->
        <div
          class="vertical-line"
          :style="{ marginLeft: `${18}px` }"
        />
        <!-- 右侧子节点 -->
        <div class="children">
          <TreeNode
            v-for="child in node.children"
            :key="child.path"
            :node="child"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style lang="less" scoped>
.tree-node {
  .node-item {
    display: flex;
    align-items: center;
    padding: 4px 0;
    margin: 0 2px;
    cursor: pointer;
    transition: background-color 0.2s;
    border-radius: 4px;
    min-width: max-content; // 确保节点项宽度适应内容
    width: 100%;

    &:hover {
      background-color: rgba(0, 0, 0, 0.05);
    }

    &.selected {
      background-color: var(--active-color);
    }

    .expand-icon {
      display: inline-block;
      width: 16px;
      height: 16px;
      line-height: 16px;
      text-align: center;
      font-size: 10px;
      transition: transform 0.2s;
      user-select: none;
      color: var(--text-color-3);
      margin-right: 6px;
      flex-shrink: 0;

      &.expanded {
        transform: rotate(90deg);
      }

      .iconfont {
        &.active {
          color: var(--text-color-1);
        }
      }
    }

    .expand-icon-placeholder {
      display: inline-block;
      width: 16px;
      height: 16px;
      margin-right: 6px;
      user-select: none;
      flex-shrink: 0;
    }

    .file-icon {
      display: inline-block;
      width: 18px;
      height: 18px;
      margin-right: 2px;
      font-size: 14px;
      color: var(--text-color-3);
      flex-shrink: 0;

      .iconfont {
        &.active {
          color: var(--text-color-1);
        }
      }
    }

    .node-name {
      flex: 1;
      font-size: 12px;
      color: var(--text-color-2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      user-select: none;
      transition: color 0.2s;

      &.active {
        color: var(--text-color-1);
      }

      &.selected {
        color: var(--text-color-1);

      }
    }
  }

  // 子节点容器 - 左右布局
  .children-container {
    display: flex;
    position: relative;
    transition: all 0.3s cubic-bezier(0.230, 1.000, 0.320, 1.000);
  }

  // 左侧竖线
  .vertical-line {
    width: 1px;
    background-color: var(--hover-color);
    flex-shrink: 0;
  }

  // 右侧子节点容器
  .children {
    flex: 1;
    position: relative;
  }

}
</style>

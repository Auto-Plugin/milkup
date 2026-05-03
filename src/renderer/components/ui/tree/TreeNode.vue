<script lang="ts" setup>
import type { TreeNodeProps } from "./types";
import { computed, nextTick, ref, watch } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import { useTreeContext } from "./context";

const props = defineProps<TreeNodeProps>();

const {
  expandedNodes,
  currentNode,
  editingPath,
  transitionHooks,
  handleNodeClick,
  handleNodeContextMenu,
  handleEditConfirm,
  handleEditCancel,
} = useTreeContext();

const isExpanded = computed(() => expandedNodes.has(props.node.path));

const isSelected = computed(() => currentNode.value === props.node.path);

const isEditing = computed(() => editingPath.value === props.node.path);

const isImageFile = computed(
  () => !props.node.isDirectory && /\.(?:png|jpe?g|gif|webp|svg|bmp)$/i.test(props.node.name)
);

const editInputRef = ref<HTMLInputElement | null>(null);
const editValue = ref("");

watch(isEditing, (val) => {
  if (val) {
    // 初始化编辑值：文件去掉扩展名，文件夹显示全名
    if (props.node.isDirectory) {
      editValue.value = props.node.name;
    } else {
      const lastDot = props.node.name.lastIndexOf(".");
      editValue.value = lastDot > 0 ? props.node.name.substring(0, lastDot) : props.node.name;
    }
    nextTick(() => {
      editInputRef.value?.focus();
      editInputRef.value?.select();
    });
  }
});

function onEditKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    confirmEdit();
  } else if (e.key === "Escape") {
    e.preventDefault();
    handleEditCancel(props.node);
  }
}

function confirmEdit() {
  const trimmed = editValue.value.trim();
  if (!trimmed) {
    handleEditCancel(props.node);
    return;
  }
  // 如果是文件，自动补回扩展名
  let finalName = trimmed;
  if (!props.node.isDirectory) {
    const lastDot = props.node.name.lastIndexOf(".");
    const ext = lastDot > 0 ? props.node.name.substring(lastDot) : ".md";
    if (!finalName.endsWith(ext)) {
      finalName += ext;
    }
  }
  handleEditConfirm(props.node, finalName);
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  handleNodeContextMenu(props.node, e);
}
</script>

<template>
  <div class="tree-node">
    <!-- 当前节点 -->
    <div
      class="node-item"
      :class="{ selected: isSelected }"
      :style="{ paddingLeft: `${10}px` }"
      @click="() => handleNodeClick(node)"
      @contextmenu="onContextMenu"
    >
      <!-- 展开/折叠图标 -->
      <span
        v-if="node.isDirectory && node.children"
        class="expand-icon"
        :class="{ expanded: isExpanded }"
      >
        <AppIcon name="arrow-right" :class="{ active: isExpanded }" />
      </span>
      <span v-else class="expand-icon-placeholder"></span>

      <!-- 文件/文件夹图标 -->
      <span class="file-icon">
        <AppIcon
          :name="node.isDirectory ? 'folder-copy' : isImageFile ? 'image' : 'markdown'"
          :class="{ active: isExpanded }"
        />
      </span>

      <!-- 节点名称 / 编辑输入框 -->
      <input
        v-if="isEditing"
        ref="editInputRef"
        v-model="editValue"
        class="node-edit-input"
        @keydown="onEditKeydown"
        @blur="confirmEdit"
        @click.stop
      />
      <span v-else class="node-name" :class="{ active: isExpanded, selected: isSelected }">{{
        node.name
      }}</span>
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
        <div class="vertical-line" :style="{ marginLeft: `${18}px` }" />
        <!-- 右侧子节点 -->
        <div class="children">
          <TreeNode v-for="child in node.children" :key="child.path" :node="child" />
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

      svg {
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

      svg {
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

    .node-edit-input {
      flex: 1;
      font-size: 12px;
      color: var(--text-color-1);
      background: var(--background-color-2);
      border: 1px solid var(--primary-color);
      border-radius: 3px;
      padding: 1px 4px;
      outline: none;
      min-width: 60px;
      max-width: 200px;
    }
  }

  // 子节点容器 - 左右布局
  .children-container {
    display: flex;
    position: relative;
    transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
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

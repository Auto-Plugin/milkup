<script lang="ts" setup>
import type { TreeEmits, TreeNode as TreeNodeType, TreeProps } from './types'
import { computed } from 'vue'
import { useTreeState } from '@/renderer/hooks/useTreeState'
import { transitionEffects } from '@/renderer/utils/heightTransition'
import { providerTreeContext } from './context'
import TreeNode from './TreeNode.vue'

const props = defineProps<TreeProps>()

const emits = defineEmits<TreeEmits>()

/**
 * 这里本应是 const expandedNodes = reactive<Set<string>>(new Set())
 * 但是由于 WorkSpace 组件总会意外地重新渲染，状态总是被重置
 * 所以这里使用 `useTreeState` 来管理展开状态
 */
const { expandedNodes } = useTreeState()

const currentNode = computed(() => props.currentNode)

function toggleNodeExpanded(path: string) {
  if (expandedNodes.has(path)) {
    expandedNodes.delete(path)
  } else {
    expandedNodes.add(path)
  }
}

function clearExpandedNodes() {
  expandedNodes.clear()
}

function handleNodeClick(node: TreeNodeType) {
  const isDirectory = node.isDirectory

  if (!isDirectory) {
    emits('nodeClick', node)
    return
  }

  if (node.isDirectory && node.children) {
    toggleNodeExpanded(node.path)
  }
}

providerTreeContext({
  transitionHooks: transitionEffects.blurScale,
  currentNode,
  expandedNodes,
  toggleNodeExpanded,
  clearExpandedNodes,
  handleNodeClick,
})
</script>

<template>
  <div class="tree-container" :class="props.class">
    <TreeNode
      v-for="node in props.nodes"
      :key="node.path"
      :node="node"
      :level="0"
    />
  </div>
</template>

<style lang="less" scoped>
.tree-container {
  padding: 8px 4px;
  min-width: max-content;
  width: 100%;
}
</style>

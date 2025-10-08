import type { Tab } from '@/types/tab'
import { computed, reactive, ref } from 'vue'
import useTab from '@/hooks/useTab'
import { transitionEffects } from '@/utils/heightTransition'

// 树节点接口
export interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileTreeNode[]
}

// 树节点组件属性接口
export interface FileTreeProps {
  node: FileTreeNode
  level?: number
  currentTab: Tab | null
}

// 全局的树节点展开状态管理
const expandedNodes = reactive<Set<string>>(new Set())

// 切换节点展开状态
function toggleNodeExpanded(nodePath: string) {
  if (expandedNodes.has(nodePath)) {
    expandedNodes.delete(nodePath)
  } else {
    expandedNodes.add(nodePath)
  }
}

// 检查节点是否展开
function isNodeExpanded(nodePath: string): boolean {
  return expandedNodes.has(nodePath)
}

// 设置节点展开状态
function setNodeExpanded(nodePath: string, expanded: boolean) {
  if (expanded) {
    expandedNodes.add(nodePath)
  } else {
    expandedNodes.delete(nodePath)
  }
}

// 清空所有展开状态
function clearExpandedNodes() {
  expandedNodes.clear()
}

// 树节点逻辑管理
export function useTreeNode(props: FileTreeProps) {
  const { openFile } = useTab()

  // 子节点容器引用
  const childrenContainer = ref<HTMLElement>()

  // 使用全局状态管理展开状态
  const isExpanded = computed(() => isNodeExpanded(props.node.path))

  // 是否被选中
  const isSelected = computed(() => {
    return props.currentTab && props.currentTab.filePath === props.node.path
  })

  // 切换展开状态
  function toggleExpanded() {
    if (props.node.isDirectory && props.node.children) {
      toggleNodeExpanded(props.node.path)
    }
  }

  // 使用预定义的过渡效果
  const transitionHooks = transitionEffects.blurScale

  // 点击节点
  async function handleNodeClick() {
    if (props.node.isDirectory) {
      toggleExpanded()
    } else {
      // 处理文件点击，打开文件
      await openFile(props.node.path)
    }
  }

  return {
    childrenContainer,
    isExpanded,
    isSelected,
    toggleExpanded,
    transitionHooks,
    handleNodeClick,
  }
}

// 基础状态管理
export function useTreeState() {
  return {
    expandedNodes,
    toggleNodeExpanded,
    isNodeExpanded,
    setNodeExpanded,
    clearExpandedNodes,
  }
}

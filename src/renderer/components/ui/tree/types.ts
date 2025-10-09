import type { HTMLAttributes } from 'vue'

// 树节点接口
export interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: TreeNode[]
}

// 树节点组件属性接口
export interface TreeNodeProps {
  node: TreeNode
}

export interface TreeProps {
  nodes: TreeNode[] | null
  currentNode: string | null
  class?: HTMLAttributes['class']
}

export interface TreeEmits {
  (e: 'nodeClick', node: TreeNode): void
}

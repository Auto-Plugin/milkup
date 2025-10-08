// 树节点接口
export interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: TreeNode[]
}

// 树节点组件属性接口
export interface TreeProps {
  node: TreeNode
  level?: number
}

export interface TreeEmits {
  (e: 'nodeClick', node: TreeNode): void
}

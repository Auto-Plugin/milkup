import type { ComputedRef, Reactive } from 'vue'
import type { TreeNode } from './types'
import type { TransitionEffect } from '@/utils/heightTransition'
import { createContext } from '@renderer/hooks/createContext'

export interface TreeContext {
  expandedNodes: Reactive<Set<string>>
  currentNode: ComputedRef<string | null>
  transitionHooks: TransitionEffect
  toggleNodeExpanded: (path: string) => void
  clearExpandedNodes: () => void
  handleNodeClick: (node: TreeNode) => void
}

export const [useTreeContext, providerTreeContext] = createContext<TreeContext>('Tree')

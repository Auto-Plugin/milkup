import { ref } from 'vue'

// const { tabs,currentTab } = useTab()

interface WorkSpace {
  id: string
  name: string
  path: string
  type: 'file' | 'directory'
}

const workSpace = ref<WorkSpace | null>(null)

// const

function useWorkSpace() {
  return {
    workSpace,
  }
}

export default useWorkSpace

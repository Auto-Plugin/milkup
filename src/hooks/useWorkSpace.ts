import autolog from 'autolog.js'
import { ref, watch } from 'vue'
import useTab from './useTab'

const { tabs, currentTab } = useTab()

let isLoadWorkSpace = false// 是否已经加载文件目录 标识
const isLoading = ref(false)// 文件目录加载中

interface WorkSpace {
  name: string
  path: string
  isDirectory: boolean
  children?: WorkSpace[]
}

const workSpace = ref<WorkSpace[] | null>(null)

async function getWorkSpace() {
  if (isLoadWorkSpace)
    return
  if (isLoading.value)
    return

  // 从tab中寻找是否有真实path得文件
  const realFile = tabs.value.find(tab => tab.filePath)

  if (!realFile || !realFile.filePath)
    return

  // 获取文件所在的目录路径
  const directoryPath = realFile.filePath.replace(/[^/\\]+$/, '')

  try {
    isLoading.value = true

    const result = await window.electronAPI.getDirectoryFiles(directoryPath)

    if (!result)
      return
    if (!result.length)
      return

    // 已加载 cnm
    isLoadWorkSpace = true
    // 更新工作区信息
    workSpace.value = result

    console.log('✅ 获取到的目录文件结果:', workSpace.value)
  } catch (error) {
    autolog.log('获取目录文件失败:', 'error')
  } finally {
    isLoading.value = false
  }
}

// 监听tabs的变化
watch(
  () => tabs.value,
  () => {
    getWorkSpace()
  },
  {
    deep: true,
  },
)

// 监听当前选中得tab
watch(
  () => currentTab.value,
  () => {
    // getWorkSpace()
  },
)

function useWorkSpace() {
  return {
    workSpace,
  }
}

export default useWorkSpace

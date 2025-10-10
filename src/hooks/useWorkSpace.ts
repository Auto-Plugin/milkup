import toast from 'autotoast.js'
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

// 获取文件夹
async function getWorkSpace() {
  if (isLoadWorkSpace)
    return
  if (isLoading.value)
    return

  // 是否有真实path得文件
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
    // 更新文件夹信息
    workSpace.value = result
  } catch {
    toast.show('获取目录文件失败:', 'error')
  } finally {
    isLoading.value = false
  }
}

// 打开选择文件夹对话框
async function setWorkSpace() {
  try {
    const result = await window.electronAPI.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择文件夹文件夹',
    })

    if (result && !result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]

      isLoadWorkSpace = false
      workSpace.value = null

      // 获取选择的文件夹内容
      const directoryFiles = await window.electronAPI.getDirectoryFiles(selectedPath)

      if (directoryFiles && directoryFiles.length > 0) {
        workSpace.value = directoryFiles
        isLoadWorkSpace = true
      }
    }
  } catch {
    toast.show('获取目录文件失败:', 'error')
  }
}

// 监听tabs
watch(
  () => tabs.value,
  (newTabs) => {
    // 只有在从无到有时才重新加载文件夹
    const hasRealFile = newTabs.some(tab => tab.filePath)
    if (hasRealFile && !isLoadWorkSpace) {
      getWorkSpace()
    }
  },
  {
    deep: true,
  },
)

// 监听当前选中得tab
watch(
  () => currentTab.value,
  () => { },
)

function useWorkSpace() {
  return {
    workSpace,
    setWorkSpace,
  }
}

export default useWorkSpace

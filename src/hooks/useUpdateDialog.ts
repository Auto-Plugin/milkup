import autotoast from 'autotoast.js'
import { ref } from 'vue'

export function useUpdateDialog() {
  const isDialogVisible = ref(false)
  const updateInfo = JSON.parse(localStorage.getItem('updateInfo') || '{}')

  function showDialog() {
    isDialogVisible.value = true
  }
  function hideDialog() {
    isDialogVisible.value = false
  }
  function handleIgnore() {
    const version = updateInfo.version || ''
    hideDialog()
    localStorage.setItem('ignoredVersion', version)
  }
  function handleUpdate() {
    const downloadUrl = updateInfo.url || ''
    if (!downloadUrl) {
      console.error('No download URL available for update.')
      autotoast.show('无法获取下载链接', 'error')
      return
    }
    // 打开浏览器下载页面
    window.electronAPI.openExternal(downloadUrl)
    hideDialog()
  }
  function handleLater() {
    hideDialog()
  }
  return {
    isDialogVisible,
    showDialog,
    hideDialog,
    handleIgnore,
    handleUpdate,
    handleLater,
  }
}

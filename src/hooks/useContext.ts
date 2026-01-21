import { nextTick, onUnmounted, ref } from 'vue'
import emitter from '../renderer/events'
import useContent from './useContent'
import useFile from './useFile'
import { useSaveConfirmDialog } from './useSaveConfirmDialog'
import useTab from './useTab'
import useTheme from './useTheme'
import { useUpdateDialog } from './useUpdateDialog'

/**
 * useContext - 应用级事件协调器
 *
 * 职责：
 * - 监听和处理IPC事件（close:confirm, trigger-save, custom-theme-saved）
 * - 监听和处理emitter事件（file:overwrite-confirm, tab:close-confirm, update:available等）
 * - 协调跨hooks的复杂交互（如关闭应用时的多tab保存流程）
 *
 * 注意：
 * - 不应该重新暴露其他hooks的状态和方法
 * - App.vue应该直接使用各个hooks获取所需的状态
 */
export function useContext() {
  // 只获取协调所需的hooks功能
  const { markdown, originalContent } = useContent()
  const { onSave } = useFile()
  const { close, switchToTab, saveCurrentTab, activeTabId, getUnsavedTabs, currentTab } = useTab()
  const { showDialog, showOverwriteDialog, showFileChangedDialog } = useSaveConfirmDialog()
  const { showDialog: showUpdateDialog } = useUpdateDialog()

  // useContext自己的状态（编辑器重建控制）
  const isShowEditors = ref(true)
  const pendingCloseTab = ref<{ tabId: string, tabName: string, isLastTab?: boolean } | null>(null)

  // 处理应用关闭时的多tab保存确认
  async function handleAppCloseConfirm() {
    const unsavedTabs = getUnsavedTabs()

    if (unsavedTabs.length === 0) {
      window.electronAPI.closeDiscard()
      return
    }

    for (const tab of unsavedTabs) {
      if (tab.id !== activeTabId.value) {
        switchToTab(tab.id)
        await nextTick()
      }

      const result = await showDialog(tab.name)

      if (result === 'save') {
        const saved = await saveCurrentTab()
        if (!saved)
          return
      } else if (result === 'cancel') {
        return
      }
    }

    window.electronAPI.closeDiscard()
  }

  // 处理tab关闭保存
  async function handleTabCloseSave() {
    if (!pendingCloseTab.value)
      return

    const { tabId, isLastTab } = pendingCloseTab.value

    if (tabId !== activeTabId.value) {
      switchToTab(tabId)
      await nextTick()
    }

    const saved = await saveCurrentTab()
    if (saved) {
      if (isLastTab) {
        window.electronAPI.closeDiscard()
      } else {
        close(tabId)
      }
    }
  }

  // 处理tab关闭丢弃
  function handleTabCloseDiscard() {
    if (!pendingCloseTab.value)
      return

    const { tabId, isLastTab } = pendingCloseTab.value

    if (isLastTab) {
      window.electronAPI.closeDiscard()
    } else {
      close(tabId)
    }
  }

  // 重建Milkdown编辑器
  function reBuildMilkdown() {
    isShowEditors.value = false
    nextTick(() => {
      isShowEditors.value = true
    })
  }

  // === 事件监听（核心职责） ===

  // IPC事件监听
  const handleCloseConfirm = async () => {
    await handleAppCloseConfirm()
  }

  const handleTriggerSave = async () => {
    await onSave()
  }

  const handleCustomThemeSaved = (theme: any) => {
    const { setTheme } = useTheme()
    setTheme(theme.name)
  }

  window.electronAPI.on('close:confirm', handleCloseConfirm)
  window.electronAPI.on('trigger-save', handleTriggerSave)
  window.electronAPI.on('custom-theme-saved', handleCustomThemeSaved)

  // emitter事件监听
  const handleFileChange = () => {
    if (currentTab.value) {
      markdown.value = currentTab.value.content
      originalContent.value = currentTab.value.originalContent
    }
    reBuildMilkdown()
  }

  const handleTabSwitch = (tab: any) => {
    if (tab) {
      markdown.value = tab.content
    }
  }

  const handleFileOverwriteConfirm = async (data: { fileName: string, resolver: (choice: 'cancel' | 'save' | 'overwrite') => void }) => {
    const result = await showOverwriteDialog(data.fileName)
    data.resolver(result)
  }

  const handleFileChangedConfirm = async (data: { fileName: string, resolver: (choice: 'cancel' | 'overwrite') => void }) => {
    const result = await showFileChangedDialog(data.fileName)
    data.resolver(result)
  }

  const handleTabCloseConfirm = async (data: { tabId: string, tabName: string, isLastTab?: boolean }) => {
    pendingCloseTab.value = data
    const result = await showDialog(data.tabName)

    if (result === 'save') {
      await handleTabCloseSave()
    } else if (result === 'discard') {
      handleTabCloseDiscard()
    }

    pendingCloseTab.value = null
  }

  const handleUpdateAvailable = (updateInfo: any) => {
    const ignoredVersion = localStorage.getItem('ignoredVersion') || ''
    if (updateInfo.version === ignoredVersion) {
      return
    }
    localStorage.setItem('updateInfo', JSON.stringify(updateInfo))
    showUpdateDialog()
  }

  emitter.on('file:Change', handleFileChange)
  emitter.on('tab:switch', handleTabSwitch)
  emitter.on('file:overwrite-confirm', handleFileOverwriteConfirm)
  emitter.on('file:changed-confirm', handleFileChangedConfirm)
  emitter.on('tab:close-confirm', handleTabCloseConfirm)
  emitter.on('update:available', handleUpdateAvailable)

  // 清理事件监听器
  onUnmounted(() => {
    // 清理IPC监听器
    window.electronAPI?.removeListener?.('close:confirm', handleCloseConfirm)
    window.electronAPI?.removeListener?.('trigger-save', handleTriggerSave)
    window.electronAPI?.removeListener?.('custom-theme-saved', handleCustomThemeSaved)

    // 清理emitter监听器
    emitter.off('file:Change', handleFileChange)
    emitter.off('tab:switch', handleTabSwitch)
    emitter.off('file:overwrite-confirm', handleFileOverwriteConfirm)
    emitter.off('file:changed-confirm', handleFileChangedConfirm)
    emitter.off('tab:close-confirm', handleTabCloseConfirm)
    emitter.off('update:available', handleUpdateAvailable)
  })

  // ✅ 只暴露useContext自己的状态，不重复暴露其他hooks的内容
  return {
    isShowEditors,
    reBuildMilkdown,
  }
}

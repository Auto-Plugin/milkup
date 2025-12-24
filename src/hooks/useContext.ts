import { nextTick, ref, watch } from 'vue'
import { closeDiscard, on as onIpc } from '@/renderer/services'
import emitter from '../renderer/events'
import useContent from './useContent'
import useFile from './useFile'
import useFont from './useFont'
import useOtherConfig from './useOtherConfig'
import { isShowOutline } from './useOutline'
import { useSaveConfirmDialog } from './useSaveConfirmDialog'
import useSourceCode from './useSourceCode'
import useSpellCheck from './useSpellCheck'
import useTab from './useTab'
import useTheme from './useTheme'
import useTitle from './useTitle'
import { useUpdateDialog } from './useUpdateDialog'

export function useContext() {
  // 初始化所有hooks
  const { updateTitle } = useTitle()
  const { markdown, originalContent } = useContent()
  const { currentTheme, init: initTheme } = useTheme()
  const { init: initFont, currentFont } = useFont()
  const { init: initOtherConfig } = useOtherConfig()
  const { isShowSource } = useSourceCode()
  const { isDialogVisible, dialogType, fileName, tabName, showDialog, showOverwriteDialog, showFileChangedDialog, handleSave, handleDiscard, handleCancel, handleOverwrite } = useSaveConfirmDialog()
  const { isDialogVisible: isUpdateDialogVisible, showDialog: showUpdateDialog, hideDialog: hideUpdateDialog, handleIgnore, handleLater, handleUpdate } = useUpdateDialog()
  const { onSave } = useFile()
  const { close, switchToTab, saveCurrentTab, activeTabId, getUnsavedTabs, shouldOffsetTabBar, currentTab } = useTab()

  useSpellCheck()// spell check
  initTheme()// 主题
  initFont()// 字体
  initOtherConfig()// 其他配置

  // 响应式状态
  const isShowEditors = ref(true)
  const pendingCloseTab = ref<{ tabId: string, tabName: string, isLastTab?: boolean } | null>(null)

  // 监听markdown变化，更新标题
  watch(markdown, () => {
    updateTitle()
  })

  // 监听主题、源码模式、字体变化，重建编辑器
  watch([currentTheme, isShowSource, currentFont], () => {
    // reBuildMilkdown()
  }, {
    deep: true,
  })

  // 监听文件变化事件
  emitter.on('file:Change', () => {
    if (currentTab.value) {
      markdown.value = currentTab.value.content
      originalContent.value = currentTab.value.originalContent
    }
    reBuildMilkdown()
  })

  // 监听tab切换事件，同步编辑器内容
  emitter.on('tab:switch', (tab: any) => {
    if (tab) {
      // 更新编辑器内容为切换到的tab的内容
      markdown.value = tab.content
    }
  })

  // 处理应用关闭时的多tab保存确认
  async function handleAppCloseConfirm() {
    const unsavedTabs = getUnsavedTabs()

    if (unsavedTabs.length === 0) {
      // 没有未保存的tab，直接关闭
      closeDiscard()
      return
    }

    // 依次处理每个未保存的tab
    for (const tab of unsavedTabs) {
      // 切换到该tab
      if (tab.id !== activeTabId.value) {
        switchToTab(tab.id)
        // 等待切换完成
        await nextTick()
      }

      // 显示保存确认对话框
      const result = await showDialog(tab.name)

      if (result === 'save') {
        // 保存当前tab
        const saved = await saveCurrentTab()
        if (!saved) {
          // 保存失败，取消关闭操作
          return
        }
      } else if (result === 'cancel') {
        // 用户取消，停止关闭操作
        return
      }
      // result === 'discard' 时，继续处理下一个tab
    }

    // 所有tab都处理完成，关闭应用
    closeDiscard()
  }

  // 监听关闭确认事件
  onIpc('close:confirm', async () => {
    await handleAppCloseConfirm()
  })

  // 监听保存触发事件
  onIpc('trigger-save', async () => {
    await onSave()
  })

  // 监听自定义主题保存事件
  onIpc('custom-theme-saved', (theme) => {
    // 重新获取主题列表以包含新保存的主题
    const { setTheme } = useTheme()
    setTheme(theme.name)
  })

  // 监听文件覆盖确认事件
  emitter.on('file:overwrite-confirm', async (data: { fileName: string, resolver: (choice: 'cancel' | 'save' | 'overwrite') => void }) => {
    const result = await showOverwriteDialog(data.fileName)
    data.resolver(result)
  })

  // 监听文件变动确认事件
  emitter.on('file:changed-confirm', async (data: { fileName: string, resolver: (choice: 'cancel' | 'overwrite') => void }) => {
    const result = await showFileChangedDialog(data.fileName)
    data.resolver(result)
  })

  // 监听tab关闭确认事件
  emitter.on('tab:close-confirm', async (data: { tabId: string, tabName: string, isLastTab?: boolean }) => {
    pendingCloseTab.value = data
    const result = await showDialog(data.tabName)

    if (result === 'save') {
      // 保存并关闭tab
      await handleTabCloseSave()
    } else if (result === 'discard') {
      // 直接关闭tab
      handleTabCloseDiscard()
    }
    // cancel 情况下什么都不做

    pendingCloseTab.value = null
  })

  // 监听更新可用事件
  emitter.on('update:available', (updateInfo) => {
    const ignoredVersion = localStorage.getItem('ignoredVersion') || ''
    if (updateInfo.version === ignoredVersion) {
      // 如果用户忽略了这个版本，则不显示更新对话框
      return
    }
    localStorage.setItem('updateInfo', JSON.stringify(updateInfo))
    showUpdateDialog()
  })

  // 处理tab关闭保存
  async function handleTabCloseSave() {
    if (!pendingCloseTab.value)
      return

    const { tabId, isLastTab } = pendingCloseTab.value

    // 如果不是当前活跃tab，需要先切换到该tab
    if (tabId !== activeTabId.value) {
      switchToTab(tabId)
      // 等待切换完成
      await nextTick()
    }

    // 保存当前tab
    const saved = await saveCurrentTab()
    if (saved) {
      // 保存成功
      if (isLastTab) {
        // 如果是最后一个tab，关闭应用
        closeDiscard()
      } else {
        // 否则关闭tab
        close(tabId)
      }
    }
    // 如果保存失败，不关闭tab
  }

  // 处理tab关闭丢弃
  function handleTabCloseDiscard() {
    if (!pendingCloseTab.value)
      return

    const { tabId, isLastTab } = pendingCloseTab.value

    if (isLastTab) {
      // 如果是最后一个tab，关闭应用
      closeDiscard()
    } else {
      // 否则关闭tab
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

  return {
    // 状态
    markdown,
    currentTheme,
    currentFont,
    isShowSource,
    isShowOutline,
    isDialogVisible,
    dialogType,
    fileName,
    tabName,
    isShowEditors,
    pendingCloseTab,
    activeTabId,
    shouldOffsetTabBar,
    isUpdateDialogVisible,
    currentTab,

    // 方法
    updateTitle,
    onSave,
    close,
    switchToTab,
    saveCurrentTab,
    showDialog,
    showOverwriteDialog,
    handleSave,
    handleDiscard,
    handleCancel,
    handleOverwrite,
    handleTabCloseSave,
    handleTabCloseDiscard,
    handleAppCloseConfirm,
    reBuildMilkdown,
    showUpdateDialog,
    hideUpdateDialog,
    handleIgnore,
    handleLater,
    handleUpdate,
  }
}

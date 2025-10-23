import type { Tab } from '@/types/tab'
// useFile.ts
import { nextTick, onUnmounted } from 'vue'
import { processImagePaths } from '@/plugins/imagePathPlugin'
import emitter from '@/renderer/events'
import useContent from './useContent'
import useTab from './useTab'
import useTitle from './useTitle'

const { updateTitle } = useTitle()
const { markdown, filePath, originalContent } = useContent()
const {
  updateCurrentTabFile,
  createTabFromFile,
  createNewTab,
  switchToTab,
  updateCurrentTabContent,
  updateCurrentTabScrollRatio,
  saveCurrentTab,
  currentTab,
  hasUnsavedTabs,
  tabs,
} = useTab()

type OpenedFileResult = { filePath: string, content: string, isReadOnly: boolean }

async function onOpen(result?: OpenedFileResult | null) {
  if (!result) {
    result = await window.electronAPI.openFile()
  }

  if (result) {
    // 创建新tab
    const tab = await createTabFromFile(result.filePath, result.content, { isReadOnly: result.isReadOnly })

    // 更新当前内容状态
    filePath.value = result.filePath
    markdown.value = tab.content
    originalContent.value = result.content

    updateTitle()
    nextTick(() => {
      emitter.emit('file:Change')
    })
  }
}

async function onSave() {
  // 先更新当前tab的内容
  updateCurrentTabContent(markdown.value)

  // 保存当前tab
  const saved = await saveCurrentTab()
  if (saved) {
    filePath.value = currentTab.value?.filePath || ''
    originalContent.value = markdown.value
    updateTitle()
  }
  return saved
}

async function onSaveAs() {
  // 先更新当前tab的内容
  updateCurrentTabContent(markdown.value)

  const result = await window.electronAPI.saveFileAs(markdown.value)
  if (result) {
    // 更新当前tab的文件路径
    if (currentTab.value) {
      currentTab.value.filePath = result.filePath
      currentTab.value.name = result.filePath.split(/[\\/]/).at(-1) || 'Untitled'
      currentTab.value.originalContent = markdown.value
      currentTab.value.isModified = false
      currentTab.value.isReadOnly = false
    }

    filePath.value = result.filePath
    originalContent.value = markdown.value
    updateTitle()
  }
}

// ✅ 注册事件：只执行一次（确保是单例）
let hasRegistered = false
function registerMenuEventsOnce() {
  if (hasRegistered)
    return
  hasRegistered = true

  window.electronAPI?.onOpenFileAtLaunch?.(async ({ filePath: launchFilePath, content, isReadOnly }) => {
    // 创建新tab
    const tab = await createTabFromFile(launchFilePath, content, { isReadOnly })

    // 更新当前内容状态
    markdown.value = tab.content
    filePath.value = launchFilePath
    originalContent.value = content

    updateTitle()
    nextTick(() => {
      emitter.emit('file:Change')
    })
  })

  window.electronAPI.on?.('menu-open', onOpen)
  window.electronAPI.on?.('menu-save', onSave)

  // 拖拽打开 Markdown 文件
  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()

    const files = Array.from(event.dataTransfer?.files ?? [])

    if (files.length === 0)
      return

    // 查找 Markdown 文件
    const mdFile = files.find(f => /\.(?:md|markdown)$/i.test(f.name))

    if (!mdFile)
      return

    // 检查当前是否有未保存的内容
    let userChoice: 'cancel' | 'save' | 'overwrite' | null = null

    if (hasUnsavedTabs.value) {
      // 先检查要拖入的文件是否已经在某个tab中打开
      const isFileAlreadyOpen = tabs.value.some(tab =>
        tab.name === mdFile.name
        || (tab.filePath && tab.filePath.endsWith(mdFile.name)),
      )

      // 只有当文件真的已经打开过时，才显示覆盖确认
      if (isFileAlreadyOpen) {
        userChoice = await new Promise<'cancel' | 'save' | 'overwrite'>((resolve) => {
          emitter.emit('file:overwrite-confirm', {
            fileName: mdFile.name,
            resolver: resolve,
          })
        })

        if (userChoice === 'cancel') {
          // 用户选择取消
          return
        } else if (userChoice === 'save') {
          // 用户选择保存当前内容
          try {
            await onSave()
          } catch (error) {
            console.error('保存当前文件失败:', error)
            return // 如果保存失败，不继续打开新文件
          }
        }
        // userChoice === 'overwrite' 表示覆盖当前内容，直接继续执行
      }
    }

    try {
      // 尝试获取文件的完整路径
      let fullPath: string | null = null

      try {
        // 使用 webUtils.getPathForFile 方法
        const pathResult = window.electronAPI.getPathForFile(mdFile)
        fullPath = pathResult || null
      } catch (error) {
      }

      if (!fullPath) {
        const electronFile = mdFile as any
        if (electronFile.path) {
          fullPath = electronFile.path
        }
      }

      if (fullPath) {
        const result = await window.electronAPI.readFileByPath(fullPath)
        if (result) {
          if (userChoice === 'overwrite') {
            // 覆盖更新当前tab的文件信息
            const processedContent = await processImagePaths(result.content, result.filePath)
            updateCurrentTabFile(result.filePath, processedContent, undefined, { isReadOnly: result.isReadOnly })

            // 更新当前内容状态
            markdown.value = processedContent
            filePath.value = result.filePath
            originalContent.value = result.content
          } else {
            // 创建新tab
            const tab = await createTabFromFile(result.filePath, result.content, { isReadOnly: result.isReadOnly })

            // 更新当前内容
            markdown.value = tab.content
            filePath.value = result.filePath
            originalContent.value = result.content
          }

          updateTitle()
          nextTick(() => {
            emitter.emit('file:Change')
          })
          return
        }
      }

      // 无法获取回退到直接读取文件内容
      const content = await mdFile.text()

      if (userChoice === 'overwrite') {
        // 覆盖更新当前tab的文件信息
        updateCurrentTabFile(mdFile.name, content, undefined, { isReadOnly: false })

        // 更新内容
        markdown.value = content
        filePath.value = mdFile.name
        originalContent.value = content
      } else {
        // 注意：这里无法处理相对路径图片，因为没有完整的文件路径
        // 图片路径解析需要知道 Markdown 文件的实际位置
        await createTabFromFile(mdFile.name, content)

        // 更新当前内容状态
        markdown.value = content
        filePath.value = mdFile.name
        originalContent.value = content
      }

      updateTitle()
      nextTick(() => {
        emitter.emit('file:Change')
      })
    } catch (error) {
      console.error('读取拖拽文件失败:', error)
    }
  }

  window.addEventListener('dragover', handleDragOver)
  window.addEventListener('drop', handleDrop)
}

// ✅ 立即注册（只注册一次）
registerMenuEventsOnce()

// 创建新文件
function createNewFile() {
  createNewTab()

  // 更新当前内容状态
  filePath.value = ''
  markdown.value = ''
  originalContent.value = ''

  updateTitle()
  nextTick(() => {
    emitter.emit('file:Change')
  })
}
function tabSwitch(tab: Tab) {
  // 更新当前内容状态
  filePath.value = tab.filePath || ''
  markdown.value = tab.content
  originalContent.value = tab.originalContent

  updateTitle()
  nextTick(() => {
    emitter.emit('file:Change')
  })
}
// 监听tab切换事件
emitter.on('tab:switch', tabSwitch)

export default function useFile() {
  onUnmounted(() => {
    window.electronAPI?.removeListener?.('menu-open', onOpen)
    window.electronAPI?.removeListener?.('menu-save', onSave)
  })
  return {
    onOpen,
    onSave,
    onSaveAs,
    tabSwitch,
    createNewFile,
    switchToTab,
    updateCurrentTabContent,
    updateCurrentTabScrollRatio,
    saveCurrentTab,
    hasUnsavedTabs,
    currentTab,
  }
}

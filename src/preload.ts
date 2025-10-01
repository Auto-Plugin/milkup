import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (filePath: string | null, content: string) => ipcRenderer.invoke('dialog:saveFile', { filePath, content }),
  saveFileAs: (content: string) => ipcRenderer.invoke('dialog:saveFileAs', content),
  on: (channel: string, listener: (...args: any[]) => void) => ipcRenderer.on(channel, (_event, ...args) => listener(...args)),
  removeListener: (channel: string, listener: (...args: any[]) => void) => ipcRenderer.removeListener(channel, (_event, ...args) => listener(...args)),
  setTitle: (filePath: string | null) => ipcRenderer.send('set-title', filePath),
  changeSaveStatus: (isSaved: boolean) => ipcRenderer.send('change-save-status', isSaved),
  windowControl: (action: 'minimize' | 'maximize' | 'close') => ipcRenderer.send('window-control', action),
  closeDiscard: () => ipcRenderer.send('close:discard'),
  onOpenFileAtLaunch: (cb: (payload: { filePath: string, content: string }) => void) => {
    ipcRenderer.on('open-file-at-launch', (_event, payload) => {
      cb(payload)
    })
  },
  openExternal: (url: string) => ipcRenderer.send('shell:openExternal', url),
  getFilePathInClipboard: () => ipcRenderer.invoke('clipboard:getFilePath'),
  writeTempImage: (file: File, tempPath: string) => ipcRenderer.invoke('clipboard:writeTempImage', file, tempPath),
  // 图片路径解析
  resolveImagePath: (markdownFilePath: string, imagePath: string) => ipcRenderer.invoke('file:resolveImagePath', markdownFilePath, imagePath),
  // 通过路径读取文件（用于拖拽）
  readFileByPath: (filePath: string) => ipcRenderer.invoke('file:readByPath', filePath),
  // 显示文件覆盖确认对话框
  showOverwriteConfirm: (fileName: string) => ipcRenderer.invoke('dialog:showOverwriteConfirm', fileName),
  // 显示关闭确认对话框
  showCloseConfirm: (fileName: string) => ipcRenderer.invoke('dialog:showCloseConfirm', fileName),
  // 显示文件选择对话框
  showOpenDialog: (options: any) => ipcRenderer.invoke('dialog:showOpenDialog', options),
  // 获取拖拽文件的真实路径
  getPathForFile: (file: File) => {
    try {
      // 在 preload 脚本中直接访问 webUtils
      // const { webUtils } = require('electron')
      const result = webUtils?.getPathForFile(file)
      return result
    } catch (error) {
      console.error('❌ preload 中 webUtils 不可用:', error)
      return undefined
    }
  },
  // 字体相关
  getSystemFonts: () => ipcRenderer.invoke('get-system-fonts'),
  // 工作区相关
  getDirectoryFiles: (dirPath: string) => ipcRenderer.invoke('workspace:getDirectoryFiles', dirPath),

  // 主题编辑器相关
  openThemeEditor: (theme?: any) => ipcRenderer.send('open-theme-editor', theme),
  themeEditorWindowControl: (action: 'minimize' | 'maximize' | 'close') => ipcRenderer.send('theme-editor-window-control', action),
  saveCustomTheme: (theme: any) => ipcRenderer.send('save-custom-theme', theme),
  platform: process.platform,
})

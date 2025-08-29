// ipcBridge.ts

import * as fs from 'node:fs'
import path from 'node:path'
import { app, clipboard, dialog, ipcMain, shell } from 'electron'
import { getFonts } from 'font-list'

import { createThemeEditorWindow } from './index'

let isSaved = true
let isQuitting = false

// 所有 on 类型监听
export function registerIpcOnHandlers(win: Electron.BrowserWindow) {
  ipcMain.on('set-title', (_event, filePath: string | null) => {
    const title = filePath
      ? `milkup - ${path.basename(filePath)}`
      : 'milkup - Untitled'
    win.setTitle(title)
  })
  ipcMain.on('window-control', async (_event, action) => {
    if (!win)
      return
    switch (action) {
      case 'minimize':
        win.minimize()
        break
      case 'maximize':
        if (win.isMaximized())
          win.unmaximize()
        else win.maximize()
        break
      case 'close':
        if (process.platform === 'darwin') {
          // 在 macOS 上，窗口关闭按钮只隐藏窗口
          win.hide()
        } else {
          // 其他平台直接退出
          close(win)
        }
        break
    }
  })
  ipcMain.on('shell:openExternal', (_event, url) => {
    shell.openExternal(url)
  })
  ipcMain.on('change-save-status', (_event, isSavedStatus) => {
    isSaved = isSavedStatus
    win.webContents.send('save-status-changed', isSaved)
  })

  // 监听保存事件
  ipcMain.on('menu-save', async (_event, shouldClose) => {
    win.webContents.send('trigger-save', shouldClose)
  })

  // 监听丢弃更改事件
  ipcMain.on('close:discard', () => {
    isQuitting = true
    win.close()
    app.quit()
  })

  // 打开主题编辑器窗口
  ipcMain.on('open-theme-editor', async () => {
    await createThemeEditorWindow()
  })

  // 主题编辑器窗口控制
  ipcMain.on('theme-editor-window-control', async (_event, action) => {
    try {
      console.log('主题编辑器窗口控制:', action)

      // 直接导入并获取窗口引用
      const { createThemeEditorWindow } = await import('./index')
      const themeEditorWindow = await createThemeEditorWindow()

      if (!themeEditorWindow) {
        console.log('主题编辑器窗口不存在')
        return
      }

      // 检查窗口是否已被销毁
      if (themeEditorWindow.isDestroyed()) {
        console.log('主题编辑器窗口已被销毁')
        return
      }

      console.log('主题编辑器窗口状态:', {
        isDestroyed: themeEditorWindow.isDestroyed(),
        isVisible: themeEditorWindow.isVisible(),
        isMinimized: themeEditorWindow.isMinimized(),
        isMaximized: themeEditorWindow.isMaximized(),
      })

      switch (action) {
        case 'minimize':
          console.log('最小化主题编辑器窗口')
          if (!themeEditorWindow.isDestroyed()) {
            themeEditorWindow.minimize()
          }
          break
        case 'maximize':
          console.log('最大化/还原主题编辑器窗口')
          if (!themeEditorWindow.isDestroyed()) {
            if (themeEditorWindow.isMaximized())
              themeEditorWindow.unmaximize()
            else
              themeEditorWindow.maximize()
          }
          break
        case 'close':
          console.log('关闭主题编辑器窗口')
          if (!themeEditorWindow.isDestroyed()) {
            themeEditorWindow.close()
          }
          break
        default:
          console.log('未知的窗口控制动作:', action)
      }
    } catch (error) {
      console.error('主题编辑器窗口控制错误:', error)
    }
  })

  // 保存自定义主题
  ipcMain.on('save-custom-theme', (_event, theme) => {
    // 转发到主窗口
    win.webContents.send('custom-theme-saved', theme)
  })
}

// 所有 handle 类型监听
export function registerIpcHandleHandlers(win: Electron.BrowserWindow) {
  // 获取系统字体列表
  ipcMain.handle('get-system-fonts', async () => {
    console.log('获取系统字体列表')
    try {
      const fonts = await getFonts()
      console.log(fonts)
      return fonts
    } catch (error) {
      console.error('获取系统字体失败:', error)
      return []
    }
  })

  // 文件打开对话框
  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      properties: ['openFile'],
    })
    if (canceled)
      return null
    const filePath = filePaths[0]
    const content = fs.readFileSync(filePath, 'utf-8')
    return { filePath, content }
  })

  // 文件保存对话框
  ipcMain.handle('dialog:saveFile', async (_event, { filePath, content }) => {
    if (!filePath) {
      const { canceled, filePath: savePath } = await dialog.showSaveDialog(win, {
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      })
      if (canceled || !savePath)
        return null
      filePath = savePath
    }
    fs.writeFileSync(filePath, content, 'utf-8')
    return filePath
  })
  // 文件另存为对话框
  ipcMain.handle('dialog:saveFileAs', async (_event, content) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    })
    if (canceled || !filePath)
      return null
    fs.writeFileSync(filePath, content, 'utf-8')
    return { filePath }
  })
  // 获取剪贴板中的文件路径
  ipcMain.handle('clipboard:getFilePath', async () => {
    const platform = process.platform
    try {
      if (platform === 'win32') {
        const buf = clipboard.readBuffer('FileNameW')
        const raw = buf.toString('ucs2').replace(/\0/g, '')
        return raw.split('\r\n').filter(s => s.trim())[0] || null
      } else if (platform === 'darwin') {
        const url = clipboard.read('public.file-url')
        return url ? [url.replace('file://', '')] : []
      } else {
        return []
      }
    } catch {
      return []
    }
  })
  // 将临时图片写入剪贴板
  ipcMain.handle('clipboard:writeTempImage', async (_event, file: Uint8Array<ArrayBuffer>, tempPath: string) => {
    const tempDir = path.join(__dirname, tempPath || '/temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir)
    }
    const filePath = path.join(tempDir, `temp-image-${Date.now()}.png`)
    fs.writeFileSync(filePath, file)
    return filePath
  })
  // 同步显示消息框
  ipcMain.handle('dialog:OpenDialog', async (_event, options: Electron.MessageBoxSyncOptions) => {
    const response = await dialog.showMessageBox(win, options)
    return response
  })

  // 显示文件覆盖确认对话框
  ipcMain.handle('dialog:showOverwriteConfirm', async (_event, fileName: string) => {
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['取消', '覆盖', '保存'],
      defaultId: 0,
      title: '文件已存在',
      message: `文件 "${fileName}" 已存在，是否要覆盖当前内容？`,
      detail: '选择"保存"将先保存当前内容，然后打开新文件。',
    })
    return result.response
  })

  // 解析相对路径图片为绝对路径
  ipcMain.handle('file:resolveImagePath', async (_event, markdownFilePath: string, imagePath: string) => {
    if (!markdownFilePath || !imagePath) {
      return imagePath
    }

    // 如果图片路径已经是绝对路径，直接返回
    if (path.isAbsolute(imagePath)) {
      return imagePath
    }

    // 获取 Markdown 文件所在的目录
    const markdownDir = path.dirname(markdownFilePath)

    // 将相对路径转换为绝对路径
    const absoluteImagePath = path.resolve(markdownDir, imagePath)

    // 检查文件是否存在
    if (fs.existsSync(absoluteImagePath)) {
      // 返回 file:// 协议的路径，这样 Electron 可以正确加载
      const fileUrl = `file://${absoluteImagePath.replace(/\\/g, '/')}`
      return fileUrl
    }

    return imagePath
  })

  // 通过文件路径读取 Markdown 文件（用于拖拽）
  ipcMain.handle('file:readByPath', async (_event, filePath: string) => {
    try {
      if (!filePath || !fs.existsSync(filePath))
        return null

      const isMd = /\.(?:md|markdown)$/i.test(filePath)
      if (!isMd)
        return null

      const content = fs.readFileSync(filePath, 'utf-8')
      return { filePath, content }
    } catch (error) {
      console.error('Failed to read file:', error)
      return null
    }
  })
}

export function close(win: Electron.BrowserWindow) {
  // 防止重复调用
  if (isQuitting) {
    return
  }

  if (isSaved) {
    isQuitting = true
    win.close()
    app.quit()
  } else {
    // 检查窗口是否仍然有效
    if (win && !win.isDestroyed()) {
      // 发送事件到渲染进程显示前端弹窗
      win.webContents.send('close:confirm')
    }
  }
}

export function getIsQuitting() {
  return isQuitting
}

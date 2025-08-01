// ipcBridge.ts

import * as fs from 'node:fs'
import path from 'node:path'
import { app, clipboard, dialog, ipcMain, shell } from 'electron'

let isSaved = true
let isQuitting = false

// 所有 on 类型监听
export function registerIpcOnHandlers(win: Electron.BrowserWindow) {
  ipcMain.on('set-title', (_event, filePath: string | null) => {
    const title = filePath
      ? `MilkUp - ${path.basename(filePath)}`
      : 'MilkUp - Untitled'
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
}

// 所有 handle 类型监听
export function registerIpcHandleHandlers(win: Electron.BrowserWindow) {
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
  ipcMain.handle('clipboard:writeTempImage', async (_event, file: ArrayBufferLike, tempPath: string) => {
    const tempDir = path.join(__dirname, tempPath || '/temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir)
    }
    const filePath = path.join(tempDir, `temp-image-${Date.now()}.png`)
    fs.writeFileSync(filePath, file as Buffer)
    return filePath
  })
  // 同步显示消息框
  ipcMain.handle('dialog:OpenDialog', async (_event, options: Electron.MessageBoxSyncOptions) => {
    const response = await dialog.showMessageBox(win, options)
    return response
  })
}

export function close(win: Electron.BrowserWindow) {
  if (isSaved) {
    isQuitting = true
    win.close()
    app.quit()
  } else {
    // 发送事件到渲染进程显示前端弹窗
    win.webContents.send('close:confirm')
  }
}

export function getIsQuitting() {
  return isQuitting
}

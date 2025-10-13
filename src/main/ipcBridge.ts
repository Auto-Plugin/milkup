// ipcBridge.ts

import type { ExportPDFOptions } from './types'
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
      // 直接导入并获取窗口引用
      const { createThemeEditorWindow } = await import('./index')
      const themeEditorWindow = await createThemeEditorWindow()

      if (!themeEditorWindow) {
        return
      }

      // 检查窗口是否已被销毁
      if (themeEditorWindow.isDestroyed()) {
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

          if (!themeEditorWindow.isDestroyed()) {
            themeEditorWindow.minimize()
          }
          break
        case 'maximize':

          if (!themeEditorWindow.isDestroyed()) {
            if (themeEditorWindow.isMaximized())
              themeEditorWindow.unmaximize()
            else
              themeEditorWindow.maximize()
          }
          break
        case 'close':

          if (!themeEditorWindow.isDestroyed()) {
            themeEditorWindow.close()
          }
          break
        default:
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

  // 显示关闭确认对话框
  ipcMain.handle('dialog:showCloseConfirm', async (_event, fileName: string) => {
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['取消', '不保存', '保存'],
      defaultId: 2,
      title: '文件未保存',
      message: `文件 "${fileName}" 有未保存的更改。`,
      detail: '是否要保存更改？',
    })
    return result.response
  })

  // 显示文件选择对话框
  ipcMain.handle('dialog:showOpenDialog', async (_event, options: any) => {
    const result = await dialog.showOpenDialog(win, options)
    return result
  })
  // 导出为 pdf 文件
  ipcMain.handle(
    'file:exportPDF',
    async (
      _event,
      elementSelector: string,
      outputName: string,
      options?: ExportPDFOptions,
    ): Promise<void> => {
      const { pageSize = 'A4', scale = 1 } = options || {}

      // 保证代码块完整显示
      const preventCutOffStyle = `
        <style>
          pre {
            page-break-inside: avoid;
          }
          code {
            page-break-inside: avoid;
          }
          .ͼo .cm-line{
            display: flex!important;
            flex-wrap: wrap;
          }
          .milkdown .milkdown-code-block .cm-editor span{
            word-break: break-word;
            white-space: break-spaces;
            display: inline-block;
            max-width: 100%;
          }
          .ͼo .cm-content[contenteditable=true]{
            width: 0px;
            flex: 1;
          }
        </style>
      `
      const cssKey = await win.webContents.insertCSS(preventCutOffStyle)

      // 1. 在页面中克隆元素并隐藏其他内容
      await win.webContents.executeJavaScript(`
          (function() {
            const target = document.querySelector('${elementSelector}');
            if (!target) throw new Error('Element not found');
  
            // 克隆节点
            const clone = target.cloneNode(true);
  
            // 创建临时容器
            const container = document.createElement('div');
            container.className = 'electron-export-container';
            container.style.position = 'absolute';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = '100vw';
            container.style.padding = '20px';
            container.style.boxSizing = 'border-box';
            container.style.visibility = 'visible'; 
            container.appendChild(clone);
  
            // 隐藏 body 其他内容
            document.body.style.visibility = 'hidden';
            document.body.appendChild(container);
          })();
        `)
      try {
        // 2. 导出 PDF
        const pdfData = await win.webContents.printToPDF({
          printBackground: true,
          pageSize,
          margins: {
            marginType: 'printableArea',
          },
          scale,
        })

        // 3. 保存 PDF 文件
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: '导出为 PDF',
          defaultPath: outputName || 'export.pdf',
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
        if (canceled || !filePath) {
          return Promise.reject(new Error('用户取消了保存'))
        }
        fs.writeFileSync(filePath, pdfData)
      } catch (error) {
        console.error('导出 PDF 失败:', error)
        return Promise.reject(error)
      } finally {
        // 4. 清理页面
        win.webContents.executeJavaScript(`
                  (function() {
                    const container = document.querySelector('.electron-export-container');
                    if (container) container.remove();
                    document.body.style.visibility = 'visible';
                  })();
                `)
        // 移除插入的样式
        if (cssKey)
          win.webContents.removeInsertedCSS(cssKey)
      }
    },
  )
}
// 无需 win 的 ipc 处理
export function registerGlobalIpcHandlers() {
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
  // 获取系统字体列表
  ipcMain.handle('get-system-fonts', async () => {
    try {
      const fonts = await getFonts()

      return fonts
    } catch (error) {
      console.error('获取系统字体失败:', error)
      return []
    }
  })

  // 获取目录下的文件列表（树形结构）
  ipcMain.handle('workspace:getDirectoryFiles', async (_event, dirPath: string) => {
    try {
      if (!dirPath || !fs.existsSync(dirPath)) {
        return []
      }

      interface WorkSpace {
        name: string
        path: string
        isDirectory: boolean
        children?: WorkSpace[]
      }

      // 性能优化配置
      const MAX_DEPTH = 10 // 最大扫描深度
      const MAX_FILES_PER_DIR = 100 // 每个目录最大文件数
      const IGNORE_PATTERNS = [
        /^\.git$/,
        /^\.vscode$/,
        /^\.idea$/,
        /^node_modules$/,
        /^\.next$/,
        /^\.nuxt$/,
        /^dist$/,
        /^build$/,
        /^coverage$/,
        /^\.DS_Store$/,
        /^Thumbs\.db$/,
      ]

      function shouldIgnoreDirectory(name: string): boolean {
        return IGNORE_PATTERNS.some(pattern => pattern.test(name))
      }

      function scanDirectory(currentPath: string, depth: number = 0): WorkSpace[] {
        // 限制扫描深度
        if (depth > MAX_DEPTH) {
          return []
        }

        try {
          const items = fs.readdirSync(currentPath, { withFileTypes: true })

          // 限制每个目录的文件数量
          if (items.length > MAX_FILES_PER_DIR) {
            console.warn(`目录 ${currentPath} 包含过多文件 (${items.length})，已限制扫描`)
            items.splice(MAX_FILES_PER_DIR)
          }

          // 先添加文件夹，再添加文件
          const directories: WorkSpace[] = []
          const files: WorkSpace[] = []

          for (const item of items) {
            const itemPath = path.join(currentPath, item.name)

            if (item.isDirectory()) {
              // 跳过忽略的目录
              if (shouldIgnoreDirectory(item.name)) {
                continue
              }

              const children = scanDirectory(itemPath, depth + 1)
              // 只有当文件夹包含markdown文件或子文件夹时才显示
              if (children.length > 0) {
                directories.push({
                  name: item.name,
                  path: itemPath,
                  isDirectory: true,
                  children,
                })
              }
            } else if (item.isFile() && /\.(?:md|markdown)$/i.test(item.name)) {
              files.push({
                name: item.name,
                path: itemPath,
                isDirectory: false,
              })
            }
          }

          // 按名称排序
          directories.sort((a, b) => a.name.localeCompare(b.name))
          files.sort((a, b) => a.name.localeCompare(b.name))

          return [...directories, ...files]
        } catch (error) {
          console.warn(`扫描目录失败: ${currentPath}`, error)
          return []
        }
      }

      return scanDirectory(dirPath)
    } catch (error) {
      console.error('获取目录文件失败:', error)
      return []
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

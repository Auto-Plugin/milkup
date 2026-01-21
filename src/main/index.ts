import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, BrowserWindow, globalShortcut } from 'electron'
import { close, getIsQuitting, registerGlobalIpcHandlers, registerIpcHandleHandlers, registerIpcOnHandlers } from './ipcBridge'
import createMenu from './menu'

let win: BrowserWindow
let themeEditorWindow: BrowserWindow | null = null

async function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden', // ✅ macOS 专属
    icon: path.join(__dirname, '../assets/icons/milkup.ico'),
    webPreferences: {
      sandbox: false,
      preload: path.resolve(__dirname, '../../dist-electron/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // 允许加载本地文件
    },
  })
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (win)
      win.webContents.openDevTools()
  })

  const indexPath = path.join(__dirname, '../../dist', 'index.html')

  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    await win.loadFile(indexPath)
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    win.webContents.openDevTools()
  }
}

// 创建主题编辑器窗口
export async function createThemeEditorWindow() {
  if (themeEditorWindow && !themeEditorWindow.isDestroyed()) {
    themeEditorWindow.focus()
    return themeEditorWindow
  }

  themeEditorWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    parent: win,
    modal: false,
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, '../assets/icons/milkup.ico'),
    webPreferences: {
      sandbox: false,
      preload: path.resolve(__dirname, '../../dist-electron/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  // 加载主题编辑器页面
  if (process.env.VITE_DEV_SERVER_URL) {
    await themeEditorWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/theme-editor.html`)
  } else {
    const themeEditorPath = path.join(__dirname, '../../dist', 'theme-editor.html')
    await themeEditorWindow.loadFile(themeEditorPath)
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    themeEditorWindow.webContents.openDevTools()
  }

  // 窗口关闭时清理引用
  themeEditorWindow.on('closed', () => {
    themeEditorWindow = null
  })

  return themeEditorWindow
}

/**
 * 统一的文件发送函数
 * 整合了文件读取、验证和发送到渲染进程的逻辑
 */
function sendFileToRenderer(filePath: string) {
  // 验证文件路径
  if (!filePath.endsWith('.md') && !filePath.endsWith('.markdown')) {
    return
  }

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    console.warn('[main] 文件不存在:', filePath)
    return
  }

  // 读取文件内容
  const content = fs.readFileSync(filePath, 'utf-8')

  // 发送到渲染进程的函数
  const sendFile = () => {
    if (win && win.webContents) {
      win.webContents.send('open-file-at-launch', {
        filePath,
        content,
      })
    }
  }

  // 等待窗口准备就绪
  if (win && win.webContents) {
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => {
        setTimeout(sendFile, 200)
      })
    } else {
      setTimeout(sendFile, 200)
    }
  } else {
    // 窗口还未创建，等待窗口创建
    const waitForWindow = () => {
      if (win && win.webContents) {
        setTimeout(sendFile, 200)
      } else {
        setTimeout(waitForWindow, 100)
      }
    }
    waitForWindow()
  }
}

function sendLaunchFileIfExists(argv = process.argv) {
  const fileArg = argv.find(arg => arg.endsWith('.md') || arg.endsWith('.markdown'))

  if (fileArg) {
    const absolutePath = path.resolve(fileArg)
    sendFileToRenderer(absolutePath)
  }
}

app.whenReady().then(async () => {
  registerGlobalIpcHandlers()
  await createWindow()
  createMenu(win)

  registerIpcOnHandlers(win)
  registerIpcHandleHandlers(win)

  sendLaunchFileIfExists()

  win.on('close', (event) => {
    if (process.platform === 'darwin' && !getIsQuitting()) {
      event.preventDefault()
      win.webContents.send('close')
    }
  })
})

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (win) {
      if (win.isMinimized())
        win.restore()
      win.focus()
      // 处理通过命令行传入的文件路径
      sendLaunchFileIfExists(argv)
    }
  })
}
// macOS 专用：Finder 打开文件时触发
// 处理应用已运行时双击文件打开的情况
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  sendFileToRenderer(filePath)
})
// 处理应用即将退出事件（包括右键 Dock 图标的退出）
app.on('before-quit', (event) => {
  if (process.platform === 'darwin' && !getIsQuitting()) {
    event.preventDefault()
    close(win)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// macOS 上处理应用激活事件
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  } else {
    // 如果窗口存在但被隐藏，则显示它
    if (win && !win.isVisible()) {
      win.show()
    }
    // 将窗口置于前台
    if (win) {
      win.focus()
    }
  }
})

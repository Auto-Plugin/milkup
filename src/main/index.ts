import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, BrowserWindow, globalShortcut } from 'electron'
import { registerIpcHandleHandlers, registerIpcOnHandlers } from './ipcBridge'
import createMenu from './menu'

let win: BrowserWindow
const isQuiting = false

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

  // 注册 Cmd+Q 快捷键来退出应用
  if (process.platform === 'darwin') {
    globalShortcut.register('Command+Q', () => {
      app.exit(0)
    })
  }
  const indexPath = path.join(__dirname, '../../dist', 'index.html')
  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL)
  }
  else {
    await win.loadFile(indexPath)
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    win.webContents.openDevTools()
  }

  // 处理窗口关闭事件
  win.on('close', (event) => {
    if (process.platform === 'darwin') {
      // 在 macOS 上，点击关闭按钮时隐藏窗口而不是退出应用
      if (!isQuiting) {
        event.preventDefault()
        win.hide()
      }
    }
  })
}
function sendLaunchFileIfExists() {
  const fileArg = process.argv.find(arg => arg.endsWith('.md') || arg.endsWith('.markdown'))

  if (fileArg) {
    const absolutePath = path.resolve(fileArg)
    if (fs.existsSync(absolutePath)) {
      const content = fs.readFileSync(absolutePath, 'utf-8')
      win.webContents.send('open-file-at-launch', {
        filePath: absolutePath,
        content,
      })
    }
    else {
      console.warn('[main] 文件不存在:', absolutePath)
    }
  }
}

app.whenReady().then(async () => {
  await createWindow()
  createMenu(win)
  sendLaunchFileIfExists()
  registerIpcOnHandlers(win)
  registerIpcHandleHandlers(win)
  win.on('close', (event) => {
    if (process.platform === 'darwin') {
      event.preventDefault()
      win.webContents.send('close')
    }
  })
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
  }
  else {
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

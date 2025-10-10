import type { BrowserWindow } from 'electron'
import { Menu } from 'electron'
import { close } from './ipcBridge'

export default function createMenu(win: BrowserWindow) {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            win.webContents.send('menu-open')
          },
        },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            win.webContents.send('menu-save')
          },
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
        {
          label: '切换视图',
          accelerator: 'CmdOrCtrl+\/',
          click: () => {
            win.webContents.send('view:toggleView')
          },
        },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
      ],
    },
  ]

  // 在 macOS 上添加应用菜单
  if (process.platform === 'darwin') {
    template.unshift({
      label: 'milkup',
      submenu: [
        { label: '隐藏 milkup', accelerator: 'Cmd+H', role: 'hide' },
        { label: '隐藏其他', accelerator: 'Cmd+Alt+H', role: 'hideOthers' },
        { type: 'separator' },
        {
          label: '退出 milkup',
          accelerator: 'Cmd+Q',
          click: () => {
            close(win)
          },
        },
      ],
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

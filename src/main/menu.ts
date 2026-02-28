import { BrowserWindow, Menu } from "electron";
import { close } from "./ipcBridge";

/**
 * 获取当前聚焦的窗口，用于菜单 click 处理器。
 * 避免在闭包中捕获特定窗口引用，防止窗口销毁后出现
 * "Object has been destroyed" 错误。
 */
function getFocusedWindow(): BrowserWindow | null {
  const win = BrowserWindow.getFocusedWindow();
  if (win && !win.isDestroyed()) return win;
  // 如果没有聚焦窗口（例如 macOS 上窗口全部隐藏），回退到第一个可见窗口
  const allWindows = BrowserWindow.getAllWindows();
  return allWindows.find((w) => !w.isDestroyed()) ?? null;
}

export default function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        {
          label: "打开",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            getFocusedWindow()?.webContents.send("menu-open");
          },
        },
        {
          label: "保存",
          accelerator: "CmdOrCtrl+S",
          click: () => {
            getFocusedWindow()?.webContents.send("menu-save");
          },
        },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "重做", accelerator: "Shift+CmdOrCtrl+Z", role: "redo" },
        { label: "剪切", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "复制", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "粘贴", accelerator: "CmdOrCtrl+V", role: "paste" },
        { label: "全选", accelerator: "CmdOrCtrl+A", role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "实际大小", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
        { label: "全屏", accelerator: "F11", role: "togglefullscreen" },
        {
          label: "切换视图",
          accelerator: "CmdOrCtrl+/",
          click: () => {
            getFocusedWindow()?.webContents.send("view:toggleView");
          },
        },
      ],
    },
    {
      label: "窗口",
      submenu: [{ label: "最小化", accelerator: "CmdOrCtrl+M", role: "minimize" }],
    },
  ];

  // 在 macOS 上添加应用菜单
  if (process.platform === "darwin") {
    template.unshift({
      label: "milkup",
      submenu: [
        { label: "隐藏 milkup", accelerator: "Cmd+H", role: "hide" },
        { label: "隐藏其他", accelerator: "Cmd+Alt+H", role: "hideOthers" },
        { type: "separator" },
        {
          label: "退出 milkup",
          accelerator: "Cmd+Q",
          click: () => {
            const win = getFocusedWindow();
            if (win) close(win);
          },
        },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

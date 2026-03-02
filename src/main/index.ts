import * as fs from "node:fs";
import * as path from "node:path";
import { app, BrowserWindow, globalShortcut, ipcMain, protocol, shell } from "electron";
import { cleanupProtocolUrls, detectFileTraits, normalizeMarkdown } from "./fileFormat";
import {
  close,
  getIsQuitting,
  isWindowClosing,
  setIsQuitting,
  registerGlobalIpcHandlers,
  registerIpcHandleHandlers,
  registerIpcOnHandlers,
} from "./ipcBridge";
import createMenu from "./menu";
import { setupUpdateHandlers } from "./update";
import { trackWindow } from "./windowManager";

let win: BrowserWindow | null = null;
let themeEditorWindow: BrowserWindow | null = null;
let isRendererReady = false;
let pendingStartupFile: string | null = null;

/** 安全获取一个可用的编辑器窗口（优先主窗口，回退到任意存活窗口） */
function getAvailableWindow(): BrowserWindow | null {
  if (win && !win.isDestroyed()) return win;
  const allWindows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  return allWindows[0] ?? null;
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: "hidden", // ✅ macOS 专属
    icon: path.join(__dirname, "../assets/icons/milkup.ico"),
    webPreferences: {
      sandbox: false,
      preload: path.resolve(__dirname, "../../dist-electron/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // 允许加载本地文件
    },
  });

  // 注册为主窗口
  trackWindow(win, true);

  globalShortcut.register("CommandOrControl+Shift+I", () => {
    const targetWin = getAvailableWindow();
    if (targetWin) targetWin.webContents.openDevTools();
  });

  createMenu();

  // 处理外部链接跳转（target="_blank" 或 window.open）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // 防止应用内部跳转（直接点击链接）
  win.webContents.on("will-navigate", (event, url) => {
    // 允许 dev server 的 reload
    if (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) {
      return;
    }
    if (url.startsWith("https:") || url.startsWith("http:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  const indexPath = path.join(__dirname, "../../dist", "index.html");

  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(indexPath);
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    win.webContents.openDevTools();
  }

  // macOS: 窗口关闭时如果不是退出流程且不是主动关闭，只隐藏而不关闭
  win.on("close", (event) => {
    if (process.platform === "darwin" && !getIsQuitting() && !isWindowClosing(win!.id)) {
      event.preventDefault();
      win?.webContents.send("close");
    }
  });
}

// 创建主题编辑器窗口
export async function createThemeEditorWindow() {
  if (themeEditorWindow && !themeEditorWindow.isDestroyed()) {
    themeEditorWindow.focus();
    return themeEditorWindow;
  }

  themeEditorWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    parent: getAvailableWindow() ?? undefined,
    modal: false,
    frame: false,
    titleBarStyle: "hidden",
    icon: path.join(__dirname, "../assets/icons/milkup.ico"),
    webPreferences: {
      sandbox: false,
      preload: path.resolve(__dirname, "../../dist-electron/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  // 处理外部链接跳转
  themeEditorWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // 防止应用内部跳转
  themeEditorWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // 加载主题编辑器页面
  if (process.env.VITE_DEV_SERVER_URL) {
    await themeEditorWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/theme-editor.html`);
  } else {
    const themeEditorPath = path.join(__dirname, "../../dist", "theme-editor.html");
    await themeEditorWindow.loadFile(themeEditorPath);
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    themeEditorWindow.webContents.openDevTools();
  }

  // 窗口关闭时清理引用
  themeEditorWindow.on("closed", () => {
    themeEditorWindow = null;
  });

  return themeEditorWindow;
}

/**
 * 统一的文件发送函数
 * 整合了文件读取、验证和发送到渲染进程的逻辑
 */
function sendFileToRenderer(filePath: string) {
  // 验证文件路径
  if (!filePath.endsWith(".md") && !filePath.endsWith(".markdown")) {
    return;
  }

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    console.warn("[main] 文件不存在:", filePath);
    return;
  }

  // 读取文件内容
  const raw = fs.readFileSync(filePath, "utf-8");
  const fileTraits = detectFileTraits(raw);
  const content = cleanupProtocolUrls(normalizeMarkdown(raw));

  // 发送到渲染进程的函数
  const sendFile = () => {
    const targetWin = getAvailableWindow();
    if (targetWin) {
      targetWin.webContents.send("open-file-at-launch", {
        filePath,
        content,
        fileTraits,
      });
    }
  };

  if (isRendererReady) {
    sendFile();
  } else {
    pendingStartupFile = filePath;
  }
}

function sendLaunchFileIfExists(argv = process.argv) {
  const fileArg = argv.find((arg) => arg.endsWith(".md") || arg.endsWith(".markdown"));

  if (fileArg) {
    const absolutePath = path.resolve(fileArg);
    sendFileToRenderer(absolutePath);
  }
}

// 注册自定义协议为特权协议
protocol.registerSchemesAsPrivileged([
  {
    scheme: "milkup",
    privileges: {
      bypassCSP: true,
      supportFetchAPI: true,
      standard: true,
      secure: true,
    },
  },
]);

app.whenReady().then(async () => {
  // 注册所有 IPC 处理程序（只注册一次，防止重复注册报错）
  registerGlobalIpcHandlers();
  registerIpcOnHandlers();
  registerIpcHandleHandlers();
  setupUpdateHandlers();

  // 注册自定义协议处理器（仅用于兼容旧版本残留的 milkup:// URL）
  // 新版本使用 file:// 协议直接加载本地图片
  protocol.registerFileProtocol("milkup", (request, callback) => {
    try {
      const rawUrl = request.url;

      // 提取路径部分
      let urlPath: string;
      if (rawUrl.startsWith("milkup:///")) {
        urlPath = rawUrl.substring("milkup:///".length);
      } else {
        urlPath = rawUrl.substring("milkup://".length);
      }

      // 旧格式：<base64-encoded-markdown-path>/<relative-image-path>
      const firstSlashIndex = urlPath.indexOf("/");
      if (firstSlashIndex === -1) {
        callback({ error: -2 });
        return;
      }

      const encodedMdPath = urlPath.substring(0, firstSlashIndex);
      const relativePath = urlPath.substring(firstSlashIndex + 1);

      const markdownPath = Buffer.from(encodedMdPath, "base64").toString("utf-8");
      const markdownDir = path.dirname(markdownPath);
      const absolutePath = path.resolve(markdownDir, decodeURIComponent(relativePath));

      if (!fs.existsSync(absolutePath)) {
        console.error("[milkup protocol] 文件不存在:", absolutePath);
        callback({ error: -6 });
        return;
      }

      callback({ path: absolutePath });
    } catch (error) {
      console.error("[milkup protocol] 处理请求失败:", error);
      callback({ error: -2 });
    }
  });

  // 监听渲染进程就绪事件 (Moved up to avoid race condition)
  ipcMain.on("renderer-ready", () => {
    isRendererReady = true;
    if (pendingStartupFile) {
      sendFileToRenderer(pendingStartupFile);
      pendingStartupFile = null;
    }
  });

  await createWindow();

  sendLaunchFileIfExists();
});

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const targetWin = getAvailableWindow();
    if (targetWin) {
      if (targetWin.isMinimized()) targetWin.restore();
      targetWin.focus();
    }
    // 处理通过命令行传入的文件路径
    sendLaunchFileIfExists(argv);
  });
}
// macOS 专用：Finder 打开文件时触发
// 处理应用已运行时双击文件打开的情况
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  sendFileToRenderer(filePath);
});
// 处理应用即将退出事件（包括右键 Dock 图标的退出、Cmd+Q）
app.on("before-quit", (event) => {
  // 防止重入：close() / close:discard 中的 app.quit() 会再次触发 before-quit
  if (getIsQuitting()) return;

  // 标记正在退出，让窗口 close 事件不再拦截
  setIsQuitting(true);

  if (process.platform === "darwin") {
    const targetWin = getAvailableWindow();
    if (targetWin) {
      event.preventDefault();
      close(targetWin);
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// macOS 上处理应用激活事件（点击 Dock 图标）
app.on("activate", () => {
  // 重置退出标记：用户重新激活应用说明不想退出
  setIsQuitting(false);

  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    const targetWin = getAvailableWindow();
    if (targetWin) {
      // 如果窗口存在但被隐藏，则显示它
      if (!targetWin.isVisible()) {
        targetWin.show();
      }
      // 将窗口置于前台
      targetWin.focus();
    }
  }
});

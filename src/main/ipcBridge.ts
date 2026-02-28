// ipcBridge.ts

import type { FSWatcher } from "chokidar";
import type { Block, ExportPDFOptions } from "./types";
import type { FileTraits } from "./fileFormat";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { getFonts } from "font-list";
import {
  cleanupProtocolUrls,
  detectFileTraits,
  normalizeMarkdown,
  restoreFileTraits,
} from "./fileFormat";
import { createThemeEditorWindow } from "./index";
import {
  cancelDragFollow,
  clearWindowDragPreview,
  consumePendingTabData,
  finalizeWindowDragMerge,
  finalizeDragFollow,
  findWindowWithFile,
  getEditorWindows,
  isMainWindow,
  startDragFollow,
  startWindowDrag,
  stopWindowDrag,
  updateWindowOpenFiles,
} from "./windowManager";
import type { TearOffTabData } from "./windowManager";

/** 每个窗口独立追踪保存状态（windowId → isSaved） */
const windowSaveState = new Map<number, boolean>();
/** 正在执行关闭流程的窗口集合 */
const windowClosingSet = new Set<number>();

/** 窗口关闭后清理状态，防止内存泄漏 */
function cleanupWindowState(windowId: number): void {
  windowSaveState.delete(windowId);
  windowClosingSet.delete(windowId);
}

// 存储已监听的文件路径和对应的 watcher
const watchedFiles = new Set<string>();
let watcher: FSWatcher | null = null;

// 目录监听 watcher
let directoryWatcher: FSWatcher | null = null;
let directoryChangedDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// 所有 on 类型监听
export function registerIpcOnHandlers(win: Electron.BrowserWindow) {
  ipcMain.on("set-title", (event, filePath: string | null) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender);
    if (!targetWin) return;
    const title = filePath ? `milkup - ${path.basename(filePath)}` : "milkup - Untitled";
    targetWin.setTitle(title);
  });
  ipcMain.on("window-control", async (event, action) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender);
    if (!targetWin) return;
    switch (action) {
      case "minimize":
        targetWin.minimize();
        break;
      case "maximize":
        if (targetWin.isMaximized()) targetWin.unmaximize();
        else targetWin.maximize();
        break;
      case "close":
        if (process.platform === "darwin" && isMainWindow(targetWin)) {
          // macOS 主窗口按关闭按钮仅隐藏
          targetWin.hide();
        } else {
          close(targetWin);
        }
        break;
    }
  });
  ipcMain.on("shell:openExternal", (_event, url) => {
    shell.openExternal(url);
  });
  ipcMain.on("change-save-status", (event, isSavedStatus) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender);
    if (!targetWin) return;
    windowSaveState.set(targetWin.id, isSavedStatus);
    event.sender.send("save-status-changed", isSavedStatus);
  });

  // 监听保存事件
  ipcMain.on("menu-save", async (event, shouldClose) => {
    event.sender.send("trigger-save", shouldClose);
  });

  // 监听丢弃更改事件
  ipcMain.on("close:discard", (event) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender);
    if (!targetWin || targetWin.isDestroyed()) return;
    const winId = targetWin.id;
    windowClosingSet.add(winId);
    targetWin.close();
    cleanupWindowState(winId);
    // 如果是最后一个窗口（非 macOS），退出应用
    const remaining = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    if (remaining.length === 0 && process.platform !== "darwin") {
      app.quit();
    }
  });

  // 打开主题编辑器窗口
  ipcMain.on("open-theme-editor", async () => {
    await createThemeEditorWindow();
  });

  // 主题编辑器窗口控制
  ipcMain.on("theme-editor-window-control", async (_event, action) => {
    try {
      // 直接导入并获取窗口引用
      const { createThemeEditorWindow } = await import("./index");
      const themeEditorWindow = await createThemeEditorWindow();

      if (!themeEditorWindow) {
        return;
      }

      // 检查窗口是否已被销毁
      if (themeEditorWindow.isDestroyed()) {
        return;
      }

      switch (action) {
        case "minimize":
          if (!themeEditorWindow.isDestroyed()) {
            themeEditorWindow.minimize();
          }
          break;
        case "maximize":
          if (!themeEditorWindow.isDestroyed()) {
            if (themeEditorWindow.isMaximized()) themeEditorWindow.unmaximize();
            else themeEditorWindow.maximize();
          }
          break;
        case "close":
          if (!themeEditorWindow.isDestroyed()) {
            themeEditorWindow.close();
          }
          break;
        default:
      }
    } catch (error) {
      console.error("主题编辑器窗口控制错误:", error);
    }
  });

  // 保存自定义主题
  ipcMain.on("save-custom-theme", (_event, theme) => {
    // 转发到主窗口
    win.webContents.send("custom-theme-saved", theme);
  });
}

// 所有 handle 类型监听 —— 使用 event.sender 路由到正确窗口
export function registerIpcHandleHandlers(win: Electron.BrowserWindow) {
  // 检查文件是否只读
  ipcMain.handle("file:isReadOnly", async (_event, filePath: string) => {
    return isFileReadOnly(filePath);
  });

  // 文件打开对话框
  ipcMain.handle("dialog:openFile", async (event) => {
    const parentWin = BrowserWindow.fromWebContents(event.sender) ?? win;
    const { canceled, filePaths } = await dialog.showOpenDialog(parentWin, {
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      properties: ["openFile"],
    });
    if (canceled) return null;
    const filePath = filePaths[0];
    const raw = fs.readFileSync(filePath, "utf-8");
    const fileTraits = detectFileTraits(raw);
    const content = cleanupProtocolUrls(normalizeMarkdown(raw));
    return { filePath, content, fileTraits };
  });

  // 文件保存对话框
  ipcMain.handle(
    "dialog:saveFile",
    async (
      event,
      {
        filePath,
        content,
        fileTraits,
      }: { filePath: string | null; content: string; fileTraits?: FileTraits }
    ) => {
      const parentWin = BrowserWindow.fromWebContents(event.sender) ?? win;
      if (!filePath) {
        const { canceled, filePath: savePath } = await dialog.showSaveDialog(parentWin, {
          filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
        });
        if (canceled || !savePath) return null;
        filePath = savePath;
      }
      // 根据原始文件格式特征还原内容
      const restoredContent = restoreFileTraits(content, fileTraits);
      fs.writeFileSync(filePath, restoredContent, "utf-8");
      return filePath;
    }
  );
  // 文件另存为对话框
  ipcMain.handle("dialog:saveFileAs", async (event, content) => {
    const parentWin = BrowserWindow.fromWebContents(event.sender) ?? win;
    const { canceled, filePath } = await dialog.showSaveDialog(parentWin, {
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, content, "utf-8");
    return { filePath };
  });

  // 同步显示消息框
  ipcMain.handle("dialog:OpenDialog", async (event, options: Electron.MessageBoxSyncOptions) => {
    const parentWin = BrowserWindow.fromWebContents(event.sender) ?? win;
    const response = await dialog.showMessageBox(parentWin, options);
    return response;
  });

  // 显示文件覆盖确认对话框
  ipcMain.handle("dialog:showOverwriteConfirm", async (event, fileName: string) => {
    const parentWin = BrowserWindow.fromWebContents(event.sender) ?? win;
    const result = await dialog.showMessageBox(parentWin, {
      type: "question",
      buttons: ["取消", "覆盖", "保存"],
      defaultId: 0,
      title: "文件已存在",
      message: `文件 "${fileName}" 已存在，是否要覆盖当前内容？`,
      detail: '选择"保存"将先保存当前内容，然后打开新文件。',
    });
    return result.response;
  });

  // 显示关闭确认对话框
  ipcMain.handle("dialog:showCloseConfirm", async (event, fileName: string) => {
    const parentWin = BrowserWindow.fromWebContents(event.sender) ?? win;
    const result = await dialog.showMessageBox(parentWin, {
      type: "question",
      buttons: ["取消", "不保存", "保存"],
      defaultId: 2,
      title: "文件未保存",
      message: `文件 "${fileName}" 有未保存的更改。`,
      detail: "是否要保存更改？",
    });
    return result.response;
  });

  // 显示文件选择对话框
  ipcMain.handle("dialog:showOpenDialog", async (event, options: any) => {
    const parentWin = BrowserWindow.fromWebContents(event.sender) ?? win;
    const result = await dialog.showOpenDialog(parentWin, options);
    return result;
  });
  // 导出为 pdf 文件
  ipcMain.handle(
    "file:exportPDF",
    async (
      event,
      elementSelector: string,
      outputName: string,
      options?: ExportPDFOptions
    ): Promise<void> => {
      const sender = event.sender;
      const parentWin = BrowserWindow.fromWebContents(sender) ?? win;
      const { pageSize = "A4", scale = 1 } = options || {};

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
      `;
      const cssKey = await sender.insertCSS(preventCutOffStyle);

      // 1. 在页面中克隆元素并隐藏其他内容
      await sender.executeJavaScript(`
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
        `);
      try {
        // 2. 导出 PDF
        const pdfData = await sender.printToPDF({
          printBackground: true,
          pageSize,
          margins: {
            marginType: "printableArea",
          },
          scale,
        });

        // 3. 保存 PDF 文件
        const { canceled, filePath } = await dialog.showSaveDialog(parentWin, {
          title: "导出为 PDF",
          defaultPath: outputName || "export.pdf",
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (canceled || !filePath) {
          return Promise.reject(new Error("用户取消了保存"));
        }
        fs.writeFileSync(filePath, pdfData);
      } catch (error) {
        console.error("导出 PDF 失败:", error);
        return Promise.reject(error);
      } finally {
        // 4. 清理页面
        sender.executeJavaScript(`
                  (function() {
                    const container = document.querySelector('.electron-export-container');
                    if (container) container.remove();
                    document.body.style.visibility = 'visible';
                  })();
                `);
        // 移除插入的样式
        if (cssKey) sender.removeInsertedCSS(cssKey);
      }
    }
  );
  // 导出为 word 文件
  ipcMain.handle(
    "file:exportWord",
    async (event, blocks: Block[], outputName: string): Promise<void> => {
      // 定义 Word 的列表样式

      const sectionChildren: Paragraph[] = [];

      blocks.forEach((block) => {
        if (block.type === "heading") {
          sectionChildren.push(
            new Paragraph({
              text: block.text,
              heading:
                block.level === 1
                  ? HeadingLevel.HEADING_1
                  : block.level === 2
                    ? HeadingLevel.HEADING_2
                    : HeadingLevel.HEADING_3,
            })
          );
        } else if (block.type === "paragraph") {
          sectionChildren.push(new Paragraph({ text: block.text }));
        } else if (block.type === "list") {
          block.items.forEach((item) =>
            sectionChildren.push(
              new Paragraph({
                text: item,
                numbering: {
                  reference: block.ordered ? "my-numbered" : "my-bullet",
                  level: 0,
                },
              })
            )
          );
        } else if (block.type === "code") {
          block.lines.forEach((line, index) => {
            const lineChildren: TextRun[] = [
              new TextRun({
                text: `${String(index + 1).padStart(3, "0")} | `,
                color: "999999",
              }),
            ];

            // 简单 JS 高亮关键字
            const keywordRegex = /\b(?:const|let|var|function|return|if|else)\b/g;
            let lastIndex = 0;
            let match: RegExpExecArray | null = keywordRegex.exec(line);
            while (match) {
              if (match.index > lastIndex) {
                lineChildren.push(
                  new TextRun({ text: line.slice(lastIndex, match.index), font: "Courier New" })
                );
              }
              lineChildren.push(
                new TextRun({
                  text: match[0],
                  bold: true,
                  color: "0000FF",
                  font: "Courier New",
                })
              );
              lastIndex = match.index + match[0].length;
              match = keywordRegex.exec(line);
            }

            if (lastIndex < line.length) {
              lineChildren.push(new TextRun({ text: line.slice(lastIndex), font: "Courier New" }));
            }

            sectionChildren.push(
              new Paragraph({ children: lineChildren, spacing: { after: 100 } })
            );
          });
        }
      });

      const doc = new Document({
        sections: [{ children: sectionChildren }],
        numbering: {
          config: [
            {
              reference: "my-bullet",
              levels: [{ level: 0, format: "bullet", text: "•", alignment: "left" }],
            },
            {
              reference: "my-numbered",
              levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "left" }],
            },
          ],
        },
      });

      const buffer = await Packer.toBuffer(doc);
      const parentWin = BrowserWindow.fromWebContents(event.sender) ?? win;

      const { canceled, filePath } = await dialog.showSaveDialog(parentWin, {
        title: "导出为 Word",
        defaultPath: outputName || "export.docx",
        filters: [{ name: "Word Document", extensions: ["docx"] }],
      });

      if (canceled || !filePath) return Promise.reject(new Error("用户取消了保存"));
      try {
        fs.writeFileSync(filePath, buffer);
      } catch (error) {
        console.error("导出 Word 失败:", error);
        return Promise.reject(error);
      }
    }
  );
}
// 无需 win 的 ipc 处理
export function registerGlobalIpcHandlers() {
  // ── Tab 拖拽分离：开始跟随（创建新窗口并跟随光标）────
  ipcMain.handle(
    "tab:tear-off-start",
    async (
      event,
      tabData: TearOffTabData,
      screenX: number,
      screenY: number,
      offsetX: number,
      offsetY: number
    ): Promise<boolean> => {
      try {
        const sourceWin = BrowserWindow.fromWebContents(event.sender);
        startDragFollow(tabData, screenX, screenY, offsetX, offsetY, sourceWin);
        return true;
      } catch (error) {
        console.error("[tab:tear-off-start] 创建窗口失败:", error);
        return false;
      }
    }
  );

  // ── Tab 拖拽分离：完成跟随（松手时判断合并或保留）──
  ipcMain.handle(
    "tab:tear-off-end",
    async (
      event,
      screenX: number,
      screenY: number
    ): Promise<{ action: "created" | "merged" | "failed" }> => {
      try {
        const sourceWin = BrowserWindow.fromWebContents(event.sender);
        const result = await finalizeDragFollow(screenX, screenY, sourceWin);
        // 延迟聚焦新窗口：让源窗口 renderer 先完成 close → switchToTab → 编辑器内容刷新
        // 编辑器 setMarkdown 在 requestAnimationFrame 中执行，源窗口失焦后 RAF 会被限流
        if (result.action === "created" && result.newWin && !result.newWin.isDestroyed()) {
          const newWin = result.newWin;
          setTimeout(() => {
            if (!newWin.isDestroyed()) newWin.focus();
          }, 200);
        }
        return { action: result.action };
      } catch (error) {
        console.error("[tab:tear-off-end] 操作失败:", error);
        return { action: "failed" };
      }
    }
  );

  // ── Tab 拖拽分离：取消跟随（指针回到窗口内时取消分离）──
  ipcMain.handle("tab:tear-off-cancel", async (): Promise<boolean> => {
    try {
      await cancelDragFollow();
      return true;
    } catch (error) {
      console.error("[tab:tear-off-cancel] 取消失败:", error);
      return false;
    }
  });

  // ── 跨窗口文件去重：检查文件是否已在某个窗口打开 ────────
  ipcMain.handle(
    "file:focus-if-open",
    async (event, filePath: string): Promise<{ found: boolean }> => {
      const sourceWin = BrowserWindow.fromWebContents(event.sender);
      const targetWin = findWindowWithFile(filePath, sourceWin?.id);
      if (!targetWin) return { found: false };

      targetWin.webContents.send("tab:activate-file", filePath);
      targetWin.focus();
      return { found: true };
    }
  );

  // ── 新窗口获取初始 Tab 数据 ─────────────────────────────
  ipcMain.handle("tab:get-init-data", (event) => {
    const data = consumePendingTabData(event.sender.id);
    // 预设未保存状态，避免窗口初始化前被关闭时误认为“已保存”
    if (data?.isModified) {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) windowSaveState.set(win.id, false);
    }
    return data;
  });

  // ── 获取当前窗口边界（用于渲染进程判断拖拽是否出界）────
  ipcMain.handle("window:get-bounds", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    return win.getBounds();
  });

  // ── 单 Tab 窗口拖拽：直接移动窗口 ─────────────────────
  ipcMain.on(
    "window:start-drag",
    (event, tabData: TearOffTabData, offsetX: number, offsetY: number) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) return;
      // 记录 drag offset 并启动窗口位置跟随定时器
      startWindowDrag(win, tabData, offsetX, offsetY);
    }
  );

  ipcMain.on("window:stop-drag", () => {
    stopWindowDrag();
  });

  // ── 单 Tab 窗口松手：判断是否合并到目标窗口 ─────────────
  ipcMain.handle(
    "window:drop-merge",
    async (
      event,
      tabData: TearOffTabData,
      screenX: number,
      screenY: number
    ): Promise<{ action: "merged" | "none" }> => {
      const sourceWin = BrowserWindow.fromWebContents(event.sender);
      const previewTarget = finalizeWindowDragMerge();
      if (previewTarget && !previewTarget.isDestroyed()) {
        previewTarget.focus();
        return { action: "merged" };
      }
      // 查找目标窗口
      for (const win of getEditorWindows()) {
        if (win === sourceWin || win.isDestroyed()) continue;
        const { x, y, width, height } = win.getBounds();
        if (screenX >= x && screenX <= x + width && screenY >= y && screenY <= y + height) {
          win.webContents.send("tab:merge-in", tabData);
          win.focus();
          return { action: "merged" };
        }
      }
      clearWindowDragPreview();
      return { action: "none" };
    }
  );

  // 通过文件路径读取 Markdown 文件（用于拖拽）
  ipcMain.handle("file:readByPath", async (_event, filePath: string) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;

      const isMd = /\.(?:md|markdown)$/i.test(filePath);
      if (!isMd) return null;

      const raw = fs.readFileSync(filePath, "utf-8");
      const fileTraits = detectFileTraits(raw);
      const content = cleanupProtocolUrls(normalizeMarkdown(raw), filePath);
      return { filePath, content, fileTraits };
    } catch (error) {
      console.error("Failed to read file:", error);
      return null;
    }
  });
  // 获取剪贴板中的文件路径
  ipcMain.handle("clipboard:getFilePath", async () => {
    const platform = process.platform;
    try {
      if (platform === "win32") {
        const buf = clipboard.readBuffer("FileNameW");
        const raw = buf.toString("ucs2").replace(/\0/g, "");
        return raw.split("\r\n").filter((s) => s.trim())[0] || null;
      } else if (platform === "darwin") {
        const url = clipboard.read("public.file-url");
        return url ? [url.replace("file://", "")] : [];
      } else {
        return [];
      }
    } catch {
      return [];
    }
  });
  // 将临时图片写入剪贴板
  ipcMain.handle(
    "clipboard:writeTempImage",
    async (_event, file: Uint8Array<ArrayBuffer>, tempPath: string) => {
      const tempDir = path.join(__dirname, tempPath || "/temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }
      const filePath = path.join(tempDir, `temp-image-${Date.now()}.png`);
      fs.writeFileSync(filePath, file);
      return filePath;
    }
  );
  // 获取系统字体列表
  ipcMain.handle("get-system-fonts", async () => {
    try {
      const fonts = await getFonts();

      return fonts;
    } catch (error) {
      console.error("获取系统字体失败:", error);
      return [];
    }
  });

  // 获取目录下的文件列表（树形结构）
  ipcMain.handle("workspace:getDirectoryFiles", async (_event, dirPath: string) => {
    try {
      if (!dirPath || !fs.existsSync(dirPath)) {
        return [];
      }

      interface WorkSpace {
        name: string;
        path: string;
        isDirectory: boolean;
        mtime: number;
        children?: WorkSpace[];
      }

      // 性能优化配置
      const MAX_DEPTH = 10; // 最大扫描深度
      const MAX_FILES_PER_DIR = 100; // 每个目录最大文件数
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
      ];

      function shouldIgnoreDirectory(name: string): boolean {
        return IGNORE_PATTERNS.some((pattern) => pattern.test(name));
      }

      function scanDirectory(currentPath: string, depth: number = 0): WorkSpace[] {
        // 限制扫描深度
        if (depth > MAX_DEPTH) {
          return [];
        }

        try {
          const items = fs.readdirSync(currentPath, { withFileTypes: true });

          // 限制每个目录的文件数量
          if (items.length > MAX_FILES_PER_DIR) {
            console.warn(`目录 ${currentPath} 包含过多文件 (${items.length})，已限制扫描`);
            items.splice(MAX_FILES_PER_DIR);
          }

          // 先添加文件夹，再添加文件
          const directories: WorkSpace[] = [];
          const files: WorkSpace[] = [];

          for (const item of items) {
            const itemPath = path.join(currentPath, item.name);

            if (item.isDirectory()) {
              // 跳过忽略的目录
              if (shouldIgnoreDirectory(item.name)) {
                continue;
              }

              const children = scanDirectory(itemPath, depth + 1);
              // 只有当文件夹包含markdown文件或子文件夹时才显示
              if (children.length > 0) {
                let dirMtime = 0;
                try {
                  dirMtime = fs.statSync(itemPath).mtimeMs;
                } catch {}
                directories.push({
                  name: item.name,
                  path: itemPath,
                  isDirectory: true,
                  mtime: dirMtime,
                  children,
                });
              }
            } else if (item.isFile() && /\.(?:md|markdown)$/i.test(item.name)) {
              let fileMtime = 0;
              try {
                fileMtime = fs.statSync(itemPath).mtimeMs;
              } catch {}
              files.push({
                name: item.name,
                path: itemPath,
                isDirectory: false,
                mtime: fileMtime,
              });
            }
          }

          // 按名称排序
          directories.sort((a, b) => a.name.localeCompare(b.name));
          files.sort((a, b) => a.name.localeCompare(b.name));

          return [...directories, ...files];
        } catch (error) {
          console.warn(`扫描目录失败: ${currentPath}`, error);
          return [];
        }
      }

      return scanDirectory(dirPath);
    } catch (error) {
      console.error("获取目录文件失败:", error);
      return [];
    }
  });

  // 监听文件变化
  ipcMain.on("file:watch", (event, filePaths: string[]) => {
    // 更新主进程的文件打开索引（用于跨窗口文件去重 O(1) 查询）
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) updateWindowOpenFiles(win.id, filePaths);

    // 先差异对比
    const newFiles = filePaths.filter((filePath) => !watchedFiles.has(filePath));
    const removedFiles = Array.from(watchedFiles).filter(
      (filePath) => !filePaths.includes(filePath)
    );

    // 如果 watcher 不存在，创建它并设置事件监听
    if (!watcher) {
      watcher = chokidar.watch([], {
        ignored: (path, stats) => {
          // 确保总是返回 boolean 类型
          if (!stats) return false;
          return stats.isFile() && !path.endsWith(".md");
        },
        persistent: true,
      });

      // 设置文件变化监听 —— 广播到所有编辑器窗口
      watcher.on("change", (filePath) => {
        for (const editorWin of getEditorWindows()) {
          if (!editorWin.isDestroyed()) {
            editorWin.webContents.send("file:changed", filePath);
          }
        }
      });
    }

    // 新增的文件 - 添加到 watcher
    if (newFiles.length > 0) {
      watcher.add(newFiles);
      newFiles.forEach((filePath) => watchedFiles.add(filePath));
    }

    // 移除的文件 - 从 watcher 中移除
    if (removedFiles.length > 0) {
      watcher.unwatch(removedFiles);
      removedFiles.forEach((filePath) => watchedFiles.delete(filePath));
    }
  });

  // 监听目录变化（用于文件列表自动刷新）
  ipcMain.on("workspace:watchDirectory", (_event, dirPath: string) => {
    // 先关闭旧的 watcher
    if (directoryWatcher) {
      directoryWatcher.close();
      directoryWatcher = null;
    }

    if (!dirPath || !fs.existsSync(dirPath)) return;

    const IGNORE_DIRS =
      /(?:^|[/\\])(?:\.git|\.vscode|\.idea|node_modules|\.next|\.nuxt|dist|build|coverage)(?:[/\\]|$)/;

    directoryWatcher = chokidar.watch(dirPath, {
      ignoreInitial: true,
      depth: 10,
      ignored: (watchPath) => IGNORE_DIRS.test(watchPath),
      persistent: true,
    });

    const notifyChanged = () => {
      if (directoryChangedDebounceTimer) clearTimeout(directoryChangedDebounceTimer);
      directoryChangedDebounceTimer = setTimeout(() => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("workspace:directory-changed");
        }
      }, 300);
    };

    directoryWatcher.on("add", notifyChanged);
    directoryWatcher.on("unlink", notifyChanged);
    directoryWatcher.on("addDir", notifyChanged);
    directoryWatcher.on("unlinkDir", notifyChanged);
  });

  // 停止监听目录
  ipcMain.on("workspace:unwatchDirectory", () => {
    if (directoryWatcher) {
      directoryWatcher.close();
      directoryWatcher = null;
    }
    if (directoryChangedDebounceTimer) {
      clearTimeout(directoryChangedDebounceTimer);
      directoryChangedDebounceTimer = null;
    }
  });

  // 创建文件
  ipcMain.handle(
    "workspace:createFile",
    async (_event, { dirPath, fileName }: { dirPath: string; fileName: string }) => {
      try {
        const filePath = path.join(dirPath, fileName);
        fs.writeFileSync(filePath, "", "utf-8");
        return filePath;
      } catch (error) {
        console.error("创建文件失败:", error);
        return null;
      }
    }
  );

  // 删除文件或文件夹
  ipcMain.handle("workspace:deleteFile", async (_event, filePath: string) => {
    try {
      fs.rmSync(filePath, { recursive: true });
      return true;
    } catch (error) {
      console.error("删除文件失败:", error);
      return false;
    }
  });

  // 重命名文件或文件夹
  ipcMain.handle(
    "workspace:renameFile",
    async (_event, { oldPath, newName }: { oldPath: string; newName: string }) => {
      try {
        const dir = path.dirname(oldPath);
        const newPath = path.join(dir, newName);
        fs.renameSync(oldPath, newPath);
        return newPath;
      } catch (error) {
        console.error("重命名文件失败:", error);
        return null;
      }
    }
  );
}
export function close(win: Electron.BrowserWindow) {
  // 如果窗口已销毁或已在关闭流程中，跳过
  if (win.isDestroyed() || windowClosingSet.has(win.id)) return;

  const isSaved = windowSaveState.get(win.id) ?? true;

  if (isSaved) {
    windowClosingSet.add(win.id);
    win.close();
    cleanupWindowState(win.id);
    // 如果所有窗口都关了（非 macOS），退出应用
    const remaining = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    if (remaining.length === 0 && process.platform !== "darwin") {
      app.quit();
    }
  } else {
    // 有未保存内容，通知渲染进程弹出确认框
    if (!win.isDestroyed()) {
      win.webContents.send("close:confirm");
    }
  }
}

export function getIsQuitting() {
  // 兼容旧逻辑：当所有窗口都在关闭时视为正在退出
  const allWindows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  return allWindows.length === 0 || allWindows.every((w) => windowClosingSet.has(w.id));
}
export function isFileReadOnly(filePath: string): boolean {
  // 先检测是否可写（跨平台）
  try {
    fs.accessSync(filePath, fs.constants.W_OK);
  } catch {
    return true;
  }

  // 如果是 Windows，再额外检测 "R" 属性
  if (process.platform === "win32") {
    try {
      const attrs = execSync(`attrib "${filePath}"`).toString();
      // attrs 输出格式类似于: "A  R       C:\path\to\file.md"
      // 我们需要解析属性部分，忽略文件路径部分

      // 1. 获取包含文件路径的那一行 (通常只有一行，但以防万一)
      const lines = attrs.split("\r\n").filter((line) => line.trim());
      const fileLine = lines.find((line) => line.trim().endsWith(filePath)) || lines[0];

      if (fileLine) {
        // 2. 截取文件路径之前的部分作为属性区域
        // 文件路径可能包含空格，所以不能简单 split
        const lastIndex = fileLine.lastIndexOf(filePath);
        if (lastIndex > -1) {
          const attrPart = fileLine.substring(0, lastIndex);
          // 3. 检查属性区域是否包含 'R'
          if (attrPart.includes("R")) {
            return true;
          }
        }
      }
    } catch (e) {
      console.error("Check file read-only error:", e);
    }
  }

  return false;
}

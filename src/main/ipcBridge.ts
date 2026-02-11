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
  detectFileTraits,
  normalizeMarkdown,
  processImagePaths,
  restoreFileTraits,
} from "./fileFormat";
import { createThemeEditorWindow } from "./index";

let isSaved = true;
let isQuitting = false;

// 存储已监听的文件路径和对应的 watcher
const watchedFiles = new Set<string>();
let watcher: FSWatcher | null = null;

// 所有 on 类型监听
export function registerIpcOnHandlers(win: Electron.BrowserWindow) {
  ipcMain.on("set-title", (_event, filePath: string | null) => {
    const title = filePath ? `milkup - ${path.basename(filePath)}` : "milkup - Untitled";
    win.setTitle(title);
  });
  ipcMain.on("window-control", async (_event, action) => {
    if (!win) return;
    switch (action) {
      case "minimize":
        win.minimize();
        break;
      case "maximize":
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
        break;
      case "close":
        if (process.platform === "darwin") {
          // 在 macOS 上，窗口关闭按钮只隐藏窗口
          win.hide();
        } else {
          // 其他平台直接退出
          close(win);
        }
        break;
    }
  });
  ipcMain.on("shell:openExternal", (_event, url) => {
    shell.openExternal(url);
  });
  ipcMain.on("change-save-status", (_event, isSavedStatus) => {
    isSaved = isSavedStatus;
    win.webContents.send("save-status-changed", isSaved);
  });

  // 监听保存事件
  ipcMain.on("menu-save", async (_event, shouldClose) => {
    win.webContents.send("trigger-save", shouldClose);
  });

  // 监听丢弃更改事件
  ipcMain.on("close:discard", () => {
    isQuitting = true;
    win.close();
    app.quit();
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

// 所有 handle 类型监听
export function registerIpcHandleHandlers(win: Electron.BrowserWindow) {
  // 检查文件是否只读
  ipcMain.handle("file:isReadOnly", async (_event, filePath: string) => {
    return isFileReadOnly(filePath);
  });

  // 文件打开对话框
  ipcMain.handle("dialog:openFile", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      properties: ["openFile"],
    });
    if (canceled) return null;
    const filePath = filePaths[0];
    const raw = fs.readFileSync(filePath, "utf-8");
    const fileTraits = detectFileTraits(raw);
    const rawContent = normalizeMarkdown(raw);
    const content = processImagePaths(rawContent, filePath);
    return { filePath, content, rawContent, fileTraits };
  });

  // 文件保存对话框
  ipcMain.handle(
    "dialog:saveFile",
    async (
      _event,
      {
        filePath,
        content,
        fileTraits,
      }: { filePath: string | null; content: string; fileTraits?: FileTraits }
    ) => {
      if (!filePath) {
        const { canceled, filePath: savePath } = await dialog.showSaveDialog(win, {
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
  ipcMain.handle("dialog:saveFileAs", async (_event, content) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, content, "utf-8");
    return { filePath };
  });

  // 同步显示消息框
  ipcMain.handle("dialog:OpenDialog", async (_event, options: Electron.MessageBoxSyncOptions) => {
    const response = await dialog.showMessageBox(win, options);
    return response;
  });

  // 显示文件覆盖确认对话框
  ipcMain.handle("dialog:showOverwriteConfirm", async (_event, fileName: string) => {
    const result = await dialog.showMessageBox(win, {
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
  ipcMain.handle("dialog:showCloseConfirm", async (_event, fileName: string) => {
    const result = await dialog.showMessageBox(win, {
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
  ipcMain.handle("dialog:showOpenDialog", async (_event, options: any) => {
    const result = await dialog.showOpenDialog(win, options);
    return result;
  });
  // 导出为 pdf 文件
  ipcMain.handle(
    "file:exportPDF",
    async (
      _event,
      elementSelector: string,
      outputName: string,
      options?: ExportPDFOptions
    ): Promise<void> => {
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
      const cssKey = await win.webContents.insertCSS(preventCutOffStyle);

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
        `);
      try {
        // 2. 导出 PDF
        const pdfData = await win.webContents.printToPDF({
          printBackground: true,
          pageSize,
          margins: {
            marginType: "printableArea",
          },
          scale,
        });

        // 3. 保存 PDF 文件
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
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
        win.webContents.executeJavaScript(`
                  (function() {
                    const container = document.querySelector('.electron-export-container');
                    if (container) container.remove();
                    document.body.style.visibility = 'visible';
                  })();
                `);
        // 移除插入的样式
        if (cssKey) win.webContents.removeInsertedCSS(cssKey);
      }
    }
  );
  // 导出为 word 文件
  ipcMain.handle(
    "file:exportWord",
    async (_event, blocks: Block[], outputName: string): Promise<void> => {
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

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
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
  // 通过文件路径读取 Markdown 文件（用于拖拽）
  ipcMain.handle("file:readByPath", async (_event, filePath: string) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;

      const isMd = /\.(?:md|markdown)$/i.test(filePath);
      if (!isMd) return null;

      const raw = fs.readFileSync(filePath, "utf-8");
      const fileTraits = detectFileTraits(raw);
      const rawContent = normalizeMarkdown(raw);
      const content = processImagePaths(rawContent, filePath);
      return { filePath, content, rawContent, fileTraits };
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
                directories.push({
                  name: item.name,
                  path: itemPath,
                  isDirectory: true,
                  children,
                });
              }
            } else if (item.isFile() && /\.(?:md|markdown)$/i.test(item.name)) {
              files.push({
                name: item.name,
                path: itemPath,
                isDirectory: false,
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
  ipcMain.on("file:watch", (_event, filePaths: string[]) => {
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

      // 设置文件变化监听
      watcher.on("change", (filePath) => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("file:changed", filePath);
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
}
export function close(win: Electron.BrowserWindow) {
  // 防止重复调用
  if (isQuitting) {
    return;
  }

  if (isSaved) {
    isQuitting = true;
    win.close();
    app.quit();
  } else {
    // 检查窗口是否仍然有效
    if (win && !win.isDestroyed()) {
      // 发送事件到渲染进程显示前端弹窗
      win.webContents.send("close:confirm");
    }
  }
}

export function getIsQuitting() {
  return isQuitting;
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

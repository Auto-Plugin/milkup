/**
 * 窗口管理器 - 支持多窗口 Tab 拖拽分离
 *
 * 职责：
 * 1. 跟踪所有编辑器窗口
 * 2. 创建配置统一的编辑器窗口
 * 3. 管理 Tab 拖拽分离的数据传递
 */

import * as path from "node:path";
import { BrowserWindow, screen, shell } from "electron";
import type { TearOffTabData } from "../shared/types/tearoff";

export type { TearOffTabData };

export interface CreateWindowOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  tabData?: TearOffTabData;
  /** 快速创建：不等待页面加载完成，不自动打开 devtools */
  fastCreate?: boolean;
  /** 是否将 x,y 视为中心点 (如果是 false，则 x,y 为左上角坐标) */
  center?: boolean;
}

// ─── 状态 ────────────────────────────────────────────────────

/** 所有活跃的编辑器窗口 */
const editorWindows = new Set<BrowserWindow>();

/** 尚未被新窗口消费的 Tab 数据（按 webContentsId 索引） */
const pendingTabData = new Map<number, TearOffTabData>();

/** 每个窗口当前打开的文件路径（用于跨窗口文件去重 O(1) 查询） */
const windowOpenFiles = new Map<number, Set<string>>();

/** 主窗口引用（macOS 需要区分主窗口与普通窗口） */
let mainWindow: BrowserWindow | null = null;

// ─── 查询 ────────────────────────────────────────────────────

export function getEditorWindows(): ReadonlySet<BrowserWindow> {
  return editorWindows;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function isMainWindow(win: BrowserWindow): boolean {
  return win === mainWindow;
}

/** 更新指定窗口的打开文件列表 */
export function updateWindowOpenFiles(winId: number, filePaths: string[]): void {
  windowOpenFiles.set(winId, new Set(filePaths));
}

/** 查找已打开指定文件的窗口（O(1) 查询，排除指定窗口） */
export function findWindowWithFile(filePath: string, excludeWinId?: number): BrowserWindow | null {
  for (const [winId, files] of windowOpenFiles) {
    if (winId === excludeWinId) continue;
    if (!files.has(filePath)) continue;
    const win = BrowserWindow.fromId(winId);
    if (win && !win.isDestroyed()) return win;
  }
  return null;
}

/**
 * 根据屏幕坐标查找对应位置的编辑器窗口
 * @param screenX 屏幕 X 坐标
 * @param screenY 屏幕 Y 坐标
 * @param excludeWin 排除的窗口（通常是发起方自身）
 */
export function findWindowAtPosition(
  screenX: number,
  screenY: number,
  excludeWin?: BrowserWindow | null
): BrowserWindow | null {
  for (const win of editorWindows) {
    if (win === excludeWin || win.isDestroyed()) continue;
    const { x, y, width, height } = win.getBounds();
    if (screenX >= x && screenX <= x + width && screenY >= y && screenY <= y + height) {
      return win;
    }
  }
  return null;
}

// ─── 窗口追踪 ───────────────────────────────────────────────

export function trackWindow(win: BrowserWindow, isMain = false): void {
  editorWindows.add(win);
  if (isMain) mainWindow = win;

  // 提前缓存 —— closed 事件触发时窗口已销毁，无法再访问属性
  const webContentsId = win.webContents.id;
  const winId = win.id;

  win.on("closed", () => {
    editorWindows.delete(win);
    pendingTabData.delete(webContentsId);
    windowOpenFiles.delete(winId);
    if (win === mainWindow) mainWindow = null;
  });
}

// ─── 待消费 Tab 数据 ─────────────────────────────────────────

export function setPendingTabData(webContentsId: number, data: TearOffTabData): void {
  pendingTabData.set(webContentsId, data);
}

/** 取出并删除，确保只消费一次 */
export function consumePendingTabData(webContentsId: number): TearOffTabData | null {
  const data = pendingTabData.get(webContentsId);
  if (data) pendingTabData.delete(webContentsId);
  return data ?? null;
}

// ─── 窗口创建 ────────────────────────────────────────────────

/**
 * 创建一个新的编辑器窗口
 * - 与主窗口共享相同的 webPreferences、外链处理等配置
 * - 可选传入 tabData，窗口加载完成后由渲染进程通过 IPC 取回
 */
export async function createEditorWindow(
  options: CreateWindowOptions = {}
): Promise<BrowserWindow> {
  const { x, y, width = 1000, height = 700, tabData, fastCreate = false, center = true } = options;

  const winOptions: Electron.BrowserWindowConstructorOptions = {
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: "hidden",
    show: !fastCreate, // 拖拽跟随窗口初始不显示，避免抢夺焦点
    icon: path.join(__dirname, "../assets/icons/milkup.ico"),
    webPreferences: {
      sandbox: false,
      preload: path.resolve(__dirname, "../../dist-electron/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  };

  // 设置窗口位置
  if (x !== undefined && y !== undefined) {
    if (center) {
      winOptions.x = Math.round(x - width / 2);
      winOptions.y = Math.round(y - 20);
    } else {
      winOptions.x = Math.round(x);
      winOptions.y = Math.round(y);
    }
  }

  const win = new BrowserWindow(winOptions);
  trackWindow(win);

  // 存储待消费的 Tab 数据
  if (tabData) {
    setPendingTabData(win.webContents.id, tabData);
  }

  // ── 外链处理（与主窗口一致）──────────────────────────────
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) {
      return;
    }
    if (url.startsWith("https:") || url.startsWith("http:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // ── 加载页面 ──────────────────────────────────────────────
  const indexPath = path.join(__dirname, "../../dist", "index.html");

  if (process.env.VITE_DEV_SERVER_URL) {
    if (fastCreate) {
      win.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
      await win.loadURL(process.env.VITE_DEV_SERVER_URL);
    }
  } else {
    if (fastCreate) {
      win.loadFile(indexPath);
    } else {
      await win.loadFile(indexPath);
    }
  }

  if (process.env.VITE_DEV_SERVER_URL && !fastCreate) {
    win.webContents.openDevTools();
  }

  // fastCreate 模式下显示窗口但不抢焦点
  if (fastCreate) {
    win.showInactive();
  }

  return win;
}

// ─── 拖拽跟随（创建新窗口并跟随光标直到松手）───────────

// ─── 合并预览（拖拽悬停即合并，离开撤销）─────────────────

const mergePreviewTargets = new Map<number, BrowserWindow | null>();

function updateMergePreview(
  sourceWinId: number,
  tabData: TearOffTabData,
  screenX: number,
  screenY: number,
  excludeWins: BrowserWindow[] = []
): BrowserWindow | null {
  let target: BrowserWindow | null = null;

  for (const win of editorWindows) {
    if (win.isDestroyed()) continue;
    if (win.id === sourceWinId) continue;
    if (excludeWins.includes(win)) continue;
    const { x, y, width, height } = win.getBounds();
    if (screenX >= x && screenX <= x + width && screenY >= y && screenY <= y + height) {
      target = win;
      break;
    }
  }

  const prev = mergePreviewTargets.get(sourceWinId) ?? null;
  if (prev?.id === target?.id) {
    // 目标窗口未变，但光标位置变了 → 发送位置更新以动态调整预览 Tab 插入位置
    if (target && !target.isDestroyed()) {
      target.webContents.send("tab:merge-preview-update", screenX, screenY);
    }
    return target;
  }

  if (prev && !prev.isDestroyed()) {
    prev.webContents.send("tab:merge-preview-cancel");
  }
  if (target && !target.isDestroyed()) {
    target.webContents.send("tab:merge-preview", tabData, screenX, screenY);
  }

  mergePreviewTargets.set(sourceWinId, target ?? null);
  return target;
}

function finalizeMergePreview(sourceWinId: number): BrowserWindow | null {
  const target = mergePreviewTargets.get(sourceWinId) ?? null;
  if (target && !target.isDestroyed()) {
    target.webContents.send("tab:merge-preview-finalize");
  }
  mergePreviewTargets.delete(sourceWinId);
  return target ?? null;
}

function clearMergePreview(sourceWinId: number): void {
  const target = mergePreviewTargets.get(sourceWinId) ?? null;
  if (target && !target.isDestroyed()) {
    target.webContents.send("tab:merge-preview-cancel");
  }
  mergePreviewTargets.delete(sourceWinId);
}

// ─── 单 Tab 窗口拖拽（直接移动整个窗口）─────────────────

let windowDragInterval: ReturnType<typeof setInterval> | null = null;
let windowDragSourceId: number | null = null;
let windowDragTabData: TearOffTabData | null = null;
let windowDragSourceWin: BrowserWindow | null = null;

/**
 * 开始以 ~60fps 让窗口跟随光标
 * @param offsetX 鼠标相对窗口左上角的 X 偏移
 * @param offsetY 鼠标相对窗口左上角的 Y 偏移
 */
export function startWindowDrag(
  win: BrowserWindow,
  tabData: TearOffTabData,
  offsetX: number,
  offsetY: number
): void {
  stopWindowDrag();
  windowDragSourceId = win.id;
  windowDragTabData = tabData;
  windowDragSourceWin = win;
  let prevCX = -1,
    prevCY = -1;
  windowDragInterval = setInterval(() => {
    if (!win || win.isDestroyed()) {
      stopWindowDrag();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    if (cursor.x === prevCX && cursor.y === prevCY) return;
    prevCX = cursor.x;
    prevCY = cursor.y;

    let target: BrowserWindow | null = null;
    if (windowDragSourceId && windowDragTabData) {
      target = updateMergePreview(windowDragSourceId, windowDragTabData, cursor.x, cursor.y, [win]);
    }

    // 始终跟随光标移动（即使透明化也要移动，确保渲染进程能接收鼠标事件）
    win.setPosition(Math.round(cursor.x - offsetX), Math.round(cursor.y - offsetY));

    if (target) {
      // 合并预览激活 → 透明化源窗口，让用户视觉上感知 Tab 已并入目标窗口
      // 使用 setOpacity(0) 而非 hide()，保持窗口可接收鼠标事件（SortableJS 需要 pointerup）
      if (win.getOpacity() > 0) {
        win.setOpacity(0);
      }
    } else {
      // 无目标窗口 → 恢复可见
      if (win.getOpacity() === 0) {
        win.setOpacity(1);
      }
    }
  }, 16);
}

export function stopWindowDrag(): void {
  if (windowDragInterval) {
    clearInterval(windowDragInterval);
    windowDragInterval = null;
  }
  // 恢复源窗口透明度（拖拽期间可能被透明化）
  if (
    windowDragSourceWin &&
    !windowDragSourceWin.isDestroyed() &&
    windowDragSourceWin.getOpacity() === 0
  ) {
    windowDragSourceWin.setOpacity(1);
  }
  windowDragSourceWin = null;
}

export function finalizeWindowDragMerge(): BrowserWindow | null {
  if (!windowDragSourceId) return null;
  const target = finalizeMergePreview(windowDragSourceId);
  windowDragSourceId = null;
  windowDragTabData = null;
  windowDragSourceWin = null;
  return target;
}

export function clearWindowDragPreview(): void {
  if (windowDragSourceId) {
    clearMergePreview(windowDragSourceId);
  }
  windowDragSourceId = null;
  windowDragTabData = null;
  windowDragSourceWin = null;
}

// ─── 多 Tab 拖拽跟随（创建新窗口并跟随光标直到松手）─────

interface DragFollowState {
  interval: ReturnType<typeof setInterval>;
  window: BrowserWindow;
  tabData: TearOffTabData;
  sourceWinId: number | null;
  hiddenForPreview: boolean;
}

let dragFollowState: DragFollowState | null = null;
let dragFollowReady: Promise<void> | null = null;

/**
 * 开始拖拽跟随：立即创建新窗口并以 ~60fps 跟随光标移动
 * 渲染进程 fire-and-forget 调用，无需等待返回
 */
export function startDragFollow(
  tabData: TearOffTabData,
  screenX: number,
  screenY: number,
  offsetX: number,
  offsetY: number,
  sourceWin: BrowserWindow | null
): void {
  cleanupDragFollow();

  dragFollowReady = (async () => {
    // 初始位置：根据 offset 计算窗口位置
    // 从 screenX/Y 中减去 offset，使窗口内的 tab 相对鼠标位置不变
    const initX = Math.round(screenX - offsetX);
    const initY = Math.round(screenY - offsetY);

    const win = await createEditorWindow({
      x: initX,
      y: initY,
      tabData,
      fastCreate: true,
      center: false,
    });

    // 如果在等待期间已被取消
    if (!dragFollowReady) return;

    let prevCX = -1,
      prevCY = -1;
    const interval = setInterval(() => {
      if (!win || win.isDestroyed()) {
        cleanupDragFollow();
        return;
      }
      const cursor = screen.getCursorScreenPoint();
      if (cursor.x === prevCX && cursor.y === prevCY) return;
      prevCX = cursor.x;
      prevCY = cursor.y;
      win.setPosition(Math.round(cursor.x - offsetX), Math.round(cursor.y - offsetY));

      if (dragFollowState) {
        const sourceId = dragFollowState.sourceWinId;
        if (sourceId) {
          const target = updateMergePreview(sourceId, tabData, cursor.x, cursor.y, [win]);
          if (target && !dragFollowState.hiddenForPreview) {
            win.hide();
            dragFollowState.hiddenForPreview = true;
          } else if (!target && dragFollowState.hiddenForPreview) {
            win.showInactive();
            dragFollowState.hiddenForPreview = false;
          }
        }
      }
    }, 16);

    dragFollowState = {
      interval,
      window: win,
      tabData,
      sourceWinId: sourceWin?.id ?? null,
      hiddenForPreview: false,
    };
  })();
}

/** 内部清理（不关闭新窗口） */
function cleanupDragFollow(): void {
  if (dragFollowState) {
    clearInterval(dragFollowState.interval);
    if (dragFollowState.sourceWinId) {
      clearMergePreview(dragFollowState.sourceWinId);
    }
    dragFollowState = null;
  }
  dragFollowReady = null;
}

/**
 * 取消拖拽跟随：停止跟随并关闭已创建的新窗口
 * 当用户把 Tab 拖回原窗口时由渲染进程调用
 */
export async function cancelDragFollow(): Promise<void> {
  // 等待窗口创建完成（可能仍在创建中）
  if (dragFollowReady) {
    try {
      await dragFollowReady;
    } catch {
      cleanupDragFollow();
      return;
    }
  }

  if (!dragFollowState) {
    dragFollowReady = null;
    return;
  }

  const { interval, window: newWin, sourceWinId } = dragFollowState;
  clearInterval(interval);
  if (sourceWinId) {
    clearMergePreview(sourceWinId);
  }
  dragFollowState = null;
  dragFollowReady = null;

  // 关闭已创建的新窗口
  if (newWin && !newWin.isDestroyed()) {
    newWin.close();
  }
}

/**
 * 完成拖拽跟随：停止跟随、判断合并或保留新窗口
 * 由渲染进程在 SortableJS onEnd（鼠标松开）时调用
 */
export async function finalizeDragFollow(
  screenX: number,
  screenY: number,
  sourceWin: BrowserWindow | null
): Promise<{ action: "created" | "merged" | "failed"; newWin?: BrowserWindow }> {
  // 等待窗口创建完成（快速松手时可能仍在创建中）
  if (dragFollowReady) {
    try {
      await dragFollowReady;
    } catch {
      cleanupDragFollow();
      return { action: "failed" };
    }
  }

  if (!dragFollowState) return { action: "failed" };

  const { interval, window: newWin, tabData, sourceWinId } = dragFollowState;
  clearInterval(interval);
  dragFollowState = null;
  dragFollowReady = null;

  if (newWin.isDestroyed()) return { action: "failed" };

  // 若悬停窗口已产生预览，立即完成合并
  if (sourceWinId) {
    const target = finalizeMergePreview(sourceWinId);
    if (target && !target.isDestroyed()) {
      target.focus();
      newWin.close();
      return { action: "merged" };
    }
  }

  // 查找光标下的目标窗口（排除新窗口与源窗口）
  for (const win of editorWindows) {
    if (win === sourceWin || win === newWin || win.isDestroyed()) continue;
    const { x, y, width, height } = win.getBounds();
    if (screenX >= x && screenX <= x + width && screenY >= y && screenY <= y + height) {
      // ── 合并到已有窗口 ──
      win.webContents.send("tab:merge-in", tabData);
      win.focus();
      newWin.close();
      return { action: "merged" };
    }
  }

  // ── 无目标窗口 → 保留新窗口在当前位置 ──
  return { action: "created", newWin };
}

/**
 * WindowGroup 管理器
 *
 * 核心思路：每个 Tab 对应一个 BrowserWindow，同一"窗口组"的多个 BrowserWindow
 * 在视觉上表现为一个窗口的多个标签页（只有一个可见，其余隐藏）。
 *
 * Tab 切换 = hide 旧窗口 + show 新窗口（零重载）
 * Tab 拖出 = 从组中移除窗口 → 直接 show（零重载）
 * Tab 合入 = 加入目标组 → hide
 */

import { BrowserWindow } from "electron";

// ─── 数据结构 ────────────────────────────────────────────────

export interface TabMeta {
  tabId: string;
  windowId: number; // BrowserWindow.id
  name: string;
  filePath: string | null;
  isModified: boolean;
  readOnly: boolean;
}

export interface WindowGroup {
  groupId: string;
  tabOrder: string[]; // Tab 排列顺序（tabId 数组）
  activeTabId: string | null;
  tabs: Map<string, TabMeta>;
  bounds: Electron.Rectangle; // 共享的窗口位置/尺寸
  isMaximized: boolean;
}

export interface TabListPayload {
  groupId: string;
  tabOrder: string[];
  activeTabId: string | null;
  tabs: Array<{
    tabId: string;
    name: string;
    filePath: string | null;
    isModified: boolean;
    readOnly: boolean;
    isMergePreview?: boolean;
  }>;
}

// ─── 全局索引 ────────────────────────────────────────────────

const groups = new Map<string, WindowGroup>();
const windowToGroup = new Map<number, string>(); // winId → groupId
const tabToWindow = new Map<string, number>(); // tabId → winId

let groupIdCounter = 0;
function nextGroupId(): string {
  return `group-${++groupIdCounter}`;
}

let tabIdCounter = 0;
export function nextTabId(): string {
  return `tab-${++tabIdCounter}`;
}

// ─── 查询 ────────────────────────────────────────────────────

export function getGroup(groupId: string): WindowGroup | undefined {
  return groups.get(groupId);
}

export function getGroupByWindowId(winId: number): WindowGroup | undefined {
  const gid = windowToGroup.get(winId);
  return gid ? groups.get(gid) : undefined;
}

export function getWindowForTab(tabId: string): BrowserWindow | null {
  const winId = tabToWindow.get(tabId);
  if (winId === undefined) return null;
  const win = BrowserWindow.fromId(winId);
  return win && !win.isDestroyed() ? win : null;
}

export function getTabIdByWindowId(winId: number): string | null {
  for (const [tabId, wId] of tabToWindow) {
    if (wId === winId) return tabId;
  }
  return null;
}

/** 查找已打开指定文件的 Tab（跨所有组） */
export function findTabWithFile(
  filePath: string,
  excludeTabId?: string
): { tabMeta: TabMeta; group: WindowGroup } | null {
  for (const group of groups.values()) {
    for (const tab of group.tabs.values()) {
      if (tab.tabId === excludeTabId) continue;
      if (tab.filePath === filePath) return { tabMeta: tab, group };
    }
  }
  return null;
}

// ─── 组操作 ──────────────────────────────────────────────────

/**
 * 创建新的窗口组，包含一个初始窗口
 */
export function createGroup(
  win: BrowserWindow,
  tabId: string,
  meta: Omit<TabMeta, "tabId" | "windowId">
): WindowGroup {
  const groupId = nextGroupId();
  const tabMeta: TabMeta = { tabId, windowId: win.id, ...meta };

  const group: WindowGroup = {
    groupId,
    tabOrder: [tabId],
    activeTabId: tabId,
    tabs: new Map([[tabId, tabMeta]]),
    bounds: win.getBounds(),
    isMaximized: win.isMaximized(),
  };

  groups.set(groupId, group);
  windowToGroup.set(win.id, groupId);
  tabToWindow.set(tabId, win.id);
  setupBoundsSync(win, groupId);

  return group;
}

/**
 * 向现有组添加一个窗口（新 Tab）
 * 新窗口会被隐藏并同步 bounds
 */
export function addTabToGroup(
  groupId: string,
  win: BrowserWindow,
  tabId: string,
  meta: Omit<TabMeta, "tabId" | "windowId">,
  insertIndex?: number
): boolean {
  const group = groups.get(groupId);
  if (!group) return false;

  const tabMeta: TabMeta = { tabId, windowId: win.id, ...meta };
  group.tabs.set(tabId, tabMeta);

  if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= group.tabOrder.length) {
    group.tabOrder.splice(insertIndex, 0, tabId);
  } else {
    group.tabOrder.push(tabId);
  }

  windowToGroup.set(win.id, groupId);
  tabToWindow.set(tabId, win.id);

  // 同步 bounds 并隐藏
  win.setBounds(group.bounds);
  if (group.isMaximized) win.maximize();
  win.hide();

  setupBoundsSync(win, groupId);
  return true;
}

/**
 * 从组中移除一个 Tab（及其窗口）
 * 返回 { win, meta, sourceGroupId }，调用方决定后续操作
 */
export function removeTabFromGroup(tabId: string): {
  win: BrowserWindow;
  meta: TabMeta;
  sourceGroupId: string;
} | null {
  const winId = tabToWindow.get(tabId);
  if (winId === undefined) return null;

  const gid = windowToGroup.get(winId);
  if (!gid) return null;

  const group = groups.get(gid);
  if (!group) return null;

  const meta = group.tabs.get(tabId);
  if (!meta) return null;
  const metaCopy = { ...meta };

  // 从组中移除
  group.tabs.delete(tabId);
  group.tabOrder = group.tabOrder.filter((id) => id !== tabId);
  tabToWindow.delete(tabId);
  windowToGroup.delete(winId);

  // 如果移除的是活跃 Tab，重置为 null（由调用方通过 switchTab 显示下一个）
  if (group.activeTabId === tabId) {
    group.activeTabId = null;
  }

  // 如果组为空，清理组
  if (group.tabs.size === 0) {
    groups.delete(gid);
  }

  const win = BrowserWindow.fromId(winId);
  if (!win || win.isDestroyed()) return null;

  return { win, meta: metaCopy, sourceGroupId: gid };
}

/**
 * 切换组内的活跃 Tab（防闪烁）
 */
export function switchTab(groupId: string, targetTabId: string): boolean {
  const group = groups.get(groupId);
  if (!group || !group.tabs.has(targetTabId)) return false;
  if (group.activeTabId === targetTabId) return true;

  const oldTabId = group.activeTabId;
  const newWinId = tabToWindow.get(targetTabId);
  const oldWinId = oldTabId ? tabToWindow.get(oldTabId) : undefined;

  if (newWinId === undefined) return false;

  const newWin = BrowserWindow.fromId(newWinId);
  if (!newWin || newWin.isDestroyed()) return false;

  // 先更新 activeTabId（确保后续逻辑一致）
  group.activeTabId = targetTabId;

  // 同步位置到新窗口
  if (group.isMaximized) {
    newWin.maximize();
  } else {
    newWin.setBounds(group.bounds);
  }

  // 防闪烁：先显示新窗口（覆盖旧窗口），再隐藏旧窗口
  newWin.showInactive();
  newWin.moveTop();
  newWin.focus();

  // 延迟隐藏旧窗口
  if (oldWinId !== undefined && oldWinId !== newWinId) {
    const oldWin = BrowserWindow.fromId(oldWinId);
    if (oldWin && !oldWin.isDestroyed()) {
      // 使用 setImmediate 确保在当前事件循环结束后执行
      setImmediate(() => {
        if (!oldWin.isDestroyed() && oldWin.isVisible()) {
          oldWin.hide();
        }
      });
    }
  }

  return true;
}

/**
 * 更新 Tab 元信息
 */
export function updateTabMeta(
  tabId: string,
  updates: Partial<Pick<TabMeta, "name" | "filePath" | "isModified" | "readOnly">>
): void {
  const winId = tabToWindow.get(tabId);
  if (winId === undefined) return;
  const gid = windowToGroup.get(winId);
  if (!gid) return;
  const tab = groups.get(gid)?.tabs.get(tabId);
  if (!tab) return;
  Object.assign(tab, updates);
}

/**
 * 重排序 Tab
 */
export function reorderTabs(groupId: string, newOrder: string[]): boolean {
  const group = groups.get(groupId);
  if (!group) return false;
  if (newOrder.length !== group.tabOrder.length) return false;
  for (const id of newOrder) {
    if (!group.tabs.has(id)) return false;
  }
  group.tabOrder = newOrder;
  return true;
}

// ─── Bounds 同步 ─────────────────────────────────────────────

function setupBoundsSync(win: BrowserWindow, groupId: string): void {
  const updateBounds = () => {
    if (win.isDestroyed()) return;
    const group = groups.get(groupId);
    if (!group) return;
    // 只有活跃窗口的 bounds 变化才同步到组
    const tabId = getTabIdByWindowId(win.id);
    if (tabId && group.activeTabId === tabId) {
      if (!win.isMaximized()) {
        group.bounds = win.getBounds();
      }
      group.isMaximized = win.isMaximized();
    }
  };

  win.on("resize", updateBounds);
  win.on("move", updateBounds);

  // 窗口关闭时清理索引
  const cachedWinId = win.id;
  win.on("closed", () => {
    const tabId = getTabIdByWindowId(cachedWinId);
    if (tabId) {
      tabToWindow.delete(tabId);
      const gid = windowToGroup.get(cachedWinId);
      if (gid) {
        const g = groups.get(gid);
        if (g) {
          g.tabs.delete(tabId);
          g.tabOrder = g.tabOrder.filter((id) => id !== tabId);
          if (g.activeTabId === tabId) {
            g.activeTabId = g.tabOrder[0] ?? null;
          }
          if (g.tabs.size === 0) {
            groups.delete(gid);
          }
        }
      }
    }
    windowToGroup.delete(cachedWinId);
  });
}

// ─── 广播 ────────────────────────────────────────────────────

/**
 * 构建 TabListPayload 并广播到组内所有窗口
 */
export function broadcastTabList(groupId: string): void {
  const group = groups.get(groupId);
  if (!group) return;

  const payload = buildTabListPayload(group);

  for (const tabId of group.tabOrder) {
    const winId = tabToWindow.get(tabId);
    if (winId === undefined) continue;
    const win = BrowserWindow.fromId(winId);
    if (win && !win.isDestroyed()) {
      win.webContents.send("group:tab-list-updated", payload);
    }
  }
}

/** 向单个窗口发送 tab list（用于 renderer-ready 时的初始同步） */
export function sendTabListToWindow(win: BrowserWindow): void {
  const group = getGroupByWindowId(win.id);
  if (!group) return;
  const payload = buildTabListPayload(group);
  win.webContents.send("group:tab-list-updated", payload);
}

function buildTabListPayload(group: WindowGroup): TabListPayload {
  return {
    groupId: group.groupId,
    tabOrder: [...group.tabOrder],
    activeTabId: group.activeTabId,
    tabs: group.tabOrder.map((tabId) => {
      const meta = group.tabs.get(tabId)!;
      return {
        tabId: meta.tabId,
        name: meta.name,
        filePath: meta.filePath,
        isModified: meta.isModified,
        readOnly: meta.readOnly,
      };
    }),
  };
}

// ─── 窗口就绪协调 ───────────────────────────────────────────

const windowReadyResolvers = new Map<number, () => void>();
const readyWindows = new Set<number>();

/** 标记窗口渲染进程已就绪（由 renderer-ready IPC 调用） */
export function onWindowReady(winId: number): void {
  readyWindows.add(winId);
  const resolver = windowReadyResolvers.get(winId);
  if (resolver) {
    resolver();
    windowReadyResolvers.delete(winId);
  }
}

/** 等待指定窗口的渲染进程就绪 */
export function waitForWindowReady(winId: number): Promise<void> {
  if (readyWindows.has(winId)) return Promise.resolve();
  return new Promise((resolve) => {
    windowReadyResolvers.set(winId, resolve);
  });
}

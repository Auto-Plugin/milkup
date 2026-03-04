import type { Ref } from "vue";
import type { InertiaScroll } from "@/renderer/utils/inertiaScroll";
import type { Tab } from "@/types/tab";
import autotoast from "autotoast.js";
import { computed, nextTick, ref, toRaw, watch } from "vue";
import { setCurrentMarkdownFilePath } from "@/plugins/imagePathPlugin";
import emitter from "@/renderer/events";
import { createTabDataFromFile, readAndProcessFile } from "@/renderer/services/fileService";
import { createInertiaScroll } from "@/renderer/utils/inertiaScroll";
import { randomUUID } from "@/renderer/utils/tool";
import { isShowOutline } from "./useOutline";

// ─── 新架构：每个窗口只有一个本地 Tab ────────────────────────

/** 本窗口的 Tab 数据 */
const localTab = ref<Tab | null>(null);

/** 主进程同步的 Tab 列表（给 TabBar 显示用） */
const tabList = ref<TabListPayload | null>(null);

/** 当前窗口在组中的 tabId */
const localTabId = ref<string | null>(null);

/** 活跃 Tab ID（从 tabList 读取） */
const activeTabId = computed(() => tabList.value?.activeTabId ?? localTabId.value);

/** 兼容旧接口：tabs 数组（仅含本窗口的 Tab） */
const tabs = computed(() => (localTab.value ? [localTab.value] : []));

/** 当前 Tab（兼容旧接口） */
const currentTab = computed(() => localTab.value);

// 防抖定时器：归一化完成后清除 isNewlyLoaded
let newlyLoadedTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleNewlyLoadedCleanup() {
  if (newlyLoadedTimer) clearTimeout(newlyLoadedTimer);
  newlyLoadedTimer = setTimeout(() => {
    if (localTab.value) localTab.value.isNewlyLoaded = false;
    newlyLoadedTimer = null;
  }, 150);
}

const defaultName = "Untitled";

// ── 窗口初始化 ─────────────────────────────────────────
// 从主进程获取初始化数据（tabId + groupId），然后尝试获取 tear-off 数据

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _initPromise: Promise<void> | null = null;

async function initWindow(): Promise<void> {
  try {
    // 先尝试获取 WindowGroup 初始化数据
    const initData = await window.electronAPI?.groupGetInitData();
    if (initData) {
      localTabId.value = initData.tabId;
      // 同步本地 Tab 的 ID 与主进程一致
      if (localTab.value) {
        localTab.value.id = initData.tabId;
      }
    }

    // 再尝试获取 tear-off 数据（旧架构兼容）
    const tabData: TearOffTabData | null = await window.electronAPI?.getInitialTabData();
    if (tabData) {
      const tab: Tab = {
        id: localTabId.value ?? randomUUID(),
        name: tabData.name,
        filePath: tabData.filePath,
        content: tabData.content,
        originalContent: tabData.originalContent,
        isModified: tabData.isModified,
        scrollRatio: tabData.scrollRatio ?? 0,
        readOnly: tabData.readOnly,
        isNewlyLoaded: !tabData.isModified,
        fileTraits: tabData.fileTraits,
      };
      localTab.value = tab;
      if (!tabData.isModified) scheduleNewlyLoadedCleanup();
      if (tab.filePath) setCurrentMarkdownFilePath(tab.filePath);
      return;
    }
  } catch (error) {
    console.error("[useTab] 窗口初始化失败:", error);
  }
}

_initPromise = initWindow().then(() => {
  _initPromise = null;
});

// 同步创建默认 Tab（确保 UI 立即可用）
if (!localTab.value) {
  localTab.value = {
    id: randomUUID(),
    name: defaultName,
    filePath: null,
    content: "",
    originalContent: "",
    isModified: false,
    scrollRatio: 0,
    readOnly: false,
    isNewlyLoaded: true,
  };
  scheduleNewlyLoadedCleanup();
}

// 监听主进程 Tab 列表广播
window.electronAPI?.on("group:tab-list-updated", (payload: TabListPayload) => {
  tabList.value = payload;
});

// 监听启动时打开文件
window.electronAPI?.onOpenFileAtLaunch((_payload) => {
  if (localTab.value && !localTab.value.filePath && !localTab.value.isModified) {
    // 空白 tab，后续 useFile 中的 onOpenFileAtLaunch 会处理内容更新
  }
});

// ─── 兼容旧接口的函数 ────────────────────────────────────────

function getFileName(filePath: string | null): string {
  if (!filePath) return defaultName;
  const parts = filePath.split(/[\\/]/);
  return parts.at(-1) ?? defaultName;
}

function isFileAlreadyOpen(filePath: string): Tab | null {
  if (localTab.value?.filePath === filePath) return localTab.value;
  return null;
}

function getCurrentTab() {
  return localTab.value;
}

// 更新当前 tab 的内容
function updateCurrentTabContent(content: string, isModified?: boolean) {
  const tab = localTab.value;
  if (!tab) return;

  tab.content = content;

  if (tab.readOnly) {
    tab.isModified = false;
    return;
  }

  if (isModified !== undefined) {
    tab.isModified = isModified;
    return;
  }

  if (tab.isNewlyLoaded) {
    tab.originalContent = content;
    tab.isModified = false;
    scheduleNewlyLoadedCleanup();
    return;
  }

  tab.isModified = content !== tab.originalContent;
}

function updateCurrentTabFile(filePath: string, content: string, name?: string) {
  const tab = localTab.value;
  if (!tab) return;
  tab.filePath = filePath;
  tab.content = content;
  tab.originalContent = content;
  tab.isModified = false;
  tab.isNewlyLoaded = true;
  scheduleNewlyLoadedCleanup();
  if (name) {
    tab.name = name;
  } else {
    tab.name = getFileName(filePath);
  }
}

function updateCurrentTabScrollRatio(ratio: number) {
  if (localTab.value) localTab.value.scrollRatio = ratio;
}

async function saveTab(tab: Tab): Promise<boolean> {
  if (!tab || tab.readOnly) return false;
  try {
    const saved = await window.electronAPI.saveFile(
      tab.filePath,
      tab.content,
      toRaw(tab.fileTraits)
    );
    if (saved) {
      tab.filePath = saved;
      tab.name = getFileName(saved);
      tab.originalContent = tab.content;
      tab.isModified = false;
      // 通知主进程更新 meta
      if (localTabId.value) {
        window.electronAPI.groupUpdateTabMeta(localTabId.value, {
          name: tab.name,
          filePath: tab.filePath,
          isModified: false,
        });
      }
      return true;
    }
  } catch (error) {
    autotoast.show("保存文件失败，请检查写入权限", "error");
    console.error("保存文件失败:", error);
  }
  return false;
}

async function saveCurrentTab(): Promise<boolean> {
  return saveTab(localTab.value!);
}

async function createTabFromFile(
  filePath: string,
  content: string,
  fileTraits?: FileTraitsDTO
): Promise<Tab> {
  const tabData = createTabDataFromFile(filePath, content, { fileTraits });
  const readOnly = (await window.electronAPI?.getIsReadOnly(filePath)) || false;

  const tab: Tab = {
    id: randomUUID(),
    ...tabData,
    readOnly,
    isNewlyLoaded: true,
  };
  scheduleNewlyLoadedCleanup();

  // 在新架构中，打开文件 = 更新本窗口的 Tab 内容（或让主进程创建新窗口）
  // 这里直接更新本窗口
  localTab.value = tab;
  if (tab.filePath) setCurrentMarkdownFilePath(tab.filePath);

  // 通知主进程更新 meta
  if (localTabId.value) {
    window.electronAPI.groupUpdateTabMeta(localTabId.value, {
      name: tab.name,
      filePath: tab.filePath,
      isModified: tab.isModified,
      readOnly: tab.readOnly,
    });
  }

  return tab;
}

async function openFile(filePath: string): Promise<Tab | null> {
  try {
    const existingTab = isFileAlreadyOpen(filePath);
    if (existingTab) return existingTab;

    // 检查其他窗口是否已打开
    try {
      const result = await window.electronAPI.focusFileIfOpen(filePath);
      if (result.found) return null;
    } catch {}

    const fileContent = await readAndProcessFile({ filePath });
    if (!fileContent) {
      console.error("无法读取文件:", filePath);
      return null;
    }

    // 如果当前是空白 tab，复用
    const tab = localTab.value;
    if (tab && tab.filePath === null && !tab.isModified) {
      tab.filePath = fileContent.filePath;
      tab.name = getFileName(fileContent.filePath);
      tab.content = fileContent.content;
      tab.originalContent = fileContent.content;
      tab.isModified = false;
      tab.isNewlyLoaded = true;
      scheduleNewlyLoadedCleanup();
      tab.readOnly = fileContent.readOnly || false;
      tab.fileTraits = fileContent.fileTraits;
      if (tab.filePath) setCurrentMarkdownFilePath(tab.filePath);
      // 通知主进程
      if (localTabId.value) {
        window.electronAPI.groupUpdateTabMeta(localTabId.value, {
          name: tab.name,
          filePath: tab.filePath,
          isModified: false,
          readOnly: tab.readOnly,
        });
      }
      return tab;
    } else {
      // 创建新 tab（在新架构中，这应该通过主进程创建新窗口）
      const newTab = await createTabFromFile(
        fileContent.filePath,
        fileContent.content,
        fileContent.fileTraits
      );
      emitter.emit("file:Change");
      return newTab;
    }
  } catch (error) {
    console.error("打开文件失败:", error);
    return null;
  }
}

function createNewTab(): Tab {
  const tab: Tab = {
    id: randomUUID(),
    name: defaultName,
    filePath: null,
    content: "",
    originalContent: "",
    isModified: false,
    scrollRatio: 0,
    readOnly: false,
    isNewlyLoaded: true,
  };
  scheduleNewlyLoadedCleanup();
  localTab.value = tab;
  return tab;
}

// ── Tab 切换（新架构：通过 IPC 通知主进程）────────────────────

async function switchToTab(id: string) {
  // 如果是切换到本窗口的 tab，什么都不做
  if (id === localTabId.value || id === localTab.value?.id) return;

  // 新架构：通知主进程切换 Tab（会 show/hide 不同的 BrowserWindow）
  await window.electronAPI?.groupSwitchTab(id);
}

// 设置活跃 tab（兼容旧接口，新架构中这是空操作）
function setActive(_id: string) {
  // 新架构中，活跃 Tab 由主进程管理，这里不需要做任何事
}

// 添加 tab（兼容旧接口）
function add(tab: Tab) {
  localTab.value = tab;
  return tab;
}

// 关闭 tab（兼容旧接口）
function close(_id: string) {
  // 新架构中，关闭 Tab 由主进程处理
  if (localTabId.value) {
    window.electronAPI?.groupCloseTab(localTabId.value);
  }
}

// 带确认的关闭 tab
function closeWithConfirm(id: string) {
  // 检查是否正在关闭本窗口的 Tab
  const isLocalTab = id === localTabId.value || id === localTab.value?.id;

  if (isLocalTab) {
    const tab = localTab.value;
    if (!tab) return;

    if (tab.isModified) {
      emitter.emit("tab:close-confirm", {
        tabId: id,
        tabName: tab.name,
        isLastTab: !tabList.value || tabList.value.tabOrder.length <= 1,
      });
      return;
    }
  }

  // 非本地 Tab 或未修改的 Tab：直接让主进程处理
  // 主进程 group:close-tab 会检查 isModified 并在需要时发送 close:confirm
  const isLastTab = !tabList.value || tabList.value.tabOrder.length <= 1;
  if (isLastTab && isLocalTab) {
    window.electronAPI.closeDiscard();
  } else {
    window.electronAPI?.groupCloseTab(id);
  }
}

// 计算属性
const hasUnsavedTabs = computed(() => localTab.value?.isModified ?? false);

function getUnsavedTabs() {
  if (localTab.value?.isModified) return [localTab.value];
  return [];
}

// ── Tab 排序 ──────────────────────────────────────────────────

function reorderTabs(fromIndex: number, toIndex: number) {
  if (!tabList.value || fromIndex === toIndex) return;
  const newOrder = [...tabList.value.tabOrder];
  const [moved] = newOrder.splice(fromIndex, 1);
  newOrder.splice(toIndex, 0, moved);
  window.electronAPI?.groupReorderTabs(newOrder);
}

// ── Tab 拖拽分离（新架构：直接使用 group:tear-off）────────────

function getTabDataForTearOff(_tabId: string): TearOffTabData | null {
  const tab = localTab.value;
  if (!tab) return null;
  const raw = toRaw(tab);
  return {
    id: raw.id,
    name: raw.name,
    filePath: raw.filePath,
    content: raw.content,
    originalContent: raw.originalContent,
    isModified: raw.isModified,
    scrollRatio: raw.scrollRatio ?? 0,
    readOnly: raw.readOnly,
    fileTraits: raw.fileTraits ? toRaw(raw.fileTraits) : undefined,
  };
}

let tearOffSourceTabId: string | null = null;

function startTearOff(
  tabId: string,
  screenX: number,
  screenY: number,
  offsetX: number,
  offsetY: number
): void {
  const tabData = getTabDataForTearOff(tabId);
  if (!tabData) return;
  tearOffSourceTabId = tabId;
  window.electronAPI.tearOffTabStart(tabData, screenX, screenY, offsetX, offsetY);
}

function cancelTearOff(): void {
  tearOffSourceTabId = null;
  window.electronAPI.tearOffTabCancel();
}

async function endTearOff(_tabId: string, screenX: number, screenY: number): Promise<boolean> {
  try {
    const result = await window.electronAPI.tearOffTabEnd(screenX, screenY);
    if (result.action === "failed") {
      tearOffSourceTabId = null;
      return false;
    }
    tearOffSourceTabId = null;

    // 成功后，从当前窗口移除该 Tab
    const isLastTab = !tabList.value || tabList.value.tabOrder.length <= 1;
    if (isLastTab) {
      window.electronAPI.closeDiscard();
    } else {
      // 从源窗口移除（由主进程广播更新 tabList）
      setTimeout(() => emitter.emit("file:Change"), 50);
    }
    return true;
  } catch (error) {
    tearOffSourceTabId = null;
    console.error("[useTab] Tab 拖拽分离失败:", error);
    return false;
  }
}

// ── Tab 合并接收（保留旧架构兼容）──────────────────────────────

function handleTabMergeIn(tabData: TearOffTabData) {
  const tab: Tab = {
    id: randomUUID(),
    name: tabData.name,
    filePath: tabData.filePath,
    content: tabData.content,
    originalContent: tabData.originalContent,
    isModified: tabData.isModified,
    scrollRatio: tabData.scrollRatio ?? 0,
    readOnly: tabData.readOnly,
    isNewlyLoaded: !tabData.isModified,
    fileTraits: tabData.fileTraits,
  };
  localTab.value = tab;
  if (!tabData.isModified) scheduleNewlyLoadedCleanup();
  if (tab.filePath) setCurrentMarkdownFilePath(tab.filePath);
}
window.electronAPI.on("tab:merge-in", handleTabMergeIn);

// ── 合并预览（暂时保留旧架构兼容）──────────────────────────────

let mergePreviewState: {
  tabId: string;
  prevActiveId: string | null;
  isExisting: boolean;
} | null = null;

function handleTabMergePreview(tabData: TearOffTabData, _screenX?: number, _screenY?: number) {
  // 新架构中合并预览由主进程管理，这里简化处理
  mergePreviewState = { tabId: "preview", prevActiveId: null, isExisting: false };
  handleTabMergeIn(tabData);
}

function handleTabMergePreviewCancel() {
  if (!mergePreviewState) return;
  mergePreviewState = null;
  // 恢复原来的 Tab（简化实现）
}

function handleTabMergePreviewFinalize() {
  mergePreviewState = null;
}

function handleTabMergePreviewUpdate(_screenX: number, _screenY: number) {
  // 新架构中不需要前端处理位置更新
}

window.electronAPI.on("tab:merge-preview", handleTabMergePreview);
window.electronAPI.on("tab:merge-preview-cancel", handleTabMergePreviewCancel);
window.electronAPI.on("tab:merge-preview-finalize", handleTabMergePreviewFinalize);
window.electronAPI.on("tab:merge-preview-update", handleTabMergePreviewUpdate);

// ── 跨窗口文件去重 ──────────────────────────────────────

window.electronAPI.on("tab:activate-file", (_filePath: string) => {
  // 本窗口已打开该文件，不需要操作
});

// ── 单 Tab 窗口拖拽 ──────────────────────────────────────

const isSingleTab = computed(() => !tabList.value || tabList.value.tabOrder.length <= 1);

function startSingleTabDrag(tabId: string, offsetX: number, offsetY: number): void {
  const tabData = getTabDataForTearOff(tabId);
  if (!tabData) return;
  window.electronAPI.startWindowDrag(tabData, offsetX, offsetY);
}

async function endSingleTabDrag(screenX: number, screenY: number): Promise<void> {
  window.electronAPI.stopWindowDrag();
  const tab = localTab.value;
  if (!tab) return;
  const tabData = getTabDataForTearOff(tab.id);
  if (!tabData) return;
  const result = await window.electronAPI.dropMerge(tabData, screenX, screenY);
  if (result.action === "merged") {
    window.electronAPI.closeDiscard();
  }
}

// ── UI 辅助 ──────────────────────────────────────────────

function ensureActiveTabVisible(containerRef: Ref<HTMLElement | null>) {
  const container = containerRef.value;
  if (!container || !activeTabId.value) return;

  const activeTabElement = container.querySelector(
    `[data-tab-id="${activeTabId.value}"]`
  ) as HTMLElement;
  if (!activeTabElement) return;

  const containerRect = container.getBoundingClientRect();
  const tabRect = activeTabElement.getBoundingClientRect();
  const paddingOffset = 12;
  const shadowOffset = 8;
  const offsetLeft = isShowOutline.value ? containerRect.width * 0.25 : 0;

  const isFullyVisible =
    tabRect.left >= containerRect.left + paddingOffset + offsetLeft &&
    tabRect.right <= containerRect.right - paddingOffset - shadowOffset;

  if (!isFullyVisible) {
    const tabOffsetLeft = activeTabElement.offsetLeft;
    const visibleLeft = paddingOffset;
    const visibleRight = container.clientWidth - paddingOffset - shadowOffset;
    let scrollLeft = 0;

    if (tabRect.left < containerRect.left + paddingOffset + offsetLeft) {
      scrollLeft = tabOffsetLeft - visibleLeft;
    } else if (tabRect.right > containerRect.right - paddingOffset - shadowOffset) {
      scrollLeft = tabOffsetLeft - visibleRight + activeTabElement.offsetWidth;
    }

    const minScrollLeft = isShowOutline.value ? -offsetLeft : 0;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    scrollLeft = Math.max(minScrollLeft, Math.min(scrollLeft, maxScrollLeft));

    const inertiaInstance = getInertiaScrollInstance(container);
    inertiaInstance.scrollTo(scrollLeft);
  }
}

const inertiaScrollInstances = new Map<HTMLElement, InertiaScroll>();

function getInertiaScrollInstance(container: HTMLElement): InertiaScroll {
  if (!inertiaScrollInstances.has(container)) {
    const instance = createInertiaScroll(container);
    inertiaScrollInstances.set(container, instance);
  }
  return inertiaScrollInstances.get(container)!;
}

function handleWheelScroll(event: WheelEvent, containerRef: Ref<HTMLElement | null>) {
  const container = containerRef.value;
  if (!container) return;
  const inertiaScroll = getInertiaScrollInstance(container);
  inertiaScroll.handleWheel(event);
}

function setupTabScrollListener(containerRef: Ref<HTMLElement | null>) {
  watch(activeTabId, () => {
    nextTick(() => {
      ensureActiveTabVisible(containerRef);
    });
  });
}

function cleanupInertiaScroll(container: HTMLElement) {
  const instance = inertiaScrollInstances.get(container);
  if (instance) {
    instance.destroy();
    inertiaScrollInstances.delete(container);
  }
}

// ── 格式化 Tab 显示（从 tabList 构建）──────────────────────

const formattedTabs = computed(() => {
  if (!tabList.value) {
    // 回退：使用本地 Tab
    if (!localTab.value) return [];
    const tab = localTab.value;
    return [
      {
        id: localTabId.value ?? tab.id,
        name: tab.name,
        readOnly: tab.readOnly,
        isModified: tab.isModified,
        isMergePreview: tab.isMergePreview,
        displayName: tab.isModified ? `*${tab.name}` : tab.name,
      },
    ];
  }
  return tabList.value.tabs.map((t) => ({
    id: t.tabId,
    name: t.name,
    readOnly: t.readOnly,
    isModified: t.isModified,
    isMergePreview: t.isMergePreview,
    displayName: t.isModified ? `*${t.name}` : t.name,
  }));
});

const shouldOffsetTabBar = computed(() => isShowOutline.value);

// ── 文件监听（通知主进程）──────────────────────────────────

watch(
  () => localTab.value?.filePath,
  (newPath) => {
    const filePaths = newPath ? [newPath] : [];
    window.electronAPI.watchFiles(filePaths);
  },
  { immediate: true }
);

// 文件变动回调
window.electronAPI.on?.("file:changed", async (paths) => {
  const tab = localTab.value;
  if (!tab || tab.filePath !== paths) return;

  if (!tab.isModified) {
    const fileContent = await readAndProcessFile({ filePath: paths });
    if (!fileContent) return;
    tab.content = fileContent.content;
    tab.originalContent = fileContent.content;
    tab.isModified = false;
    tab.isNewlyLoaded = true;
    tab.fileTraits = fileContent.fileTraits;
    scheduleNewlyLoadedCleanup();
    emitter.emit("file:Change");
  } else {
    const fileName = getFileName(paths);
    const choice = await new Promise<"overwrite" | "cancel">((resolve) => {
      emitter.emit("file:changed-confirm", {
        fileName,
        resolver: resolve,
      });
    });
    if (choice === "cancel") return;
    const fileContent = await readAndProcessFile({ filePath: paths });
    if (!fileContent) return;
    tab.content = fileContent.content;
    tab.originalContent = fileContent.content;
    tab.isModified = false;
    tab.isNewlyLoaded = true;
    tab.fileTraits = fileContent.fileTraits;
    scheduleNewlyLoadedCleanup();
    emitter.emit("file:Change");
  }
});

// ── isModified 变化时通知主进程 ──────────────────────────────

watch(
  () => localTab.value?.isModified,
  (isModified) => {
    if (localTabId.value && isModified !== undefined) {
      window.electronAPI.groupUpdateTabMeta(localTabId.value, { isModified });
    }
  }
);

// ── 导出 ────────────────────────────────────────────────────

function useTab() {
  return {
    // 状态
    tabs,
    activeTabId,
    currentTab,
    formattedTabs,
    hasUnsavedTabs,
    shouldOffsetTabBar,
    tabList,
    localTab,
    localTabId,
    getUnsavedTabs,
    add,
    close,
    setActive,
    getCurrentTab,

    // 更新
    updateCurrentTabContent,
    updateCurrentTabScrollRatio,
    saveCurrentTab,
    saveTab,
    createTabFromFile,
    updateCurrentTabFile,
    createNewTab,
    switchToTab,
    openFile,

    // UI
    ensureActiveTabVisible,
    handleWheelScroll,
    closeWithConfirm,
    setupTabScrollListener,
    cleanupInertiaScroll,

    // 拖动
    reorderTabs,

    // Tab 拖拽分离
    startTearOff,
    endTearOff,
    cancelTearOff,

    // 单 Tab 窗口拖拽
    isSingleTab,
    startSingleTabDrag,
    endSingleTabDrag,

    // 工具
    randomUUID,
    getFileName,
    isFileAlreadyOpen,
  };
}

export default useTab;

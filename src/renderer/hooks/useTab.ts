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

const tabs = ref<Tab[]>([]);
const activeTabId = ref<string | null>(null);

// 防抖定时器 Map：每个 tab 独立跟踪归一化完成
const newlyLoadedTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 启动/重置 isNewlyLoaded 清理定时器，确保归一化结束后 isNewlyLoaded 一定被消费 */
function scheduleNewlyLoadedCleanup(tabId: string) {
  const existing = newlyLoadedTimers.get(tabId);
  if (existing) clearTimeout(existing);
  newlyLoadedTimers.set(
    tabId,
    setTimeout(() => {
      const tab = tabs.value.find((t) => t.id === tabId);
      if (tab) tab.isNewlyLoaded = false;
      newlyLoadedTimers.delete(tabId);
    }, 150)
  );
}

const defaultName = "Untitled";

const defaultTabUUid = randomUUID();

// ── 窗口初始化逻辑 ─────────────────────────────────────────
// 如果是由 Tab 拖拽分离创建的新窗口，使用传入的 Tab 数据替换默认 Tab
let _tearOffInitPromise: Promise<void> | null = null;

async function initFromTearOff(): Promise<boolean> {
  try {
    const tabData: TearOffTabData | null = await window.electronAPI?.getInitialTabData();
    if (!tabData) return false;

    // 用分离的 Tab 数据替换默认空白 Tab
    // 已修改的 Tab 不能标记 isNewlyLoaded，否则编辑器归一化会覆盖 originalContent 并重置 isModified
    const tab: Tab = {
      id: randomUUID(), // 生成新 ID，避免与源窗口冲突
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

    tabs.value = [tab];
    activeTabId.value = tab.id;
    if (!tabData.isModified) {
      scheduleNewlyLoadedCleanup(tab.id);
    }

    // 设置图片路径解析
    if (tab.filePath) {
      setCurrentMarkdownFilePath(tab.filePath);
    }

    // 通知 useContent 同步内容（关键：无此步骤内容会为空）
    emitter.emit("tab:switch", tab);

    return true;
  } catch (error) {
    console.error("[useTab] 初始化 tear-off 数据失败:", error);
    return false;
  }
}

// 立即发起初始化请求（不阻塞模块加载）
_tearOffInitPromise = initFromTearOff().then(() => {
  _tearOffInitPromise = null;
});

// 先同步创建默认 Tab（确保 UI 立即可用），tear-off 初始化成功后会替换它
const defaultTab: Tab = {
  id: defaultTabUUid,
  name: defaultName,
  filePath: null,
  content: "",
  originalContent: "",
  isModified: false,
  scrollRatio: 0,
  readOnly: false,
  isNewlyLoaded: true,
};
tabs.value.push(defaultTab);
activeTabId.value = defaultTab.id;
scheduleNewlyLoadedCleanup(defaultTabUUid);
window.electronAPI?.onOpenFileAtLaunch((_payload) => {
  if (tabs.value.length === 1 && tabs.value[0].id === defaultTabUUid && !tabs.value[0].isModified) {
    tabs.value = [];
  }
});

// 从文件路径获取文件名
function getFileName(filePath: string | null): string {
  if (!filePath) return defaultName;
  const parts = filePath.split(/[\\/]/);
  return parts.at(-1) ?? defaultName;
}

// 检查文件是否已打开
function isFileAlreadyOpen(filePath: string): Tab | null {
  return tabs.value.find((tab) => tab.filePath === filePath) || null;
}

// 添加tab
function add(tab: Tab) {
  // 检查是否已存在相同文件路径的tab
  if (tab.filePath) {
    const existingTab = isFileAlreadyOpen(tab.filePath);
    if (existingTab) {
      // 如果文件已打开，直接切换到该tab
      setActive(existingTab.id);
      return existingTab;
    }
  }

  tabs.value.push(tab);
  setActive(tab.id);
  return tab;
}

// 关闭tab
function close(id: string) {
  const tabIndex = tabs.value.findIndex((tab) => tab.id === id);
  if (tabIndex === -1) return;

  const isActiveTab = activeTabId.value === id;
  tabs.value.splice(tabIndex, 1);

  // 如果关闭的是当前活跃tab，需要切换到其他tab
  if (isActiveTab) {
    if (tabs.value.length > 0) {
      // 优先切换到下一个tab，如果没有则切换到上一个
      const nextIndex = tabIndex < tabs.value.length ? tabIndex : tabIndex - 1;
      switchToTab(tabs.value[nextIndex].id);
    } else {
      activeTabId.value = null;
    }
  }
}

// 设置活跃tab
function setActive(id: string) {
  if (!tabs.value.find((tab) => tab.id === id) || activeTabId.value === id) return;
  activeTabId.value = id;
}

// 获取当前tab
function getCurrentTab() {
  return tabs.value.find((tab) => tab.id === activeTabId.value) || null;
}

// 更新当前tab的内容
function updateCurrentTabContent(content: string, isModified?: boolean) {
  const currentTab = getCurrentTab();
  if (!currentTab) return;

  const prevContent = currentTab.content;
  currentTab.content = content;

  if (currentTab.readOnly) {
    currentTab.isModified = false;
    return;
  }

  if (isModified !== undefined) {
    currentTab.isModified = isModified;
    return;
  }

  // 刚加载的 tab，吸收编辑器归一化产生的变化
  if (currentTab.isNewlyLoaded) {
    currentTab.originalContent = content;
    currentTab.isModified = false;
    // 归一化每步都可能触发 change，重置定时器等待全部完成
    scheduleNewlyLoadedCleanup(currentTab.id);
    return;
  }

  // 简单比较：当前内容 vs 原始内容
  currentTab.isModified = content !== currentTab.originalContent;
}

// 更新当前tab的文件信息（用于文件覆盖场景）
function updateCurrentTabFile(filePath: string, content: string, name?: string) {
  const currentTab = getCurrentTab();
  if (currentTab) {
    currentTab.filePath = filePath;
    currentTab.content = content;
    currentTab.originalContent = content;
    currentTab.isModified = false;
    currentTab.isNewlyLoaded = true;
    scheduleNewlyLoadedCleanup(currentTab.id);
    if (name) {
      currentTab.name = name;
    } else {
      currentTab.name = getFileName(filePath);
    }
  }
}

// 更新当前tab的滚动位置
function updateCurrentTabScrollRatio(ratio: number) {
  const currentTab = getCurrentTab();
  if (currentTab) {
    currentTab.scrollRatio = ratio;
  }
}

// 保存指定tab
async function saveTab(tab: Tab): Promise<boolean> {
  if (!tab || tab.readOnly) return false;

  try {
    // 传递 fileTraits 给主进程，由主进程负责还原 BOM、换行符、末尾换行
    // toRaw 将 Vue Proxy 转为普通对象，避免 IPC 序列化失败
    const saved = await window.electronAPI.saveFile(
      tab.filePath,
      tab.content,
      toRaw(tab.fileTraits)
    );
    if (saved) {
      tab.filePath = saved;
      tab.name = getFileName(saved);
      // 保存后，当前内容即为原始内容
      tab.originalContent = tab.content;
      tab.isModified = false;
      return true;
    }
  } catch (error) {
    autotoast.show("保存文件失败，请检查写入权限", "error");
    console.error("保存文件失败:", error);
  }
  return false;
}

// 保存当前tab
async function saveCurrentTab(): Promise<boolean> {
  const currentTab = getCurrentTab();
  return saveTab(currentTab!);
}

// 从文件创建新tab
async function createTabFromFile(
  filePath: string,
  content: string,
  fileTraits?: FileTraitsDTO
): Promise<Tab> {
  // 使用统一的文件服务创建Tab数据
  const tabData = createTabDataFromFile(filePath, content, { fileTraits });

  // 单独获取只读状态
  const readOnly = (await window.electronAPI?.getIsReadOnly(filePath)) || false;

  const tab: Tab = {
    id: randomUUID(),
    ...tabData,
    readOnly,
    isNewlyLoaded: true,
  };
  scheduleNewlyLoadedCleanup(tab.id);

  return add(tab);
}

// 打开文件
async function openFile(filePath: string): Promise<Tab | null> {
  try {
    // 检查文件是否已经在当前窗口中打开
    const existingTab = isFileAlreadyOpen(filePath);
    if (existingTab) {
      // 如果文件已打开，直接切换到该tab
      await switchToTab(existingTab.id);
      return existingTab;
    }

    // 检查文件是否在其他窗口中打开
    try {
      const result = await window.electronAPI.focusFileIfOpen(filePath);
      if (result.found) {
        // 其他窗口已打开该文件并已聚焦，当前窗口无需操作
        return null;
      }
    } catch {
      // 跨窗口检查失败不影响正常打开
    }

    // 使用统一的文件服务读取和处理文件
    const fileContent = await readAndProcessFile({ filePath });
    if (!fileContent) {
      console.error("无法读取文件:", filePath);
      return null;
    }

    // 如果当前活跃tab是未修改的新标签页（无文件路径），则复用该tab
    const currentTab = getCurrentTab();
    if (currentTab && currentTab.filePath === null && !currentTab.isModified) {
      currentTab.filePath = fileContent.filePath;
      currentTab.name = getFileName(fileContent.filePath);
      currentTab.content = fileContent.content;
      currentTab.originalContent = fileContent.content;
      currentTab.isModified = false;
      currentTab.isNewlyLoaded = true;
      scheduleNewlyLoadedCleanup(currentTab.id);
      currentTab.readOnly = fileContent.readOnly || false;
      currentTab.fileTraits = fileContent.fileTraits;
      await switchToTab(currentTab.id);
      return currentTab;
    } else {
      // 创建新tab
      const newTab = await createTabFromFile(
        fileContent.filePath,
        fileContent.content,
        fileContent.fileTraits
      );
      // 切换新tab
      switchToTab(newTab.id);

      // 触发内容更新事件
      emitter.emit("file:Change");
      return newTab;
    }
  } catch (error) {
    console.error("打开文件失败:", error);
    return null;
  }
}

// 创建新文件tab
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
  scheduleNewlyLoadedCleanup(tab.id);

  return add(tab);
}

// 切换tab并同步内容
async function switchToTab(id: string) {
  const targetTab = tabs.value.find((tab) => tab.id === id);
  if (!targetTab) return;

  // 设置当前tab为活跃状态
  setActive(id);

  // 设置当前文件路径用于图片路径解析
  if (targetTab.filePath) {
    setCurrentMarkdownFilePath(targetTab.filePath);
  } else {
    setCurrentMarkdownFilePath(null);
  }

  // 仅对未修改的 tab 标记为新加载，让编辑器首次输出捕获为 originalContent
  // 已修改的 tab 必须保留 originalContent 和 isModified 状态，
  // 编辑器归一化产生的微小变化不会影响 isModified 判断（因为内容本就与 originalContent 不同）
  if (!targetTab.isModified) {
    targetTab.isNewlyLoaded = true;
    scheduleNewlyLoadedCleanup(targetTab.id);
  }

  // 触发内容更新事件
  emitter.emit("tab:switch", targetTab);
}

// 计算属性
const hasUnsavedTabs = computed(() => {
  return tabs.value.some((tab) => tab.isModified);
});

// 获取所有未保存的标签页
function getUnsavedTabs() {
  return tabs.value.filter((tab) => tab.isModified);
}

// 确保激活的tab在可视区域内
function ensureActiveTabVisible(containerRef: Ref<HTMLElement | null>) {
  const container = containerRef.value;
  if (!container || !activeTabId.value) return;

  // 查找激活的tab元素
  const activeTabElement = container.querySelector(
    `[data-tab-id="${activeTabId.value}"]`
  ) as HTMLElement;
  if (!activeTabElement) return;

  const containerRect = container.getBoundingClientRect();
  const tabRect = activeTabElement.getBoundingClientRect();

  const paddingOffset = 12; // 额外的内边距
  const shadowOffset = 8; // 阴影偏移量，确保阴影完全显示

  // 考虑tabbar的偏移量（当大纲显示时，tabbar向右偏移25%）
  // 由于TabBar使用margin-left: 25%，所以偏移量是相对于父容器的25%
  const offsetLeft = isShowOutline.value ? containerRect.width * 0.25 : 0;

  // 检查tab是否完全在可视区域内（包括阴影和偏移）
  const isFullyVisible =
    tabRect.left >= containerRect.left + paddingOffset + offsetLeft &&
    tabRect.right <= containerRect.right - paddingOffset - shadowOffset;

  if (!isFullyVisible) {
    // 计算tab相对于容器的位置
    const tabOffsetLeft = activeTabElement.offsetLeft;

    // 计算可视区域的边界（考虑偏移量）
    // 当有大纲显示时，TabBar有margin-left: 25%，所以可视区域从25%开始
    const visibleLeft = paddingOffset;
    const visibleRight = container.clientWidth - paddingOffset - shadowOffset;

    let scrollLeft = 0;

    // 如果tab在左侧被遮挡
    if (tabRect.left < containerRect.left + paddingOffset + offsetLeft) {
      // 将tab滚动到可视区域的左侧
      // 当有大纲显示时，需要考虑TabBar的margin-left偏移
      scrollLeft = tabOffsetLeft - visibleLeft;
    } else if (tabRect.right > containerRect.right - paddingOffset - shadowOffset) {
      // 如果tab在右侧被遮挡（包括阴影）
      // 将tab滚动到可视区域的右侧
      scrollLeft = tabOffsetLeft - visibleRight + activeTabElement.offsetWidth;
    }

    // 确保滚动位置不会超出边界
    // 当有偏移时，最小滚动位置需要考虑偏移量
    const minScrollLeft = isShowOutline.value ? -offsetLeft : 0;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    scrollLeft = Math.max(minScrollLeft, Math.min(scrollLeft, maxScrollLeft));

    // 使用专门优化的tab切换滚动
    const inertiaInstance = getInertiaScrollInstance(container);
    inertiaInstance.scrollTo(scrollLeft); // 使用平滑滚动动画
  }
}

// 惯性滚动实例存储
const inertiaScrollInstances = new Map<HTMLElement, InertiaScroll>();

// 获取或创建惯性滚动实例
function getInertiaScrollInstance(container: HTMLElement): InertiaScroll {
  if (!inertiaScrollInstances.has(container)) {
    const instance = createInertiaScroll(container);
    inertiaScrollInstances.set(container, instance);
  }
  return inertiaScrollInstances.get(container)!;
}

// 滚动
function handleWheelScroll(event: WheelEvent, containerRef: Ref<HTMLElement | null>) {
  const container = containerRef.value;
  if (!container) return;

  // 获取惯性滚动实例并处理滚轮事件
  const inertiaScroll = getInertiaScrollInstance(container);
  inertiaScroll.handleWheel(event);
}

// 带确认的关闭tab
function closeWithConfirm(id: string) {
  const tabToClose = tabs.value.find((tab) => tab.id === id);
  if (!tabToClose) return;

  // 检查是否是最后一个tab
  const isLastTab = tabs.value.length === 1;

  // 检查是否有未保存的内容
  if (tabToClose.isModified) {
    // 触发自定义确认对话框，传递tab信息和是否是最后一个tab
    emitter.emit("tab:close-confirm", {
      tabId: id,
      tabName: tabToClose.name,
      isLastTab,
    });
    return;
  }

  // 如果没有未保存内容
  if (isLastTab) {
    // 如果是最后一个tab，直接关闭应用
    window.electronAPI.closeDiscard();
  } else {
    // 否则直接关闭tab
    close(id);
  }
}

// 拖动排序功能
function reorderTabs(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;

  // 移动tab到新位置
  const [movedTab] = tabs.value.splice(fromIndex, 1);
  tabs.value.splice(toIndex, 0, movedTab);
}

// ── Tab 拖拽分离 ──────────────────────────────────────────

/** 获取指定 Tab 的完整数据，用于跨窗口传递 */
function getTabDataForTearOff(tabId: string): TearOffTabData | null {
  const tab = tabs.value.find((t) => t.id === tabId);
  if (!tab) return null;

  return {
    id: tab.id,
    name: tab.name,
    filePath: tab.filePath,
    content: tab.content,
    originalContent: tab.originalContent,
    isModified: tab.isModified,
    scrollRatio: tab.scrollRatio ?? 0,
    readOnly: tab.readOnly,
    fileTraits: tab.fileTraits,
  };
}

/**
 * 开始拖拽分离：立即创建新窗口并跟随光标
 * 由 TabBar 的 pointermove 在指针离开窗口时调用（fire-and-forget）
 */
function startTearOff(
  tabId: string,
  screenX: number,
  screenY: number,
  offsetX: number,
  offsetY: number
): void {
  const tabData = getTabDataForTearOff(tabId);
  if (!tabData) return;
  window.electronAPI.tearOffTabStart(tabData, screenX, screenY, offsetX, offsetY);
}

/**
 * 取消拖拽分离：指针回到源窗口时调用，关闭已创建的跟随窗口
 */
function cancelTearOff(): void {
  window.electronAPI.tearOffTabCancel();
}

/**
 * 完成拖拽分离：停止跟随、判断合并或保留新窗口、从源窗口移除 Tab
 * 由 TabBar 的 SortableJS onEnd（鼠标松开）时调用
 */
async function endTearOff(tabId: string, screenX: number, screenY: number): Promise<boolean> {
  try {
    const result = await window.electronAPI.tearOffTabEnd(screenX, screenY);
    if (result.action === "failed") return false;

    // 成功创建新窗口或合并后，从当前窗口移除该 Tab
    const isLastTab = tabs.value.length === 1;
    if (isLastTab) {
      window.electronAPI.closeDiscard();
    } else {
      close(tabId);
    }

    return true;
  } catch (error) {
    console.error("[useTab] Tab 拖拽分离失败:", error);
    return false;
  }
}

// ── Tab 合并接收 ──────────────────────────────────────────

/** 监听来自其他窗口的 Tab 合并请求 */
function handleTabMergeIn(tabData: TearOffTabData) {
  const tab: Tab = {
    id: randomUUID(), // 生成新 ID，避免跨窗口冲突
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

  tabs.value.push(tab);
  activeTabId.value = tab.id;
  if (!tabData.isModified) {
    scheduleNewlyLoadedCleanup(tab.id);
  }

  if (tab.filePath) {
    setCurrentMarkdownFilePath(tab.filePath);
  }

  // 通知 useContent 同步内容
  emitter.emit("tab:switch", tab);
}
window.electronAPI.on("tab:merge-in", handleTabMergeIn);

// ── Tab 合并预览（悬停即合并，离开撤销）──────────────────

let mergePreviewState: {
  tabId: string;
  prevActiveId: string | null;
  isExisting: boolean;
} | null = null;

function handleTabMergePreview(tabData: TearOffTabData, screenX?: number, screenY?: number) {
  const prevActiveId = activeTabId.value;

  // 若已存在同文件路径的 Tab，直接激活它作为预览目标
  if (tabData.filePath) {
    const existing = isFileAlreadyOpen(tabData.filePath);
    if (existing) {
      mergePreviewState = {
        tabId: existing.id,
        prevActiveId,
        isExisting: true,
      };
      switchToTab(existing.id);
      return;
    }
  }

  // 计算插入位置
  let insertIndex = tabs.value.length;
  if (screenX !== undefined && screenY !== undefined) {
    // 将屏幕坐标转换为页面内坐标
    // 注意：window.screenX 是窗口左上角在屏幕的 X，加上边框偏移才是内容区
    // 简化处理：假设标准边框或无边框，contentX ≈ screenX - window.screenX
    // 更精确的方式难以在纯 IPC 中获取，但如果不考虑标题栏（无框窗口），这样近似可行
    const clientX = screenX - window.screenX;

    // 获取所有 tab 元素 (排除预览 Tab 自身)
    const tabElements = Array.from(document.querySelectorAll("[data-tab-id]:not(.merge-preview)"));

    // 找到插入点
    for (let i = 0; i < tabElements.length; i++) {
      const rect = tabElements[i].getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      if (clientX < centerX) {
        insertIndex = i;
        break;
      }
    }
  }

  // 取消旧预览，总是重建以确保正确的插入位置
  if (mergePreviewState && !mergePreviewState.isExisting) {
    close(mergePreviewState.tabId);
  }

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
    isMergePreview: true,
    fileTraits: tabData.fileTraits,
  };

  // 插入到指定位置
  tabs.value.splice(insertIndex, 0, tab);
  activeTabId.value = tab.id;
  if (!tabData.isModified) {
    scheduleNewlyLoadedCleanup(tab.id);
  }

  if (tab.filePath) {
    setCurrentMarkdownFilePath(tab.filePath);
  }

  emitter.emit("tab:switch", tab);

  mergePreviewState = {
    tabId: tab.id,
    prevActiveId,
    isExisting: false,
  };
}

function handleTabMergePreviewCancel() {
  if (!mergePreviewState) return;
  const { tabId, prevActiveId, isExisting } = mergePreviewState;
  mergePreviewState = null;

  if (!isExisting) {
    close(tabId);
  }

  if (prevActiveId && tabs.value.find((tab) => tab.id === prevActiveId)) {
    switchToTab(prevActiveId);
  }
}

function handleTabMergePreviewFinalize() {
  if (!mergePreviewState) return;
  const { tabId, isExisting } = mergePreviewState;
  mergePreviewState = null;

  if (isExisting) return;
  const tab = tabs.value.find((t) => t.id === tabId);
  if (tab) {
    tab.isMergePreview = false;
  }
}

window.electronAPI.on("tab:merge-preview", handleTabMergePreview);
window.electronAPI.on("tab:merge-preview-cancel", handleTabMergePreviewCancel);
window.electronAPI.on("tab:merge-preview-finalize", handleTabMergePreviewFinalize);

// ── 跨窗口文件去重 ──────────────────────────────────────

/** 主进程通知激活指定文件的 Tab */
window.electronAPI.on("tab:activate-file", (filePath: string) => {
  const existingTab = isFileAlreadyOpen(filePath);
  if (existingTab) {
    switchToTab(existingTab.id);
  }
});

// ── 单 Tab 窗口拖拽 ──────────────────────────────────────

const isSingleTab = computed(() => tabs.value.length === 1);

/**
 * 开始单 Tab 窗口拖拽：直接移动整个窗口
 * @param offsetX 鼠标相对窗口左上角的 X 偏移
 * @param offsetY 鼠标相对窗口左上角的 Y 偏移
 */
function startSingleTabDrag(tabId: string, offsetX: number, offsetY: number): void {
  const tabData = getTabDataForTearOff(tabId);
  if (!tabData) return;
  window.electronAPI.startWindowDrag(tabData, offsetX, offsetY);
}

/**
 * 结束单 Tab 窗口拖拽：判断是否合并到目标窗口
 */
async function endSingleTabDrag(screenX: number, screenY: number): Promise<void> {
  window.electronAPI.stopWindowDrag();

  // 获取当前唯一 Tab 数据
  const tab = tabs.value[0];
  if (!tab) return;

  const tabData = getTabDataForTearOff(tab.id);
  if (!tabData) return;

  const result = await window.electronAPI.dropMerge(tabData, screenX, screenY);
  if (result.action === "merged") {
    // 合并成功，关闭当前窗口
    window.electronAPI.closeDiscard();
  }
}

// 设置tab容器的滚动监听
function setupTabScrollListener(containerRef: Ref<HTMLElement | null>) {
  // 监听激活tab变化，确保其可见
  watch(activeTabId, () => {
    nextTick(() => {
      ensureActiveTabVisible(containerRef);
    });
  });
}

// 清理惯性滚动实例
function cleanupInertiaScroll(container: HTMLElement) {
  const instance = inertiaScrollInstances.get(container);
  if (instance) {
    instance.destroy();
    inertiaScrollInstances.delete(container);
  }
}

// 计算属性：格式化tab显示名称
// 仅依赖渲染所需的属性，避免 content/originalContent 变化（如归一化）触发不必要的重算
const formattedTabs = computed(() => {
  return tabs.value.map((tab) => ({
    id: tab.id,
    name: tab.name,
    readOnly: tab.readOnly,
    isModified: tab.isModified,
    isMergePreview: tab.isMergePreview,
    displayName: tab.isModified ? `*${tab.name}` : tab.name,
  }));
});

const currentTab = computed(() => getCurrentTab());

// 是否偏移
const shouldOffsetTabBar = computed(() => isShowOutline.value);

// 添加新tab时不通知，只有当filePath实际变化时才通知
watch(
  () => tabs.value.map((tab) => tab.filePath),
  (newPaths, oldPaths) => {
    // 获取所有真实的filePath
    const newFilePaths = newPaths.filter(Boolean) as string[];
    const oldFilePaths = (oldPaths?.filter(Boolean) as string[]) || [];

    // 判断是否有新的路径,包括首次执行时从空到有路径的情况，以及untitled标签被替换时监听不到的问题
    const hasNewPaths = newFilePaths.some((path) => !oldFilePaths.includes(path));
    // 判断是否有删除的路径
    const hasRemovedPaths = oldFilePaths.some((path) => !newFilePaths.includes(path));
    // 判断是否有路径变化，首次执行时 oldPaths 为 undefined，oldFilePaths 为 []，如果有新路径会被 hasNewPaths 捕获
    const hasPathChanges = hasNewPaths || hasRemovedPaths;

    if (!hasPathChanges) return;
    // 通知ipc

    window.electronAPI.watchFiles(newFilePaths);
  },
  {
    immediate: true,
  }
);

// 文件变动回callback事件
window.electronAPI.on?.("file:changed", async (paths) => {
  const tab = tabs.value.find((tab) => tab.filePath === paths);
  if (!tab) return;

  if (!tab.isModified) {
    // 使用统一的文件服务读取和处理文件
    const fileContent = await readAndProcessFile({ filePath: paths });
    if (!fileContent) return;

    // 更新内容，标记为新加载让编辑器重新捕获 originalContent
    tab.content = fileContent.content;
    tab.originalContent = fileContent.content;
    tab.isModified = false;
    tab.isNewlyLoaded = true;
    tab.fileTraits = fileContent.fileTraits;
    scheduleNewlyLoadedCleanup(tab.id);

    // 如果当前tab是活跃的，触发内容更新事件
    if (tab.id === activeTabId.value) {
      emitter.emit("file:Change");
    }
  } else {
    // 文件已变动，触发是否覆盖
    const fileName = getFileName(paths);
    const choice = await new Promise<"overwrite" | "cancel">((resolve) => {
      emitter.emit("file:changed-confirm", {
        fileName,
        resolver: resolve,
      });
    });

    if (choice === "cancel") {
      return;
    }

    // 使用统一的文件服务读取和处理文件
    const fileContent = await readAndProcessFile({ filePath: paths });
    if (!fileContent) return;

    // 更新
    tab.content = fileContent.content;
    tab.originalContent = fileContent.content;
    tab.isModified = false;
    tab.isNewlyLoaded = true;
    tab.fileTraits = fileContent.fileTraits;
    scheduleNewlyLoadedCleanup(tab.id);

    // 触发内容更新
    if (tab.id === activeTabId.value) {
      emitter.emit("file:Change");
    }
  }
});

function useTab() {
  return {
    // 状态
    tabs,
    activeTabId,
    currentTab,
    formattedTabs,
    hasUnsavedTabs,
    shouldOffsetTabBar,
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

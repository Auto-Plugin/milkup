/**
 * Milkup 虚拟滚动插件 v6
 *
 * 基于主进程分块管理的真正虚拟滚动
 * 使用占位元素撑起完整文档高度，只渲染可见区域的内容块
 *
 * v6 改进：
 * - 行高从 DOM 实时计算（基于编辑器字体大小和 line-height）
 * - 修复滚动条拖拽时滑块跑飞的问题（基于时间戳的滚动抑制 + scrollTop 主动恢复）
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { parseMarkdown } from "../parser";

/** 插件 Key */
export const virtualScrollPluginKey = new PluginKey("milkup-virtual-scroll");

/** 虚拟滚动状态 */
interface VirtualScrollState {
  enabled: boolean;
  currentBlockIndex: number;
  loadedBlockIndices: number[];
  totalBlocks: number;
  isLoading: boolean;
  blockContents: Map<number, string>;
}

/** 从编辑器 DOM 计算实际行高 */
function getLineHeight(editorDom: HTMLElement): number {
  const computed = getComputedStyle(editorDom);
  const fontSize = parseFloat(computed.fontSize) || 16;
  const lh = computed.lineHeight;
  if (lh && lh !== "normal") {
    const parsed = parseFloat(lh);
    // 如果是像素值直接用，否则是倍数
    return lh.endsWith("px") ? parsed : fontSize * parsed;
  }
  // 默认 line-height: 1.6（milkup.css）
  return fontSize * 1.6;
}

/** 虚拟滚动管理器 */
class VirtualScrollManager {
  private view: EditorView;
  private state: VirtualScrollState;
  private parser = parseMarkdown;
  private topSpacer: HTMLElement | null = null;
  private bottomSpacer: HTMLElement | null = null;
  private blockSize: number = 150;
  private totalLines: number = 0;
  /** 内容更新后恢复的 scrollTop，用于区分用户滚动和内容变化引起的滚动 */
  private lastRestoredScrollTop: number = 0;
  /** 判定为用户真实滚动的最小偏移阈值（px） */
  private static readonly SCROLL_THRESHOLD = 5;
  /** 待处理的块加载请求（队列） */
  private pendingLoad: number[] | null = null;
  /** 缓存的行高 */
  private cachedLineHeight: number = 0;
  /** 行高缓存过期时间 */
  private lineHeightCacheTime: number = 0;
  /** 抑制结束后的延迟重检定时器 */
  private deferredCheckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(view: EditorView) {
    this.view = view;
    this.state = {
      enabled: false,
      currentBlockIndex: 0,
      loadedBlockIndices: [],
      totalBlocks: 0,
      isLoading: false,
      blockContents: new Map(),
    };
  }

  /** 获取行高（带缓存，每 2 秒刷新一次） */
  private getEstimatedLineHeight(): number {
    const now = Date.now();
    if (now - this.lineHeightCacheTime > 2000 || this.cachedLineHeight === 0) {
      this.cachedLineHeight = getLineHeight(this.view.dom);
      this.lineHeightCacheTime = now;
    }
    return this.cachedLineHeight;
  }

  getState(): VirtualScrollState {
    return this.state;
  }

  getBlockSize(): number {
    return this.blockSize;
  }

  getTotalLines(): number {
    return this.totalLines;
  }

  setEnabled(enabled: boolean, totalBlocks: number, blockSize: number, totalLines: number): void {
    this.state.enabled = enabled;
    this.state.totalBlocks = totalBlocks;
    this.blockSize = blockSize;
    this.totalLines = totalLines;
    this.clearCache();
    this.state.currentBlockIndex = 0;
    // 重置行高缓存
    this.cachedLineHeight = 0;
    this.lineHeightCacheTime = 0;

    if (enabled) {
      this.createSpacers();
    } else {
      this.removeSpacers();
    }
  }

  clearCache(): void {
    this.state.blockContents.clear();
    this.state.loadedBlockIndices = [];
  }

  // --- Spacer 管理 ---

  private createSpacers(): void {
    const scrollContainer = this.view.dom.parentElement?.parentElement;
    if (!scrollContainer) return;

    this.removeSpacers();

    this.topSpacer = document.createElement("div");
    this.topSpacer.className = "virtual-scroll-spacer-top";
    this.topSpacer.style.cssText =
      "height:0;width:100%;pointer-events:none;background:var(--background-color-1,#fff)";

    this.bottomSpacer = document.createElement("div");
    this.bottomSpacer.className = "virtual-scroll-spacer-bottom";
    this.bottomSpacer.style.cssText =
      "width:100%;pointer-events:none;background:var(--background-color-1,#fff)";

    const editorContainer = this.view.dom.parentElement;
    if (editorContainer && scrollContainer) {
      editorContainer.style.minHeight = "auto";
      scrollContainer.insertBefore(this.topSpacer, editorContainer);
      scrollContainer.appendChild(this.bottomSpacer);
    }

    this.updateSpacerHeights();
  }

  private removeSpacers(): void {
    this.topSpacer?.remove();
    this.bottomSpacer?.remove();
    this.topSpacer = null;
    this.bottomSpacer = null;
    const editorContainer = this.view.dom.parentElement;
    if (editorContainer) editorContainer.style.minHeight = "";
  }

  private updateSpacerHeights(): void {
    if (!this.topSpacer || !this.bottomSpacer) return;

    const lineHeight = this.getEstimatedLineHeight();
    const totalHeight = this.totalLines * lineHeight;
    const sorted = [...this.state.loadedBlockIndices].sort((a, b) => a - b);

    if (sorted.length === 0) {
      this.topSpacer.style.height = "0px";
      this.bottomSpacer.style.height = `${totalHeight}px`;
      return;
    }

    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    this.topSpacer.style.height = `${first * this.blockSize * lineHeight}px`;

    const bottomStart = (last + 1) * this.blockSize;
    this.bottomSpacer.style.height = `${Math.max(0, this.totalLines - bottomStart) * lineHeight}px`;
  }

  // --- 块加载 ---

  async loadBlocks(blockIndices: number[]): Promise<void> {
    if (!this.state.enabled) return;
    if (!window.electronAPI?.documentBlock) return;

    const validIndices = blockIndices.filter((i) => i >= 0 && i < this.state.totalBlocks);

    // 如果正在加载，将请求排队（只保留最新的）
    if (this.state.isLoading) {
      this.pendingLoad = validIndices;
      return;
    }

    const blocksToLoad = validIndices.filter((i) => !this.state.blockContents.has(i));

    const currentKey = [...this.state.loadedBlockIndices].sort().join(",");
    const newKey = [...validIndices].sort().join(",");
    if (blocksToLoad.length === 0 && currentKey === newKey) return;

    this.state.isLoading = true;

    try {
      if (blocksToLoad.length > 0) {
        const blocks = await window.electronAPI.documentBlock.getBlocks(blocksToLoad);
        blocks.forEach((block) => {
          this.state.blockContents.set(block.index, block.content);
        });
      }

      this.state.loadedBlockIndices = validIndices;

      // 记录当前 blockIndex 对应的目标 scrollTop，用于更新后恢复
      const scrollContainer = this.view.dom.parentElement?.parentElement;
      const targetScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

      // 更新内容和 spacer
      this.updateEditorContent(validIndices);
      this.updateSpacerHeights();

      // 标记内容更新后的 scrollTop，用于过滤非用户滚动
      if (scrollContainer) {
        scrollContainer.scrollTop = targetScrollTop;
        this.lastRestoredScrollTop = scrollContainer.scrollTop;
      }

      // 安排延迟重检，仅在用户确实在滚动时才会触发加载
      this.scheduleDeferredCheck();
    } catch (error) {
      console.error("Failed to load blocks:", error);
    } finally {
      this.state.isLoading = false;

      // 处理排队的请求
      if (this.pendingLoad) {
        const pending = this.pendingLoad;
        this.pendingLoad = null;
        this.loadBlocks(pending);
      }
    }
  }

  private updateEditorContent(blockIndices: number[]): void {
    const sorted = [...blockIndices].sort((a, b) => a - b);
    const contents = sorted
      .map((i) => this.state.blockContents.get(i))
      .filter((c) => c !== undefined);

    if (contents.length === 0) return;

    const { doc } = this.parser(contents.join("\n"));

    const tr = this.view.state.tr.replaceWith(0, this.view.state.doc.content.size, doc.content);
    tr.setMeta(virtualScrollPluginKey, { blockUpdate: true });

    this.view.dispatch(tr);

    // 更新行号偏移（CSS counter-reset）
    this.updateLineNumberOffset(sorted[0]);
  }

  /** 更新 CSS 行号计数器的起始值 */
  private updateLineNumberOffset(firstBlockIndex: number): void {
    const startLine = firstBlockIndex * this.blockSize;
    // counter-reset: line-number <offset> 使计数器从 offset+1 开始
    this.view.dom.style.counterReset = `line-number ${startLine}`;
  }

  // --- 滚动处理 ---

  handleScroll(): void {
    if (!this.state.enabled) return;

    const scrollContainer = this.view.dom.parentElement?.parentElement;
    if (!scrollContainer) return;

    // 只响应用户真实滚动：scrollTop 与上次内容更新后恢复的值差距足够大
    // 内容更新引起的微小高度变化（spacer/内容替换）导致的 scroll 事件会被过滤
    if (
      Math.abs(scrollContainer.scrollTop - this.lastRestoredScrollTop) <
      VirtualScrollManager.SCROLL_THRESHOLD
    ) {
      return;
    }

    // 有选区时暂停块切换
    const { from, to } = this.view.state.selection;
    if (from !== to) return;

    this.loadBlocksForCurrentScroll();
  }

  /** 根据当前 scrollTop 计算并加载需要的块 */
  loadBlocksForCurrentScroll = (): void => {
    const scrollContainer = this.view.dom.parentElement?.parentElement;
    if (!scrollContainer) return;

    const scrollTop = scrollContainer.scrollTop;
    const lineHeight = this.getEstimatedLineHeight();
    if (lineHeight <= 0) return;

    // 根据 scrollTop 所在的区域（顶部 spacer / 实际内容 / 底部 spacer）分别计算行号
    // 避免使用 scrollTop / totalHeight 的估算方式，因为实际渲染内容高度（标题、代码块、
    // 数学公式等）与估算高度差异会随文档增大而累积，导致向上滚动时块加载错误
    const topSpacerHeight = this.topSpacer ? parseFloat(this.topSpacer.style.height) || 0 : 0;
    const editorContainer = this.view.dom.parentElement;
    const contentHeight = editorContainer ? editorContainer.offsetHeight : 0;
    const contentEndPos = topSpacerHeight + contentHeight;

    const sorted = [...this.state.loadedBlockIndices].sort((a, b) => a - b);
    const firstLoadedBlock = sorted.length > 0 ? sorted[0] : 0;
    const lastLoadedBlock = sorted.length > 0 ? sorted[sorted.length - 1] : 0;

    let currentLine: number;

    if (sorted.length === 0 || scrollTop <= topSpacerHeight) {
      // 在顶部 spacer 区域或无已加载块 — spacer 使用 lineHeight 计算，结果精确
      currentLine = Math.floor(scrollTop / lineHeight);
    } else if (scrollTop >= contentEndPos) {
      // 在底部 spacer 区域 — 同样精确
      const bottomSpacerStartLine = (lastLoadedBlock + 1) * this.blockSize;
      const posInBottomSpacer = scrollTop - contentEndPos;
      currentLine = bottomSpacerStartLine + Math.floor(posInBottomSpacer / lineHeight);
    } else {
      // 在实际内容区域 — 用内容比例估算，误差限定在已加载块范围内（±5 块）
      const contentStartLine = firstLoadedBlock * this.blockSize;
      const loadedLines = (lastLoadedBlock - firstLoadedBlock + 1) * this.blockSize;
      const posInContent = scrollTop - topSpacerHeight;
      const contentRatio = contentHeight > 0 ? posInContent / contentHeight : 0;
      currentLine = contentStartLine + Math.floor(contentRatio * loadedLines);
    }

    currentLine = Math.max(0, Math.min(currentLine, this.totalLines - 1));
    const newBlockIndex = Math.max(
      0,
      Math.min(Math.floor(currentLine / this.blockSize), this.state.totalBlocks - 1)
    );

    const blocksToLoad = [
      newBlockIndex - 2,
      newBlockIndex - 1,
      newBlockIndex,
      newBlockIndex + 1,
      newBlockIndex + 2,
    ].filter((i) => i >= 0 && i < this.state.totalBlocks);

    // 检查需要的块是否已经全部加载（不仅检查 blockIndex 是否变化）
    const needed = new Set(blocksToLoad);
    const loaded = new Set(this.state.loadedBlockIndices);
    const allLoaded =
      [...needed].every((i) => loaded.has(i)) && [...loaded].every((i) => needed.has(i));

    if (!allLoaded) {
      this.state.currentBlockIndex = newBlockIndex;
      this.loadBlocks(blocksToLoad);
    }
  };

  /** 安排延迟重检，仅当用户确实在滚动时才触发加载 */
  scheduleDeferredCheck = (): void => {
    if (this.deferredCheckTimer) clearTimeout(this.deferredCheckTimer);
    this.deferredCheckTimer = setTimeout(() => {
      this.deferredCheckTimer = null;
      if (!this.state.enabled) return;
      const scrollContainer = this.view.dom.parentElement?.parentElement;
      if (!scrollContainer) return;
      // 只在用户真实滚动过（scrollTop 有显著变化）时才重新加载
      if (
        Math.abs(scrollContainer.scrollTop - this.lastRestoredScrollTop) >=
        VirtualScrollManager.SCROLL_THRESHOLD
      ) {
        this.loadBlocksForCurrentScroll();
      }
    }, 100);
  };

  /**
   * 渐进式加载：先加载核心块（立即显示），其余块在下一帧异步加载
   * 用于 tab 切换等场景，减少白屏时间
   */
  async loadBlocksProgressive(coreIndices: number[], deferredIndices: number[]): Promise<void> {
    // 先加载核心块
    await this.loadBlocks(coreIndices);

    // 其余块在下一帧异步加载
    if (deferredIndices.length > 0) {
      const allIndices = [...new Set([...coreIndices, ...deferredIndices])].filter(
        (i) => i >= 0 && i < this.state.totalBlocks
      );
      requestAnimationFrame(() => {
        if (this.state.enabled) {
          this.loadBlocks(allIndices);
        }
      });
    }
  }

  destroy(): void {
    if (this.deferredCheckTimer) clearTimeout(this.deferredCheckTimer);
    this.removeSpacers();
  }
}

// 全局管理器实例
const managers = new WeakMap<EditorView, VirtualScrollManager>();

export function createVirtualScrollPlugin(): Plugin<VirtualScrollState> {
  return new Plugin<VirtualScrollState>({
    key: virtualScrollPluginKey,

    state: {
      init() {
        return {
          enabled: false,
          currentBlockIndex: 0,
          loadedBlockIndices: [],
          totalBlocks: 0,
          isLoading: false,
          blockContents: new Map(),
        };
      },
      apply(tr, pluginState) {
        const meta = tr.getMeta(virtualScrollPluginKey);
        if (meta) return { ...pluginState, ...meta };
        return pluginState;
      },
    },

    view(editorView) {
      const manager = new VirtualScrollManager(editorView);
      managers.set(editorView, manager);

      const scrollContainer = editorView.dom.parentElement?.parentElement;
      let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

      const handleScroll = () => {
        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => manager.handleScroll(), 30);
      };

      if (scrollContainer) {
        scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
      }

      return {
        destroy() {
          if (scrollTimeout) clearTimeout(scrollTimeout);
          if (scrollContainer) scrollContainer.removeEventListener("scroll", handleScroll);
          manager.destroy();
          managers.delete(editorView);
        },
      };
    },
  });
}

export function getVirtualScrollManager(view: EditorView): VirtualScrollManager | undefined {
  return managers.get(view);
}

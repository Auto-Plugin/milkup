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
  /** 实测块高度缓存：blockIndex → 实测高度(px) */
  private blockHeights: Map<number, number> = new Map();
  /** 监听主编辑器容器宽度变化 */
  private resizeObserver: ResizeObserver | null = null;
  /** 上次测量时的容器宽度 */
  private lastMeasureWidth: number = 0;

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
    this.blockHeights.clear();
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

    // 监听容器宽度变化，宽度变化时清空高度缓存并重新测量
    if (scrollContainer && !this.resizeObserver) {
      this.lastMeasureWidth = scrollContainer.clientWidth;
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const newWidth = entry.contentRect.width;
          if (Math.abs(newWidth - this.lastMeasureWidth) > 1) {
            this.lastMeasureWidth = newWidth;
            this.blockHeights.clear();
            // 重新测量当前已加载块
            this.measureNewBlocks(this.state.loadedBlockIndices);
            this.updateSpacerHeights();
          }
        }
      });
      this.resizeObserver.observe(scrollContainer);
    }
  }

  private removeSpacers(): void {
    this.topSpacer?.remove();
    this.bottomSpacer?.remove();
    this.topSpacer = null;
    this.bottomSpacer = null;
    const editorContainer = this.view.dom.parentElement;
    if (editorContainer) editorContainer.style.minHeight = "";
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  private updateSpacerHeights(): void {
    if (!this.topSpacer || !this.bottomSpacer) return;

    const sorted = [...this.state.loadedBlockIndices].sort((a, b) => a - b);

    if (sorted.length === 0) {
      // 无已加载块，使用估算值
      const lineHeight = this.getEstimatedLineHeight();
      const totalHeight = this.totalLines * lineHeight;
      this.topSpacer.style.height = "0px";
      this.bottomSpacer.style.height = `${totalHeight}px`;
      return;
    }

    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    // 逐块累加实测/估算高度
    let topH = 0;
    for (let i = 0; i < first; i++) topH += this.getBlockHeight(i);
    this.topSpacer.style.height = `${topH}px`;

    let bottomH = 0;
    for (let i = last + 1; i < this.state.totalBlocks; i++) bottomH += this.getBlockHeight(i);
    this.bottomSpacer.style.height = `${bottomH}px`;
  }

  // --- 块高度测量 ---

  /** 使用隐藏的测量编辑器测量单个块的渲染高度 */
  private measureBlockHeight(blockIndex: number): number {
    const content = this.state.blockContents.get(blockIndex);
    if (!content || !globalMeasureView) {
      return this.estimateBlockHeight(blockIndex);
    }

    try {
      const { doc } = this.parser(content);
      const tr = globalMeasureView.state.tr.replaceWith(
        0,
        globalMeasureView.state.doc.content.size,
        doc.content
      );
      globalMeasureView.dispatch(tr);

      // 移除 padding 影响（padding 是编辑器常量，不属于单个块）
      const prevPadding = globalMeasureView.dom.style.padding;
      globalMeasureView.dom.style.padding = "0";

      const height = globalMeasureView.dom.offsetHeight;

      globalMeasureView.dom.style.padding = prevPadding;

      return height > 0 ? height : this.estimateBlockHeight(blockIndex);
    } catch {
      return this.estimateBlockHeight(blockIndex);
    }
  }

  /** 批量测量尚未缓存的块高度 */
  private measureNewBlocks(blockIndices: number[]): void {
    const uncached = blockIndices.filter((i) => !this.blockHeights.has(i));
    for (const idx of uncached) {
      this.blockHeights.set(idx, this.measureBlockHeight(idx));
    }
  }

  /** 获取块高度：优先使用实测值，否则 fallback 到估算 */
  private getBlockHeight(blockIndex: number): number {
    return this.blockHeights.get(blockIndex) ?? this.estimateBlockHeight(blockIndex);
  }

  /** 估算块高度（fallback） */
  private estimateBlockHeight(blockIndex: number): number {
    const lineHeight = this.getEstimatedLineHeight();
    // 最后一块可能不满 blockSize 行
    const linesInBlock =
      blockIndex === this.state.totalBlocks - 1
        ? this.totalLines - blockIndex * this.blockSize
        : this.blockSize;
    return linesInBlock * lineHeight;
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

      // 先测量新增块的高度（使用隐藏编辑器）
      this.measureNewBlocks(validIndices);

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
    const viewportHeight = scrollContainer.clientHeight;
    const viewportBottom = scrollTop + viewportHeight;
    const lineHeight = this.getEstimatedLineHeight();
    if (lineHeight <= 0) return;

    const topSpacerH = this.topSpacer ? parseFloat(this.topSpacer.style.height) || 0 : 0;
    const editorContainer = this.view.dom.parentElement;
    const contentH = editorContainer ? editorContainer.offsetHeight : 0;
    const contentEnd = topSpacerH + contentH;

    const sorted = [...this.state.loadedBlockIndices].sort((a, b) => a - b);
    const firstBlock = sorted.length > 0 ? sorted[0] : -1;
    const lastBlock = sorted.length > 0 ? sorted[sorted.length - 1] : -1;

    let newBlockIndex: number | null = null;

    if (sorted.length === 0 || viewportBottom <= topSpacerH || scrollTop >= contentEnd) {
      // 无已加载块 或 视口完全跳出内容区域（滚动条拖拽等）— 按位置重新计算
      newBlockIndex = this.computeBlockIndexFromPosition(
        scrollTop,
        topSpacerH,
        contentEnd,
        contentH,
        firstBlock,
        lastBlock
      );
    } else {
      // 视口与内容区域有重叠 — 使用双触发点（hysteresis）判断是否需要加载
      //
      // 上触发点：内容顶部 + 1倍视口高度
      // 下触发点：内容底部 - 1倍视口高度
      //
      // 两点间距 = contentH - 2 * viewportHeight（通常远大于 2 倍视口高度）
      // 用户在此"死区"内来回滚动不会触发任何加载，彻底避免振荡
      //
      //  topSpacer
      //  ────────────── contentTop
      //  ··· buffer ···
      //  ─ ─ ─ ─ ─ ─ ─ 上触发点（viewport top < 此处 → 向上加载）
      //  │             │
      //  │   dead zone │ ← 来回滚动不触发
      //  │             │
      //  ─ ─ ─ ─ ─ ─ ─ 下触发点（viewport bottom > 此处 → 向下加载）
      //  ··· buffer ···
      //  ────────────── contentBottom
      //  bottomSpacer

      if (scrollTop < topSpacerH + viewportHeight && firstBlock > 0) {
        // 视口顶部接近/进入上缓冲区 → 窗口向上平移 1 块
        newBlockIndex = Math.max(0, this.state.currentBlockIndex - 1);
      } else if (
        viewportBottom > contentEnd - viewportHeight &&
        lastBlock < this.state.totalBlocks - 1
      ) {
        // 视口底部接近/进入下缓冲区 → 窗口向下平移 1 块
        newBlockIndex = Math.min(this.state.totalBlocks - 1, this.state.currentBlockIndex + 1);
      }
    }

    if (newBlockIndex === null) return;

    const blocksToLoad = [
      newBlockIndex - 2,
      newBlockIndex - 1,
      newBlockIndex,
      newBlockIndex + 1,
      newBlockIndex + 2,
    ].filter((i) => i >= 0 && i < this.state.totalBlocks);

    // 检查需要的块是否已经全部加载
    const needed = new Set(blocksToLoad);
    const loaded = new Set(this.state.loadedBlockIndices);
    const allLoaded =
      [...needed].every((i) => loaded.has(i)) && [...loaded].every((i) => needed.has(i));

    if (!allLoaded) {
      this.state.currentBlockIndex = newBlockIndex;
      this.loadBlocks(blocksToLoad);
    }
  };

  /** 根据 scrollTop 在 spacer/content 区域中的位置计算目标块索引 */
  private computeBlockIndexFromPosition(
    scrollTop: number,
    topSpacerH: number,
    contentEnd: number,
    contentH: number,
    firstBlock: number,
    lastBlock: number
  ): number {
    let blockIndex: number;

    if (firstBlock < 0 || scrollTop <= topSpacerH) {
      // 在顶部 spacer 区域 — 逐块累加高度定位
      let accum = 0;
      blockIndex = 0;
      for (let i = 0; i < this.state.totalBlocks; i++) {
        const h = this.getBlockHeight(i);
        if (accum + h > scrollTop) {
          blockIndex = i;
          break;
        }
        accum += h;
        blockIndex = i;
      }
    } else if (scrollTop >= contentEnd) {
      // 在底部 spacer 区域 — 逐块累加高度定位
      let accum = contentEnd;
      blockIndex = lastBlock + 1;
      for (let i = lastBlock + 1; i < this.state.totalBlocks; i++) {
        const h = this.getBlockHeight(i);
        if (accum + h > scrollTop) {
          blockIndex = i;
          break;
        }
        accum += h;
        blockIndex = i;
      }
    } else {
      // 在实际内容区域 — 用比例估算
      const startLine = firstBlock * this.blockSize;
      const loadedLines = (lastBlock - firstBlock + 1) * this.blockSize;
      const ratio = contentH > 0 ? (scrollTop - topSpacerH) / contentH : 0;
      const currentLine = startLine + Math.floor(ratio * loadedLines);
      blockIndex = Math.floor(currentLine / this.blockSize);
    }

    return Math.max(0, Math.min(blockIndex, this.state.totalBlocks - 1));
  }

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

// 外部测量编辑器（由 App.vue 中的隐藏 MilkupEditor 提供）
let globalMeasureView: EditorView | null = null;

export function setMeasureView(view: EditorView): void {
  globalMeasureView = view;
}

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

/**
 * Milkup 虚拟滚动插件 v9
 *
 * 纯 transform 架构 —— 完全摒弃浏览器原生滚动
 *
 * 核心思想：
 * - 用 JS 变量 `virtualScrollTop` 作为唯一的滚动位置状态
 * - `overflow: hidden` 禁止浏览器原生滚动
 * - 通过 wheel 事件驱动 virtualScrollTop 变化
 * - 用 transform: translateY 定位可视内容
 * - 基于 virtualScrollTop 判断该加载哪些块
 * - 自定义滚动条提供视觉反馈
 *
 * 彻底消除反馈循环：
 * - 不读也不写 scrollContainer.scrollTop
 * - 块加载 / 高度变化只影响 transform，不改变 virtualScrollTop
 * - virtualScrollTop 只由用户输入（wheel / scrollbar drag）改变
 *
 * DOM 结构（虚拟滚动启用时）：
 *   .scrollView (overflow: hidden, position: relative)         ← scrollContainer
 *     .milkup-container (transform: translateY(-localOffset))  ← 编辑器容器
 *       .ProseMirror                                           ← 编辑器 DOM
 *     .vs-scrollbar-track                                      ← 自定义滚动条轨道
 *       .vs-scrollbar-thumb                                    ← 滚动条滑块
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { parseMarkdown } from "../parser";

/** 插件 Key */
export const virtualScrollPluginKey = new PluginKey("milkup-virtual-scroll");

/** 滚动锚点 */
export interface ScrollAnchor {
  blockIndex: number;
  fractionInBlock: number;
}

/** 虚拟滚动状态 */
interface VirtualScrollState {
  enabled: boolean;
  currentBlockIndex: number;
  loadedBlockIndices: number[];
  totalBlocks: number;
  isLoading: boolean;
  blockContents: Map<number, string>;
}

/** loadBlocks 选项 */
interface LoadBlocksOptions {
  /** 编程式加载（如 scrollToLine / setMarkdown 调用） */
  programmatic?: boolean;
}

/** 从编辑器 DOM 计算实际行高 */
function getLineHeight(editorDom: HTMLElement): number {
  const computed = getComputedStyle(editorDom);
  const fontSize = parseFloat(computed.fontSize) || 16;
  const lh = computed.lineHeight;
  if (lh && lh !== "normal") {
    const parsed = parseFloat(lh);
    return lh.endsWith("px") ? parsed : fontSize * parsed;
  }
  return fontSize * 1.6;
}

// ======================== BlockHeightCache ========================

class BlockHeightCache {
  private heights: number[];
  private measured: boolean[];
  private blockLineCounts: number[];
  private prefixSums: number[] | null = null;

  constructor(totalBlocks: number, blockSize: number, totalLines: number, lineHeight: number) {
    this.heights = new Array(totalBlocks);
    this.measured = new Array(totalBlocks).fill(false);
    this.blockLineCounts = new Array(totalBlocks);

    for (let i = 0; i < totalBlocks; i++) {
      const startLine = i * blockSize;
      const endLine = Math.min(startLine + blockSize, totalLines);
      const lines = endLine - startLine;
      this.blockLineCounts[i] = lines;
      this.heights[i] = lines * lineHeight;
    }
  }

  get totalBlocks(): number {
    return this.heights.length;
  }

  getBlockLineCount(blockIndex: number): number {
    return this.blockLineCounts[blockIndex] ?? 0;
  }

  getBlockHeight(blockIndex: number): number {
    return this.heights[blockIndex] ?? 0;
  }

  isMeasured(blockIndex: number): boolean {
    return this.measured[blockIndex] ?? false;
  }

  setMeasuredHeights(blockIndices: number[], totalRenderedHeight: number): void {
    const totalLines = blockIndices.reduce((sum, i) => sum + (this.blockLineCounts[i] ?? 0), 0);
    if (totalLines <= 0) return;

    for (const i of blockIndices) {
      const lines = this.blockLineCounts[i] ?? 0;
      if (lines > 0) {
        this.heights[i] = (lines / totalLines) * totalRenderedHeight;
        this.measured[i] = true;
      }
    }
    this.prefixSums = null;
  }

  updateEstimatedLineHeight(lineHeight: number): void {
    let dirty = false;
    for (let i = 0; i < this.heights.length; i++) {
      if (!this.measured[i]) {
        this.heights[i] = this.blockLineCounts[i] * lineHeight;
        dirty = true;
      }
    }
    if (dirty) this.prefixSums = null;
  }

  private ensurePrefixSums(): number[] {
    if (this.prefixSums) return this.prefixSums;
    const n = this.heights.length;
    const sums = new Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += this.heights[i];
      sums[i] = acc;
    }
    this.prefixSums = sums;
    return sums;
  }

  getCumulativeHeight(upTo: number): number {
    if (upTo <= 0) return 0;
    const sums = this.ensurePrefixSums();
    const idx = Math.min(upTo, sums.length) - 1;
    return sums[idx] ?? 0;
  }

  getTotalHeight(): number {
    return this.getCumulativeHeight(this.heights.length);
  }

  getBlockAtPosition(scrollTop: number): { blockIndex: number; offsetInBlock: number } {
    if (scrollTop <= 0) return { blockIndex: 0, offsetInBlock: 0 };

    const sums = this.ensurePrefixSums();
    const n = sums.length;

    if (scrollTop >= sums[n - 1]) {
      return { blockIndex: n - 1, offsetInBlock: this.heights[n - 1] };
    }

    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sums[mid] <= scrollTop) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    const blockIndex = lo;
    const blockStart = blockIndex > 0 ? sums[blockIndex - 1] : 0;
    return { blockIndex, offsetInBlock: scrollTop - blockStart };
  }
}

// ======================== VirtualScrollManager ========================

class VirtualScrollManager {
  private view: EditorView;
  private state: VirtualScrollState;
  private parser = parseMarkdown;

  /** 滚动容器 (.scrollView) */
  private scrollContainer: HTMLElement | null = null;
  /** 编辑器容器 (.milkup-container) —— 用 transform 定位 */
  private editorContainer: HTMLElement | null = null;
  /** 自定义滚动条 */
  private scrollbarTrack: HTMLElement | null = null;
  private scrollbarThumb: HTMLElement | null = null;

  private blockSize: number = 150;
  private totalLines: number = 0;
  private heightCache: BlockHeightCache | null = null;
  private pendingLoad: { indices: number[]; options?: LoadBlocksOptions } | null = null;
  private cachedLineHeight: number = 0;
  private lineHeightCacheTime: number = 0;

  /** 核心状态：虚拟滚动位置（替代 scrollContainer.scrollTop） */
  private virtualScrollTop: number = 0;
  /** 视口高度缓存 */
  private viewportHeight: number = 0;

  /** 事件绑定引用（用于 destroy 时移除） */
  private boundWheel: ((e: WheelEvent) => void) | null = null;
  private boundThumbDown: ((e: MouseEvent) => void) | null = null;
  private boundTrackClick: ((e: MouseEvent) => void) | null = null;
  private boundMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundMouseUp: ((e: MouseEvent) => void) | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundResize: (() => void) | null = null;
  /** scrollbar drag 状态 */
  private isDraggingThumb: boolean = false;
  private dragStartY: number = 0;
  private dragStartScrollTop: number = 0;
  /** 滚动条自动隐藏 */
  private scrollbarHideTimer: ReturnType<typeof setTimeout> | null = null;

  /** 原始 overflow 样式（destroy 时恢复） */
  private originalOverflow: string = "";

  constructor(view: EditorView) {
    this.view = view;
    this.scrollContainer = view.dom.parentElement?.parentElement ?? null;
    this.editorContainer = view.dom.parentElement ?? null;
    this.state = {
      enabled: false,
      currentBlockIndex: 0,
      loadedBlockIndices: [],
      totalBlocks: 0,
      isLoading: false,
      blockContents: new Map(),
    };
  }

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

  getHeightCache(): BlockHeightCache | null {
    return this.heightCache;
  }

  getScrollContainer(): HTMLElement | null {
    return this.scrollContainer;
  }

  getVirtualScrollTop(): number {
    return this.virtualScrollTop;
  }

  getViewportHeight(): number {
    return this.viewportHeight;
  }

  setEnabled(enabled: boolean, totalBlocks: number, blockSize: number, totalLines: number): void {
    this.state.enabled = enabled;
    this.state.totalBlocks = totalBlocks;
    this.blockSize = blockSize;
    this.totalLines = totalLines;
    this.clearCache();
    this.state.currentBlockIndex = 0;
    this.cachedLineHeight = 0;
    this.lineHeightCacheTime = 0;
    this.virtualScrollTop = 0;

    if (enabled) {
      const lineHeight = this.getEstimatedLineHeight();
      this.heightCache = new BlockHeightCache(totalBlocks, blockSize, totalLines, lineHeight);
      this.setupDOM();
    } else {
      this.heightCache = null;
      this.teardownDOM();
    }
  }

  clearCache(): void {
    this.state.blockContents.clear();
    this.state.loadedBlockIndices = [];
  }

  // --- 锚点（供外部 Tab 保存/恢复使用） ---

  captureAnchor(): ScrollAnchor | null {
    if (!this.heightCache) return null;

    const { blockIndex, offsetInBlock } = this.heightCache.getBlockAtPosition(
      this.virtualScrollTop
    );
    const blockHeight = this.heightCache.getBlockHeight(blockIndex);
    const fraction = blockHeight > 0 ? offsetInBlock / blockHeight : 0;

    return { blockIndex, fractionInBlock: Math.max(0, Math.min(1, fraction)) };
  }

  resolveAnchor(anchor: ScrollAnchor): number {
    if (!this.heightCache) return 0;
    const blockTop = this.heightCache.getCumulativeHeight(anchor.blockIndex);
    const blockHeight = this.heightCache.getBlockHeight(anchor.blockIndex);
    return blockTop + anchor.fractionInBlock * blockHeight;
  }

  getScrollTopFromAnchor(anchor: ScrollAnchor): number {
    return this.resolveAnchor(anchor);
  }

  // --- DOM 管理 ---

  private setupDOM(): void {
    if (!this.scrollContainer) return;

    // 保存并替换 overflow
    this.originalOverflow = this.scrollContainer.style.overflow || "";
    this.scrollContainer.style.overflow = "hidden";
    this.scrollContainer.style.position = "relative";

    // 缓存视口高度
    this.viewportHeight = this.scrollContainer.clientHeight;

    // 创建自定义滚动条
    this.createScrollbar();

    // 绑定事件
    this.bindEvents();
  }

  private teardownDOM(): void {
    this.unbindEvents();
    this.removeScrollbar();

    if (this.scrollContainer) {
      this.scrollContainer.style.overflow = this.originalOverflow;
      this.scrollContainer.style.position = "";
    }

    // 清除 transform
    if (this.editorContainer) {
      this.editorContainer.style.transform = "";
      this.editorContainer.style.willChange = "";
    }
  }

  private createScrollbar(): void {
    if (!this.scrollContainer) return;

    // 轨道
    this.scrollbarTrack = document.createElement("div");
    this.scrollbarTrack.className = "vs-scrollbar-track";
    this.scrollbarTrack.style.cssText = `
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 12px;
      z-index: 10;
      opacity: 0;
      transition: opacity 0.3s;
    `;

    // 滑块
    this.scrollbarThumb = document.createElement("div");
    this.scrollbarThumb.className = "vs-scrollbar-thumb";
    this.scrollbarThumb.style.cssText = `
      position: absolute;
      right: 2px;
      width: 8px;
      min-height: 30px;
      border-radius: 4px;
      background: rgba(128, 128, 128, 0.5);
      cursor: pointer;
      transition: background 0.2s;
    `;

    this.scrollbarTrack.appendChild(this.scrollbarThumb);
    this.scrollContainer.appendChild(this.scrollbarTrack);

    // hover 效果
    this.scrollbarThumb.addEventListener("mouseenter", () => {
      this.scrollbarThumb!.style.background = "rgba(128, 128, 128, 0.7)";
    });
    this.scrollbarThumb.addEventListener("mouseleave", () => {
      if (!this.isDraggingThumb) {
        this.scrollbarThumb!.style.background = "rgba(128, 128, 128, 0.5)";
      }
    });

    this.updateScrollbar();
  }

  private removeScrollbar(): void {
    if (this.scrollbarTrack) {
      this.scrollbarTrack.remove();
      this.scrollbarTrack = null;
      this.scrollbarThumb = null;
    }
    if (this.scrollbarHideTimer) {
      clearTimeout(this.scrollbarHideTimer);
      this.scrollbarHideTimer = null;
    }
  }

  private updateScrollbar(): void {
    if (!this.scrollbarTrack || !this.scrollbarThumb || !this.heightCache) return;

    const totalHeight = this.heightCache.getTotalHeight();
    if (totalHeight <= this.viewportHeight) {
      // 内容不超过视口，隐藏滚动条
      this.scrollbarTrack.style.display = "none";
      return;
    }

    this.scrollbarTrack.style.display = "";

    // 计算滑块大小和位置
    const trackHeight = this.viewportHeight;
    const thumbHeight = Math.max(30, (this.viewportHeight / totalHeight) * trackHeight);
    const maxScrollTop = totalHeight - this.viewportHeight;
    const scrollRatio = maxScrollTop > 0 ? this.virtualScrollTop / maxScrollTop : 0;
    const thumbTop = scrollRatio * (trackHeight - thumbHeight);

    this.scrollbarThumb.style.height = `${thumbHeight}px`;
    this.scrollbarThumb.style.top = `${thumbTop}px`;
  }

  private showScrollbar(): void {
    if (!this.scrollbarTrack) return;
    this.scrollbarTrack.style.opacity = "1";

    if (this.scrollbarHideTimer) clearTimeout(this.scrollbarHideTimer);
    this.scrollbarHideTimer = setTimeout(() => {
      if (this.scrollbarTrack && !this.isDraggingThumb) {
        this.scrollbarTrack.style.opacity = "0";
      }
    }, 1200);
  }

  // --- 事件绑定 ---

  private bindEvents(): void {
    if (!this.scrollContainer) return;

    // Wheel 事件
    this.boundWheel = (e: WheelEvent) => this.handleWheel(e);
    this.scrollContainer.addEventListener("wheel", this.boundWheel, { passive: false });

    // 滚动条拖拽
    this.boundThumbDown = (e: MouseEvent) => this.handleThumbDown(e);
    this.scrollbarThumb?.addEventListener("mousedown", this.boundThumbDown);

    // 轨道点击
    this.boundTrackClick = (e: MouseEvent) => this.handleTrackClick(e);
    this.scrollbarTrack?.addEventListener("mousedown", this.boundTrackClick);

    // 全局 mousemove / mouseup（滚动条拖拽时）
    this.boundMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
    this.boundMouseUp = (e: MouseEvent) => this.handleMouseUp(e);
    document.addEventListener("mousemove", this.boundMouseMove);
    document.addEventListener("mouseup", this.boundMouseUp);

    // 键盘滚动 (PageUp/Down, Home/End)
    this.boundKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    this.scrollContainer.addEventListener("keydown", this.boundKeyDown);

    // 窗口 resize
    this.boundResize = () => this.handleResize();
    window.addEventListener("resize", this.boundResize);
  }

  private unbindEvents(): void {
    if (this.scrollContainer && this.boundWheel) {
      this.scrollContainer.removeEventListener("wheel", this.boundWheel);
    }
    if (this.scrollbarThumb && this.boundThumbDown) {
      this.scrollbarThumb.removeEventListener("mousedown", this.boundThumbDown);
    }
    if (this.scrollbarTrack && this.boundTrackClick) {
      this.scrollbarTrack.removeEventListener("mousedown", this.boundTrackClick);
    }
    if (this.boundMouseMove) {
      document.removeEventListener("mousemove", this.boundMouseMove);
    }
    if (this.boundMouseUp) {
      document.removeEventListener("mouseup", this.boundMouseUp);
    }
    if (this.scrollContainer && this.boundKeyDown) {
      this.scrollContainer.removeEventListener("keydown", this.boundKeyDown);
    }
    if (this.boundResize) {
      window.removeEventListener("resize", this.boundResize);
    }
  }

  // --- 事件处理 ---

  private handleWheel(e: WheelEvent): void {
    if (!this.state.enabled || !this.heightCache) return;

    e.preventDefault();

    let deltaY = e.deltaY;
    // 处理不同 deltaMode
    switch (e.deltaMode) {
      case 1: // 行
        deltaY *= this.getEstimatedLineHeight();
        break;
      case 2: // 页
        deltaY *= this.viewportHeight;
        break;
      // case 0: 像素，不变
    }

    this.scrollBy(deltaY);
  }

  private handleThumbDown(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.isDraggingThumb = true;
    this.dragStartY = e.clientY;
    this.dragStartScrollTop = this.virtualScrollTop;
    document.body.style.userSelect = "none";
  }

  private handleTrackClick(e: MouseEvent): void {
    if (!this.scrollbarTrack || !this.scrollbarThumb || !this.heightCache) return;
    // 忽略滑块上的点击（由 thumbDown 处理）
    if (e.target === this.scrollbarThumb) return;

    e.preventDefault();
    const trackRect = this.scrollbarTrack.getBoundingClientRect();
    const clickRatio = (e.clientY - trackRect.top) / trackRect.height;
    const totalHeight = this.heightCache.getTotalHeight();
    const maxScrollTop = Math.max(0, totalHeight - this.viewportHeight);

    this.scrollTo(clickRatio * maxScrollTop);
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDraggingThumb || !this.heightCache) return;

    const deltaY = e.clientY - this.dragStartY;
    const totalHeight = this.heightCache.getTotalHeight();
    const maxScrollTop = Math.max(0, totalHeight - this.viewportHeight);
    const trackHeight = this.viewportHeight;
    const thumbHeight = Math.max(30, (this.viewportHeight / totalHeight) * trackHeight);
    const scrollableTrack = trackHeight - thumbHeight;

    if (scrollableTrack <= 0) return;

    const scrollDelta = (deltaY / scrollableTrack) * maxScrollTop;
    this.scrollTo(this.dragStartScrollTop + scrollDelta);
  }

  private handleMouseUp(_e: MouseEvent): void {
    if (!this.isDraggingThumb) return;
    this.isDraggingThumb = false;
    document.body.style.userSelect = "";
    if (this.scrollbarThumb) {
      this.scrollbarThumb.style.background = "rgba(128, 128, 128, 0.5)";
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.state.enabled) return;

    switch (e.key) {
      case "PageDown":
        e.preventDefault();
        this.scrollBy(this.viewportHeight * 0.9);
        break;
      case "PageUp":
        e.preventDefault();
        this.scrollBy(-this.viewportHeight * 0.9);
        break;
      case "Home":
        if (e.ctrlKey) {
          e.preventDefault();
          this.scrollTo(0);
        }
        break;
      case "End":
        if (e.ctrlKey) {
          e.preventDefault();
          const maxScrollTop = this.heightCache
            ? Math.max(0, this.heightCache.getTotalHeight() - this.viewportHeight)
            : 0;
          this.scrollTo(maxScrollTop);
        }
        break;
    }
  }

  private handleResize(): void {
    if (!this.scrollContainer) return;
    this.viewportHeight = this.scrollContainer.clientHeight;
    this.updateTransform();
    this.updateScrollbar();
  }

  // --- 核心滚动 API ---

  /** 滚动到绝对位置 */
  scrollTo(position: number): void {
    if (!this.heightCache) return;

    const maxScrollTop = Math.max(0, this.heightCache.getTotalHeight() - this.viewportHeight);
    this.virtualScrollTop = Math.max(0, Math.min(position, maxScrollTop));

    this.updateTransform();
    this.updateScrollbar();
    this.showScrollbar();
    this.scheduleBlockLoad();

    // 通知外部（Vue 组件保存 Tab 状态）
    this.emitScrollEvent();
  }

  /** 相对滚动 */
  scrollBy(delta: number): void {
    this.scrollTo(this.virtualScrollTop + delta);
  }

  // --- Transform 和内容更新 ---

  /** 根据 virtualScrollTop 和已加载块，计算并设置 transform */
  private updateTransform(): void {
    if (!this.editorContainer || !this.heightCache) return;

    const sorted = [...this.state.loadedBlockIndices].sort((a, b) => a - b);
    if (sorted.length === 0) return;

    // 第一个加载块的顶部位置
    const firstBlockTop = this.heightCache.getCumulativeHeight(sorted[0]);
    // localOffset = virtualScrollTop 相对于第一个加载块顶部的偏移
    const localOffset = this.virtualScrollTop - firstBlockTop;

    this.editorContainer.style.willChange = "transform";
    this.editorContainer.style.transform = `translateY(${-localOffset}px)`;
  }

  /** 通知外部滚动状态变化 */
  private emitScrollEvent(): void {
    if (!this.scrollContainer) return;
    // 派发自定义事件，Vue 组件监听此事件保存 Tab 状态
    this.scrollContainer.dispatchEvent(new CustomEvent("vs-scroll"));
  }

  // --- 块加载调度 ---

  private loadScheduleTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleBlockLoad(): void {
    if (this.loadScheduleTimer) clearTimeout(this.loadScheduleTimer);
    this.loadScheduleTimer = setTimeout(() => {
      this.loadScheduleTimer = null;
      this.loadBlocksForCurrentScroll();
    }, 30);
  }

  loadBlocksForCurrentScroll = (): void => {
    if (!this.heightCache) return;

    const { blockIndex: newBlockIndex } = this.heightCache.getBlockAtPosition(
      this.virtualScrollTop
    );

    const blocksToLoad = [
      newBlockIndex - 2,
      newBlockIndex - 1,
      newBlockIndex,
      newBlockIndex + 1,
      newBlockIndex + 2,
    ].filter((i) => i >= 0 && i < this.state.totalBlocks);

    const needed = new Set(blocksToLoad);
    const loaded = new Set(this.state.loadedBlockIndices);
    const allLoaded =
      [...needed].every((i) => loaded.has(i)) && [...loaded].every((i) => needed.has(i));

    if (!allLoaded) {
      this.state.currentBlockIndex = newBlockIndex;
      this.loadBlocks(blocksToLoad);
    }
  };

  // --- 块加载 ---

  async loadBlocks(blockIndices: number[], options?: LoadBlocksOptions): Promise<void> {
    if (!this.state.enabled) return;
    if (!window.electronAPI?.documentBlock) return;

    const validIndices = blockIndices.filter((i) => i >= 0 && i < this.state.totalBlocks);

    if (this.state.isLoading) {
      this.pendingLoad = { indices: validIndices, options };
      return;
    }

    const blocksToLoad = validIndices.filter((i) => !this.state.blockContents.has(i));

    const currentKey = [...this.state.loadedBlockIndices].sort().join(",");
    const newKey = [...validIndices].sort().join(",");
    if (blocksToLoad.length === 0 && currentKey === newKey) return;

    this.state.isLoading = true;

    try {
      // 1. 加载块数据
      if (blocksToLoad.length > 0) {
        const blocks = await window.electronAPI.documentBlock.getBlocks(blocksToLoad);
        blocks.forEach((block) => {
          this.state.blockContents.set(block.index, block.content);
        });
      }

      this.state.loadedBlockIndices = validIndices;

      // 2. 更新编辑器内容
      this.updateEditorContent(validIndices);

      // 3. 测量高度（只测量未测量的块）
      this.measureAndUpdateHeights(validIndices);

      // 4. 更新 transform 和滚动条
      this.updateTransform();
      this.updateScrollbar();

      // 5. 延迟重检（确保不会遗漏块）
      requestAnimationFrame(() => {
        if (this.state.enabled && !this.state.isLoading) {
          this.loadBlocksForCurrentScroll();
        }
      });
    } catch (error) {
      console.error("Failed to load blocks:", error);
    } finally {
      this.state.isLoading = false;

      if (this.pendingLoad) {
        const pending = this.pendingLoad;
        this.pendingLoad = null;
        this.loadBlocks(pending.indices, pending.options);
      }
    }
  }

  private measureAndUpdateHeights(blockIndices: number[]): void {
    if (!this.heightCache) return;

    const totalRenderedHeight = this.view.dom.getBoundingClientRect().height;
    if (totalRenderedHeight <= 0) return;

    const sorted = [...blockIndices].sort((a, b) => a - b);

    let measuredHeightSum = 0;
    const unmeasuredIndices: number[] = [];

    for (const i of sorted) {
      if (this.heightCache.isMeasured(i)) {
        measuredHeightSum += this.heightCache.getBlockHeight(i);
      } else {
        unmeasuredIndices.push(i);
      }
    }

    if (unmeasuredIndices.length === 0) return;

    const remainingHeight = Math.max(0, totalRenderedHeight - measuredHeightSum);
    this.heightCache.setMeasuredHeights(unmeasuredIndices, remainingHeight);
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

    this.updateLineNumberOffset(sorted[0]);
  }

  private updateLineNumberOffset(firstBlockIndex: number): void {
    const startLine = firstBlockIndex * this.blockSize;
    this.view.dom.style.counterReset = `line-number ${startLine}`;
  }

  // --- 渐进式加载 ---

  async loadBlocksProgressive(coreIndices: number[], deferredIndices: number[]): Promise<void> {
    await this.loadBlocks(coreIndices, { programmatic: true });

    if (deferredIndices.length > 0) {
      const allIndices = [...new Set([...coreIndices, ...deferredIndices])].filter(
        (i) => i >= 0 && i < this.state.totalBlocks
      );
      requestAnimationFrame(() => {
        if (this.state.enabled) {
          this.loadBlocks(allIndices, { programmatic: true });
        }
      });
    }
  }

  // --- ProseMirror scrollIntoView 支持 ---

  /**
   * 当 ProseMirror 触发 scrollIntoView 时调用此方法
   * 确保光标位置在视口内可见
   */
  ensureCursorVisible(): void {
    if (!this.state.enabled || !this.scrollContainer) return;

    try {
      const { from } = this.view.state.selection;
      const coords = this.view.coordsAtPos(from);
      const containerRect = this.scrollContainer.getBoundingClientRect();

      const cursorTop = coords.top - containerRect.top;
      const cursorBottom = coords.bottom - containerRect.top;
      const margin = 40; // 边距

      if (cursorTop < margin) {
        // 光标在视口上方
        this.scrollBy(cursorTop - margin);
      } else if (cursorBottom > this.viewportHeight - margin) {
        // 光标在视口下方
        this.scrollBy(cursorBottom - this.viewportHeight + margin);
      }
    } catch {
      // coordsAtPos 可能抛出异常（pos 不在 DOM 中）
    }
  }

  // --- 生命周期 ---

  destroy(): void {
    this.teardownDOM();
    this.heightCache = null;
    if (this.loadScheduleTimer) {
      clearTimeout(this.loadScheduleTimer);
    }
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

      return {
        destroy() {
          manager.destroy();
          managers.delete(editorView);
        },
      };
    },

    props: {
      // 拦截 ProseMirror 的 scrollIntoView 行为
      handleScrollToSelection(view) {
        const manager = managers.get(view);
        if (manager?.getState().enabled) {
          manager.ensureCursorVisible();
          return true; // 阻止默认滚动
        }
        return false;
      },
    },
  });
}

export function getVirtualScrollManager(view: EditorView): VirtualScrollManager | undefined {
  return managers.get(view);
}

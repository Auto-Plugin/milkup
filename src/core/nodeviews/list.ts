/**
 * Milkup 列表 NodeView
 *
 * 支持源码模式显示原始 Markdown 标记
 * 保持缩进结构
 */

import { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorView as ProseMirrorView, NodeView } from "prosemirror-view";
import { sourceViewManager } from "../decorations";

// 存储所有列表视图实例
const listViews = new Set<BulletListView | OrderedListView>();

/**
 * 更新所有列表的源码模式状态
 */
export function updateAllLists(sourceView: boolean): void {
  for (const view of listViews) {
    view.setSourceViewMode(sourceView);
  }
}

/**
 * 无序列表 NodeView
 */
export class BulletListView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: ProseMirrorNode;
  private view: ProseMirrorView;
  private getPos: () => number | undefined;
  private sourceViewMode: boolean = false;
  private sourceViewUnsubscribe: (() => void) | null = null;

  constructor(node: ProseMirrorNode, view: ProseMirrorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // 注册到全局集合
    listViews.add(this);

    // 创建容器
    this.dom = document.createElement("ul");
    this.dom.className = "milkup-bullet-list";
    this.contentDOM = this.dom;

    // 订阅源码模式状态变化
    this.sourceViewUnsubscribe = sourceViewManager.subscribe((sourceView) => {
      this.setSourceViewMode(sourceView);
    });
  }

  setSourceViewMode(enabled: boolean): void {
    if (this.sourceViewMode === enabled) return;
    this.sourceViewMode = enabled;

    if (enabled) {
      this.dom.classList.add("source-view");
    } else {
      this.dom.classList.remove("source-view");
    }
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== "bullet_list") return false;
    this.node = node;
    return true;
  }

  ignoreMutation(mutation: MutationRecord): boolean {
    // 忽略 class 属性变化
    if (mutation.type === "attributes" && mutation.attributeName === "class") {
      return true;
    }
    return false;
  }

  destroy(): void {
    listViews.delete(this);
    if (this.sourceViewUnsubscribe) {
      this.sourceViewUnsubscribe();
      this.sourceViewUnsubscribe = null;
    }
  }
}

/**
 * 有序列表 NodeView
 */
export class OrderedListView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: ProseMirrorNode;
  private view: ProseMirrorView;
  private getPos: () => number | undefined;
  private sourceViewMode: boolean = false;
  private sourceViewUnsubscribe: (() => void) | null = null;

  constructor(node: ProseMirrorNode, view: ProseMirrorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // 注册到全局集合
    listViews.add(this);

    // 创建容器
    this.dom = document.createElement("ol");
    this.dom.className = "milkup-ordered-list";
    if (node.attrs.start !== 1) {
      this.dom.setAttribute("start", String(node.attrs.start));
    }
    this.contentDOM = this.dom;

    // 订阅源码模式状态变化
    this.sourceViewUnsubscribe = sourceViewManager.subscribe((sourceView) => {
      this.setSourceViewMode(sourceView);
    });
  }

  setSourceViewMode(enabled: boolean): void {
    if (this.sourceViewMode === enabled) return;
    this.sourceViewMode = enabled;

    if (enabled) {
      this.dom.classList.add("source-view");
    } else {
      this.dom.classList.remove("source-view");
    }
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== "ordered_list") return false;
    this.node = node;
    if (node.attrs.start !== 1) {
      this.dom.setAttribute("start", String(node.attrs.start));
    } else {
      this.dom.removeAttribute("start");
    }
    return true;
  }

  ignoreMutation(mutation: MutationRecord): boolean {
    // 忽略 class 属性变化
    if (mutation.type === "attributes" && mutation.attributeName === "class") {
      return true;
    }
    return false;
  }

  destroy(): void {
    listViews.delete(this);
    if (this.sourceViewUnsubscribe) {
      this.sourceViewUnsubscribe();
      this.sourceViewUnsubscribe = null;
    }
  }
}

/**
 * 列表项 NodeView
 */
export class ListItemView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: ProseMirrorNode;
  private view: ProseMirrorView;
  private getPos: () => number | undefined;
  private sourceViewMode: boolean = false;
  private sourceViewUnsubscribe: (() => void) | null = null;
  private markerElement: HTMLElement | null = null;

  constructor(node: ProseMirrorNode, view: ProseMirrorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // 创建容器
    this.dom = document.createElement("li");
    this.dom.className = "milkup-list-item";

    // 创建标记元素（源码模式下显示）
    this.markerElement = document.createElement("span");
    this.markerElement.className = "milkup-list-marker";
    this.updateMarker();

    // 创建内容容器
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "milkup-list-item-content";
    this.dom.appendChild(this.contentDOM);

    // 订阅源码模式状态变化
    this.sourceViewUnsubscribe = sourceViewManager.subscribe((sourceView) => {
      this.setSourceViewMode(sourceView);
    });
  }

  /**
   * 更新标记文本
   */
  private updateMarker(): void {
    if (!this.markerElement) return;

    const pos = this.getPos();
    if (pos === undefined) return;

    // 获取父列表类型和索引
    const $pos = this.view.state.doc.resolve(pos);
    const parent = $pos.parent;
    const index = $pos.index();

    if (parent.type.name === "bullet_list") {
      this.markerElement.textContent = "- ";
    } else if (parent.type.name === "ordered_list") {
      const start = parent.attrs.start || 1;
      this.markerElement.textContent = `${start + index}. `;
    } else {
      this.markerElement.textContent = "- ";
    }
  }

  setSourceViewMode(enabled: boolean): void {
    if (this.sourceViewMode === enabled) return;
    this.sourceViewMode = enabled;

    if (enabled) {
      this.dom.classList.add("source-view");
      // 在内容前插入标记
      if (this.markerElement && this.contentDOM) {
        this.updateMarker();
        this.dom.insertBefore(this.markerElement, this.contentDOM);
      }
    } else {
      this.dom.classList.remove("source-view");
      // 移除标记
      if (this.markerElement && this.markerElement.parentNode) {
        this.markerElement.remove();
      }
    }
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== "list_item") return false;
    this.node = node;
    // 更新标记
    if (this.sourceViewMode) {
      this.updateMarker();
    }
    return true;
  }

  ignoreMutation(mutation: MutationRecord): boolean {
    // 忽略 class 属性变化和标记元素的变化
    if (mutation.type === "attributes" && mutation.attributeName === "class") {
      return true;
    }
    if (mutation.target === this.markerElement) {
      return true;
    }
    return false;
  }

  destroy(): void {
    if (this.sourceViewUnsubscribe) {
      this.sourceViewUnsubscribe();
      this.sourceViewUnsubscribe = null;
    }
  }
}

/**
 * 创建无序列表 NodeView
 */
export function createBulletListNodeView(
  node: ProseMirrorNode,
  view: ProseMirrorView,
  getPos: () => number | undefined
): BulletListView {
  return new BulletListView(node, view, getPos);
}

/**
 * 创建有序列表 NodeView
 */
export function createOrderedListNodeView(
  node: ProseMirrorNode,
  view: ProseMirrorView,
  getPos: () => number | undefined
): OrderedListView {
  return new OrderedListView(node, view, getPos);
}

/**
 * 创建列表项 NodeView
 */
export function createListItemNodeView(
  node: ProseMirrorNode,
  view: ProseMirrorView,
  getPos: () => number | undefined
): ListItemView {
  return new ListItemView(node, view, getPos);
}

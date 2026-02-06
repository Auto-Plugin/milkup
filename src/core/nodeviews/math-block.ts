/**
 * Milkup 数学公式 NodeView
 *
 * 使用 KaTeX 渲染数学公式
 * 支持编辑模式和预览模式切换
 */

import { Node } from "prosemirror-model";
import { EditorView, NodeView } from "prosemirror-view";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * 渲染数学公式
 */
function renderMath(content: string, displayMode: boolean): string {
  if (!content.trim()) {
    return "";
  }

  try {
    return katex.renderToString(content, {
      displayMode,
      throwOnError: false,
      output: "html",
    });
  } catch (e) {
    return `<span class="math-error">${escapeHtml(content)}</span>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 存储所有 MathBlockView 实例，用于全局更新
const mathBlockViews = new Set<MathBlockView>();

/**
 * 更新所有数学块的编辑状态
 */
export function updateAllMathBlocks(view: EditorView): void {
  const { from, to } = view.state.selection;

  for (const mathView of mathBlockViews) {
    mathView.updateEditingState(from, to);
  }
}

/**
 * 数学块 NodeView
 */
export class MathBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private preview: HTMLElement;
  private sourceContainer: HTMLElement;
  private view: EditorView;
  private getPos: () => number | undefined;
  private isEditing: boolean = false;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.view = view;
    this.getPos = getPos;

    // 注册到全局集合
    mathBlockViews.add(this);

    // 创建容器
    this.dom = document.createElement("div");
    this.dom.className = "math-block";

    // 创建预览区域
    this.preview = document.createElement("div");
    this.preview.className = "math-preview";
    this.dom.appendChild(this.preview);

    // 创建源码容器（用于居中）
    this.sourceContainer = document.createElement("div");
    this.sourceContainer.className = "math-source-container";
    this.dom.appendChild(this.sourceContainer);

    // 创建编辑区域（contentDOM）
    this.contentDOM = document.createElement("code");
    this.contentDOM.className = "math-source";
    this.sourceContainer.appendChild(this.contentDOM);

    // 初始渲染
    this.updatePreview(node.textContent);

    // 点击预览区域进入编辑模式
    this.preview.addEventListener("click", () => {
      this.enterEditMode();
    });

    // 初始检查光标位置
    const { from, to } = view.state.selection;
    this.updateEditingState(from, to);
  }

  update(node: Node): boolean {
    if (node.type.name !== "math_block") return false;
    this.updatePreview(node.textContent);
    return true;
  }

  private updatePreview(content: string): void {
    const html = renderMath(content, true);
    this.preview.innerHTML = html || '<span class="math-placeholder">输入数学公式...</span>';
  }

  /**
   * 根据光标位置更新编辑状态
   */
  updateEditingState(selFrom: number, selTo: number): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;

    const nodeStart = pos;
    const nodeEnd = pos + node.nodeSize;

    // 检查光标是否在节点内部（包括节点边界）
    const cursorInNode = selFrom >= nodeStart && selTo <= nodeEnd;

    if (cursorInNode && !this.isEditing) {
      this.setEditing(true);
    } else if (!cursorInNode && this.isEditing) {
      this.setEditing(false);
    }
  }

  private setEditing(editing: boolean): void {
    this.isEditing = editing;
    if (editing) {
      this.dom.classList.add("editing");
    } else {
      this.dom.classList.remove("editing");
    }
  }

  private enterEditMode(): void {
    if (this.isEditing) return;
    this.setEditing(true);

    // 聚焦到编辑区域
    const pos = this.getPos();
    if (pos !== undefined) {
      const tr = this.view.state.tr.setSelection(
        this.view.state.selection.constructor.near(this.view.state.doc.resolve(pos + 1))
      );
      this.view.dispatch(tr);
      this.view.focus();
    }
  }

  selectNode(): void {
    this.setEditing(true);
  }

  deselectNode(): void {
    // 不在这里退出编辑模式，由 updateEditingState 统一处理
  }

  stopEvent(event: Event): boolean {
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    // 从全局集合中移除
    mathBlockViews.delete(this);
  }
}

/**
 * 创建数学块 NodeView
 */
export function createMathBlockNodeView(
  node: Node,
  view: EditorView,
  getPos: () => number | undefined
): NodeView {
  return new MathBlockView(node, view, getPos);
}

/**
 * 渲染行内数学公式
 */
export function renderInlineMath(content: string): string {
  return renderMath(content, false);
}

/**
 * 检查 KaTeX 是否可用
 */
export function isKaTeXAvailable(): boolean {
  return true;
}

/**
 * 预加载 KaTeX（已通过静态导入加载）
 */
export function preloadKaTeX(): Promise<void> {
  return Promise.resolve();
}

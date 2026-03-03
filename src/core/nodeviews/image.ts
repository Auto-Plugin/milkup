/**
 * Milkup 图片 NodeView
 *
 * 支持编辑模式和预览模式切换
 * 聚焦时同时显示图片和源码，离开时只显示图片
 * 源码可编辑，编辑后自动更新图片属性
 * 源码位置根据光标进入方向动态调整
 * 支持源码模式只显示原始 Markdown 文本
 */

import { Node } from "prosemirror-model";
import { EditorView, NodeView } from "prosemirror-view";
import { NodeSelection } from "prosemirror-state";
import { sourceViewManager } from "../decorations";

// 存储所有 ImageView 实例，用于全局更新
const imageViews = new Set<ImageView>();

/**
 * 在浏览器端简单解析目录路径
 */
function dirname(filePath: string): string {
  const sep = filePath.includes("\\") ? "\\" : "/";
  const lastIndex = filePath.lastIndexOf(sep);
  return lastIndex === -1 ? "." : filePath.substring(0, lastIndex);
}

/**
 * 在浏览器端简单拼接路径并规范化为正斜杠
 */
function joinPath(dir: string, relative: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  let rel = relative;
  while (rel.startsWith("./") || rel.startsWith(".\\")) {
    rel = rel.substring(2);
  }
  return (dir + sep + rel).replace(/\\/g, "/");
}

/**
 * 将相对路径转换为 file:// URL，仅用于 DOM 渲染
 * BrowserWindow 已设置 webSecurity: false，可直接加载 file:// URL
 * 不修改 ProseMirror 模型的 attrs.src
 */
function resolveImageSrc(src: string): string {
  if (!src) return src;

  // 跳过已知协议和绝对路径
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("file://") ||
    src.startsWith("data:") ||
    src.startsWith("milkup://") ||
    /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(src)
  ) {
    return src;
  }

  // 获取当前文件路径
  const currentFilePath = (window as any).__currentFilePath;
  if (!currentFilePath) return src;

  // 解析为绝对路径并转为 file:// URL
  const absolutePath = joinPath(dirname(currentFilePath), src);
  return "file:///" + absolutePath;
}

// 记录上一次光标位置，用于判断进入方向
let lastCursorPos = 0;

/**
 * 更新所有图片的编辑状态
 */
export function updateAllImages(view: EditorView): void {
  const { from, to } = view.state.selection;
  const selection = view.state.selection;

  for (const imageView of imageViews) {
    imageView.updateEditingState(from, to, selection, lastCursorPos);
  }

  // 更新上一次光标位置
  lastCursorPos = from;
}

/**
 * 解析图片 Markdown 语法
 * 格式: ![alt](src "title") 或 [![alt](src "title")](href "linkTitle")
 */
function parseImageMarkdown(
  markdown: string
): { src: string; alt: string; title: string; linkHref?: string; linkTitle?: string } | null {
  // 先尝试匹配链接图片 [![alt](src "title")](href "linkTitle")
  const linkedMatch = markdown.match(
    /^\[!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/
  );
  if (linkedMatch) {
    return {
      alt: linkedMatch[1] || "",
      src: linkedMatch[2] || "",
      title: linkedMatch[3] || "",
      linkHref: linkedMatch[4] || "",
      linkTitle: linkedMatch[5] || "",
    };
  }
  // 普通图片 ![alt](src "title")
  const match = markdown.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
  if (!match) return null;
  return {
    alt: match[1] || "",
    src: match[2] || "",
    title: match[3] || "",
  };
}

/**
 * 图片 NodeView
 *
 * 图片是原子节点，不使用 contentDOM
 * 源码可编辑，编辑后自动更新图片属性
 * 支持源码模式只显示原始 Markdown 文本
 */
export class ImageView implements NodeView {
  dom: HTMLElement;
  private imgElement: HTMLElement;
  private sourceContainer: HTMLElement;
  private sourceInput: HTMLInputElement;
  private view: EditorView;
  private getPos: () => number | undefined;
  private isEditing: boolean = false;
  private node: Node;
  private sourcePosition: "before" | "after" = "after";
  // 源码模式相关
  private sourceViewMode: boolean = false;
  private sourceViewUnsubscribe: (() => void) | null = null;
  private sourceTextElement: HTMLElement | null = null;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.view = view;
    this.getPos = getPos;
    this.node = node;

    // 注册到全局集合
    imageViews.add(this);

    // 创建容器
    this.dom = document.createElement("div");
    this.dom.className = "milkup-image-block";

    // 创建图片元素
    this.imgElement = document.createElement("div");
    this.imgElement.className = "milkup-image-preview";
    this.dom.appendChild(this.imgElement);

    // 创建源码容器（编辑模式下显示）
    this.sourceContainer = document.createElement("div");
    this.sourceContainer.className = "milkup-image-source-container";
    this.dom.appendChild(this.sourceContainer);

    // 创建源码输入框
    this.sourceInput = document.createElement("input");
    this.sourceInput.type = "text";
    this.sourceInput.className = "milkup-image-source-input";
    this.sourceInput.draggable = false; // 禁止拖动
    this.sourceContainer.appendChild(this.sourceInput);

    // 禁止容器拖动
    this.dom.draggable = false;
    this.sourceContainer.draggable = false;

    // 阻止源码容器的拖动事件
    this.sourceContainer.addEventListener("dragstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.sourceContainer.addEventListener("mousedown", (e) => {
      // 阻止事件冒泡到 ProseMirror，防止触发节点拖动
      e.stopPropagation();
    });

    // 初始渲染
    this.updateContent(node);

    // 点击图片进入编辑模式
    this.imgElement.addEventListener("click", (e) => {
      e.preventDefault();
      this.selectThisNode();
    });

    // 源码输入框事件
    this.sourceInput.addEventListener("blur", () => {
      this.applySourceChange();
    });

    // 实时响应源码变化
    this.sourceInput.addEventListener("input", () => {
      this.previewSourceChange();
    });

    this.sourceInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.applySourceChange();
        // 移动光标到下一行
        const pos = this.getPos();
        if (pos !== undefined) {
          const { state } = this.view;
          const $pos = state.doc.resolve(pos + this.node.nodeSize);
          const tr = state.tr.setSelection(state.selection.constructor.near($pos));
          this.view.dispatch(tr);
          this.view.focus();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        // 恢复原始值
        this.updateSourceInput();
        this.view.focus();
      } else if (e.key === "Backspace") {
        // 当输入框为空时，删除整个图片节点
        if (
          this.sourceInput.value === "" ||
          (this.sourceInput.selectionStart === 0 && this.sourceInput.selectionEnd === 0)
        ) {
          if (this.sourceInput.value === "") {
            e.preventDefault();
            this.deleteImageNode();
          }
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.applySourceChange();
        // 移动光标到图片之前
        const pos = this.getPos();
        if (pos !== undefined) {
          const { state } = this.view;
          const $pos = state.doc.resolve(pos);
          const tr = state.tr.setSelection(state.selection.constructor.near($pos, -1));
          this.view.dispatch(tr);
          this.view.focus();
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.applySourceChange();
        // 移动光标到图片之后
        const pos = this.getPos();
        if (pos !== undefined) {
          const { state } = this.view;
          const $pos = state.doc.resolve(pos + this.node.nodeSize);
          const tr = state.tr.setSelection(state.selection.constructor.near($pos, 1));
          this.view.dispatch(tr);
          this.view.focus();
        }
      }
    });

    // 源码模式初始化
    this.initSourceViewMode();
  }

  /**
   * 初始化源码模式
   */
  private initSourceViewMode(): void {
    // 创建源码文本元素（源码模式下显示）
    this.sourceTextElement = document.createElement("div");
    this.sourceTextElement.className = "milkup-image-source-text";
    this.sourceTextElement.contentEditable = "true";
    this.sourceTextElement.spellcheck = false;
    this.updateSourceText();

    // 源码文本编辑事件
    this.sourceTextElement.addEventListener("input", () => {
      this.handleSourceTextInput();
    });

    this.sourceTextElement.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.applySourceTextChange();
        // 移动光标到下一行
        const pos = this.getPos();
        if (pos !== undefined) {
          const { state } = this.view;
          const $pos = state.doc.resolve(pos + this.node.nodeSize);
          const tr = state.tr.setSelection(state.selection.constructor.near($pos));
          this.view.dispatch(tr);
          this.view.focus();
        }
      } else if (e.key === "Backspace") {
        const text = this.sourceTextElement?.textContent || "";
        const selection = window.getSelection();
        if (
          text === "" ||
          (selection && selection.anchorOffset === 0 && selection.focusOffset === 0)
        ) {
          if (text === "") {
            e.preventDefault();
            this.deleteImageNode();
          }
        }
      }
    });

    this.sourceTextElement.addEventListener("blur", () => {
      this.applySourceTextChange();
    });

    // 订阅源码模式状态变化
    this.sourceViewUnsubscribe = sourceViewManager.subscribe((sourceView) => {
      this.setSourceViewMode(sourceView);
    });
  }

  /**
   * 更新源码文本
   */
  private updateSourceText(): void {
    if (!this.sourceTextElement) return;
    const { src, alt, title, linkHref, linkTitle } = this.node.attrs;
    let imgMarkdown = `![${alt}](${src}`;
    if (title) {
      imgMarkdown += ` "${title}"`;
    }
    imgMarkdown += ")";
    let markdown: string;
    if (linkHref) {
      markdown = `[${imgMarkdown}](${linkHref}`;
      if (linkTitle) {
        markdown += ` "${linkTitle}"`;
      }
      markdown += ")";
    } else {
      markdown = imgMarkdown;
    }
    this.sourceTextElement.textContent = markdown;
  }

  /**
   * 处理源码文本输入
   */
  private handleSourceTextInput(): void {
    // 实时预览不需要做什么，因为源码模式下不显示图片
  }

  /**
   * 应用源码文本变更
   */
  private applySourceTextChange(): void {
    if (!this.sourceTextElement) return;
    const newMarkdown = this.sourceTextElement.textContent?.trim() || "";
    const parsed = parseImageMarkdown(newMarkdown);

    if (!parsed) {
      // 解析失败，恢复原始值
      this.updateSourceText();
      return;
    }

    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const { src, alt, title, linkHref, linkTitle } = this.node.attrs;

    // 检查是否有变化
    if (
      parsed.src === src &&
      parsed.alt === alt &&
      parsed.title === title &&
      (parsed.linkHref || "") === (linkHref || "") &&
      (parsed.linkTitle || "") === (linkTitle || "")
    ) {
      return;
    }

    // 更新节点属性
    const tr = state.tr.setNodeMarkup(pos, undefined, {
      src: parsed.src,
      alt: parsed.alt,
      title: parsed.title,
      linkHref: parsed.linkHref || "",
      linkTitle: parsed.linkTitle || "",
    });
    this.view.dispatch(tr);
  }

  /**
   * 设置源码模式
   */
  private setSourceViewMode(enabled: boolean): void {
    if (this.sourceViewMode === enabled) return;
    this.sourceViewMode = enabled;

    if (enabled) {
      // 进入源码模式
      this.dom.classList.add("source-view");
      // 隐藏图片预览
      this.imgElement.style.display = "none";
      // 隐藏编辑模式的源码容器
      this.sourceContainer.style.display = "none";
      // 显示源码文本
      if (this.sourceTextElement) {
        this.updateSourceText();
        this.dom.appendChild(this.sourceTextElement);
      }
    } else {
      // 退出源码模式
      this.dom.classList.remove("source-view");
      // 显示图片预览
      this.imgElement.style.display = "";
      // 恢复编辑模式的源码容器显示状态
      this.sourceContainer.style.display = "";
      // 移除源码文本
      if (this.sourceTextElement && this.sourceTextElement.parentNode) {
        this.sourceTextElement.remove();
      }
    }
  }

  update(node: Node): boolean {
    if (node.type.name !== "image") return false;
    this.node = node;
    this.updateContent(node);
    // 源码模式下也更新源码文本
    if (this.sourceViewMode) {
      this.updateSourceText();
    }
    return true;
  }

  private updateContent(node: Node): void {
    const { src, alt, title, linkHref } = node.attrs;
    this.renderImage(src, alt, title, linkHref);

    // 更新源码输入框（仅在非编辑状态下更新，避免覆盖用户输入）
    if (!this.isEditing) {
      this.updateSourceInput();
    }
  }

  /**
   * 渲染图片
   */
  private renderImage(src: string, alt: string, title?: string, linkHref?: string): void {
    // 清空容器
    this.imgElement.innerHTML = "";

    if (!src) {
      this.showImagePlaceholder("请输入图片地址");
      return;
    }

    const img = document.createElement("img");
    // 将相对路径转为 milkup:// 协议 URL 仅用于 DOM 渲染
    img.src = resolveImageSrc(src);
    img.alt = alt;
    if (title) img.title = title;
    img.onerror = () => {
      this.showImageError(src);
    };

    if (linkHref) {
      const a = document.createElement("a");
      a.href = linkHref;
      a.appendChild(img);
      // 阻止在编辑器中点击链接跳转
      a.addEventListener("click", (e) => {
        e.preventDefault();
      });
      this.imgElement.appendChild(a);
    } else {
      this.imgElement.appendChild(img);
    }
  }

  /**
   * 显示图片加载失败占位
   */
  private showImageError(src: string): void {
    this.imgElement.innerHTML = "";
    const placeholder = document.createElement("div");
    placeholder.className = "milkup-image-placeholder milkup-image-error-placeholder";
    placeholder.innerHTML = `
      <span class="milkup-image-placeholder-icon">🖼️</span>
      <span class="milkup-image-placeholder-text">图片加载失败</span>
      <span class="milkup-image-placeholder-src">${this.escapeHtml(src)}</span>
    `;
    this.imgElement.appendChild(placeholder);
  }

  /**
   * 显示图片占位
   */
  private showImagePlaceholder(text: string): void {
    this.imgElement.innerHTML = "";
    const placeholder = document.createElement("div");
    placeholder.className = "milkup-image-placeholder";
    placeholder.innerHTML = `
      <span class="milkup-image-placeholder-icon">🖼️</span>
      <span class="milkup-image-placeholder-text">${this.escapeHtml(text)}</span>
    `;
    this.imgElement.appendChild(placeholder);
  }

  /**
   * 转义 HTML
   */
  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private updateSourceInput(): void {
    const { src, alt, title, linkHref, linkTitle } = this.node.attrs;
    let imgMarkdown = `![${alt}](${src}`;
    if (title) {
      imgMarkdown += ` "${title}"`;
    }
    imgMarkdown += ")";
    if (linkHref) {
      let markdown = `[${imgMarkdown}](${linkHref}`;
      if (linkTitle) {
        markdown += ` "${linkTitle}"`;
      }
      markdown += ")";
      this.sourceInput.value = markdown;
    } else {
      this.sourceInput.value = imgMarkdown;
    }
  }

  /**
   * 实时预览源码变化（不更新 ProseMirror 状态）
   */
  private previewSourceChange(): void {
    const newMarkdown = this.sourceInput.value.trim();
    const parsed = parseImageMarkdown(newMarkdown);

    if (parsed) {
      // 实时更新图片预览
      this.renderImage(parsed.src, parsed.alt, parsed.title, parsed.linkHref);
    } else {
      // 语法不完整时显示占位
      this.showImagePlaceholder("请输入完整的图片语法");
    }
  }

  /**
   * 应用源码变更（更新 ProseMirror 状态）
   */
  private applySourceChange(): void {
    const newMarkdown = this.sourceInput.value.trim();
    const parsed = parseImageMarkdown(newMarkdown);

    if (!parsed) {
      // 解析失败，恢复原始值
      this.updateSourceInput();
      return;
    }

    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const { src, alt, title, linkHref, linkTitle } = this.node.attrs;

    // 检查是否有变化
    if (
      parsed.src === src &&
      parsed.alt === alt &&
      parsed.title === title &&
      (parsed.linkHref || "") === (linkHref || "") &&
      (parsed.linkTitle || "") === (linkTitle || "")
    ) {
      return;
    }

    // 更新节点属性
    const tr = state.tr.setNodeMarkup(pos, undefined, {
      src: parsed.src,
      alt: parsed.alt,
      title: parsed.title,
      linkHref: parsed.linkHref || "",
      linkTitle: parsed.linkTitle || "",
    });
    this.view.dispatch(tr);
  }

  /**
   * 删除图片节点
   */
  private deleteImageNode(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const tr = state.tr.delete(pos, pos + this.node.nodeSize);

    // 如果删除后文档为空，创建一个空段落
    if (tr.doc.content.size === 0) {
      const paragraph = state.schema.nodes.paragraph.create();
      tr.insert(0, paragraph);
    }

    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * 选中此节点
   */
  private selectThisNode(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const selection = NodeSelection.create(state.doc, pos);

    const tr = state.tr.setSelection(selection);
    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * 根据光标位置更新编辑状态
   */
  updateEditingState(selFrom: number, selTo: number, selection: any, prevCursorPos: number): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;

    const nodeStart = pos;
    const nodeEnd = pos + node.nodeSize;

    // 只有 NodeSelection 选中此节点时才进入编辑模式
    const isSelected = selection instanceof NodeSelection && selection.from === pos;

    if (isSelected && !this.isEditing) {
      // 判断进入方向：从前方还是后方进入
      const enterFromBefore = prevCursorPos <= nodeStart;
      this.setSourcePosition(enterFromBefore ? "before" : "after");
      this.setEditing(true);
    } else if (!isSelected && this.isEditing) {
      this.setEditing(false);
    }
  }

  /**
   * 设置源码位置
   */
  private setSourcePosition(position: "before" | "after"): void {
    if (this.sourcePosition === position) return;
    this.sourcePosition = position;

    // 调整 DOM 顺序
    if (position === "before") {
      this.dom.insertBefore(this.sourceContainer, this.imgElement);
      this.dom.classList.add("source-before");
      this.dom.classList.remove("source-after");
    } else {
      this.dom.appendChild(this.sourceContainer);
      this.dom.classList.remove("source-before");
      this.dom.classList.add("source-after");
    }
  }

  private setEditing(editing: boolean): void {
    this.isEditing = editing;
    if (editing) {
      this.dom.classList.add("editing");
      // 自动聚焦到输入框
      requestAnimationFrame(() => {
        this.sourceInput.focus();
        // 根据进入方向设置光标位置
        if (this.sourcePosition === "before") {
          // 从上方进入，光标在开头
          this.sourceInput.setSelectionRange(0, 0);
        } else {
          // 从下方进入，光标在末尾
          const len = this.sourceInput.value.length;
          this.sourceInput.setSelectionRange(len, len);
        }
        // 确保输入框在可视范围内
        this.sourceInput.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } else {
      this.dom.classList.remove("editing");
    }
  }

  selectNode(): void {
    // 点击选中时，默认源码在下方
    this.setSourcePosition("after");
    this.setEditing(true);
  }

  deselectNode(): void {
    this.setEditing(false);
  }

  stopEvent(event: Event): boolean {
    // 允许输入框接收所有事件
    if (event.target === this.sourceInput) {
      // 阻止拖动事件
      if (event.type === "dragstart" || event.type === "drag") {
        event.preventDefault();
        return true;
      }
      return true;
    }
    // 允许源码文本元素接收所有事件
    if (event.target === this.sourceTextElement) {
      if (event.type === "dragstart" || event.type === "drag") {
        event.preventDefault();
        return true;
      }
      return true;
    }
    // 阻止源码容器的拖动
    if (
      event.target === this.sourceContainer ||
      this.sourceContainer.contains(event.target as Node)
    ) {
      if (event.type === "dragstart" || event.type === "drag") {
        event.preventDefault();
        return true;
      }
    }
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    // 从全局集合中移除
    imageViews.delete(this);
    // 取消订阅源码模式状态
    if (this.sourceViewUnsubscribe) {
      this.sourceViewUnsubscribe();
      this.sourceViewUnsubscribe = null;
    }
  }
}

/**
 * 创建图片 NodeView
 */
export function createImageNodeView(
  node: Node,
  view: EditorView,
  getPos: () => number | undefined
): NodeView {
  return new ImageView(node, view, getPos);
}

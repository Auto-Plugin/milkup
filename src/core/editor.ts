/**
 * Milkup 编辑器主类
 *
 * 整合所有模块，提供统一的编辑器 API
 */

import { EditorState, Plugin, Transaction, Selection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Schema, Node } from "prosemirror-model";
import { history } from "prosemirror-history";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";

// 导入 KaTeX CSS
import "katex/dist/katex.min.css";

import { milkupSchema } from "./schema";
import { parseMarkdown, MarkdownParser } from "./parser";
import { serializeMarkdown, MarkdownSerializer } from "./serializer";
import { createInstantRenderPlugin } from "./plugins/instant-render";
import { createInputRulesPlugin } from "./plugins/input-rules";
import { createSyntaxFixerPlugin } from "./plugins/syntax-fixer";
import { createSyntaxDetectorPlugin } from "./plugins/syntax-detector";
import { createHeadingSyncPlugin } from "./plugins/heading-sync";
import {
  createPastePlugin,
  fileToBase64,
  saveImageLocally,
  ImagePasteMethod,
} from "./plugins/paste";
import { createMathBlockSyncPlugin } from "./plugins/math-block-sync";
import { createImageSyncPlugin } from "./plugins/image-sync";
import { createAICompletionPlugin } from "./plugins/ai-completion";
import { createPlaceholderPlugin } from "./plugins/placeholder";
import { createKeymapPlugin } from "./keymap";
import { createCodeBlockNodeView } from "./nodeviews/code-block";
import { createMathBlockNodeView } from "./nodeviews/math-block";
import { createImageNodeView } from "./nodeviews/image";
import {
  createBulletListNodeView,
  createOrderedListNodeView,
  createListItemNodeView,
} from "./nodeviews/list";
import { toggleSourceView, setSourceView, decorationPluginKey } from "./decorations";
import type { MilkupConfig, MilkupEditor as IMilkupEditor, MilkupPlugin } from "./types";

/** 编辑器默认配置 */
const defaultConfig: MilkupConfig = {
  content: "",
  readonly: false,
  sourceView: false,
};

/**
 * Milkup 编辑器类
 */
export class MilkupEditor implements IMilkupEditor {
  view: EditorView;
  private config: MilkupConfig;
  private schema: Schema;
  private parser: MarkdownParser;
  private serializer: MarkdownSerializer;
  private plugins: MilkupPlugin[] = [];
  private eventHandlers: Map<string, Set<Function>> = new Map();
  private contextMenu: HTMLElement | null = null;

  constructor(container: HTMLElement, config: MilkupConfig = {}) {
    this.config = { ...defaultConfig, ...config };
    this.schema = milkupSchema;
    this.parser = new MarkdownParser(this.schema);
    this.serializer = new MarkdownSerializer();

    // 解析初始内容
    const { doc } = this.parser.parse(this.config.content || "");

    // 创建编辑器状态
    const state = EditorState.create({
      doc,
      plugins: this.createPlugins(),
    });

    // 创建编辑器视图
    this.view = new EditorView(container, {
      state,
      editable: () => !this.config.readonly,
      nodeViews: {
        code_block: createCodeBlockNodeView,
        math_block: createMathBlockNodeView,
        image: createImageNodeView,
        bullet_list: createBulletListNodeView,
        ordered_list: createOrderedListNodeView,
        list_item: createListItemNodeView,
      },
      dispatchTransaction: (tr) => this.dispatchTransaction(tr),
      attributes: {
        class: "milkup-editor",
      },
      handleClick: (view, pos, event) => this.handleEditorClick(view, pos, event),
      handleDOMEvents: {
        contextmenu: (view, event) => this.handleContextMenu(view, event),
      },
    });

    // 初始化自定义插件
    this.initPlugins();

    // 设置初始源码视图状态
    if (this.config.sourceView) {
      setSourceView(this.view.state, true, this.view.dispatch.bind(this.view));
    }
  }

  /**
   * 创建 ProseMirror 插件
   */
  private createPlugins(): Plugin[] {
    const plugins: Plugin[] = [
      // 历史记录
      history(),
      // 拖拽光标
      dropCursor(),
      // 间隙光标
      gapCursor(),
      // 自定义快捷键（放在 baseKeymap 之前，优先级更高）
      ...createKeymapPlugin(this.schema),
      // 基础快捷键
      keymap(baseKeymap),
      // 即时渲染插件
      ...createInstantRenderPlugin(),
      // 输入规则
      createInputRulesPlugin(this.schema),
      // 语法修复插件
      createSyntaxFixerPlugin(),
      // 语法检测插件
      createSyntaxDetectorPlugin(),
      // 标题同步插件
      createHeadingSyncPlugin(),
      // 粘贴处理插件
      createPastePlugin(this.config.pasteConfig),
      // 数学块状态同步插件
      createMathBlockSyncPlugin(),
      // 图片状态同步插件
      createImageSyncPlugin(),
    ];

    // AI 续写插件（如果配置了）
    if (this.config.aiConfig) {
      const aiConfig = this.config.aiConfig;
      plugins.push(createAICompletionPlugin(() => aiConfig));
    }

    // Placeholder 插件（如果配置了）
    if (this.config.placeholder) {
      plugins.push(createPlaceholderPlugin(this.config.placeholder));
    }

    return plugins;
  }

  /**
   * 初始化自定义插件
   */
  private initPlugins(): void {
    if (this.config.plugins) {
      for (const plugin of this.config.plugins) {
        this.plugins.push(plugin);
        plugin.init?.(this);
      }
    }
  }

  /**
   * 处理事务分发
   */
  private dispatchTransaction(tr: Transaction): void {
    const newState = this.view.state.apply(tr);
    this.view.updateState(newState);

    // 触发变更事件
    if (tr.docChanged) {
      this.emit("change", {
        markdown: this.getMarkdown(),
        transaction: tr,
      });
    }

    // 触发选区变更事件
    if (tr.selectionSet) {
      this.emit("selectionChange", {
        from: newState.selection.from,
        to: newState.selection.to,
        sourceFrom: newState.selection.from,
        sourceTo: newState.selection.to,
      });
    }
  }

  /**
   * 获取 Markdown 内容
   */
  getMarkdown(): string {
    return serializeMarkdown(this.view.state.doc);
  }

  /**
   * 设置 Markdown 内容
   */
  setMarkdown(content: string): void {
    const { doc } = this.parser.parse(content);
    const tr = this.view.state.tr.replaceWith(0, this.view.state.doc.content.size, doc.content);
    this.view.dispatch(tr);
  }

  /**
   * 获取当前配置
   */
  getConfig(): MilkupConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<MilkupConfig>): void {
    this.config = { ...this.config, ...config };

    // 处理只读状态变更
    if (config.readonly !== undefined) {
      this.view.setProps({ editable: () => !config.readonly });
    }

    // 处理源码视图变更
    if (config.sourceView !== undefined) {
      setSourceView(this.view.state, config.sourceView, this.view.dispatch.bind(this.view));
    }
  }

  /**
   * 销毁编辑器
   */
  destroy(): void {
    // 销毁自定义插件
    for (const plugin of this.plugins) {
      plugin.destroy?.();
    }
    this.plugins = [];

    // 清理事件处理器
    this.eventHandlers.clear();

    // 清理右键菜单
    this.hideContextMenu();

    // 销毁视图
    this.view.destroy();
  }

  /**
   * 聚焦编辑器
   */
  focus(): void {
    this.view.focus();
  }

  /**
   * 处理编辑器点击事件
   * 用于处理点击空白区域时的聚焦
   */
  private handleEditorClick(view: EditorView, pos: number, event: MouseEvent): boolean {
    const { state } = view;
    const { doc } = state;
    const editorRect = view.dom.getBoundingClientRect();
    const clickY = event.clientY;

    // 获取第一个和最后一个块节点的位置
    const firstChild = doc.firstChild;
    const lastChild = doc.lastChild;

    if (!firstChild || !lastChild) return false;

    // 检查是否点击在第一个节点上方
    const firstNodePos = 0;
    const firstNodeCoords = view.coordsAtPos(firstNodePos + 1);
    if (clickY < firstNodeCoords.top) {
      // 点击在第一个节点上方
      // 如果第一个节点不是段落，在前面插入一个段落
      if (firstChild.type.name !== "paragraph") {
        const paragraph = state.schema.nodes.paragraph.create();
        const tr = state.tr.insert(0, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, 1));
        view.dispatch(tr);
        view.focus();
        return true;
      }
    }

    // 检查是否点击在最后一个节点下方
    const lastNodePos = doc.content.size - lastChild.nodeSize;
    const lastNodeEndPos = doc.content.size;
    const lastNodeCoords = view.coordsAtPos(lastNodeEndPos);
    if (clickY > lastNodeCoords.bottom) {
      // 点击在最后一个节点下方
      // 如果最后一个节点不是段落，在后面插入一个段落
      if (lastChild.type.name !== "paragraph") {
        const paragraph = state.schema.nodes.paragraph.create();
        const tr = state.tr.insert(doc.content.size, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, doc.content.size + 1));
        view.dispatch(tr);
        view.focus();
        return true;
      }
    }

    return false;
  }

  /**
   * 处理右键菜单
   */
  private handleContextMenu(view: EditorView, event: MouseEvent): boolean {
    // 检查是否在代码块内（代码块有自己的右键菜单）
    const target = event.target as HTMLElement;
    if (target.closest(".milkup-code-block-editor")) {
      return false; // 让代码块处理
    }

    event.preventDefault();
    this.showContextMenu(event);
    return true;
  }

  /**
   * 显示右键菜单
   */
  private async showContextMenu(e: MouseEvent): Promise<void> {
    // 移除已存在的右键菜单
    this.hideContextMenu();

    const menu = document.createElement("div");
    menu.className = "milkup-context-menu";

    // 检查是否有选区
    const { selection } = this.view.state;
    const hasSelection = !selection.empty;

    // 检查剪贴板是否有内容（文本或图片）
    let hasClipboardContent = true; // 默认启用粘贴
    try {
      const items = await navigator.clipboard.read();
      hasClipboardContent = items.length > 0;
    } catch {
      // 如果 read() 不支持，尝试 readText()
      try {
        const text = await navigator.clipboard.readText();
        hasClipboardContent = text.length > 0;
      } catch {
        hasClipboardContent = true; // 默认启用粘贴
      }
    }

    // 复制
    const copyItem = this.createContextMenuItem("复制", !hasSelection, () => {
      const selectedText = this.view.state.doc.textBetween(selection.from, selection.to, "\n");
      navigator.clipboard.writeText(selectedText);
      this.hideContextMenu();
    });
    menu.appendChild(copyItem);

    // 剪切
    const cutItem = this.createContextMenuItem("剪切", !hasSelection, () => {
      const selectedText = this.view.state.doc.textBetween(selection.from, selection.to, "\n");
      navigator.clipboard.writeText(selectedText);
      const tr = this.view.state.tr.deleteSelection();
      this.view.dispatch(tr);
      this.hideContextMenu();
    });
    menu.appendChild(cutItem);

    // 粘贴 - 使用 Clipboard API 读取内容并手动处理
    const pasteItem = this.createContextMenuItem("粘贴", !hasClipboardContent, async () => {
      this.hideContextMenu();
      this.view.focus();
      await this.handlePasteFromClipboard();
    });
    menu.appendChild(pasteItem);

    // 定位菜单
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    document.body.appendChild(menu);
    this.contextMenu = menu;

    // 调整位置，确保菜单在视口内
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (menuRect.right > viewportWidth) {
      menu.style.left = `${viewportWidth - menuRect.width - 8}px`;
    }
    if (menuRect.bottom > viewportHeight) {
      menu.style.top = `${viewportHeight - menuRect.height - 8}px`;
    }

    // 点击外部关闭
    const closeHandler = (event: MouseEvent) => {
      if (!menu.contains(event.target as Node)) {
        this.hideContextMenu();
        document.removeEventListener("click", closeHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener("click", closeHandler);
    }, 0);
  }

  /**
   * 创建右键菜单项
   */
  private createContextMenuItem(
    label: string,
    disabled: boolean,
    onClick: () => void
  ): HTMLElement {
    const item = document.createElement("div");
    item.className = "milkup-context-menu-item";
    if (disabled) {
      item.classList.add("disabled");
    }
    item.textContent = label;

    if (!disabled) {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
    }

    return item;
  }

  /**
   * 隐藏右键菜单
   */
  private hideContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
    // 移除其他可能存在的右键菜单
    document.querySelectorAll(".milkup-context-menu").forEach((el) => el.remove());
  }

  /**
   * 从剪贴板粘贴内容
   */
  private async handlePasteFromClipboard(): Promise<void> {
    try {
      // 尝试读取剪贴板内容
      const items = await navigator.clipboard.read();

      for (const item of items) {
        // 检查是否有图片
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], "pasted-image.png", { type: imageType });
          await this.insertImageFromFile(file);
          return;
        }

        // 检查是否有文本
        if (item.types.includes("text/plain")) {
          const blob = await item.getType("text/plain");
          const text = await blob.text();
          if (text) {
            const tr = this.view.state.tr.insertText(text);
            this.view.dispatch(tr);
          }
          return;
        }
      }
    } catch {
      // 如果 read() 失败，尝试 readText()
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const tr = this.view.state.tr.insertText(text);
          this.view.dispatch(tr);
        }
      } catch {
        console.warn("无法访问剪贴板");
      }
    }
  }

  /**
   * 从文件插入图片
   */
  private async insertImageFromFile(file: File): Promise<void> {
    // 获取图片粘贴方式
    const method: ImagePasteMethod =
      this.config.pasteConfig?.getImagePasteMethod?.() ||
      (localStorage.getItem("pasteMethod") as ImagePasteMethod) ||
      "base64";

    let src: string;

    try {
      switch (method) {
        case "base64":
          src = await fileToBase64(file);
          break;

        case "remote":
          if (this.config.pasteConfig?.imageUploader) {
            src = await this.config.pasteConfig.imageUploader(file);
          } else {
            console.warn("Image uploader not configured, falling back to base64");
            src = await fileToBase64(file);
          }
          break;

        case "local":
          if (this.config.pasteConfig?.localImageSaver) {
            src = await this.config.pasteConfig.localImageSaver(file);
          } else {
            // 尝试使用 Electron API
            src = await saveImageLocally(file);
          }
          break;

        default:
          src = await fileToBase64(file);
      }
    } catch (error) {
      console.error("Failed to process image:", error);
      // 出错时回退到 base64
      src = await fileToBase64(file);
    }

    // 创建图片节点
    const imageNode = this.schema.nodes.image?.createAndFill({
      src,
      alt: file.name,
      title: "",
    });

    if (imageNode) {
      const { $from } = this.view.state.selection;
      const tr = this.view.state.tr.insert($from.pos, imageNode);
      this.view.dispatch(tr);
    }
  }

  /**
   * 获取光标位置
   */
  getCursorOffset(): number {
    return this.view.state.selection.head;
  }

  /**
   * 设置光标位置
   */
  setCursorOffset(offset: number): void {
    const { doc } = this.view.state;
    const pos = Math.min(Math.max(0, offset), doc.content.size);
    const $pos = doc.resolve(pos);
    const selection = Selection.near($pos);
    const tr = this.view.state.tr.setSelection(selection);
    this.view.dispatch(tr);
  }

  /**
   * 切换源码视图
   */
  toggleSourceView(): void {
    toggleSourceView(this.view.state, this.view.dispatch.bind(this.view));
    this.config.sourceView = !this.config.sourceView;
  }

  /**
   * 获取源码视图状态
   */
  isSourceViewEnabled(): boolean {
    const state = decorationPluginKey.getState(this.view.state);
    return state?.sourceView ?? false;
  }

  /**
   * 注册事件处理器
   */
  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * 移除事件处理器
   */
  off(event: string, handler: Function): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * 触发事件
   */
  private emit(event: string, data: any): void {
    this.eventHandlers.get(event)?.forEach((handler) => handler(data));
  }

  /**
   * 执行命令
   */
  command(name: string, ...args: any[]): boolean {
    // 可以在这里添加自定义命令
    return false;
  }

  /**
   * 获取 ProseMirror 状态
   */
  getState(): EditorState {
    return this.view.state;
  }

  /**
   * 获取文档
   */
  getDoc(): Node {
    return this.view.state.doc;
  }

  /**
   * 获取 Schema
   */
  getSchema(): Schema {
    return this.schema;
  }
}

/**
 * 创建 Milkup 编辑器
 */
export function createMilkupEditor(container: HTMLElement, config?: MilkupConfig): MilkupEditor {
  return new MilkupEditor(container, config);
}

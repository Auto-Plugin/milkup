/**
 * Milkup 编辑器主类
 *
 * 整合所有模块，提供统一的编辑器 API
 */

import { EditorState, Plugin, Transaction, Selection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Schema, Node, Slice, Fragment } from "prosemirror-model";
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
import { createLineNumbersPlugin } from "./plugins/line-numbers";
import { createSourceViewTransformPlugin } from "./plugins/source-view-transform";
import {
  createSearchPlugin,
  searchPluginKey,
  updateSearch,
  findNext,
  findPrev,
  replaceMatch,
  replaceAll,
  clearSearch,
} from "./plugins/search";
import type { SearchOptions } from "./plugins/search";
import { createKeymapPlugin, createDynamicKeymapPlugin } from "./keymap";
import type { ShortcutKeyMap } from "./keymap";
import { createCodeBlockNodeView } from "./nodeviews/code-block";
import { createMathBlockNodeView } from "./nodeviews/math-block";
import { createImageNodeView } from "./nodeviews/image";
import {
  createBulletListNodeView,
  createOrderedListNodeView,
  createListItemNodeView,
  createTaskListNodeView,
  createTaskItemNodeView,
} from "./nodeviews/list";
import { toggleSourceView, setSourceView, decorationPluginKey } from "./decorations";
import type { MilkupConfig, MilkupEditor as IMilkupEditor, MilkupPlugin } from "./types";
import {
  insertTable,
  addRowBefore,
  addRowAfter,
  addRowAtEnd,
  addColumnBefore,
  addColumnAfter,
  addColumnAtEnd,
  deleteRow,
  deleteColumn,
} from "./commands";
import { DEFAULT_SHORTCUTS, buildActionCommandMap } from "./keymap";
import type { ShortcutActionId } from "./keymap";

/**
 * 将 ProseMirror 快捷键格式转为显示文本
 */
function formatShortcutDisplay(key: string): string {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const parts = key.split("-");
  const mapped = parts.map((p) => {
    switch (p) {
      case "Mod":
        return isMac ? "⌘" : "Ctrl";
      case "Shift":
        return isMac ? "⇧" : "Shift";
      case "Alt":
        return isMac ? "⌥" : "Alt";
      case "minus":
        return "-";
      default:
        return p.length === 1 ? p.toUpperCase() : p;
    }
  });
  return isMac ? mapped.join("") : mapped.join("+");
}

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
  private searchPanel: HTMLElement | null = null;
  private searchWrapper: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private replaceRow: HTMLElement | null = null;
  private matchCountSpan: HTMLElement | null = null;
  private searchCaseSensitive = false;
  private searchWholeWord = false;
  private searchUseRegex = false;
  private searchInSelection = false;
  private searchSelectionRange: { from: number; to: number } | null = null;

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
      clipboardTextSerializer: (slice) => this.serializeSliceToMarkdown(slice),
      clipboardTextParser: (text, $context, plain, view) => {
        // 将粘贴的纯文本作为 Markdown 解析
        const { doc } = this.parser.parse(text);
        return new Slice(doc.content, 1, 1);
      },
      nodeViews: {
        code_block: createCodeBlockNodeView,
        math_block: createMathBlockNodeView,
        image: createImageNodeView,
        bullet_list: createBulletListNodeView,
        ordered_list: createOrderedListNodeView,
        list_item: createListItemNodeView,
        task_list: createTaskListNodeView,
        task_item: createTaskItemNodeView,
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

    // 创建搜索面板（挂载到 container，不在 contenteditable 内）
    this.createSearchPanel(container);

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
      // 搜索替换快捷键（最高优先级）
      keymap({
        "Mod-f": () => {
          this.openSearch(false);
          return true;
        },
        "Mod-h": () => {
          this.openSearch(true);
          return true;
        },
      }),
      // 动态快捷键插件（可自定义的快捷键，优先级最高）
      createDynamicKeymapPlugin(this.schema, () => this.getCustomKeyMap()),
      // 不可自定义的快捷键（块级 Enter、列表操作等）
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
      // 源码模式文档转换插件
      createSourceViewTransformPlugin(),
      // 行号插件
      createLineNumbersPlugin(),
      // 搜索插件
      createSearchPlugin(),
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

    // 清理搜索面板
    this.searchWrapper?.remove();
    this.searchWrapper = null;
    this.searchPanel = null;

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
      // 点击在第一个节点上方，聚焦到第一个字符
      const tr = state.tr.setSelection(TextSelection.create(state.doc, 1));
      view.dispatch(tr);
      view.focus();
      return true;
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
    if (
      target.closest(".milkup-code-block-editor") ||
      target.closest(".milkup-code-block-header")
    ) {
      return false; // 让代码块处理
    }

    event.preventDefault();
    this.showContextMenu(event);
    return true;
  }

  /**
   * 检测坐标位置是否在表格内
   */
  private isInsideTable(e: MouseEvent): boolean {
    const coords = { left: e.clientX, top: e.clientY };
    const pos = this.view.posAtCoords(coords);
    if (!pos) return false;
    const $pos = this.view.state.doc.resolve(pos.pos);
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).type.name === "table") return true;
    }
    return false;
  }

  /**
   * 创建右键菜单分隔线
   */
  private createContextMenuSeparator(): HTMLElement {
    const sep = document.createElement("div");
    sep.className = "milkup-context-menu-separator";
    return sep;
  }

  /**
   * 创建带子菜单的菜单项
   */
  private createContextMenuItemWithSubmenu(
    label: string,
    submenuBuilder: (container: HTMLElement) => void
  ): HTMLElement {
    const item = document.createElement("div");
    item.className = "milkup-context-menu-item has-submenu";
    item.textContent = label;

    const submenu = document.createElement("div");
    submenu.className = "milkup-context-menu-submenu";
    submenuBuilder(submenu);
    item.appendChild(submenu);

    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const showSubmenu = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      submenu.classList.add("visible");
      // 动态定位：先显示以获取尺寸，再调整
      requestAnimationFrame(() => {
        const itemRect = item.getBoundingClientRect();
        const subRect = submenu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // 水平：优先右侧，溢出则左侧
        let left = itemRect.right;
        if (left + subRect.width > vw - 8) {
          left = itemRect.left - subRect.width;
        }
        if (left < 8) left = 8;

        // 垂直：与菜单项顶部对齐，溢出则上移
        let top = itemRect.top - 4;
        if (top + subRect.height > vh - 8) {
          top = vh - subRect.height - 8;
        }
        if (top < 8) top = 8;

        submenu.style.left = `${left}px`;
        submenu.style.top = `${top}px`;
      });
    };

    const hideSubmenu = () => {
      hideTimer = setTimeout(() => {
        submenu.classList.remove("visible");
      }, 150);
    };

    item.addEventListener("mouseenter", showSubmenu);
    item.addEventListener("mouseleave", hideSubmenu);
    submenu.addEventListener("mouseenter", () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    });
    submenu.addEventListener("mouseleave", hideSubmenu);

    return item;
  }

  /**
   * 创建表格网格选择器
   */
  private buildTableGridPicker(container: HTMLElement): void {
    const picker = document.createElement("div");
    picker.className = "milkup-table-grid-picker";

    const gridContainer = document.createElement("div");
    gridContainer.className = "grid-container";

    const label = document.createElement("div");
    label.className = "grid-label";
    label.textContent = "";

    const maxRows = 8;
    const maxCols = 8;
    const cells: HTMLElement[][] = [];

    for (let r = 0; r < maxRows; r++) {
      cells[r] = [];
      for (let c = 0; c < maxCols; c++) {
        const cell = document.createElement("div");
        cell.className = "grid-cell";
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        gridContainer.appendChild(cell);
        cells[r][c] = cell;
      }
    }

    const updateHighlight = (hoverRow: number, hoverCol: number) => {
      for (let r = 0; r < maxRows; r++) {
        for (let c = 0; c < maxCols; c++) {
          cells[r][c].classList.toggle("active", r <= hoverRow && c <= hoverCol);
        }
      }
      label.textContent = `${hoverRow + 1} × ${hoverCol + 1} 表格`;
    };

    gridContainer.addEventListener("mouseover", (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("grid-cell")) {
        const r = parseInt(target.dataset.row!, 10);
        const c = parseInt(target.dataset.col!, 10);
        updateHighlight(r, c);
      }
    });

    gridContainer.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("grid-cell")) {
        const rows = parseInt(target.dataset.row!, 10) + 1;
        const cols = parseInt(target.dataset.col!, 10) + 1;
        this.view.focus();
        insertTable(rows, cols)(this.view.state, this.view.dispatch.bind(this.view));
        this.hideContextMenu();
      }
    });

    picker.appendChild(gridContainer);
    picker.appendChild(label);
    container.appendChild(picker);
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
      const slice = this.view.state.selection.content();
      const text = this.serializeSliceToMarkdown(slice);
      navigator.clipboard.writeText(text);
      this.hideContextMenu();
    });
    menu.appendChild(copyItem);

    // 剪切
    const cutItem = this.createContextMenuItem("剪切", !hasSelection, () => {
      const slice = this.view.state.selection.content();
      const text = this.serializeSliceToMarkdown(slice);
      navigator.clipboard.writeText(text);
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

    // 检测是否在表格内
    const inTable = this.isInsideTable(e);

    if (inTable) {
      // 表格内右键 — 追加表格操作项
      menu.appendChild(this.createContextMenuSeparator());

      menu.appendChild(
        this.createContextMenuItem("向上插入行", false, () => {
          this.view.focus();
          addRowBefore(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );
      menu.appendChild(
        this.createContextMenuItem("向下插入行", false, () => {
          this.view.focus();
          addRowAfter(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );
      menu.appendChild(
        this.createContextMenuItem("在末尾添加行", false, () => {
          this.view.focus();
          addRowAtEnd(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );

      menu.appendChild(this.createContextMenuSeparator());

      menu.appendChild(
        this.createContextMenuItem("向左插入列", false, () => {
          this.view.focus();
          addColumnBefore(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );
      menu.appendChild(
        this.createContextMenuItem("向右插入列", false, () => {
          this.view.focus();
          addColumnAfter(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );
      menu.appendChild(
        this.createContextMenuItem("在末尾添加列", false, () => {
          this.view.focus();
          addColumnAtEnd(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );

      menu.appendChild(this.createContextMenuSeparator());

      menu.appendChild(
        this.createContextMenuItem("删除当前行", false, () => {
          this.view.focus();
          deleteRow(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );
      menu.appendChild(
        this.createContextMenuItem("删除当前列", false, () => {
          this.view.focus();
          deleteColumn(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );
    } else {
      // 非表格区域 — 追加"插入"子菜单和"插入表格"
      menu.appendChild(this.createContextMenuSeparator());
      menu.appendChild(
        this.createContextMenuItemWithSubmenu("插入", (submenu) => {
          this.buildInsertSubmenu(submenu);
        })
      );
      menu.appendChild(
        this.createContextMenuItemWithSubmenu("插入表格", (submenu) => {
          this.buildTableGridPicker(submenu);
        })
      );
    }

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
   * 获取某个动作当前绑定的快捷键（已格式化为显示文本）
   */
  private getShortcutDisplay(actionId: ShortcutActionId): string {
    const customMap = this.getCustomKeyMap();
    const def = DEFAULT_SHORTCUTS.find((s) => s.id === actionId);
    if (!def) return "";
    const key = customMap[actionId] || def.defaultKey;
    return formatShortcutDisplay(key);
  }

  /**
   * 创建带快捷键提示的菜单项
   */
  private createContextMenuItemWithShortcut(
    label: string,
    shortcutActionId: ShortcutActionId | null,
    disabled: boolean,
    onClick: () => void
  ): HTMLElement {
    const item = document.createElement("div");
    item.className = "milkup-context-menu-item";
    if (disabled) item.classList.add("disabled");

    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    item.appendChild(labelSpan);

    if (shortcutActionId) {
      const shortcut = this.getShortcutDisplay(shortcutActionId);
      if (shortcut) {
        const shortcutSpan = document.createElement("span");
        shortcutSpan.className = "milkup-context-menu-shortcut";
        shortcutSpan.textContent = shortcut;
        item.appendChild(shortcutSpan);
      }
    }

    if (!disabled) {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
    }

    return item;
  }

  /**
   * 构建"插入"子菜单内容
   * 使用与快捷键相同的增强命令（buildActionCommandMap）
   */
  private buildInsertSubmenu(container: HTMLElement): void {
    const commandMap = buildActionCommandMap(this.schema);
    const dispatch = this.view.dispatch.bind(this.view);
    const execAndClose = (actionId: ShortcutActionId) => {
      this.view.focus();
      const cmd = commandMap[actionId];
      if (cmd) cmd(this.view.state, dispatch);
      this.hideContextMenu();
    };

    type MenuItem = { label: string; id: ShortcutActionId };

    const inlineItems: MenuItem[] = [
      { label: "粗体", id: "toggleStrong" },
      { label: "斜体", id: "toggleEmphasis" },
      { label: "行内代码", id: "toggleCodeInline" },
      { label: "删除线", id: "toggleStrikethrough" },
      { label: "高亮", id: "toggleHighlight" },
    ];

    for (const item of inlineItems) {
      container.appendChild(
        this.createContextMenuItemWithShortcut(item.label, item.id, false, () =>
          execAndClose(item.id)
        )
      );
    }

    container.appendChild(this.createContextMenuSeparator());

    const blockItems: MenuItem[] = [
      { label: "一级标题", id: "setHeading1" },
      { label: "二级标题", id: "setHeading2" },
      { label: "三级标题", id: "setHeading3" },
      { label: "段落", id: "setParagraph" },
      { label: "代码块", id: "setCodeBlock" },
      { label: "引用", id: "wrapInBlockquote" },
      { label: "无序列表", id: "wrapInBulletList" },
      { label: "有序列表", id: "wrapInOrderedList" },
    ];

    for (const item of blockItems) {
      container.appendChild(
        this.createContextMenuItemWithShortcut(item.label, item.id, false, () =>
          execAndClose(item.id)
        )
      );
    }

    container.appendChild(this.createContextMenuSeparator());

    const insertItems: MenuItem[] = [
      { label: "分割线", id: "insertHorizontalRule" },
      { label: "数学公式", id: "insertMathBlock" },
    ];

    for (const item of insertItems) {
      container.appendChild(
        this.createContextMenuItemWithShortcut(item.label, item.id, false, () =>
          execAndClose(item.id)
        )
      );
    }
  }

  /** 创建搜索面板 DOM */
  private createSearchPanel(container: HTMLElement): void {
    // SVG 图标工厂
    const svgIcon = (path: string, vb = "0 0 16 16") => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", vb);
      svg.innerHTML = path;
      return svg;
    };

    // 创建按钮的辅助函数（阻止 mousedown 防止编辑器失焦）
    const makeBtn = (cls: string, title: string, icon: SVGSVGElement, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = cls;
      btn.title = title;
      btn.appendChild(icon);
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", onClick);
      return btn;
    };

    // 外层 wrapper（sticky 定位）
    const wrapper = document.createElement("div");
    wrapper.className = "milkup-search-wrapper";

    const panel = document.createElement("div");
    panel.className = "milkup-search-panel";

    // ---- 搜索行 ----
    const searchRow = document.createElement("div");
    searchRow.className = "milkup-search-row";

    // 展开/收起替换 ▶/▼
    const toggleIcon = svgIcon('<path d="M6 4l4 4-4 4z"/>');
    const toggleBtn = makeBtn("toggle-replace", "切换替换", toggleIcon, () =>
      this.toggleReplaceRow()
    );

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "search-input";
    searchInput.placeholder = "搜索";
    searchInput.addEventListener("input", () => this.onSearchInput());
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        findPrev(this.view);
        this.updateMatchCount();
      } else if (e.key === "Enter") {
        e.preventDefault();
        findNext(this.view);
        this.updateMatchCount();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closeSearch();
      }
    });

    // Aa 区分大小写
    const caseIcon = svgIcon(
      '<text x="2" y="12" font-size="11" font-weight="600" font-family="sans-serif" fill="currentColor">Aa</text>'
    );
    const caseBtn = makeBtn("case-sensitive", "区分大小写", caseIcon, () => {
      this.searchCaseSensitive = !this.searchCaseSensitive;
      caseBtn.classList.toggle("active", this.searchCaseSensitive);
      this.onSearchInput();
    });

    // Ab| 全字匹配
    const wordIcon = svgIcon(
      '<text x="1" y="12" font-size="10" font-weight="600" font-family="sans-serif" fill="currentColor">Ab</text><rect x="12" y="2" width="1.5" height="12" rx="0.5" fill="currentColor"/>'
    );
    const wordBtn = makeBtn("whole-word", "全字匹配", wordIcon, () => {
      this.searchWholeWord = !this.searchWholeWord;
      wordBtn.classList.toggle("active", this.searchWholeWord);
      this.onSearchInput();
    });

    // .* 正则
    const regexIcon = svgIcon(
      '<text x="1" y="12" font-size="12" font-weight="600" font-family="monospace" fill="currentColor">.*</text>'
    );
    const regexBtn = makeBtn("use-regex", "正则表达式", regexIcon, () => {
      this.searchUseRegex = !this.searchUseRegex;
      regexBtn.classList.toggle("active", this.searchUseRegex);
      this.onSearchInput();
    });

    const matchCount = document.createElement("span");
    matchCount.className = "match-count";

    // ↑ 上一个
    const prevIcon = svgIcon('<path d="M8 4L3 9h10z"/>');
    const prevBtn = makeBtn("prev-match", "上一个匹配 (Shift+Enter)", prevIcon, () => {
      findPrev(this.view);
      this.updateMatchCount();
    });

    // ↓ 下一个
    const nextIcon = svgIcon('<path d="M8 12L3 7h10z"/>');
    const nextBtn = makeBtn("next-match", "下一个匹配 (Enter)", nextIcon, () => {
      findNext(this.view);
      this.updateMatchCount();
    });

    // 选区内搜索
    const selIcon = svgIcon('<path d="M2 3h12v2H2zM4 7h8v2H4zM2 11h12v2H2z"/>');
    const selBtn = makeBtn("search-in-selection", "在选区内搜索", selIcon, () => {
      this.searchInSelection = !this.searchInSelection;
      selBtn.classList.toggle("active", this.searchInSelection);
      if (this.searchInSelection) {
        const { from, to } = this.view.state.selection;
        this.searchSelectionRange = from !== to ? { from, to } : null;
      } else {
        this.searchSelectionRange = null;
      }
      this.onSearchInput();
    });

    // × 关闭
    const closeIcon = svgIcon(
      '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" fill="none"/>'
    );
    const closeBtn = makeBtn("close-search", "关闭 (Escape)", closeIcon, () => this.closeSearch());

    searchRow.append(
      toggleBtn,
      searchInput,
      caseBtn,
      wordBtn,
      regexBtn,
      matchCount,
      prevBtn,
      nextBtn,
      selBtn,
      closeBtn
    );

    // ---- 替换行 ----
    const replaceRow = document.createElement("div");
    replaceRow.className = "milkup-replace-row hidden";

    const replaceInput = document.createElement("input");
    replaceInput.type = "text";
    replaceInput.className = "replace-input";
    replaceInput.placeholder = "替换";
    replaceInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        replaceMatch(this.view, replaceInput.value);
        this.onSearchInput();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closeSearch();
      }
    });

    const replaceOneBtn = document.createElement("button");
    replaceOneBtn.type = "button";
    replaceOneBtn.className = "replace-btn";
    replaceOneBtn.textContent = "替换";
    replaceOneBtn.addEventListener("mousedown", (e) => e.preventDefault());
    replaceOneBtn.addEventListener("click", () => {
      replaceMatch(this.view, replaceInput.value);
      this.onSearchInput();
    });

    const replaceAllBtn = document.createElement("button");
    replaceAllBtn.type = "button";
    replaceAllBtn.className = "replace-btn";
    replaceAllBtn.textContent = "全部替换";
    replaceAllBtn.addEventListener("mousedown", (e) => e.preventDefault());
    replaceAllBtn.addEventListener("click", () => {
      replaceAll(this.view, replaceInput.value);
      this.onSearchInput();
    });

    replaceRow.append(replaceInput, replaceOneBtn, replaceAllBtn);

    panel.append(searchRow, replaceRow);
    wrapper.appendChild(panel);

    // 挂载到最近的滚动容器（overflow-y: auto/scroll 的祖先）
    // 这样 sticky 定位才能正确工作
    const scrollParent = this.findScrollParent(container) || container;
    scrollParent.insertBefore(wrapper, scrollParent.firstChild);

    this.searchWrapper = wrapper;
    this.searchPanel = panel;
    this.searchInput = searchInput;
    this.replaceRow = replaceRow;
    this.matchCountSpan = matchCount;
  }

  /** 打开搜索面板 */
  openSearch(showReplace: boolean): void {
    if (!this.searchWrapper || !this.searchInput) return;

    this.searchWrapper.classList.add("visible");

    if (showReplace) {
      this.replaceRow?.classList.remove("hidden");
      const toggleBtn = this.searchPanel?.querySelector(".toggle-replace svg");
      if (toggleBtn) toggleBtn.innerHTML = '<path d="M4 6l4 4 4-4z"/>';
    }

    // 如有选中文本，填入搜索框
    const { from, to } = this.view.state.selection;
    if (from !== to) {
      const selectedText = this.view.state.doc.textBetween(from, to, "\n");
      if (selectedText && !selectedText.includes("\n")) {
        this.searchInput.value = selectedText;
      }
    }

    this.searchInput.focus();
    this.searchInput.select();
    this.onSearchInput();
  }

  /** 关闭搜索面板 */
  closeSearch(): void {
    if (!this.searchWrapper) return;
    this.searchWrapper.classList.remove("visible");
    clearSearch(this.view);
    this.view.focus();
  }

  /** 切换替换行 */
  private toggleReplaceRow(): void {
    if (!this.replaceRow || !this.searchPanel) return;
    const hidden = this.replaceRow.classList.toggle("hidden");
    const toggleSvg = this.searchPanel.querySelector(".toggle-replace svg");
    if (toggleSvg) {
      toggleSvg.innerHTML = hidden ? '<path d="M6 4l4 4-4 4z"/>' : '<path d="M4 6l4 4 4-4z"/>';
    }
  }

  /** 搜索输入变化 */
  private onSearchInput(): void {
    if (!this.searchInput) return;
    const query = this.searchInput.value;
    const options: SearchOptions = {
      caseSensitive: this.searchCaseSensitive,
      wholeWord: this.searchWholeWord,
      useRegex: this.searchUseRegex,
      searchInSelection: this.searchInSelection,
      selectionRange: this.searchSelectionRange,
    };
    updateSearch(this.view, query, options);
    this.updateMatchCount();
  }

  /** 更新匹配计数显示 */
  private updateMatchCount(): void {
    if (!this.matchCountSpan) return;
    const state = searchPluginKey.getState(this.view.state);
    if (!state || state.matches.length === 0) {
      this.matchCountSpan.textContent = this.searchInput?.value ? "无结果" : "";
    } else {
      this.matchCountSpan.textContent = `${state.currentIndex + 1}/${state.matches.length}`;
    }
  }

  /** 查找最近的可滚动祖先元素 */
  private findScrollParent(el: HTMLElement): HTMLElement | null {
    let parent = el.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

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

    // 源码模式下：创建包含 Markdown 文本的段落
    if (this.isSourceViewEnabled()) {
      const alt = file.name;
      const markdownText = `![${alt}](${src})`;
      const paragraph = this.schema.nodes.paragraph.create(
        { imageAttrs: { src, alt, title: "" } },
        this.schema.text(markdownText)
      );
      const { $from } = this.view.state.selection;
      const tr = this.view.state.tr.insert($from.pos, paragraph);
      this.view.dispatch(tr);
      return;
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
   * 将 Slice 序列化为 Markdown 文本
   */
  private serializeSliceToMarkdown(slice: Slice): string {
    const fragment = slice.content;
    if (fragment.childCount === 0) return "";

    // 检查是否全部为行内节点（段落内部分选区）
    let allInline = true;
    fragment.forEach((node) => {
      if (!node.isInline) allInline = false;
    });

    if (allInline) {
      const para = this.schema.nodes.paragraph.create(null, fragment);
      const doc = this.schema.topNodeType.create(null, para);
      return serializeMarkdown(doc).trim();
    }

    const doc = this.schema.topNodeType.create(null, fragment);
    return serializeMarkdown(doc).trimEnd();
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

  /**
   * 获取用户自定义快捷键映射
   * 从 localStorage 读取
   */
  private getCustomKeyMap(): ShortcutKeyMap {
    try {
      const raw = localStorage.getItem("milkup-config");
      if (raw) {
        const config = JSON.parse(raw);
        return config.shortcuts || {};
      }
    } catch {
      // ignore
    }
    return {};
  }
}

/**
 * 创建 Milkup 编辑器
 */
export function createMilkupEditor(container: HTMLElement, config?: MilkupConfig): MilkupEditor {
  return new MilkupEditor(container, config);
}

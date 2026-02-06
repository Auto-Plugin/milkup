/**
 * Milkup 代码块 NodeView
 *
 * 使用 CodeMirror 6 实现代码块编辑
 * 支持语法高亮和 Mermaid 图表预览
 * 支持源码模式显示完整 Markdown 语法
 */

import { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorView as ProseMirrorView, NodeView } from "prosemirror-view";
import { Selection, TextSelection } from "prosemirror-state";
import { EditorView, keymap as cmKeymap, ViewUpdate } from "@codemirror/view";
import { EditorState as CMEditorState, Compartment, Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { sourceViewManager } from "../decorations";

/** Mermaid 显示模式 */
type MermaidDisplayMode = "code" | "mixed" | "diagram";

/** 暗色主题高亮样式 */
const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff7b72" },
  { tag: tags.operator, color: "#79c0ff" },
  { tag: tags.special(tags.variableName), color: "#ffa657" },
  { tag: tags.typeName, color: "#ffa657" },
  { tag: tags.atom, color: "#79c0ff" },
  { tag: tags.number, color: "#79c0ff" },
  { tag: tags.definition(tags.variableName), color: "#d2a8ff" },
  { tag: tags.string, color: "#a5d6ff" },
  { tag: tags.special(tags.string), color: "#a5d6ff" },
  { tag: tags.comment, color: "#8b949e", fontStyle: "italic" },
  { tag: tags.variableName, color: "#c9d1d9" },
  { tag: tags.tagName, color: "#7ee787" },
  { tag: tags.propertyName, color: "#79c0ff" },
  { tag: tags.attributeName, color: "#79c0ff" },
  { tag: tags.className, color: "#ffa657" },
  { tag: tags.labelName, color: "#d2a8ff" },
  { tag: tags.namespace, color: "#ff7b72" },
  { tag: tags.macroName, color: "#d2a8ff" },
  { tag: tags.literal, color: "#79c0ff" },
  { tag: tags.bool, color: "#79c0ff" },
  { tag: tags.null, color: "#79c0ff" },
  { tag: tags.punctuation, color: "#c9d1d9" },
  { tag: tags.bracket, color: "#c9d1d9" },
  { tag: tags.meta, color: "#8b949e" },
  { tag: tags.link, color: "#58a6ff", textDecoration: "underline" },
  { tag: tags.heading, color: "#79c0ff", fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);

/**
 * 检测当前主题是否为暗色模式
 */
function detectDarkTheme(): boolean {
  const htmlElement = document.documentElement;
  const themeClass = Array.from(htmlElement.classList).find((c) => c.startsWith("theme-"));
  if (!themeClass) return false;
  return themeClass.includes("dark");
}

/**
 * 获取当前主题名称
 */
function getCurrentThemeName(): string {
  const htmlElement = document.documentElement;
  const themeClass = Array.from(htmlElement.classList).find((c) => c.startsWith("theme-"));
  return themeClass ? themeClass.replace("theme-", "") : "normal";
}

/**
 * 创建 CodeMirror 主题扩展（使用 CSS 变量）
 */
function createThemeExtension(isDark: boolean): Extension[] {
  const baseTheme = EditorView.theme(
    {
      "&": {
        backgroundColor: "transparent",
        color: "var(--text-color)",
      },
      ".cm-content": {
        caretColor: "var(--text-color)",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--text-color)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--selected-background-color)",
      },
      ".cm-activeLine": {
        backgroundColor: "transparent",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "var(--text-color-3)",
        border: "none",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        color: "var(--text-color-3)",
      },
    },
    { dark: isDark }
  );

  const highlightStyle = isDark ? darkHighlightStyle : defaultHighlightStyle;
  return [baseTheme, syntaxHighlighting(highlightStyle)];
}

/** 语言扩展映射 */
const languageExtensions: Record<string, () => any> = {
  javascript: javascript,
  js: javascript,
  typescript: () => javascript({ typescript: true }),
  ts: () => javascript({ typescript: true }),
  jsx: () => javascript({ jsx: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  python: python,
  py: python,
  html: html,
  css: css,
  json: json,
  markdown: markdown,
  md: markdown,
};

/** 语言别名映射（用于显示） */
const languageAliases: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  md: "markdown",
};

/** 支持的语言列表 */
const supportedLanguages = [
  { value: "", label: "plain text" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "json", label: "JSON" },
  { value: "markdown", label: "Markdown" },
  { value: "mermaid", label: "Mermaid" },
  { value: "sql", label: "SQL" },
  { value: "bash", label: "Bash" },
  { value: "yaml", label: "YAML" },
  { value: "xml", label: "XML" },
];

/** Mermaid 显示模式选项 */
const mermaidDisplayModes = [
  { value: "code", label: "代码" },
  { value: "mixed", label: "混合" },
  { value: "diagram", label: "图表" },
];

/**
 * 规范化语言名称
 */
function normalizeLanguage(language: string): string {
  const lower = language.toLowerCase();
  return languageAliases[lower] || lower;
}

/**
 * 获取语言扩展
 */
function getLanguageExtension(language: string): any {
  const ext = languageExtensions[language.toLowerCase()];
  return ext ? ext() : [];
}

/**
 * 代码块 NodeView 类
 */
export class CodeBlockView implements NodeView {
  dom: HTMLElement;
  cm: EditorView;
  node: ProseMirrorNode;
  view: ProseMirrorView;
  getPos: () => number | undefined;
  updating = false;
  languageCompartment: Compartment;
  themeCompartment: Compartment;
  mermaidPreview: HTMLElement | null = null;
  mermaidDisplayMode: MermaidDisplayMode = "mixed";
  themeObserver: MutationObserver | null = null;
  headerElement: HTMLElement | null = null;
  editorContainer: HTMLElement | null = null;
  contextMenu: HTMLElement | null = null;
  // 源码模式相关
  private sourceViewMode: boolean = false;
  private sourceViewUnsubscribe: (() => void) | null = null;
  private fenceStartElement: HTMLElement | null = null;
  private fenceEndElement: HTMLElement | null = null;

  constructor(node: ProseMirrorNode, view: ProseMirrorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.languageCompartment = new Compartment();
    this.themeCompartment = new Compartment();

    // 检测当前主题
    const isDark = detectDarkTheme();

    // 规范化语言名称
    const normalizedLang = normalizeLanguage(node.attrs.language);
    if (normalizedLang !== node.attrs.language) {
      requestAnimationFrame(() => {
        const pos = this.getPos();
        if (pos !== undefined) {
          this.view.dispatch(
            this.view.state.tr.setNodeMarkup(pos, null, {
              ...this.node.attrs,
              language: normalizedLang,
            })
          );
        }
      });
    }

    // 创建容器
    this.dom = document.createElement("div");
    this.dom.className = "milkup-code-block";

    // 创建头部（语言选择器）
    this.headerElement = this.createHeader(normalizedLang);
    this.dom.appendChild(this.headerElement);

    // 创建 CodeMirror 编辑器容器
    this.editorContainer = document.createElement("div");
    this.editorContainer.className = "milkup-code-block-editor";
    this.dom.appendChild(this.editorContainer);

    this.cm = new EditorView({
      state: CMEditorState.create({
        doc: node.textContent,
        extensions: [
          history(),
          cmKeymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            {
              key: "Ctrl-Enter",
              run: () => {
                this.exitCodeBlock(1);
                return true;
              },
            },
            {
              key: "ArrowDown",
              run: (cmView) => {
                const { state } = cmView;
                const { main } = state.selection;
                const line = state.doc.lineAt(main.head);
                if (line.number === state.doc.lines) {
                  this.exitCodeBlock(1);
                  return true;
                }
                return false;
              },
            },
            {
              key: "ArrowUp",
              run: (cmView) => {
                const { state } = cmView;
                const { main } = state.selection;
                const line = state.doc.lineAt(main.head);
                if (line.number === 1) {
                  this.exitCodeBlock(-1);
                  return true;
                }
                return false;
              },
            },
            {
              key: "ArrowLeft",
              run: (cmView) => {
                const { state } = cmView;
                const { main } = state.selection;
                if (main.head === 0 && main.empty) {
                  this.exitCodeBlock(-1);
                  return true;
                }
                return false;
              },
            },
            {
              key: "ArrowRight",
              run: (cmView) => {
                const { state } = cmView;
                const { main } = state.selection;
                if (main.head === state.doc.length && main.empty) {
                  this.exitCodeBlock(1);
                  return true;
                }
                return false;
              },
            },
            {
              key: "Backspace",
              run: (cmView) => {
                if (cmView.state.doc.length === 0) {
                  this.deleteCodeBlock();
                  return true;
                }
                return false;
              },
            },
          ]),
          this.themeCompartment.of(createThemeExtension(isDark)),
          this.languageCompartment.of(getLanguageExtension(normalizedLang)),
          EditorView.updateListener.of((update) => this.onCMUpdate(update)),
          EditorView.domEventHandlers({
            focus: () => this.forwardSelection(),
            blur: () => {},
            contextmenu: (e) => {
              e.preventDefault();
              this.showContextMenu(e);
              return true;
            },
          }),
        ],
      }),
      parent: this.editorContainer,
    });

    // 监听主题变化
    this.setupThemeObserver();

    // 创建底部点击区域
    const footer = document.createElement("div");
    footer.className = "milkup-code-block-footer";
    footer.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.exitCodeBlock(1);
    });
    this.dom.appendChild(footer);

    // Mermaid 预览
    if (normalizedLang === "mermaid") {
      this.createMermaidPreview(node.textContent);
    }

    // 如果代码块是空的，自动聚焦
    if (!node.textContent) {
      requestAnimationFrame(() => {
        this.cm.focus();
      });
    }

    // 源码模式初始化
    this.initSourceViewMode(normalizedLang);
  }

  /**
   * 初始化源码模式
   */
  private initSourceViewMode(language: string): void {
    // 创建开始围栏元素
    this.fenceStartElement = document.createElement("div");
    this.fenceStartElement.className = "milkup-code-fence milkup-code-fence-start";
    this.fenceStartElement.textContent = "```" + language;

    // 创建结束围栏元素
    this.fenceEndElement = document.createElement("div");
    this.fenceEndElement.className = "milkup-code-fence milkup-code-fence-end";
    this.fenceEndElement.textContent = "```";

    // 订阅源码模式状态变化
    this.sourceViewUnsubscribe = sourceViewManager.subscribe((sourceView) => {
      this.setSourceViewMode(sourceView);
    });
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
      // 隐藏头部
      if (this.headerElement) {
        this.headerElement.style.display = "none";
      }
      // 在编辑器容器前插入开始围栏
      if (this.fenceStartElement && this.editorContainer) {
        this.dom.insertBefore(this.fenceStartElement, this.editorContainer);
      }
      // 在编辑器容器后插入结束围栏
      if (this.fenceEndElement && this.editorContainer) {
        this.editorContainer.after(this.fenceEndElement);
      }
      // 隐藏 Mermaid 预览
      if (this.mermaidPreview) {
        this.mermaidPreview.style.display = "none";
      }
    } else {
      // 退出源码模式
      this.dom.classList.remove("source-view");
      // 显示头部
      if (this.headerElement) {
        this.headerElement.style.display = "";
      }
      // 移除围栏元素
      if (this.fenceStartElement && this.fenceStartElement.parentNode) {
        this.fenceStartElement.remove();
      }
      if (this.fenceEndElement && this.fenceEndElement.parentNode) {
        this.fenceEndElement.remove();
      }
      // 恢复 Mermaid 预览
      if (this.mermaidPreview && this.node.attrs.language === "mermaid") {
        this.updateMermaidDisplay();
      }
    }
  }

  /**
   * 更新围栏语言标识
   */
  private updateFenceLanguage(language: string): void {
    if (this.fenceStartElement) {
      this.fenceStartElement.textContent = "```" + language;
    }
  }

  /**
   * 创建头部（语言选择器和 Mermaid 模式选择器）
   */
  private createHeader(language: string): HTMLElement {
    const header = document.createElement("div");
    header.className = "milkup-code-block-header";

    // 语言选择器
    const langSelector = this.createCustomSelect(supportedLanguages, language, (value) =>
      this.setLanguage(value)
    );
    langSelector.classList.add("milkup-code-block-lang-select");
    header.appendChild(langSelector);

    // Mermaid 模式选择器（仅在 mermaid 语言时显示）
    if (language === "mermaid") {
      const modeSelector = this.createCustomSelect(
        mermaidDisplayModes,
        this.mermaidDisplayMode,
        (value) => this.setMermaidDisplayMode(value as MermaidDisplayMode)
      );
      modeSelector.classList.add("milkup-code-block-mode-select");
      header.appendChild(modeSelector);
    }

    return header;
  }

  /**
   * 创建自定义下拉选择器
   */
  private createCustomSelect(
    options: { value: string; label: string }[],
    currentValue: string,
    onChange: (value: string) => void
  ): HTMLElement {
    const container = document.createElement("div");
    container.className = "milkup-custom-select";

    const button = document.createElement("button");
    button.className = "milkup-custom-select-button";
    button.type = "button";
    const currentOption = options.find((o) => o.value === currentValue);
    button.textContent = currentOption?.label || options[0].label;

    const dropdown = document.createElement("div");
    dropdown.className = "milkup-custom-select-dropdown";

    for (const option of options) {
      const item = document.createElement("div");
      item.className = "milkup-custom-select-item";
      if (option.value === currentValue) {
        item.classList.add("selected");
      }
      item.textContent = option.label;
      item.dataset.value = option.value;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        button.textContent = option.label;
        // 更新选中状态
        dropdown.querySelectorAll(".milkup-custom-select-item").forEach((el) => {
          el.classList.remove("selected");
        });
        item.classList.add("selected");
        container.classList.remove("open");
        onChange(option.value);
      });
      dropdown.appendChild(item);
    }

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      // 关闭所有其他下拉框
      document.querySelectorAll(".milkup-custom-select.open").forEach((el) => {
        if (el !== container) {
          el.classList.remove("open");
        }
      });

      // 检测是否需要向上弹出
      const buttonRect = button.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - buttonRect.bottom;
      const dropdownHeight = 240; // 最大高度

      if (spaceBelow < dropdownHeight && buttonRect.top > spaceBelow) {
        container.classList.add("dropup");
      } else {
        container.classList.remove("dropup");
      }

      container.classList.toggle("open");
    });

    // 点击外部关闭
    document.addEventListener("click", () => {
      container.classList.remove("open");
    });

    container.appendChild(button);
    container.appendChild(dropdown);
    return container;
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
    const { main } = this.cm.state.selection;
    const hasSelection = !main.empty;

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
      const selectedText = this.cm.state.sliceDoc(main.from, main.to);
      navigator.clipboard.writeText(selectedText);
      this.hideContextMenu();
    });
    menu.appendChild(copyItem);

    // 剪切
    const cutItem = this.createContextMenuItem("剪切", !hasSelection, () => {
      const selectedText = this.cm.state.sliceDoc(main.from, main.to);
      navigator.clipboard.writeText(selectedText);
      this.cm.dispatch({
        changes: { from: main.from, to: main.to, insert: "" },
      });
      this.hideContextMenu();
    });
    menu.appendChild(cutItem);

    // 粘贴 - 使用 Clipboard API 读取文本
    const pasteItem = this.createContextMenuItem("粘贴", !hasClipboardContent, async () => {
      this.hideContextMenu();
      this.cm.focus();
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const { main } = this.cm.state.selection;
          this.cm.dispatch({
            changes: { from: main.from, to: main.to, insert: text },
          });
        }
      } catch {
        console.warn("无法访问剪贴板");
      }
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
   * 设置主题观察器
   */
  private setupThemeObserver(): void {
    const htmlElement = document.documentElement;

    this.themeObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          const isDark = detectDarkTheme();
          this.updateTheme(isDark);
          // 更新 Mermaid 预览
          if (this.node.attrs.language === "mermaid" && this.mermaidPreview) {
            this.createMermaidPreview(this.cm.state.doc.toString());
          }
        }
      }
    });

    this.themeObserver.observe(htmlElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  /**
   * 更新主题
   */
  private updateTheme(isDark: boolean): void {
    this.cm.dispatch({
      effects: this.themeCompartment.reconfigure(createThemeExtension(isDark)),
    });
  }

  /**
   * 设置语言
   */
  private setLanguage(language: string): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const prevLanguage = this.node.attrs.language;

    // 更新 ProseMirror 节点属性
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, null, {
        ...this.node.attrs,
        language,
      })
    );

    // 更新 CodeMirror 语言扩展
    this.cm.dispatch({
      effects: this.languageCompartment.reconfigure(getLanguageExtension(language)),
    });

    // 更新头部（添加或移除 Mermaid 模式选择器）
    if ((prevLanguage === "mermaid") !== (language === "mermaid")) {
      this.updateHeader(language);
    }

    // 更新 Mermaid 预览
    if (language === "mermaid") {
      this.createMermaidPreview(this.cm.state.doc.toString());
    } else if (this.mermaidPreview) {
      this.mermaidPreview.remove();
      this.mermaidPreview = null;
    }

    // 更新围栏语言标识
    this.updateFenceLanguage(language);
  }

  /**
   * 更新头部
   */
  private updateHeader(language: string): void {
    if (this.headerElement) {
      const newHeader = this.createHeader(language);
      this.dom.replaceChild(newHeader, this.headerElement);
      this.headerElement = newHeader;
    }
  }

  /**
   * 设置 Mermaid 显示模式
   */
  private setMermaidDisplayMode(mode: MermaidDisplayMode): void {
    this.mermaidDisplayMode = mode;
    this.updateMermaidDisplay();
  }

  /**
   * 更新 Mermaid 显示
   */
  private updateMermaidDisplay(): void {
    if (!this.editorContainer || !this.mermaidPreview) return;

    switch (this.mermaidDisplayMode) {
      case "code":
        this.editorContainer.style.display = "block";
        this.mermaidPreview.style.display = "none";
        break;
      case "diagram":
        this.editorContainer.style.display = "none";
        this.mermaidPreview.style.display = "block";
        break;
      case "mixed":
      default:
        this.editorContainer.style.display = "block";
        this.mermaidPreview.style.display = "block";
        break;
    }
  }

  /**
   * 创建 Mermaid 预览
   */
  private async createMermaidPreview(content: string): Promise<void> {
    if (!this.mermaidPreview) {
      this.mermaidPreview = document.createElement("div");
      this.mermaidPreview.className = "milkup-mermaid-preview";
      this.dom.appendChild(this.mermaidPreview);
    }

    try {
      const mermaid = await import("mermaid");
      const isDark = detectDarkTheme();
      const themeName = getCurrentThemeName();

      // 根据主题选择 Mermaid 主题
      let mermaidTheme = "default";
      if (isDark) {
        mermaidTheme = "dark";
      } else if (themeName === "frame") {
        mermaidTheme = "forest";
      }

      mermaid.default.initialize({
        startOnLoad: false,
        theme: mermaidTheme,
      });

      const { svg } = await mermaid.default.render(`mermaid-${Date.now()}`, content);
      this.mermaidPreview.innerHTML = svg;
    } catch (error) {
      this.mermaidPreview.innerHTML = `<div class="milkup-mermaid-error">Mermaid 渲染错误</div>`;
    }

    this.updateMermaidDisplay();
  }

  /**
   * CodeMirror 更新回调
   */
  private onCMUpdate(update: ViewUpdate): void {
    if (this.updating) return;

    if (update.docChanged) {
      const pos = this.getPos();
      if (pos === undefined) return;

      const newText = update.state.doc.toString();

      // 更新 ProseMirror 文档
      const tr = this.view.state.tr;
      const start = pos + 1;
      const end = pos + 1 + this.node.content.size;

      tr.replaceWith(start, end, newText ? this.view.state.schema.text(newText) : []);

      this.view.dispatch(tr);

      // 更新 Mermaid 预览
      if (this.node.attrs.language === "mermaid") {
        this.createMermaidPreview(newText);
      }
    }
  }

  /**
   * 转发选区到 ProseMirror
   */
  private forwardSelection(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { from, to } = this.cm.state.selection.main;
    const start = pos + 1 + from;
    const end = pos + 1 + to;

    const selection = TextSelection.create(this.view.state.doc, start, end);

    if (!this.view.state.selection.eq(selection)) {
      this.view.dispatch(this.view.state.tr.setSelection(selection));
    }
  }

  /**
   * 跳出代码块
   */
  private exitCodeBlock(direction: 1 | -1): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const nodeEnd = pos + this.node.nodeSize;

    if (direction === 1) {
      const isLastNode = nodeEnd >= state.doc.content.size;

      if (isLastNode) {
        const paragraph = state.schema.nodes.paragraph.create();
        const tr = state.tr.insert(nodeEnd, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, nodeEnd + 1));
        this.view.dispatch(tr);
        this.view.focus();
        return;
      }

      const selection = Selection.near(state.doc.resolve(nodeEnd), 1);
      this.view.dispatch(state.tr.setSelection(selection));
      this.view.focus();
    } else {
      const selection = Selection.near(state.doc.resolve(pos), -1);
      this.view.dispatch(state.tr.setSelection(selection));
      this.view.focus();
    }
  }

  /**
   * 删除代码块
   */
  private deleteCodeBlock(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const nodeEnd = pos + this.node.nodeSize;

    const tr = state.tr.delete(pos, nodeEnd);

    if (tr.doc.content.size === 0) {
      const paragraph = state.schema.nodes.paragraph.create();
      tr.insert(0, paragraph);
      tr.setSelection(TextSelection.create(tr.doc, 1));
    } else {
      const $pos = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
      tr.setSelection(Selection.near($pos, -1));
    }

    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * 更新节点
   */
  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;

    this.node = node;
    const newText = node.textContent;

    if (newText !== this.cm.state.doc.toString()) {
      this.updating = true;
      this.cm.dispatch({
        changes: {
          from: 0,
          to: this.cm.state.doc.length,
          insert: newText,
        },
      });
      this.updating = false;
    }

    // 更新语言
    if (node.attrs.language !== this.node.attrs.language) {
      this.cm.dispatch({
        effects: this.languageCompartment.reconfigure(getLanguageExtension(node.attrs.language)),
      });
    }

    return true;
  }

  /**
   * 设置选区
   */
  setSelection(anchor: number, head: number): void {
    this.cm.focus();
    this.cm.dispatch({
      selection: { anchor, head },
    });
  }

  /**
   * 选区是否在此节点内
   */
  selectNode(): void {
    this.cm.focus();
  }

  /**
   * 停止事件传播
   * 只阻止键盘事件，允许鼠标事件传播到自定义组件
   */
  stopEvent(event: Event): boolean {
    // 允许头部区域的鼠标事件（下拉选择器）
    if (event.target instanceof HTMLElement) {
      const isInHeader = event.target.closest(".milkup-code-block-header");
      if (isInHeader) {
        return false;
      }
    }
    return true;
  }

  /**
   * 忽略变更
   */
  ignoreMutation(): boolean {
    return true;
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.cm.destroy();
    if (this.mermaidPreview) {
      this.mermaidPreview.remove();
    }
    if (this.themeObserver) {
      this.themeObserver.disconnect();
      this.themeObserver = null;
    }
    this.hideContextMenu();
    // 取消订阅源码模式状态
    if (this.sourceViewUnsubscribe) {
      this.sourceViewUnsubscribe();
      this.sourceViewUnsubscribe = null;
    }
  }
}

/**
 * 创建代码块 NodeView 工厂函数
 */
export function createCodeBlockNodeView(
  node: ProseMirrorNode,
  view: ProseMirrorView,
  getPos: () => number | undefined
): CodeBlockView {
  return new CodeBlockView(node, view, getPos);
}

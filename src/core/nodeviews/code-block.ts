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
import { EditorView, keymap as cmKeymap, ViewUpdate, lineNumbers } from "@codemirror/view";
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

/** 全局 Mermaid 默认显示模式 */
let globalMermaidDefaultMode: MermaidDisplayMode = "diagram";

/** 设置全局 Mermaid 默认显示模式 */
export function setGlobalMermaidDefaultMode(mode: MermaidDisplayMode): void {
  globalMermaidDefaultMode = mode;
}

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
  lineNumbersCompartment: Compartment;
  mermaidPreview: HTMLElement | null = null;
  mermaidDisplayMode: MermaidDisplayMode = globalMermaidDefaultMode;
  themeObserver: MutationObserver | null = null;
  headerElement: HTMLElement | null = null;
  editorContainer: HTMLElement | null = null;
  contextMenu: HTMLElement | null = null;
  sourceTextElement: HTMLElement | null = null; // 源码模式下的纯文本显示元素
  // 源码模式相关
  private sourceViewMode: boolean = false;
  private sourceViewUnsubscribe: (() => void) | null = null;

  constructor(node: ProseMirrorNode, view: ProseMirrorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.languageCompartment = new Compartment();
    this.themeCompartment = new Compartment();
    this.lineNumbersCompartment = new Compartment();

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

    // 头部右键菜单
    this.headerElement.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showContextMenu(e);
    });

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
            {
              key: "Ctrl-Enter",
              run: () => {
                // 检查是否在列表中
                const pos = this.getPos();
                if (pos !== undefined) {
                  const $pos = this.view.state.doc.resolve(pos);
                  // 检查祖先节点中是否有 list_item
                  let inList = false;
                  for (let d = $pos.depth; d > 0; d--) {
                    const node = $pos.node(d);
                    if (node.type.name === "list_item" || node.type.name === "task_item") {
                      inList = true;
                      break;
                    }
                  }
                  if (inList) {
                    // 在列表中，创建新的列表项
                    this.exitCodeBlockAndCreateListItem();
                    return true;
                  }
                }
                // 不在列表中，使用默认行为
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

                // 在第一位按右箭头，跳出代码块到开始围栏之前
                if (main.head === 0 && main.empty) {
                  this.exitCodeBlock(-1);
                  return true;
                }

                // 在最后一位按右箭头，跳出代码块
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
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          this.themeCompartment.of(createThemeExtension(isDark)),
          this.languageCompartment.of(getLanguageExtension(normalizedLang)),
          this.lineNumbersCompartment.of(lineNumbers()),
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

      // 隐藏 Mermaid 预览
      if (this.mermaidPreview) {
        this.mermaidPreview.style.display = "none";
      }

      // 隐藏 CodeMirror
      if (this.editorContainer) {
        this.editorContainer.style.display = "none";
      }

      // 创建源码容器（拆分成多行以参与行号计数）
      if (!this.sourceTextElement) {
        this.sourceTextElement = document.createElement("div");
        this.sourceTextElement.className = "milkup-code-block-source-container";
        this.sourceTextElement.contentEditable = "true";
        this.sourceTextElement.spellcheck = false;
        this.sourceTextElement.style.cssText = `
          position: relative;
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
          font-size: 14px;
          line-height: 1.6;
          padding: 0;
          margin: 0;
          color: inherit;
          background: transparent;
          border: none;
          outline: none;
        `;

        // 监听输入事件
        this.sourceTextElement.addEventListener("input", () => {
          this.handleSourceTextInput();
        });

        // 监听键盘事件
        this.sourceTextElement.addEventListener("keydown", (e) => {
          this.handleSourceTextKeydown(e);
        });

        // 阻止默认的粘贴行为，使用纯文本粘贴
        this.sourceTextElement.addEventListener("paste", (e) => {
          e.preventDefault();
          const text = e.clipboardData?.getData("text/plain") || "";
          document.execCommand("insertText", false, text);
        });

        this.dom.insertBefore(this.sourceTextElement, this.editorContainer);
      }

      // 更新源码内容（拆分成多行）
      const language = this.node.attrs.language || "";
      const content = this.node.textContent;
      const fullMarkdown = `\`\`\`${language}\n${content}\n\`\`\``;
      const lines = fullMarkdown.split("\n");

      // 清空容器
      this.sourceTextElement.innerHTML = "";

      // 为每一行创建一个 div 元素以参与行号计数
      lines.forEach((line) => {
        const lineDiv = document.createElement("div");
        lineDiv.className = "milkup-with-line-number";
        lineDiv.style.cssText = `
          white-space: pre;
          min-height: 1.6em;
        `;
        lineDiv.textContent = line;
        this.sourceTextElement!.appendChild(lineDiv);
      });

      this.sourceTextElement.style.display = "block";
    } else {
      // 退出源码模式
      this.dom.classList.remove("source-view");

      // 显示 CodeMirror
      if (this.editorContainer) {
        this.editorContainer.style.display = "";
      }

      // 显示头部
      if (this.headerElement) {
        this.headerElement.style.display = "";
      }

      // 隐藏源码文本元素
      if (this.sourceTextElement) {
        this.sourceTextElement.style.display = "none";
      }

      // 恢复 Mermaid 预览
      if (this.mermaidPreview && this.node.attrs.language === "mermaid") {
        this.updateMermaidDisplay();
      }
    }
  }

  /**
   * 处理源码文本输入
   */
  private handleSourceTextInput(): void {
    if (!this.sourceTextElement || this.updating) return;

    // 从所有子 div 中收集文本内容
    const lines: string[] = [];
    const childDivs = this.sourceTextElement.querySelectorAll("div.milkup-with-line-number");
    childDivs.forEach((div) => {
      lines.push(div.textContent || "");
    });
    const text = lines.join("\n");

    const pos = this.getPos();
    if (pos === undefined) return;

    // 保存光标位置
    const selection = window.getSelection();
    let cursorOffset = 0;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        cursorOffset = range.startOffset;
        // 计算相对于整个文本的偏移量
        let node: Node | null = range.startContainer;
        while (node && node !== this.sourceTextElement && node.previousSibling) {
          node = node.previousSibling;
          cursorOffset += node.textContent?.length || 0;
        }
      }
    }

    this.updating = true;

    // 检查是否是完整的代码块格式（必须有开头和结尾的 ```）
    const fenceMatch = text.match(/^```([^\n]*?)\n([\s\S]*?)\n```$/);

    if (fenceMatch) {
      // 仍然是完整的代码块格式，更新内容
      const [, language, content] = fenceMatch;
      const tr = this.view.state.tr;
      let needsUpdate = false;

      // 更新语言属性
      const normalizedLang = language || "";
      if (normalizedLang !== this.node.attrs.language) {
        tr.setNodeMarkup(pos, null, {
          ...this.node.attrs,
          language: normalizedLang,
        });
        needsUpdate = true;
      }

      // 更新内容
      if (content !== this.node.textContent) {
        const start = pos + 1;
        const end = pos + 1 + this.node.content.size;
        tr.replaceWith(start, end, content ? this.view.state.schema.text(content) : []);
        needsUpdate = true;
      }

      if (needsUpdate) {
        this.view.dispatch(tr);
      }

      // 更新行显示（重新拆分成多行）
      const newLines = text.split("\n");
      this.sourceTextElement.innerHTML = "";
      newLines.forEach((line) => {
        const lineDiv = document.createElement("div");
        lineDiv.className = "milkup-with-line-number";
        lineDiv.style.cssText = `
          white-space: pre;
          min-height: 1.6em;
        `;
        lineDiv.textContent = line;
        this.sourceTextElement!.appendChild(lineDiv);
      });
    } else {
      // 不是完整的代码块格式，转换为段落
      const tr = this.view.state.tr;
      const nodeEnd = pos + this.node.nodeSize;

      tr.delete(pos, nodeEnd);

      if (text.trim()) {
        const textLines = text.split("\n").filter((line) => line.trim());
        const paragraphs = textLines.map((line) =>
          this.view.state.schema.nodes.paragraph.create(
            null,
            line ? this.view.state.schema.text(line) : null
          )
        );

        if (paragraphs.length === 0) {
          paragraphs.push(this.view.state.schema.nodes.paragraph.create());
        }

        tr.insert(pos, paragraphs);
        const newPos = pos + 1;
        tr.setSelection(TextSelection.create(tr.doc, newPos));
      } else {
        const paragraph = this.view.state.schema.nodes.paragraph.create();
        tr.insert(pos, paragraph);
        const newPos = pos + 1;
        tr.setSelection(TextSelection.create(tr.doc, newPos));
      }

      this.view.dispatch(tr);
      this.view.focus();
    }

    this.updating = false;

    // 如果仍然是代码块,恢复光标位置
    if (fenceMatch) {
      requestAnimationFrame(() => {
        if (this.sourceTextElement && selection) {
          try {
            // 找到光标应该在的位置
            let remainingOffset = cursorOffset;
            let targetDiv: HTMLElement | null = null;
            let targetOffset = 0;

            const divs = this.sourceTextElement.querySelectorAll("div.milkup-with-line-number");
            for (let i = 0; i < divs.length; i++) {
              const div = divs[i] as HTMLElement;
              const textNode = div.firstChild;
              if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

              const textLength = textNode.textContent?.length || 0;
              if (remainingOffset <= textLength) {
                targetDiv = div;
                targetOffset = remainingOffset;
                break;
              }
              remainingOffset -= textLength + 1; // +1 for newline
            }

            if (targetDiv && targetDiv.firstChild) {
              const range = document.createRange();
              const textNode = targetDiv.firstChild;
              const offset = Math.min(targetOffset, textNode.textContent?.length || 0);
              range.setStart(textNode, offset);
              range.collapse(true);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          } catch (e) {
            // 忽略光标恢复错误
          }
        }
      });
    }
  }

  /**
   * 处理源码文本键盘事件
   */
  private handleSourceTextKeydown(e: KeyboardEvent): void {
    // 允许基本的编辑操作
    if (e.key === "Tab") {
      e.preventDefault();
      // 插入两个空格
      document.execCommand("insertText", false, "  ");
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

    // 复制按钮（hover 时显示）
    const copyBtn = document.createElement("button");
    copyBtn.className = "milkup-code-block-copy-btn";
    copyBtn.type = "button";
    copyBtn.title = "复制代码块";
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.copyCodeBlock();
      // 短暂显示已复制反馈
      copyBtn.classList.add("copied");
      copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      }, 1500);
    });
    header.appendChild(copyBtn);

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
   * 获取代码块的完整 Markdown 文本（含围栏）
   */
  private getCodeBlockMarkdown(): string {
    const language = this.node.attrs.language || "";
    const content = this.cm.state.doc.toString();
    return `\`\`\`${language}\n${content}\n\`\`\``;
  }

  /**
   * 复制代码块到剪贴板
   */
  private copyCodeBlock(): void {
    navigator.clipboard.writeText(this.getCodeBlockMarkdown());
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

    // 分隔线
    const separator = document.createElement("div");
    separator.className = "milkup-context-menu-separator";
    menu.appendChild(separator);

    // 复制代码块
    const copyBlockItem = this.createContextMenuItem("复制代码块", false, () => {
      this.copyCodeBlock();
      this.hideContextMenu();
    });
    menu.appendChild(copyBlockItem);

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
      // 如果找到的选区不在代码块之前，说明前方无可用位置，需创建段落
      if (selection.from >= pos) {
        const paragraph = state.schema.nodes.paragraph.create();
        const tr = state.tr.insert(pos, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, pos + 1));
        this.view.dispatch(tr);
        this.view.focus();
        return;
      }
      this.view.dispatch(state.tr.setSelection(selection));
      this.view.focus();
    }
  }

  /**
   * 跳出代码块并创建新的列表项
   */
  private exitCodeBlockAndCreateListItem(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const $pos = state.doc.resolve(pos);

    // 查找列表项节点
    let listItemDepth = -1;
    for (let d = $pos.depth; d > 0; d--) {
      const node = $pos.node(d);
      if (node.type.name === "list_item" || node.type.name === "task_item") {
        listItemDepth = d;
        break;
      }
    }

    // 确认在列表项中
    if (listItemDepth === -1) {
      this.exitCodeBlock(1);
      return;
    }

    // 获取列表项之后的位置（而非内容末尾）
    const listItemAfter = $pos.after(listItemDepth);

    // 创建新的列表项
    const newListItem = state.schema.nodes.list_item.create(
      null,
      state.schema.nodes.paragraph.create()
    );

    const tr = state.tr;
    tr.insert(listItemAfter, newListItem);
    tr.setSelection(TextSelection.create(tr.doc, listItemAfter + 2));
    this.view.dispatch(tr);
    this.view.focus();
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

    const prevLanguage = this.node.attrs.language;
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

    // 更新源码模式下的文本内容
    if (this.sourceViewMode && this.sourceTextElement) {
      const language = node.attrs.language || "";
      const content = node.textContent;
      const fullMarkdown = `\`\`\`${language}\n${content}\n\`\`\``;
      const lines = fullMarkdown.split("\n");

      // 收集当前的文本内容
      const currentLines: string[] = [];
      const childDivs = this.sourceTextElement.querySelectorAll("div.milkup-with-line-number");
      childDivs.forEach((div) => {
        currentLines.push(div.textContent || "");
      });
      const currentText = currentLines.join("\n");

      // 只在内容真正变化时更新
      if (currentText !== fullMarkdown) {
        // 保存光标位置
        const selection = window.getSelection();
        let cursorOffset = 0;
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (range.startContainer.nodeType === Node.TEXT_NODE) {
            cursorOffset = range.startOffset;
            // 计算相对于整个文本的偏移量
            let node: Node | null = range.startContainer;
            while (node && node !== this.sourceTextElement && node.previousSibling) {
              node = node.previousSibling;
              cursorOffset += node.textContent?.length || 0;
            }
          }
        }

        this.updating = true;

        // 清空容器并重新创建行
        this.sourceTextElement.innerHTML = "";
        lines.forEach((line) => {
          const lineDiv = document.createElement("div");
          lineDiv.className = "milkup-with-line-number";
          lineDiv.style.cssText = `
            white-space: pre;
            min-height: 1.6em;
          `;
          lineDiv.textContent = line;
          this.sourceTextElement!.appendChild(lineDiv);
        });

        this.updating = false;

        // 恢复光标位置
        if (selection && cursorOffset > 0) {
          requestAnimationFrame(() => {
            if (!this.sourceTextElement) return;
            try {
              // 找到光标应该在的位置
              let remainingOffset = cursorOffset;
              let targetDiv: HTMLElement | null = null;
              let targetOffset = 0;

              const divs = this.sourceTextElement.querySelectorAll("div.milkup-with-line-number");
              for (let i = 0; i < divs.length; i++) {
                const div = divs[i] as HTMLElement;
                const textNode = div.firstChild;
                if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

                const textLength = textNode.textContent?.length || 0;
                if (remainingOffset <= textLength) {
                  targetDiv = div;
                  targetOffset = remainingOffset;
                  break;
                }
                remainingOffset -= textLength + 1; // +1 for newline
              }

              if (targetDiv && targetDiv.firstChild) {
                const range = document.createRange();
                const textNode = targetDiv.firstChild;
                const offset = Math.min(targetOffset, textNode.textContent?.length || 0);
                range.setStart(textNode, offset);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
              }
            } catch (e) {
              // 忽略光标恢复错误
            }
          });
        }
      }
    }

    // 更新语言
    if (node.attrs.language !== prevLanguage) {
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

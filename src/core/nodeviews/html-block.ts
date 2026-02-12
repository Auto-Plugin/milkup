/**
 * Milkup HTML 块 NodeView
 *
 * 渲染 HTML 内容，支持编辑模式和预览模式切换
 * 编辑模式使用 CodeMirror 6 + HTML 语法高亮
 */

import { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorView as ProseMirrorView, NodeView } from "prosemirror-view";
import { Selection, TextSelection } from "prosemirror-state";
import { EditorView, keymap as cmKeymap, ViewUpdate } from "@codemirror/view";
import { EditorState as CMEditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { createThemeExtension, detectDarkTheme } from "./code-block";

// 存储所有 HtmlBlockView 实例，用于全局更新
const htmlBlockViews = new Set<HtmlBlockView>();

/**
 * 更新所有 HTML 块的编辑状态
 */
export function updateAllHtmlBlocks(view: ProseMirrorView): void {
  const { from, to } = view.state.selection;
  for (const htmlView of htmlBlockViews) {
    htmlView.updateEditingState(from, to);
  }
}

/**
 * 对 HTML 内容进行安全处理（移除 script 标签）
 */
function sanitizeHtml(htmlContent: string): string {
  return htmlContent
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[\s\S]*?\/>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
}

/**
 * HTML 块 NodeView
 */
export class HtmlBlockView implements NodeView {
  dom: HTMLElement;
  private cm: EditorView;
  private node: ProseMirrorNode;
  private view: ProseMirrorView;
  private getPos: () => number | undefined;
  private updating = false;
  private isEditing = false;
  private preview: HTMLElement;
  private header: HTMLElement;
  private editorContainer: HTMLElement;
  private themeCompartment: Compartment;
  private themeObserver: MutationObserver | null = null;

  constructor(node: ProseMirrorNode, view: ProseMirrorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.themeCompartment = new Compartment();
    htmlBlockViews.add(this);

    const isDark = detectDarkTheme();

    // 创建容器
    this.dom = document.createElement("div");
    this.dom.className = "milkup-html-block";

    // 创建 header（固定显示 "HTML"）
    this.header = document.createElement("div");
    this.header.className = "milkup-html-block-header";
    const label = document.createElement("span");
    label.className = "milkup-html-block-label";
    label.textContent = "HTML";
    this.header.appendChild(label);
    this.dom.appendChild(this.header);

    // 创建预览区域
    this.preview = document.createElement("div");
    this.preview.className = "milkup-html-block-preview";
    this.dom.appendChild(this.preview);

    // 创建编辑器容器
    this.editorContainer = document.createElement("div");
    this.editorContainer.className = "milkup-html-block-editor";
    this.dom.appendChild(this.editorContainer);

    // 创建 CodeMirror 编辑器
    this.cm = new EditorView({
      state: CMEditorState.create({
        doc: node.textContent,
        extensions: [
          history(),
          cmKeymap.of([
            {
              key: "Ctrl-Enter",
              run: () => {
                this.exitBlock(1);
                return true;
              },
            },
            {
              key: "ArrowDown",
              run: (cmView) => {
                const { main } = cmView.state.selection;
                const line = cmView.state.doc.lineAt(main.head);
                if (line.number === cmView.state.doc.lines) {
                  this.exitBlock(1);
                  return true;
                }
                return false;
              },
            },
            {
              key: "ArrowUp",
              run: (cmView) => {
                const { main } = cmView.state.selection;
                const line = cmView.state.doc.lineAt(main.head);
                if (line.number === 1) {
                  this.exitBlock(-1);
                  return true;
                }
                return false;
              },
            },
            {
              key: "Backspace",
              run: (cmView) => {
                if (cmView.state.doc.length === 0) {
                  this.deleteBlock();
                  return true;
                }
                return false;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          this.themeCompartment.of(createThemeExtension(isDark)),
          html(),
          EditorView.updateListener.of((update) => this.onCMUpdate(update)),
          EditorView.domEventHandlers({
            focus: () => this.forwardSelection(),
          }),
        ],
      }),
      parent: this.editorContainer,
    });

    // 初始渲染
    this.updatePreview(node.textContent);
    this.setEditing(false);

    // 点击预览区域进入编辑模式
    this.preview.addEventListener("click", () => this.enterEditMode());

    // 初始检查光标位置
    const { from, to } = view.state.selection;
    this.updateEditingState(from, to);

    // 监听主题变化
    this.setupThemeObserver();
  }

  private updatePreview(content: string): void {
    const safe = sanitizeHtml(content);
    if (safe.trim()) {
      this.preview.innerHTML = safe;
    } else {
      this.preview.innerHTML = '<span class="html-placeholder">输入 HTML...</span>';
    }
  }

  updateEditingState(selFrom: number, selTo: number): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;

    const nodeEnd = pos + node.nodeSize;
    const cursorInNode = selFrom >= pos && selTo <= nodeEnd;

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
      this.header.style.display = "";
      this.editorContainer.style.display = "";
      this.preview.style.display = "none";
    } else {
      this.dom.classList.remove("editing");
      this.header.style.display = "none";
      this.editorContainer.style.display = "none";
      this.preview.style.display = "";
      // 更新预览
      this.updatePreview(this.node.textContent);
    }
  }

  private enterEditMode(): void {
    if (this.isEditing) return;
    this.setEditing(true);
    const pos = this.getPos();
    if (pos !== undefined) {
      const tr = this.view.state.tr.setSelection(
        Selection.near(this.view.state.doc.resolve(pos + 1))
      );
      this.view.dispatch(tr);
      this.view.focus();
    }
  }

  private onCMUpdate(update: ViewUpdate): void {
    if (this.updating) return;
    if (update.docChanged) {
      const pos = this.getPos();
      if (pos === undefined) return;
      const newText = update.state.doc.toString();
      const tr = this.view.state.tr;
      const start = pos + 1;
      const end = pos + 1 + this.node.content.size;
      tr.replaceWith(start, end, newText ? this.view.state.schema.text(newText) : []);
      this.view.dispatch(tr);
    }
  }

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

  private exitBlock(direction: 1 | -1): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const { state } = this.view;
    const nodeEnd = pos + this.node.nodeSize;

    if (direction === 1) {
      if (nodeEnd >= state.doc.content.size) {
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

  private deleteBlock(): void {
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

  private setupThemeObserver(): void {
    this.themeObserver = new MutationObserver(() => {
      const isDark = detectDarkTheme();
      this.cm.dispatch({
        effects: this.themeCompartment.reconfigure(createThemeExtension(isDark)),
      });
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== "html_block") return false;
    this.node = node;
    const newText = node.textContent;

    if (newText !== this.cm.state.doc.toString()) {
      this.updating = true;
      this.cm.dispatch({
        changes: { from: 0, to: this.cm.state.doc.length, insert: newText },
      });
      this.updating = false;
    }

    // 更新预览（仅在非编辑模式下）
    if (!this.isEditing) {
      this.updatePreview(newText);
    }

    return true;
  }

  setSelection(anchor: number, head: number): void {
    if (!this.isEditing) {
      this.setEditing(true);
    }
    this.cm.focus();
    this.cm.dispatch({ selection: { anchor, head } });
  }

  selectNode(): void {
    this.setEditing(true);
    this.cm.focus();
  }

  deselectNode(): void {
    // 由 updateEditingState 统一处理
  }

  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    htmlBlockViews.delete(this);
    this.cm.destroy();
    if (this.themeObserver) {
      this.themeObserver.disconnect();
    }
  }
}

/**
 * 创建 HTML 块 NodeView
 */
export function createHtmlBlockNodeView(
  node: ProseMirrorNode,
  view: ProseMirrorView,
  getPos: () => number | undefined
): NodeView {
  return new HtmlBlockView(node, view, getPos);
}

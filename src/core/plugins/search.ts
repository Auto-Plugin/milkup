/**
 * Milkup 搜索替换插件
 *
 * 提供 VS Code 风格的搜索替换功能：
 * - 文本搜索与高亮
 * - 区分大小写 / 全字匹配 / 正则表达式
 * - 选区内搜索
 * - 替换 / 全部替换
 */

import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { Node } from "prosemirror-model";

/** 搜索选项 */
export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  searchInSelection: boolean;
  selectionRange: { from: number; to: number } | null;
}

/** 搜索状态 */
export interface SearchState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  searchInSelection: boolean;
  selectionRange: { from: number; to: number } | null;
  matches: Array<{ from: number; to: number }>;
  currentIndex: number;
  decorations: DecorationSet;
}

export const searchPluginKey = new PluginKey<SearchState>("milkup-search");

/** 从文档中提取纯文本及位置映射 */
function getDocText(doc: Node): { text: string; posMap: number[] } {
  let text = "";
  const posMap: number[] = []; // posMap[textIndex] = docPos

  doc.descendants((node, pos) => {
    if (node.isText) {
      for (let i = 0; i < node.text!.length; i++) {
        posMap.push(pos + i);
        text += node.text![i];
      }
    } else if (node.isBlock && text.length > 0 && text[text.length - 1] !== "\n") {
      posMap.push(pos);
      text += "\n";
    }
    return true;
  });

  return { text, posMap };
}

/** 转义正则特殊字符 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 剥离 Markdown 语法，保留纯文本内容 */
function stripMarkdownSyntax(query: string): string {
  let s = query;
  // 标题前缀: ### text → text
  s = s.replace(/^#{1,6}\s+/, "");
  // 图片: ![alt](url) → alt
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // 链接: [text](url) → text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // 粗体: **text** 或 __text__
  s = s.replace(/\*\*(.+?)\*\*/g, "$1");
  s = s.replace(/__(.+?)__/g, "$1");
  // 删除线: ~~text~~
  s = s.replace(/~~(.+?)~~/g, "$1");
  // 行内代码: `text`
  s = s.replace(/`(.+?)`/g, "$1");
  // 斜体: *text* 或 _text_
  s = s.replace(/\*(.+?)\*/g, "$1");
  s = s.replace(/_(.+?)_/g, "$1");
  return s;
}

/** 查找所有匹配 */
function findMatches(
  doc: Node,
  query: string,
  options: SearchOptions
): Array<{ from: number; to: number }> {
  if (!query) return [];

  // 非正则模式下，剥离 Markdown 语法
  if (!options.useRegex) {
    const stripped = stripMarkdownSyntax(query);
    if (stripped && stripped !== query) {
      query = stripped;
    }
  }

  const { text, posMap } = getDocText(doc);
  const matches: Array<{ from: number; to: number }> = [];

  let pattern: string;
  let flags = "g";
  if (!options.caseSensitive) flags += "i";

  try {
    if (options.useRegex) {
      pattern = query;
    } else {
      pattern = escapeRegex(query);
    }
    if (options.wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }

    const regex = new RegExp(pattern, flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++;
        continue;
      }

      const startIdx = match.index;
      const endIdx = match.index + match[0].length;

      if (startIdx >= posMap.length || endIdx - 1 >= posMap.length) continue;

      const from = posMap[startIdx];
      const to = posMap[endIdx - 1] + 1;

      if (options.searchInSelection && options.selectionRange) {
        const { from: selFrom, to: selTo } = options.selectionRange;
        if (from < selFrom || to > selTo) continue;
      }

      matches.push({ from, to });
    }
  } catch {
    // 无效正则，返回空
  }

  return matches;
}

/** 构建装饰集 */
function buildDecorations(
  doc: Node,
  matches: Array<{ from: number; to: number }>,
  currentIndex: number
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;

  const decorations = matches.map((m, i) => {
    const cls =
      i === currentIndex
        ? "milkup-search-match milkup-search-match-current"
        : "milkup-search-match";
    return Decoration.inline(m.from, m.to, { class: cls });
  });

  return DecorationSet.create(doc, decorations);
}

/** 空搜索状态 */
function emptyState(): SearchState {
  return {
    query: "",
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    searchInSelection: false,
    selectionRange: null,
    matches: [],
    currentIndex: -1,
    decorations: DecorationSet.empty,
  };
}

/** 创建搜索插件 */
export function createSearchPlugin(): Plugin {
  return new Plugin({
    key: searchPluginKey,

    state: {
      init() {
        return emptyState();
      },

      apply(tr, prev, _oldState, newState): SearchState {
        // 处理 setSearchQuery meta
        const queryMeta = tr.getMeta(searchPluginKey) as
          | { type: "setQuery"; query: string; options: SearchOptions }
          | { type: "setIndex"; index: number }
          | { type: "clear" }
          | undefined;

        if (queryMeta) {
          if (queryMeta.type === "setQuery") {
            const { query, options } = queryMeta;
            const matches = findMatches(newState.doc, query, options);
            const currentIndex = matches.length > 0 ? 0 : -1;
            return {
              query,
              ...options,
              matches,
              currentIndex,
              decorations: buildDecorations(newState.doc, matches, currentIndex),
            };
          }
          if (queryMeta.type === "setIndex") {
            const currentIndex = queryMeta.index;
            return {
              ...prev,
              currentIndex,
              decorations: buildDecorations(newState.doc, prev.matches, currentIndex),
            };
          }
          if (queryMeta.type === "clear") {
            return emptyState();
          }
        }

        // 文档变化时重新搜索
        if (tr.docChanged && prev.query) {
          const options: SearchOptions = {
            caseSensitive: prev.caseSensitive,
            wholeWord: prev.wholeWord,
            useRegex: prev.useRegex,
            searchInSelection: prev.searchInSelection,
            selectionRange: prev.selectionRange,
          };
          const matches = findMatches(newState.doc, prev.query, options);
          let currentIndex = prev.currentIndex;
          if (currentIndex >= matches.length) {
            currentIndex = matches.length > 0 ? 0 : -1;
          }
          return {
            ...prev,
            matches,
            currentIndex,
            decorations: buildDecorations(newState.doc, matches, currentIndex),
          };
        }

        return prev;
      },
    },

    props: {
      decorations(state) {
        return searchPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

// ========== 导出辅助函数 ==========

/** 更新搜索 */
export function updateSearch(view: EditorView, query: string, options: SearchOptions): void {
  const tr = view.state.tr.setMeta(searchPluginKey, {
    type: "setQuery",
    query,
    options,
  });
  view.dispatch(tr);
}

/** 下一个匹配 */
export function findNext(view: EditorView): void {
  const state = searchPluginKey.getState(view.state);
  if (!state || state.matches.length === 0) return;

  const nextIndex = (state.currentIndex + 1) % state.matches.length;
  const match = state.matches[nextIndex];
  const tr = view.state.tr
    .setMeta(searchPluginKey, { type: "setIndex", index: nextIndex })
    .setSelection(TextSelection.create(view.state.doc, match.from))
    .scrollIntoView();
  view.dispatch(tr);
  scrollCurrentMatchIntoView(view);
}

/** 上一个匹配 */
export function findPrev(view: EditorView): void {
  const state = searchPluginKey.getState(view.state);
  if (!state || state.matches.length === 0) return;

  const prevIndex = (state.currentIndex - 1 + state.matches.length) % state.matches.length;
  const match = state.matches[prevIndex];
  const tr = view.state.tr
    .setMeta(searchPluginKey, { type: "setIndex", index: prevIndex })
    .setSelection(TextSelection.create(view.state.doc, match.from))
    .scrollIntoView();
  view.dispatch(tr);
  scrollCurrentMatchIntoView(view);
}

/** 滚动当前匹配项到可视区域 */
function scrollCurrentMatchIntoView(view: EditorView): void {
  requestAnimationFrame(() => {
    const el = view.dom.querySelector(".milkup-search-match-current");
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
}

/** 替换当前匹配 */
export function replaceMatch(view: EditorView, replacement: string): void {
  const state = searchPluginKey.getState(view.state);
  if (!state || state.currentIndex < 0 || state.currentIndex >= state.matches.length) return;

  const match = state.matches[state.currentIndex];
  const tr = view.state.tr.insertText(replacement, match.from, match.to);
  view.dispatch(tr);
}

/** 替换所有匹配 */
export function replaceAll(view: EditorView, replacement: string): void {
  const state = searchPluginKey.getState(view.state);
  if (!state || state.matches.length === 0) return;

  // 从后往前替换，避免位置偏移
  let tr = view.state.tr;
  for (let i = state.matches.length - 1; i >= 0; i--) {
    const match = state.matches[i];
    tr = tr.insertText(replacement, match.from, match.to);
  }
  view.dispatch(tr);
}

/** 清除搜索 */
export function clearSearch(view: EditorView): void {
  const tr = view.state.tr.setMeta(searchPluginKey, { type: "clear" });
  view.dispatch(tr);
}

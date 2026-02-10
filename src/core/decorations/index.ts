/**
 * Milkup 装饰系统 v2
 *
 * 基于 syntax_marker mark 的即时渲染装饰系统
 * 语法标记是真实的文本内容，光标可以自由移动
 * 装饰只控制显示/隐藏，不改变文档结构
 */

import { Decoration, DecorationSet } from "prosemirror-view";
import { EditorState, Plugin, PluginKey } from "prosemirror-state";
import { Node } from "prosemirror-model";
import type { SyntaxType } from "../types";
import { renderInlineMath } from "../nodeviews/math-block";

// ============ 源码模式状态管理器 ============

/** 源码模式状态变化监听器 */
export type SourceViewListener = (sourceView: boolean) => void;

/** 源码模式状态管理器 */
class SourceViewManager {
  private listeners: Set<SourceViewListener> = new Set();
  private currentState: boolean = false;

  /** 订阅状态变化 */
  subscribe(listener: SourceViewListener): () => void {
    this.listeners.add(listener);
    // 立即通知当前状态
    listener(this.currentState);
    // 返回取消订阅函数
    return () => this.listeners.delete(listener);
  }

  /** 更新状态并通知所有监听器 */
  setState(sourceView: boolean): void {
    if (this.currentState !== sourceView) {
      this.currentState = sourceView;
      this.listeners.forEach((listener) => listener(sourceView));
    }
  }

  /** 获取当前状态 */
  getState(): boolean {
    return this.currentState;
  }
}

/** 全局源码模式状态管理器实例 */
export const sourceViewManager = new SourceViewManager();

/** 装饰插件状态 */
export interface DecorationPluginState {
  decorations: DecorationSet;
  activeRegions: SyntaxMarkerRegion[];
  sourceView: boolean;
}

/** 语法标记区域 */
export interface SyntaxMarkerRegion {
  from: number;
  to: number;
  syntaxType: string;
}

/** Mark 区域（兼容旧接口） */
export interface MarkRegion {
  type: string;
  from: number;
  to: number;
  mark: any;
}

/** 语法区域（兼容旧接口） */
export interface SyntaxRegion {
  type: SyntaxType;
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  prefix: string;
  suffix: string;
}

/** 装饰插件 Key */
export const decorationPluginKey = new PluginKey<DecorationPluginState>("milkup-decorations");

/** CSS 类名映射 */
export const SYNTAX_CLASSES: Record<string, string> = {
  strong: "milkup-strong",
  emphasis: "milkup-emphasis",
  code_inline: "milkup-code-inline",
  strikethrough: "milkup-strikethrough",
  link: "milkup-link",
  highlight: "milkup-highlight",
  math_inline: "milkup-math-inline",
  heading: "milkup-heading", // 标题
  strong_emphasis: "milkup-strong-emphasis", // 粗斜体
  escape: "milkup-escape", // 转义
};

/** 语法类型关联映射 - 用于处理嵌套语法 */
const SYNTAX_TYPE_RELATIONS: Record<string, string[]> = {
  strong_emphasis: ["strong", "emphasis"],
  strong: ["strong", "strong_emphasis"],
  emphasis: ["emphasis", "strong_emphasis"],
  highlight: ["highlight"],
  strikethrough: ["strikethrough"],
  code_inline: ["code_inline"],
  link: ["link"],
  math_inline: ["math_inline"],
  heading: ["heading"],
  escape: ["escape"],
};

/**
 * 查找文档中所有的 syntax_marker 区域
 */
export function findSyntaxMarkerRegions(doc: Node): SyntaxMarkerRegion[] {
  const regions: SyntaxMarkerRegion[] = [];

  doc.descendants((node, pos) => {
    if (node.isText) {
      const syntaxMark = node.marks.find((m) => m.type.name === "syntax_marker");
      if (syntaxMark) {
        regions.push({
          from: pos,
          to: pos + node.nodeSize,
          syntaxType: syntaxMark.attrs.syntaxType,
        });
      }
    }
    return true;
  });

  return regions;
}

/** 行内数学公式区域 */
export interface MathInlineRegion {
  from: number;
  to: number;
  content: string;
  contentFrom: number;
  contentTo: number;
}

/**
 * 查找文档中所有的行内数学公式区域
 */
export function findMathInlineRegions(doc: Node): MathInlineRegion[] {
  const regions: MathInlineRegion[] = [];

  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      // 在文本块中查找 math_inline mark 区域
      let offset = pos + 1; // +1 跳过节点开始标记
      let currentRegion: {
        from: number;
        to: number;
        content: string;
        contentFrom: number;
        contentTo: number;
      } | null = null;

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        const childStart = offset;
        const childEnd = offset + child.nodeSize;

        const hasMathMark = child.marks.some((m) => m.type.name === "math_inline");
        const hasSyntaxMark = child.marks.some(
          (m) => m.type.name === "syntax_marker" && m.attrs.syntaxType === "math_inline"
        );

        if (hasMathMark) {
          if (currentRegion === null) {
            currentRegion = {
              from: childStart,
              to: childEnd,
              content: "",
              contentFrom: childStart,
              contentTo: childEnd,
            };
          } else {
            currentRegion.to = childEnd;
          }

          // 如果不是语法标记，则是内容
          if (!hasSyntaxMark && child.isText) {
            if (currentRegion.content === "") {
              currentRegion.contentFrom = childStart;
            }
            currentRegion.content += child.text || "";
            currentRegion.contentTo = childEnd;
          }
        } else {
          if (currentRegion !== null) {
            regions.push(currentRegion);
            currentRegion = null;
          }
        }

        offset = childEnd;
      }

      // 不要忘记最后一个区域
      if (currentRegion !== null) {
        regions.push(currentRegion);
      }
    }
    return true;
  });

  return regions;
}

/**
 * 查找包含指定位置的所有语义 Mark 区域
 * 用于判断光标是否在某个语法结构内
 * 返回所有相关的语义区域（支持嵌套语法）
 */
export function findSemanticRegionsAt(
  doc: Node,
  pos: number
): Array<{ type: string; from: number; to: number }> {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;

  if (!parent.isTextblock) return [];

  // 保存父节点内容的开始位置
  const parentStart = $pos.start();
  let offset = parentStart;
  const regions: Array<{ type: string; from: number; to: number }> = [];
  const foundTypes = new Set<string>();

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childStart = offset;
    const childEnd = offset + child.nodeSize;

    if (pos >= childStart && pos <= childEnd) {
      // 检查这个节点的所有 marks
      for (const mark of child.marks) {
        if (
          mark.type.name !== "syntax_marker" &&
          SYNTAX_CLASSES[mark.type.name] &&
          !foundTypes.has(mark.type.name)
        ) {
          // 找到语义 mark，现在需要找到整个区域
          const region = findFullMarkRegion(parent, mark.type.name, childStart, parentStart);
          if (region) {
            regions.push(region);
            foundTypes.add(mark.type.name);
          }
        }
      }
    }

    offset = childEnd;
  }

  return regions;
}

/**
 * 查找包含指定位置的语义 Mark 区域（兼容旧接口）
 */
export function findSemanticRegionAt(
  doc: Node,
  pos: number
): { type: string; from: number; to: number } | null {
  const regions = findSemanticRegionsAt(doc, pos);
  return regions.length > 0 ? regions[0] : null;
}

/**
 * 找到完整的 mark 区域（包括相邻的同类型 mark 节点）
 * 确保找到包含 startHint 位置的连续区域
 */
function findFullMarkRegion(
  parent: Node,
  markType: string,
  startHint: number,
  parentOffset: number
): { type: string; from: number; to: number } | null {
  // 收集所有有该 mark 的连续区域
  const regions: Array<{ from: number; to: number }> = [];
  let currentRegion: { from: number; to: number } | null = null;
  let offset = parentOffset;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childStart = offset;
    const childEnd = offset + child.nodeSize;

    const hasMark = child.marks.some((m) => m.type.name === markType);

    if (hasMark) {
      if (currentRegion === null) {
        currentRegion = { from: childStart, to: childEnd };
      } else {
        currentRegion.to = childEnd;
      }
    } else {
      if (currentRegion !== null) {
        regions.push(currentRegion);
        currentRegion = null;
      }
    }

    offset = childEnd;
  }

  // 不要忘记最后一个区域
  if (currentRegion !== null) {
    regions.push(currentRegion);
  }

  // 找到包含 startHint 的区域
  for (const region of regions) {
    if (startHint >= region.from && startHint <= region.to) {
      return { type: markType, from: region.from, to: region.to };
    }
  }

  // 如果没找到，返回第一个区域（兜底）
  if (regions.length > 0) {
    return { type: markType, from: regions[0].from, to: regions[0].to };
  }

  return null;
}

/**
 * 检查光标是否在语法区域内
 */
export function isCursorInSyntaxRegion(
  doc: Node,
  cursorPos: number,
  syntaxRegions: SyntaxMarkerRegion[]
): boolean {
  // 首先检查是否在 syntax_marker 内
  for (const region of syntaxRegions) {
    if (cursorPos >= region.from && cursorPos <= region.to) {
      return true;
    }
  }

  // 然后检查是否在语义 mark 区域内
  const semanticRegion = findSemanticRegionAt(doc, cursorPos);
  return semanticRegion !== null;
}

/**
 * 获取光标所在的所有语义区域
 * 包括行内 marks 和块级节点（如标题）
 */
export function getActiveSemanticRegions(
  doc: Node,
  cursorPos: number
): Array<{ type: string; from: number; to: number }> {
  const regions: Array<{ type: string; from: number; to: number }> = [];

  // 首先检查行内 mark 区域
  const inlineRegions = findSemanticRegionsAt(doc, cursorPos);
  regions.push(...inlineRegions);

  // 检查块级节点（如标题）
  const $pos = doc.resolve(cursorPos);
  const parent = $pos.parent;

  // 如果父节点是标题，返回整个标题区域
  if (parent.type.name === "heading") {
    const start = $pos.start();
    const end = $pos.end();
    regions.push({ type: "heading", from: start, to: end });
  }

  return regions;
}

/**
 * 获取光标所在的语义区域（兼容旧接口）
 */
export function getActiveSemanticRegion(
  doc: Node,
  cursorPos: number
): { type: string; from: number; to: number } | null {
  const regions = getActiveSemanticRegions(doc, cursorPos);
  return regions.length > 0 ? regions[0] : null;
}

/**
 * 检查语法类型是否与语义区域类型相关
 */
function isSyntaxTypeRelated(syntaxType: string, semanticType: string): boolean {
  const relatedTypes = SYNTAX_TYPE_RELATIONS[syntaxType] || [syntaxType];
  return relatedTypes.includes(semanticType);
}

/**
 * 计算装饰集
 */
export function computeDecorations(
  doc: Node,
  cursorPos: number,
  sourceView: boolean
): { decorations: DecorationSet; activeRegions: SyntaxMarkerRegion[] } {
  const syntaxRegions = findSyntaxMarkerRegions(doc);
  const mathInlineRegions = findMathInlineRegions(doc);
  const decorations: Decoration[] = [];

  // 获取光标所在的所有语义区域
  const activeSemanticRegions = getActiveSemanticRegions(doc, cursorPos);

  for (const region of syntaxRegions) {
    // 判断这个语法标记是否应该显示
    let shouldShow = sourceView;

    if (!shouldShow && region.syntaxType === "escape") {
      // escape 类型特殊处理：当光标在 `\` 或紧邻的被转义字符上时显示
      // region 是 `\` 的位置，被转义字符紧跟其后（region.to 位置）
      if (cursorPos >= region.from && cursorPos <= region.to + 1) {
        shouldShow = true;
      }
    } else if (!shouldShow && activeSemanticRegions.length > 0) {
      // 如果光标在某个语义区域内，显示该区域的所有语法标记
      for (const activeRegion of activeSemanticRegions) {
        // 检查这个 syntax_marker 是否属于当前活跃的语义区域
        if (isSyntaxTypeRelated(region.syntaxType, activeRegion.type)) {
          // 检查位置是否在语义区域内（严格检查）
          if (region.from >= activeRegion.from && region.to <= activeRegion.to) {
            shouldShow = true;
            break;
          }
        }
      }
    }

    if (!shouldShow) {
      // 检查光标是否直接在这个 syntax_marker 内
      if (cursorPos >= region.from && cursorPos <= region.to) {
        shouldShow = true;
      }
    }

    if (!shouldShow) {
      // 隐藏语法标记
      decorations.push(
        Decoration.inline(region.from, region.to, {
          class: "milkup-syntax-hidden",
        })
      );
    } else {
      // 显示语法标记
      decorations.push(
        Decoration.inline(region.from, region.to, {
          class: "milkup-syntax-visible",
        })
      );
    }
  }

  // 为行内数学公式添加渲染装饰
  for (const mathRegion of mathInlineRegions) {
    // 检查光标是否在这个数学公式区域内
    const cursorInMath = cursorPos >= mathRegion.from && cursorPos <= mathRegion.to;

    if (!cursorInMath && !sourceView && mathRegion.content.trim()) {
      // 光标不在公式内，隐藏源码并显示渲染结果
      // 隐藏整个公式源码
      decorations.push(
        Decoration.inline(mathRegion.from, mathRegion.to, {
          class: "milkup-math-source-hidden",
        })
      );

      // 在公式后面添加渲染后的 widget
      const renderedHtml = renderInlineMath(mathRegion.content);
      if (renderedHtml) {
        const widget = document.createElement("span");
        widget.className = "milkup-math-rendered";
        widget.innerHTML = renderedHtml;
        decorations.push(Decoration.widget(mathRegion.to, widget, { side: -1 }));
      }
    }
  }

  return {
    decorations: DecorationSet.create(doc, decorations),
    activeRegions: syntaxRegions.filter((r) => cursorPos >= r.from && cursorPos <= r.to),
  };
}

/**
 * 兼容旧接口
 */
export function findSyntaxRegions(doc: Node): SyntaxRegion[] {
  return [];
}

export function findMarkRegions(doc: Node): MarkRegion[] {
  return [];
}

export function getActiveRegions(cursorPos: number, regions: any[]): any[] {
  return regions.filter((r) => cursorPos >= r.from && cursorPos <= r.to);
}

/**
 * 创建装饰插件
 */
export function createDecorationPlugin(initialSourceView = false): Plugin<DecorationPluginState> {
  return new Plugin<DecorationPluginState>({
    key: decorationPluginKey,

    state: {
      init(_, state) {
        const { decorations, activeRegions } = computeDecorations(
          state.doc,
          state.selection.head,
          initialSourceView
        );
        return {
          decorations,
          activeRegions,
          sourceView: initialSourceView,
        };
      },

      apply(tr, pluginState, oldState, newState) {
        const selectionChanged = !oldState.selection.eq(newState.selection);
        const docChanged = tr.docChanged;

        const meta = tr.getMeta(decorationPluginKey);
        const sourceView = meta?.sourceView ?? pluginState.sourceView;

        if (docChanged || selectionChanged || meta?.sourceView !== undefined) {
          const { decorations, activeRegions } = computeDecorations(
            newState.doc,
            newState.selection.head,
            sourceView
          );
          return {
            decorations,
            activeRegions,
            sourceView,
          };
        }

        return pluginState;
      },
    },

    props: {
      decorations(state) {
        return this.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

/**
 * 切换源码视图
 */
export function toggleSourceView(state: EditorState, dispatch?: (tr: any) => void): boolean {
  const pluginState = decorationPluginKey.getState(state);
  if (!pluginState) return false;

  const newSourceView = !pluginState.sourceView;

  if (dispatch) {
    const tr = state.tr.setMeta(decorationPluginKey, {
      sourceView: newSourceView,
    });
    dispatch(tr);
  }

  // 通知状态管理器
  sourceViewManager.setState(newSourceView);

  return true;
}

/**
 * 设置源码视图状态
 */
export function setSourceView(
  state: EditorState,
  enabled: boolean,
  dispatch?: (tr: any) => void
): boolean {
  if (dispatch) {
    const tr = state.tr.setMeta(decorationPluginKey, { sourceView: enabled });
    dispatch(tr);
  }

  // 通知状态管理器
  sourceViewManager.setState(enabled);

  return true;
}

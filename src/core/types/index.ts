/**
 * Milkup 核心类型定义
 */

import type { EditorState, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node, Schema } from "prosemirror-model";
import type { PastePluginConfig } from "../plugins/paste";

/** 编辑器配置 */
export interface MilkupConfig {
  /** 初始 Markdown 内容 */
  content?: string;
  /** 是否只读 */
  readonly?: boolean;
  /** 是否启用源码视图（显示所有语法标记） */
  sourceView?: boolean;
  /** 图片路径处理器 */
  imagePathProcessor?: ImagePathProcessor;
  /** 粘贴插件配置 */
  pasteConfig?: PastePluginConfig;
  /** 自定义插件 */
  plugins?: MilkupPlugin[];
}

/** 图片路径处理器 */
export interface ImagePathProcessor {
  /** 处理图片路径（渲染时） */
  process: (path: string, basePath: string | null) => string;
  /** 反向处理（保存时） */
  reverse: (path: string, basePath: string | null) => string;
}

/** Milkup 插件 */
export interface MilkupPlugin {
  name: string;
  init?: (editor: MilkupEditor) => void;
  destroy?: () => void;
}

/** Milkup 编辑器实例 */
export interface MilkupEditor {
  /** ProseMirror 视图 */
  view: EditorView;
  /** 获取 Markdown 内容 */
  getMarkdown: () => string;
  /** 设置 Markdown 内容 */
  setMarkdown: (content: string) => void;
  /** 获取当前配置 */
  getConfig: () => MilkupConfig;
  /** 更新配置 */
  updateConfig: (config: Partial<MilkupConfig>) => void;
  /** 销毁编辑器 */
  destroy: () => void;
  /** 聚焦编辑器 */
  focus: () => void;
  /** 获取光标位置（在源码中的偏移量） */
  getCursorOffset: () => number;
  /** 设置光标位置 */
  setCursorOffset: (offset: number) => void;
}

/** 语法类型 */
export type SyntaxType =
  // 块级
  | "heading"
  | "paragraph"
  | "blockquote"
  | "code_block"
  | "horizontal_rule"
  | "bullet_list"
  | "ordered_list"
  | "list_item"
  | "task_list"
  | "task_item"
  | "table"
  | "table_row"
  | "table_cell"
  | "table_header"
  | "math_block"
  | "container"
  // 行内
  | "text"
  | "strong"
  | "emphasis"
  | "code_inline"
  | "strikethrough"
  | "link"
  | "image"
  | "math_inline"
  | "highlight"
  | "footnote_ref"
  | "hard_break";

/** 语法标记信息 */
export interface SyntaxMarker {
  /** 语法类型 */
  type: SyntaxType;
  /** 开始标记 */
  prefix: string;
  /** 结束标记 */
  suffix: string;
  /** 在源码中的起始位置 */
  sourceStart: number;
  /** 在源码中的结束位置 */
  sourceEnd: number;
  /** 在文档中的起始位置 */
  docStart: number;
  /** 在文档中的结束位置 */
  docEnd: number;
}

/** 位置映射 - 源码位置到文档位置 */
export interface PositionMap {
  /** 源码位置到文档位置 */
  sourceToDoc: (sourcePos: number) => number;
  /** 文档位置到源码位置 */
  docToSource: (docPos: number) => number;
  /** 获取指定位置的语法标记 */
  getMarkersAt: (docPos: number) => SyntaxMarker[];
}

/** 装饰状态 */
export interface DecorationState {
  /** 当前光标所在的语法区域 */
  activeSyntax: SyntaxMarker[];
  /** 是否处于源码视图模式 */
  sourceView: boolean;
}

/** 事件类型 */
export type MilkupEventType = "change" | "selectionChange" | "focus" | "blur";

/** 事件处理器 */
export type MilkupEventHandler<T = any> = (data: T) => void;

/** 变更事件数据 */
export interface ChangeEventData {
  markdown: string;
  transaction: Transaction;
}

/** 选区变更事件数据 */
export interface SelectionChangeEventData {
  from: number;
  to: number;
  sourceFrom: number;
  sourceTo: number;
}

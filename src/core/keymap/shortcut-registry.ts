/**
 * 快捷键默认注册表
 */

import type { ShortcutDefinition } from "./types";

/** 所有可自定义快捷键的默认注册表 */
export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // 内联格式
  { id: "toggleStrong", label: "粗体", category: "inline", key: "Mod-b", defaultKey: "Mod-b" },
  { id: "toggleEmphasis", label: "斜体", category: "inline", key: "Mod-i", defaultKey: "Mod-i" },
  {
    id: "toggleCodeInline",
    label: "行内代码",
    category: "inline",
    key: "Mod-`",
    defaultKey: "Mod-`",
  },
  {
    id: "toggleStrikethrough",
    label: "删除线",
    category: "inline",
    key: "Mod-Shift-s",
    defaultKey: "Mod-Shift-s",
  },
  {
    id: "toggleHighlight",
    label: "高亮",
    category: "inline",
    key: "Mod-Shift-h",
    defaultKey: "Mod-Shift-h",
  },

  // 块级格式
  { id: "setHeading1", label: "一级标题", category: "block", key: "Mod-1", defaultKey: "Mod-1" },
  { id: "setHeading2", label: "二级标题", category: "block", key: "Mod-2", defaultKey: "Mod-2" },
  { id: "setHeading3", label: "三级标题", category: "block", key: "Mod-3", defaultKey: "Mod-3" },
  { id: "setHeading4", label: "四级标题", category: "block", key: "Mod-4", defaultKey: "Mod-4" },
  { id: "setHeading5", label: "五级标题", category: "block", key: "Mod-5", defaultKey: "Mod-5" },
  { id: "setHeading6", label: "六级标题", category: "block", key: "Mod-6", defaultKey: "Mod-6" },
  { id: "setParagraph", label: "段落", category: "block", key: "Mod-0", defaultKey: "Mod-0" },
  {
    id: "setCodeBlock",
    label: "代码块",
    category: "block",
    key: "Mod-Shift-c",
    defaultKey: "Mod-Shift-c",
  },
  {
    id: "wrapInBlockquote",
    label: "引用",
    category: "block",
    key: "Mod-Shift-q",
    defaultKey: "Mod-Shift-q",
  },
  {
    id: "wrapInBulletList",
    label: "无序列表",
    category: "block",
    key: "Mod-Shift-u",
    defaultKey: "Mod-Shift-u",
  },
  {
    id: "wrapInOrderedList",
    label: "有序列表",
    category: "block",
    key: "Mod-Shift-o",
    defaultKey: "Mod-Shift-o",
  },
  {
    id: "liftBlock",
    label: "取消嵌套",
    category: "block",
    key: "Mod-Shift-l",
    defaultKey: "Mod-Shift-l",
  },

  // 插入
  {
    id: "insertHorizontalRule",
    label: "分割线",
    category: "insert",
    key: "Mod-Shift-minus",
    defaultKey: "Mod-Shift-minus",
  },
  {
    id: "insertTable",
    label: "表格",
    category: "insert",
    key: "Mod-Shift-t",
    defaultKey: "Mod-Shift-t",
  },
  {
    id: "insertMathBlock",
    label: "数学公式",
    category: "insert",
    key: "Mod-Shift-m",
    defaultKey: "Mod-Shift-m",
  },

  // 编辑器操作
  {
    id: "toggleSourceView",
    label: "源码视图",
    category: "editor",
    key: "Mod-/",
    defaultKey: "Mod-/",
  },
  { id: "undo", label: "撤销", category: "editor", key: "Mod-z", defaultKey: "Mod-z" },
  { id: "redo", label: "重做", category: "editor", key: "Mod-y", defaultKey: "Mod-y" },
];

/** 分类中文名映射 */
export const CATEGORY_LABELS: Record<string, string> = {
  inline: "内联格式",
  block: "块级格式",
  insert: "插入",
  editor: "编辑器操作",
};
